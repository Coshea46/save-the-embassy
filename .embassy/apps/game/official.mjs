import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";

import { homedir } from "node:os";
import { assignmentSchema, rest } from "@embassy/contracts";
import { createScenario, Simulation, RULESET } from "@embassy/simulation";
import { fullCatalogue } from "@embassy/tasks";
import { Practice } from "./session.mjs";
import { Synchroniser } from "./sync.mjs";

function connectionError(cause) {
  const message =
    cause.name === "TimeoutError"
      ? "The competition server did not respond within 45 seconds."
      : "The connection to the competition server was interrupted.";
  throw Object.assign(new Error(message, { cause }), { reason: "connection" });
}

function endpoint(base, route, ids) {
  const path = route.path.replace(/:(\w+)/g, (_, k) =>
    encodeURIComponent(ids[k]),
  );
  return base.replace(/\/$/, "") + path;
}

export function checkedUrl(value) {
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.protocol === "https:" || (local && url.protocol === "http:"))
  )
    throw new Error("Use an HTTPS service URL or HTTP on loopback.");
  return url.href.replace(/\/$/, "");
}

export function remoteTransport(service) {
  const base = checkedUrl(service);

  return async (operation, ids, data, token) => {
    const route = rest[operation];
    const request = route.request.parse(data);
    const response = await fetch(endpoint(base, route, ids), {
      method: route.method,
      redirect: "error",
      signal: AbortSignal.timeout(45000),
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: "Bearer " + token }),
      },
      body: route.method === "GET" ? undefined : JSON.stringify(request),
    }).catch(connectionError);
    const rawBody = await response.text().catch(connectionError);
    if (!response.ok) {
      let problem;
      try {
        problem = JSON.parse(rawBody);
      } catch {
        // A proxy may return an empty or HTML error with a Retry-After header.
      }
      const error = new Error(
        typeof problem?.error === "string"
          ? problem.error
          : "Competition server returned HTTP " + response.status,
      );
      error.status = response.status;
      if (response.status === 429) {
        const raw = response.headers.get("retry-after");
        const seconds =
          raw && !Number.isNaN(Number(raw))
            ? Number(raw)
            : (Date.parse(raw) - Date.now()) / 1000;
        error.retryMs =
          Number.isSafeInteger(problem?.retry_ms) && problem?.retry_ms > 0
            ? problem?.retry_ms
            : Number.isFinite(seconds)
              ? Math.max(1, Math.ceil(seconds * 1000))
              : 2000;
        error.reason =
          problem?.reason === "simulation_pacing" ||
          problem?.error === "Wait for simulation time"
            ? "simulation_pacing"
            : "rate_limit";
      }
      throw error;
    }
    return route.response.parse(JSON.parse(rawBody));
  };
}

export function mockTransport() {
  const participant_id = randomUUID(),
    run_id = randomUUID();
  const scenario = createScenario(42, "training-room", fullCatalogue);
  const sim = new Simulation(scenario, fullCatalogue);
  const receipts = new Map();
  let sequence = 0;
  const status = () => ({
    run_id,
    manifest: scenario.manifest,
    next_sequence: sequence,
    tick: sim.metrics.survival_ticks,
    status: sim.status,
    metrics: sim.metrics,
    observation: sim.status === "playing" ? sim.observe() : null,
  });
  return async (operation, ids, body) => {
    const route = rest[operation];
    route.request.parse(body);
    let result;
    if (operation === "register")
      result = { participant_id, access_token: "local-rehearsal" };
    else if (operation === "join")
      result = { workshop_id: ids.workshop_id, participant_id };
    else if (operation === "assign") {
      const ids = new Set(scenario.events.map((e) => e.definition_id));
      result = {
        protocol: 2,
        run_id,
        deadline: new Date(Date.now() + 1800000).toISOString(),
        scenario,
        catalogue: {
          version: fullCatalogue.version,
          definitions: fullCatalogue.definitions.filter((d) => ids.has(d.id)),
        },
      };
    } else if (operation === "batch") {
      for (const d of body.decisions) {
        if (
          d.sequence < sequence &&
          receipts.get(d.sequence) === d.idempotency_key
        )
          continue;
        if (d.sequence !== sequence)
          throw new Error("Rehearsal sequence mismatch");
        sim.decide(d.selected_task_id);
        receipts.set(sequence++, d.idempotency_key);
      }
      result = { run_id, next_sequence: sequence, score: sim.metrics.score };
    } else if (operation === "finish" && sim.status !== "playing")
      result = status();
    else throw new Error("Unexpected rehearsal request");
    return route.response.parse(result);
  };
}

export function credentialStore(base, workshop) {
  const dir = join(homedir(), ".embassy-dispatch");
  const file = join(
    dir,
    createHash("sha256")
      .update(base + "|" + workshop)
      .digest("hex") + ".json",
  );
  return {
    base,
    workshop,
    async load() {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return {};
        throw error;
      }
    },
    async save(state) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temp = file + "." + randomUUID();
      await writeFile(temp, JSON.stringify(state), {
        mode: 0o600,
        flush: true,
      });
      await rename(temp, file);
    },
  };
}

// Only v2 journals carry their service origin. Resume locally even if the API is down.
export async function savedWorkshops() {
  const dir = join(homedir(), ".embassy-dispatch");
  let files;
  try {
    files = await readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const saved = [];
  for (const name of files.filter((n) => /^[a-f0-9]{64}\.json$/.test(n))) {
    const file = join(dir, name);
    const data = JSON.parse(await readFile(file, "utf8"));
    if (data.assignment && data.base && !data.finished)
      saved.push({
        base: checkedUrl(data.base),
        workshop: data.workshop,
        mtime: (await stat(file)).mtimeMs,
      });
  }
  return saved.sort((a, b) => a.mtime - b.mtime);
}

export class Official {
  constructor(transport, store, workshop, mock, leaderboard) {
    Object.assign(this, {
      call: transport,
      store,
      workshop,
      mock,
      leaderboard,
    });
    this.writes = Promise.resolve();
  }
  // Queue disk I/O only. A slow HTTP request never owns this queue.
  persist() {
    const snapshot = structuredClone(this.data);
    const write = this.writes.then(() => this.store.save(snapshot));
    this.writes = write.catch(() => {});
    return write;
  }
  async connect(display_name, join_code, player) {
    const d = (this.data = await this.store.load());
    if (
      player &&
      d.participant_id &&
      player.participant_id !== d.participant_id
    )
      throw new Error(
        "A different player already has a saved run for this workshop.",
      );
    if (!d.joined && !player && d.name && d.name !== display_name) {
      delete d.participant_id;
      delete d.access_token;
    }
    if (player) Object.assign(d, player, { joined: true });
    const ids = { workshop_id: this.workshop };
    if (!d.access_token) {
      Object.assign(d, await this.call("register", ids, { display_name }));
      d.name = display_name;
      await this.persist();
    }
    if (!d.joined) {
      await this.call("join", ids, { join_code }, d.access_token);
      d.joined = true;
      await this.persist();
    }
    if (d.status && !d.assignment) {
      if (!d.finished)
        throw new Error(
          "This attempt started with the previous launcher. Resume it with that launcher before starting another attempt.",
        );
      return this.frame();
    }
    if (!d.assignment) await this.assign();
    else this.restore();
    return this.frame();
  }
  async assign() {
    const d = this.data;
    d.nextStartKey ??= randomUUID();
    await this.persist();
    const bundle = await this.call(
      "assign",
      { workshop_id: this.workshop },
      { idempotency_key: d.nextStartKey },
      d.access_token,
    );
    this.data = {
      participant_id: d.participant_id,
      access_token: d.access_token,
      joined: true,
      base: this.store.base,
      workshop: this.workshop,
      startKey: d.nextStartKey,
      assignment: bundle,
      journal: [],
      ack: 0,
      verifiedScore: 0,
      finished: false,
      finishKey: randomUUID(),
    };
    this.restore();
    await this.persist();
  }
  restore() {
    const d = this.data;
    const { scenario, catalogue } = assignmentSchema.parse(d.assignment);
    if (scenario.rules.version !== RULESET)
      throw new Error("Update the launcher to use this scenario ruleset.");
    this.game = Practice.assigned(scenario, catalogue, d.local);
    this.durable = d.journal.length;
    this.ended = this.game.sim.status !== "playing";
    this.sync = new Synchroniser(this);
    this.sync.wake();
  }
  async anotherAttempt() {
    if (!this.data.finished || this.mock)
      throw new Error("Finish verification first.");
    await this.assign();
    return this.frame();
  }
  async advance(bridge) {
    // If a disk write failed, retry it before asking Python for another choice.
    if (!this.dirty) {
      await this.game.advance(bridge, (sequence, tick, selected_task_id) => {
        this.data.journal.push({
          sequence,
          tick,
          selected_task_id,
          idempotency_key: randomUUID(),
        });
      });
      this.data.local = this.game.snapshot();
      this.dirty = true;
    }
    await this.persist();
    this.dirty = false;
    this.durable = this.data.journal.length;
    this.ended = this.game.sim.status !== "playing";
    this.sync.wake();
    return this.frame();
  }
  frame() {
    const d = this.data;
    const f = this.game?.frame() ?? {
      status: d.status.status,
      tick: d.status.tick,
      metrics: d.status.metrics,
      decisions: d.status.next_sequence,
      position: d.position ?? { x: 9, y: 5 },
      active: null,
      reports: [],
      log: d.log ?? [],
      history: d.history ?? [],
    };
    return {
      ...f,
      mode: this.mock ? "rehearsal" : "official",
      verified: !this.mock && d.finished,
      verifiedScore: d.verifiedScore ?? d.status?.metrics.score,
      deadline: d.assignment?.deadline,
      verification: d.failure
        ? "Verification failed"
        : d.finished
          ? "Score verified"
          : this.sync?.offline
            ? "Offline"
            : this.ended
              ? "Awaiting final verification"
              : d.ack < this.durable
                ? "Synchronising"
                : "Connected",
      verificationError: d.failure,
      leaderboard: this.mock ? null : this.leaderboard,
    };
  }
}

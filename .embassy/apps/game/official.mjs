import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { homedir } from "node:os";
import { rest } from "@embassy/contracts";
import {
  createScenario,
  Simulation,
  entrance,
  shortestPath,
} from "@embassy/simulation";
import { fullCatalogue } from "@embassy/tasks";
import { roomAt } from "./session.mjs";

function connectionError(cause) {
  const message =
    cause.name === "TimeoutError"
      ? "The competition server did not respond within 12 seconds."
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
  let nextWait;
  return async (operation, ids, data, token) => {
    const route = rest[operation];
    const request = route.request.parse(data);
    if (
      operation === "decide" &&
      request.selected_task_id === null &&
      nextWait &&
      nextWait.run === ids.run_id &&
      nextWait.sequence === request.sequence
    ) {
      const remaining = nextWait.readyAt - performance.now();
      if (remaining > 0) await sleep(Math.ceil(remaining));
    }
    const response = await fetch(endpoint(base, route, ids), {
      method: route.method,
      redirect: "error",
      signal: AbortSignal.timeout(12000),
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
    const result = route.response.parse(JSON.parse(rawBody));
    if ("run_id" in result) {
      // Before pacing metadata existed, official servers used one second per tick.
      const tickMs = Number(response.headers.get("Embassy-Tick-Ms")) || 1000;
      const waitMs = Number(response.headers.get("Embassy-Next-Wait-Ms"));
      nextWait =
        Number.isFinite(waitMs) && waitMs > 0 && waitMs <= tickMs
          ? {
              run: result.run_id,
              sequence: result.next_sequence,
              readyAt: performance.now() + waitMs,
            }
          : undefined;
      return { ...result, tickMs };
    }
    return result;
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
    else if (receipts.has(body.idempotency_key))
      result = receipts.get(body.idempotency_key);
    else {
      if (operation === "decide") {
        if (sequence !== body.sequence)
          throw new Error("Mock sequence mismatch");
        sim.decide(body.selected_task_id);
        sequence++;
      }
      if (operation === "finish" && sim.status === "playing")
        throw new Error("Shift still running");
      result = status();
      if (body.idempotency_key) receipts.set(body.idempotency_key, result);
    }
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
      await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
      await rename(temp, file);
    },
  };
}

export class Official {
  constructor(transport, store, workshop, mock, leaderboard) {
    this.call = transport;
    this.store = store;
    this.workshop = workshop;
    this.mock = mock;
    this.leaderboard = leaderboard;
  }
  persist() {
    return this.store.save(this.data);
  }
  async connect(display_name, join_code, player) {
    this.data = await this.store.load();
    const d = this.data;
    const ids = { workshop_id: this.workshop };
    if (player) {
      if (d.participant_id && d.participant_id !== player.participant_id)
        throw new Error(
          "A different player already has a saved run for this workshop.",
        );
      Object.assign(d, player, { joined: true });
    }
    if (!d.joined && d.name && d.name !== display_name) {
      delete d.access_token;
      delete d.participant_id;
    }
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
    d.history ??= [];
    d.log ??= [];
    if (!d.status) {
      d.startKey ??= randomUUID();
      await this.persist();
      d.status = await this.call(
        "start",
        ids,
        { idempotency_key: d.startKey },
        d.access_token,
      );
    } else if (!d.pending) {
      d.status = await this.call(
        "status",
        { run_id: d.status.run_id },
        {},
        d.access_token,
      );
    }
    await this.persist();
    return this.frame();
  }
  async anotherAttempt() {
    const d = this.data;
    if (!d.finished || this.mock)
      throw new Error("Finish this official run first.");
    d.nextStartKey ??= randomUUID();
    await this.persist();
    const status = await this.call(
      "start",
      { workshop_id: this.workshop },
      { idempotency_key: d.nextStartKey },
      d.access_token,
    );
    Object.assign(d, {
      status,
      startKey: d.nextStartKey,
      history: [],
      log: [],
      finished: false,
      position: entrance,
    });
    delete d.nextStartKey;
    await this.persist();
    return this.frame();
  }
  async advance(bridge) {
    const d = this.data;
    if (!d.pending) {
      const playing = d.status.status === "playing";
      const chosen = playing ? await bridge.choose(d.status.observation) : null;
      d.pending = {
        op: playing ? "decide" : "finish",
        body: {
          sequence: d.status.next_sequence,
          idempotency_key: randomUUID(),
          ...(playing && { selected_task_id: chosen }),
        },
      };
    }
    // Journal the exact choice before sending. A lost response reuses the same receipt.
    await this.persist();
    const { op, body } = d.pending;
    const before = d.status;
    const after = await this.call(
      op,
      { run_id: before.run_id },
      body,
      d.access_token,
    );
    let route = [];
    if (op === "decide") {
      const task = before.observation.available_tasks.find(
        (t) => t.id === body.selected_task_id,
      );
      const prior = d.log[0];
      if (
        !task &&
        prior?.waitTicks &&
        prior.tick + prior.waitTicks === before.tick
      ) {
        prior.waitTicks++;
        prior.text = "Wait " + prior.waitTicks + " ticks";
      } else {
        d.log.unshift({
          tick: before.tick,
          text: task ? "Selected " + task.title : "Wait one tick",
          ...(!task && { waitTicks: 1 }),
        });
      }
      if (task) {
        const travelled = after.metrics.travel - before.metrics.travel;
        route = shortestPath(
          before.observation.agent.position,
          task.position,
        ).slice(0, travelled);
        d.position = route.at(-1) ?? before.observation.agent.position;
      }
      if (task && after.metrics.completed > before.metrics.completed) {
        d.history.unshift({
          tick: after.tick,
          title: task.title,
          outcome: "Completed",
          reward: task.reward,
        });
      }
    } else d.finished = true;
    d.position =
      after.observation?.agent.position ??
      d.position ??
      before.observation?.agent.position;
    d.status = after;
    d.pending = null;
    await this.persist();
    return { ...this.frame(), route };
  }
  frame() {
    const d = this.data,
      s = d.status;
    return {
      mode: this.mock ? "rehearsal" : "official",
      seed: null,
      officialSpeed: this.mock ? null : 1000 / (s.tickMs ?? 1000),
      tick: s.tick,
      status: s.status !== "playing" && !d.finished ? "verifying" : s.status,
      position: s.observation?.agent.position ?? d.position ?? entrance,
      active: null,
      reports: (s.observation?.available_tasks ?? []).map((t) => ({
        ...t,
        room: roomAt(t.position),
      })),
      history: d.history,
      log: d.log,
      metrics: s.metrics,
      decisions: s.next_sequence,
      verified: !this.mock && d.finished === true,
      leaderboard: this.mock ? null : this.leaderboard,
    };
  }
}

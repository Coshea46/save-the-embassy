import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { subscribeStandings } from "../../leaderboard/src/live.js";
import { batchLimit, rest } from "@embassy/contracts";
import { createScenario, Simulation } from "@embassy/simulation";
import { strategies } from "@embassy/strategies";
import { Official } from "../../game/official.mjs";
import { fixture } from "./fixture.mjs";

function stats(values) {
  const xs = values.toSorted((a, b) => a - b),
    pct = (p) => xs[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)];
  return xs.length
    ? {
        count: xs.length,
        p50_ms: +pct(0.5).toFixed(1),
        p95_ms: +pct(0.95).toFixed(1),
        p99_ms: +pct(0.99).toFixed(1),
        max_ms: +xs.at(-1).toFixed(1),
      }
    : { count: 0 };
}
async function waitFor(check, timeout = 60000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw Error("Timed out waiting for Realtime");
    await sleep(50);
  }
}
function viewer(url, key, workshop) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let stop;
  const delivered = new Map();
  const observed = new Map();
  async function connect() {
    let ready = false;
    stop = subscribeStandings(
      client,
      workshop,
      (e) => {
        observed.set(e.new.display_name, e.new);
        if (e.new.score > 0 && !delivered.has(e.new.display_name))
          delivered.set(
            e.new.display_name,
            Date.now() - Date.parse(e.commit_timestamp),
          );
      },
      (status) => {
        ready = status === "SUBSCRIBED";
      },
      "UPDATE",
    );
    await waitFor(() => ready);
  }
  async function close() {
    await stop?.();
    stop = undefined;
    client.realtime.disconnect();
  }
  return { connect, close, delivered, observed };
}
// Invoke only with an isolated fixture. No production DB or prior workshop is mutated.
export async function measure(f, { size = 200, realtime } = {}) {
  const w = await f.workshop(),
    base = "/workshops/" + w.id;
  const [{ catalogue }] =
    await f.admin`select catalogue from embassy.scenarios where id=(select scenario_id from embassy.workshops where id=${w.id})`;
  const scenarioId = randomUUID(),
    scenario = createScenario(42, scenarioId, catalogue);
  await f.admin`insert into embassy.scenarios values(${scenarioId},${JSON.stringify(scenario)}::text::jsonb,${JSON.stringify(catalogue)}::text::jsonb)`;
  await f.admin`update embassy.workshops set scenario_id=${scenarioId} where id=${w.id}`;
  const phases = {},
    localTimes = [],
    finalLag = [],
    batchSizes = [],
    clients = [],
    requests = [],
    viewers = [];
  let peak = 0,
    duplicates = 0,
    interruptions = 0,
    maxPending = 0;
  async function counters() {
    await f.admin`select pg_stat_clear_snapshot()`;
    return (
      await f.admin`select xact_commit,xact_rollback,blks_hit,blks_read,deadlocks from pg_stat_database where datname=current_database()`
    )[0];
  }
  const before = await counters(),
    started = performance.now(),
    cpu = process.cpuUsage();
  const sample = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage.rss());
  }, 100);
  const policies = [
    ...Object.values(strategies),
    (o) => o.available_tasks.find((t) => t.mandatory)?.id ?? null,
  ];
  const reference = policies.map((choose) => {
    const sim = new Simulation(scenario, catalogue);
    while (sim.status === "playing") sim.decide(choose(sim.observe()));
    return sim.checkpoint();
  });
  async function http(op, ids, body, token) {
    const route = rest[op];
    const path = route.path.replace(/:(\w+)/g, (_, k) => ids[k]);
    const r = await f.request(
      path,
      body,
      token ? { authorization: "Bearer " + token } : undefined,
    );
    requests.push(r.ms);
    (phases[op] ??= []).push(r.ms);
    assert.ok(
      r.status === 200 || r.status === 201,
      op + " " + r.status + " " + r.data.error,
    );
    return r.data;
  }
  try {
    if (realtime) {
      for (let i = 0; i < 2; i++) {
        const v = viewer(realtime.url, realtime.key, w.id);
        viewers.push(v);
        await v.connect();
      }
      await viewers[1].close();
    }
    await f.request("/admin" + base, { action: "start" }, f.cookie);
    const players = await Promise.all(
      Array.from({ length: size }, async (_, i) => {
        const name = "Agent " + String(i + 1).padStart(3, "0");
        const player = await http("register", {}, { display_name: name });
        await http(
          "join",
          { workshop_id: w.id },
          { join_code: w.code },
          player.access_token,
        );
        return { i, name, player };
      }),
    );
    await Promise.all(
      players.map(async ({ i, player }) => {
        let first = true;
        const service = async (op, ids, body, token) => {
          if (op === "batch" && first) {
            first = false;
            if (i % 4 === 0) {
              interruptions++;
              throw new Error("Campus connection interrupted");
            }
            if (i % 4 === 1) {
              duplicates++;
              const [a, b] = await Promise.all([
                http(op, ids, body, token),
                http(op, ids, body, token),
              ]);
              assert.deepEqual(a, b);
              return a;
            }
            if (i % 4 === 2) {
              const result = await http(op, ids, body, token);
              await sleep(5000);
              return result;
            }
          }
          if (op === "batch") batchSizes.push(body.decisions.length);
          return http(op, ids, body, token);
        };
        const c = new Official(
          service,
          { load: async () => ({}), save: async () => {} },
          w.id,
          false,
          null,
        );
        await c.connect(undefined, undefined, player);
        clients[i] = c;
        assert.deepEqual(c.data.assignment.scenario, scenario);
      }),
    );
    await f.request("/admin" + base, { action: "end" }, f.cookie);
    await Promise.all(
      clients.map(async (c, i) => {
        const policy = i % policies.length;
        const agent = {
          choose: async (obs) => {
            if (i % 7 === 0) await sleep(25);
            return policies[policy](obs);
          },
        };
        const t = performance.now();
        while (c.game.sim.status === "playing") {
          await c.advance(agent);
          maxPending = Math.max(maxPending, c.durable - c.data.ack);
          await sleep(5); // accelerated playback; 200 clients share this one JS process
        }
        const localEnd = performance.now();
        localTimes.push(localEnd - t);
        assert.deepEqual(c.game.sim.checkpoint(), reference[policy]);
        await waitFor(() => c.frame().verified || c.data.failure, 120000);
        assert.equal(c.data.failure, undefined);
        assert.equal(c.data.verifiedScore, reference[policy].metrics.score);
        assert.equal(c.data.ack, c.data.journal.length);
        finalLag.push(performance.now() - localEnd);
      }),
    );
    if (viewers.length) {
      await waitFor(
        () =>
          players.every(({ i, name }) => {
            const row = viewers[0].observed.get(name),
              cp = reference[i % policies.length];
            return (
              row?.score === cp.metrics.score && row.survival_ticks === cp.tick
            );
          }),
        60000,
      );
      assert.equal(viewers[0].delivered.size, size);
      await viewers[1].connect();
    }
    const board = (await f.request(base + "/display")).data;
    assert.ok(board.final && board.entries.length === size);
    const byName = new Map(board.entries.map((e) => [e.display_name, e]));
    for (const { i, name } of players) {
      const row = byName.get(name),
        cp = reference[i % policies.length];
      assert.ok(row.finalised);
      assert.equal(row.score, cp.metrics.score);
      assert.equal(row.survival_ticks, cp.tick);
      const ahead = board.entries.filter(
        (e) =>
          e.score > row.score ||
          (e.score === row.score && e.survival_ticks > row.survival_ticks),
      );
      assert.equal(row.rank, ahead.length + 1);
    }
    const [{ n, unique_runs }] =
      await f.admin`select count(*)::int n,count(distinct d.run_id)::int unique_runs from embassy.decisions d join embassy.runs r on r.id=d.run_id where r.workshop_id=${w.id}`;
    assert.equal(
      n,
      clients.reduce((n, c) => n + c.data.journal.length, 0),
    );
    assert.equal(unique_runs, size);
    assert.ok(maxPending <= scenario.rules.horizon);
    assert.equal(Math.max(...batchSizes), batchLimit);
    const publicRows =
      await f.admin`select display_name,score,survival_ticks from public.embassy_standings where workshop_id=${w.id}`;
    assert.equal(publicRows.length, size);
    for (const row of publicRows)
      assert.equal(row.score, byName.get(row.display_name).score);
    await sleep(1100);
    const after = await counters(),
      wall = (performance.now() - started) / 1000,
      used = process.cpuUsage(cpu);
    return {
      size,
      seed: 42,
      verified: size,
      score_differences: 0,
      committed_decisions: n,
      participant_requests: requests.length,
      requests_per_player: requests.length / size,
      requests_per_second: requests.length / wall,
      wall_seconds: wall,
      concurrent_duplicate_batches: duplicates,
      offline_reconnects: interruptions,
      maximum_pending_decisions: maxPending,
      maximum_batch: Math.max(...batchSizes),
      local_gameplay: stats(localTimes),
      terminal_to_verified: stats(finalLag),
      http: Object.fromEntries(
        Object.entries(phases).map(([op, times]) => [op, stats(times)]),
      ),
      database: Object.fromEntries(
        Object.keys(before).map((k) => [
          k,
          Number(after[k]) - Number(before[k]),
        ]),
      ),
      peak_node_rss_mib: peak / 2 ** 20,
      node_cpu_seconds: (used.user + used.system) / 1e6,
      realtime: viewers.length
        ? {
            commit_to_first_positive_score: stats([
              ...viewers[0].delivered.values(),
            ]),
            recovered_snapshot_rows: board.entries.length,
          }
        : null,
    };
  } finally {
    clearInterval(sample);
    for (const c of clients) await c?.sync.stop();
    for (const v of viewers) await v.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const f = await fixture();
  try {
    console.log(JSON.stringify(await measure(f), null, 2));
  } finally {
    await f.close();
  }
}

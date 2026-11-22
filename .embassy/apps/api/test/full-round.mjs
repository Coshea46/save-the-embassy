// Full wall-clock rehearsal against a new disposable PostgreSQL cluster.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Simulation } from "@embassy/simulation";
import { strategies } from "@embassy/strategies";
import { fixture } from "./fixture.mjs";

const size = 150;
const f = await fixture();
const started = performance.now(),
  cpu = process.cpuUsage();
const groups = Object.entries(strategies);
const durations = [];
let pace = 0,
  accepted = 0,
  peakRss = 0;
const sample = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage.rss());
}, 250);
try {
  const w = await f.workshop(),
    round = "/workshops/" + w.id;
  async function request(path, body, headers) {
    const r = await f.request(path, body, headers);
    durations.push(r.ms);
    return r;
  }
  async function ok(path, body, headers) {
    const r = await request(path, body, headers);
    assert.ok(
      r.status === 200 || r.status === 201,
      path + " returned " + r.status,
    );
    return r.data;
  }
  await ok("/admin" + round, { action: "start" }, f.cookie);
  const pilots = await Promise.all(
    Array.from({ length: size }, async (_, i) => {
      const name = "Pilot " + String(i + 1).padStart(3, "0");
      const player = await ok("/participants", { display_name: name });
      const headers = { authorization: "Bearer " + player.access_token };
      await ok(round + "/join", { join_code: w.code }, headers);
      const state = await ok(
        round + "/runs",
        { idempotency_key: randomUUID() },
        headers,
      );
      return { name, headers, state, policy: groups[i % groups.length] };
    }),
  );
  await ok("/admin" + round, { action: "end" }, f.cookie);
  const [{ scenario, catalogue }] =
    await f.admin`select scenario,catalogue from embassy.scenarios`;
  assert.equal(catalogue.definitions.length, 600);
  const expected = Object.fromEntries(
    groups.map(([name, choose]) => {
      const sim = new Simulation(scenario, catalogue);
      while (sim.status === "playing") sim.decide(choose(sim.observe()));
      return [name, { status: sim.status, ...sim.metrics }];
    }),
  );
  const results = await Promise.allSettled(
    pilots.map(async ({ name, headers, state, policy: [strategy, choose] }) => {
      const run = "/runs/" + state.run_id;
      while (state.status === "playing") {
        const body = {
          sequence: state.next_sequence,
          idempotency_key: randomUUID(),
          selected_task_id: choose(state.observation),
        };
        let r = await request(run + "/decisions", body, headers);
        while (r.status === 429) {
          assert.ok(r.data.retry_ms > 0);
          pace++;
          await delay(r.data.retry_ms + 10);
          r = await request(run + "/decisions", body, headers);
        }
        assert.equal(r.status, 200);
        accepted++;
        state = r.data;
      }
      const end = await ok(
        run + "/finish",
        { sequence: state.next_sequence, idempotency_key: randomUUID() },
        headers,
      );
      assert.deepEqual(
        { status: end.status, ...end.metrics },
        expected[strategy],
        name,
      );
      return end;
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
  const board = await ok(round + "/display");
  assert.ok(
    board.final &&
      board.entries.length === size &&
      board.entries.every((e) => e.finalised),
  );
  const [{ n }] = await f.admin`select count(*)::int n from embassy.decisions`;
  assert.equal(n, accepted);
  durations.sort((a, b) => a - b);
  const usage = process.cpuUsage(cpu);
  console.log(
    JSON.stringify(
      {
        manifest: scenario.manifest,
        players: size,
        verified_finishes: board.entries.length,
        duration_s: +((performance.now() - started) / 1000).toFixed(2),
        requests: durations.length,
        pacing_responses: pace,
        committed_decisions: n,
        http_p95_ms:
          +durations[Math.ceil(0.95 * durations.length) - 1].toFixed(1),
        node_peak_sampled_rss_mib: +(peakRss / 2 ** 20).toFixed(1),
        node_cpu_seconds: +((usage.user + usage.system) / 1e6).toFixed(2),
        policies: Object.fromEntries(
          Object.entries(expected).map(([key, e]) => [
            key,
            {
              score: e.score,
              status: e.status,
              survival_ticks: e.survival_ticks,
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(sample);
  await f.close();
}

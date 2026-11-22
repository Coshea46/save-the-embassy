import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createScenario,
  canonicalEvents,
  Simulation,
  replay,
  shortestPath,
  stations,
  tiles,
  walkable,
  entrance,
  samePosition,
  standardRules,
  urgency,
} from "@embassy/simulation";
import { sampleCatalogue, loadCatalogue } from "@embassy/tasks";
import { instanceSchema, observationSchema } from "@embassy/contracts";
import { runBenchmark } from "../tools/benchmark/run.mjs";

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/golden.json", import.meta.url)),
);
const fixtureEvent = {
  id: "a",
  spawn: 0,
  ...stations[1],
  priority: 7,
  reward: 35,
  mandatory: false,
  duration: 2,
  deadline: 6,
  definition_id: "thermal",
};
function fixture(...events) {
  return {
    ...createScenario(1),
    events,
    rules: { ...standardRules, horizon: 20 },
  };
}
test("map connectivity, shortest route length and deterministic tie breaking", () => {
  // Independent distance oracle: relaxation on every floor tile.
  const distance = new Map([[entrance.y * 19 + entrance.x, 0]]);
  for (let k = 0; k < tiles.length * 19; k++) {
    let changes = false;
    for (const [cell, d] of distance) {
      const x = cell % 19,
        y = Math.floor(cell / 19);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const p = { x: x + dx, y: y + dy },
          key = p.y * 19 + p.x;
        if (walkable(p) && (distance.get(key) ?? Infinity) > d + 1) {
          distance.set(key, d + 1);
          changes = true;
        }
      }
    }
    if (!changes) break;
  }
  for (const [y, row] of tiles.entries())
    for (const [x, char] of [...row].entries()) {
      if ("#F".includes(char)) continue;
      assert.equal(
        shortestPath(entrance, { x, y }).length,
        distance.get(y * 19 + x),
      );
    }
  assert.deepEqual(shortestPath({ x: 1, y: 1 }, { x: 2, y: 2 }), [
    { x: 2, y: 1 },
    { x: 2, y: 2 },
  ]);
  assert.throws(() => shortestPath(entrance, { x: 3, y: 2 }));
  assert.deepEqual(shortestPath(entrance, entrance), []);
});
test("seed, official flavour, reachable stations and mandatory opening feasibility", () => {
  for (let seed = 0; seed < 100; seed++) {
    const a = createScenario(seed, "round-a");
    assert.deepEqual(a, createScenario(seed, "round-a"));
    for (const e of a.events) {
      instanceSchema.parse(e);
      assert.ok(
        stations.some(
          (s) => s.room === e.room && samePosition(s.position, e.position),
        ),
      );
      assert.ok(shortestPath(entrance, e.position).length > 0);
    }
    const sim = new Simulation(a);
    sim.decide(a.events[0].id);
    assert.equal(sim.metrics.completed, 1);
  }
  assert.notDeepEqual(canonicalEvents(1), canonicalEvents(2));
  assert.throws(() => canonicalEvents(-1));
});
test("flavour changes preserve canonical scheduling and validate catalogue coverage", () => {
  const custom = {
    ...sampleCatalogue,
    version: "other",
    definitions: [...sampleCatalogue.definitions].reverse(),
  };
  const canonical = (s) =>
    s.events.map((e) => {
      const copy = { ...e };
      delete copy.definition_id;
      return copy;
    });
  assert.deepEqual(
    canonical(createScenario(42)),
    canonical(createScenario(42, "p", custom)),
  );
  assert.throws(() =>
    loadCatalogue({ ...custom, definitions: custom.definitions.slice(0, 1) }),
  );
  assert.throws(() =>
    loadCatalogue({
      ...custom,
      definitions: [...custom.definitions, custom.definitions[0]],
    }),
  );
  assert.throws(() => loadCatalogue(custom, true));
});
test("movement, spawning while travelling, work ticks and exact-deadline completion", () => {
  const sim = new Simulation(
    fixture(fixtureEvent, { ...fixtureEvent, id: "b", spawn: 1, deadline: 12 }),
  );
  sim.select("a");
  sim.step();
  assert.deepEqual(sim.observe().agent.position, { x: 9, y: 4 });
  assert.equal(sim.observe().available_tasks[0].id, "b");
  assert.throws(() => sim.select("b"));
  for (let i = 0; i < 3; i++) sim.step();
  assert.equal(sim.metrics.travel, 4);
  assert.equal(sim.metrics.work_ticks, 0);
  sim.step();
  assert.equal(sim.metrics.score, 0);
  sim.step();
  assert.equal(sim.metrics.score, 35);
  assert.equal(sim.metrics.optional_points, 35);
  assert.equal(sim.metrics.failed, 0);
});
test("expiry cancels optional work; simultaneous mandatory failures close the embassy", () => {
  const sim = new Simulation(
    fixture(
      { ...fixtureEvent, deadline: 5 },
      { ...fixtureEvent, id: "b", spawn: 1, mandatory: true, deadline: 7 },
      { ...fixtureEvent, id: "c", spawn: 1, mandatory: true, deadline: 7 },
    ),
  );
  sim.decide("a");
  assert.equal(sim.busy, false);
  assert.equal(sim.metrics.failed, 1);
  sim.decide(null);
  sim.decide(null);
  assert.equal(sim.metrics.failed, 3);
  assert.equal(sim.status, "closed");
  assert.equal(sim.metrics.score, 0);
  assert.throws(() => sim.step());
});
test("invalid selection is atomic, null spends a tick, observations pass the wire schema", () => {
  const sim = new Simulation(createScenario(42));
  const before = sim.checkpoint();
  assert.throws(() => sim.decide("not-a-task"));
  assert.deepEqual(sim.checkpoint(), before);
  const obs = observationSchema.parse(sim.observe());
  const t = obs.available_tasks[0];
  assert.equal(t.distance, shortestPath(entrance, t.position).length);
  assert.throws(() => observationSchema.parse({ ...obs, seed: 42 }));
  assert.throws(() =>
    observationSchema.parse({
      ...obs,
      available_tasks: [{ ...t, slack: t.slack - 1 }],
    }),
  );
  sim.decide(null);
  assert.equal(sim.metrics.idle_ticks, 1);
  assert.equal(sim.observe().simulation_time, 1);
});
test("serialised and restored in-flight saves resume identical motion and work", () => {
  const scenario = createScenario(42);
  const sim = new Simulation(scenario);
  sim.select("report-1");
  while (sim.busy) {
    const saved = JSON.parse(JSON.stringify(sim.checkpoint()));
    const copy = Simulation.restore(scenario, saved);
    assert.throws(() => Simulation.restore(createScenario(32), saved));
    copy.step();
    sim.step();
    assert.deepEqual(copy.checkpoint(), sim.checkpoint());
  }
});
test("urgency boundaries", () => {
  assert.deepEqual(
    [31, 30, 16, 15, 6, 5, -8].map((n) => urgency(n, standardRules.urgency)),
    [
      "normal",
      "urgent",
      "urgent",
      "very_urgent",
      "very_urgent",
      "critical",
      "critical",
    ],
  );
});
test("golden replay and score breakdown", () => {
  const terminal = replay(
    createScenario(golden.seed),
    golden.decisions,
  ).checkpoint();
  assert.deepEqual(terminal, golden.terminal);
  const m = terminal.metrics;
  assert.equal(m.score, m.optional_points + m.mandatory_points);
  assert.equal(m.survival_ticks, m.idle_ticks + m.travel + m.work_ticks);
});
test("benchmark and fixed seed strategies are reproducible with distinct outcomes", () => {
  const results = runBenchmark([7, 42]);
  assert.deepEqual(results, runBenchmark([7, 42]));
  const score = (name) =>
    results.find((r) => r.seed === 42 && r.strategy === name).score;
  assert.ok(score("weighted") > score("priority"));
});

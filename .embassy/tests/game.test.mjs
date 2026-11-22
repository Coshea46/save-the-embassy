import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createScenario, Simulation, walkable } from "@embassy/simulation";
import { fullCatalogue } from "@embassy/tasks";
import { Practice } from "../apps/game/session.mjs";
import {
  mockTransport,
  Official,
  checkedUrl,
  remoteTransport,
} from "../apps/game/official.mjs";

const officer = {
  choose: (o) =>
    o.available_tasks.reduce(
      (best, t) => (!best || t.priority > best.priority ? t : best),
      null,
    )?.id ?? null,
};
test("dispatch.1 content and published audit remain immutable across checkouts", () => {
  const raw = readFileSync(
    new URL("../packages/tasks/src/dispatch-1.json", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const audit = JSON.parse(
    readFileSync(
      new URL("../apps/game/qa/catalogue-audit.json", import.meta.url),
    ),
  );
  assert.equal(createHash("sha256").update(raw).digest("hex"), audit.sha256);
  assert.equal(fullCatalogue.definitions.length, 600);
});
test("practice frames follow the engine, preserve selected markers and account for every completion", async () => {
  const game = new Practice(42),
    reference = new Simulation(
      createScenario(42, undefined, fullCatalogue),
      fullCatalogue,
    );
  let previous = game.frame(),
    sawBusy = false,
    spawnedDuringJob = false;
  while (previous.status === "playing") {
    const next = await game.advance(officer);
    assert(walkable(next.position));
    assert(
      Math.abs(next.position.x - previous.position.x) +
        Math.abs(next.position.y - previous.position.y) <=
        1,
    );
    if (next.active) {
      sawBusy = true;
      assert(!next.reports.some((t) => t.id === next.active.id));
    }
    if (
      previous.active &&
      next.active &&
      next.reports.some((t) => !previous.reports.some((o) => o.id === t.id))
    )
      spawnedDuringJob = true;
    previous = next;
  }
  while (reference.status === "playing")
    reference.decide(officer.choose(reference.observe()));
  assert(sawBusy && spawnedDuringJob);
  assert.deepEqual(previous.metrics, reference.metrics);
  assert.equal(
    previous.history.filter((h) => h.outcome === "Completed").length,
    previous.metrics.completed,
  );
  assert.equal(
    previous.history.filter((h) => h.outcome === "Expired").length,
    previous.metrics.failed,
  );
  assert.equal(previous.status, "closed");
  assert.deepEqual(new Practice(42).frame(), new Practice(42).frame());
});
test("REST transport uses bearer auth, validates responses, and honours Retry-After", async (t) => {
  assert.throws(() => checkedUrl("http://example.com"));
  assert.throws(() => checkedUrl("https://user:secret@example.com"));
  const call = remoteTransport("https://competition.example/api"),
    id = randomUUID();
  const stub = t.mock.method(globalThis, "fetch", async (url, opts) => {
    assert.equal(url, "https://competition.example/api/runs/" + id);
    assert.equal(opts.headers.Authorization, "Bearer test-only");
    return new Response("", { status: 429, headers: { "Retry-After": "4" } });
  });
  await assert.rejects(
    call("status", { run_id: id }, {}, "test-only"),
    (e) => e.retryMs === 4000 && e.reason === "rate_limit",
  );
  stub.mock.mockImplementation(async () =>
    Response.json(
      {
        error: "Wait for simulation time",
        reason: "simulation_pacing",
        retry_ms: 73,
      },
      { status: 429, headers: { "Retry-After": "1" } },
    ),
  );
  await assert.rejects(
    call("status", { run_id: id }, {}, "test-only"),
    (e) =>
      e.status === 429 && e.retryMs === 73 && e.reason === "simulation_pacing",
  );
  // A transport timeout has no pacing delay. The launcher offers Retry.
  stub.mock.mockImplementation(async () => {
    throw new DOMException("timed out", "TimeoutError");
  });
  await assert.rejects(
    call("status", { run_id: id }, {}, "test-only"),
    (e) =>
      e.reason === "connection" &&
      e.retryMs === undefined &&
      /45 seconds/.test(e.message),
  );
  stub.mock.mockImplementation(async () => Response.json({ invalid: true }));
  await assert.rejects(call("status", { run_id: id }, {}, "test-only"));
});

test("both modes produce identical frames and terminal checkpoints with the same choices", async () => {
  const official = new Official(
    mockTransport(),
    { load: async () => ({}), save: async () => {} },
    randomUUID(),
    true,
    null,
  );
  await official.connect("Pilot", "local");
  const { scenario, catalogue } = official.data.assignment;
  const practice = Practice.assigned(scenario, catalogue);
  const calls = [];
  const agent = {
    choose(obs) {
      calls.push(obs.simulation_time);
      return officer.choose(obs);
    },
  };
  while (practice.sim.status === "playing") {
    await official.advance(agent);
    await practice.advance(officer);
    assert.deepEqual(official.game.frame(), practice.frame());
    assert.deepEqual(official.game.sim.checkpoint(), practice.sim.checkpoint());
  }
  assert.equal(calls.length, official.data.journal.length);
  assert.deepEqual(
    official.data.journal.map((d) => d.tick),
    calls,
  );
  assert.equal(official.data.ack, 0);
  await official.sync.stop();
});

test("rate limits and HTTP 500 keep the same pending batch while waits continue locally", async () => {
  const mock = mockTransport(),
    sent = [];
  const call = async (op, ...args) => {
    if (op === "batch") {
      sent.push(structuredClone(args[1]));
      if (sent.length === 1)
        throw Object.assign(new Error("Throttled"), {
          status: 429,
          retryMs: 1000,
        });
      if (sent.length === 2)
        throw Object.assign(new Error("Service restarting"), { status: 500 });
    }
    return mock(op, ...args);
  };
  const c = new Official(
    call,
    { load: async () => ({}), save: async () => {} },
    randomUUID(),
    false,
    null,
  );
  await c.connect("Wait pilot", "test");
  // Drive the worker manually so this test can distinguish a retry from newly
  // journalled waits. The production timer is covered by the PostgreSQL tests.
  await c.sync.stop();
  const seen = [],
    agent = {
      choose: (obs) => {
        seen.push(obs.simulation_time);
        return null;
      },
    };
  await c.advance(agent);
  await c.sync.upload();
  assert.equal(c.frame().verification, "Offline");
  while (c.game.sim.status === "playing") await c.advance(agent);
  await c.sync.upload();
  await c.sync.upload();
  assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(sent[1], sent[2]);
  while (!c.data.finished) await c.sync.upload();
  assert.deepEqual(
    seen,
    c.data.journal.map((d) => d.sequence),
  );
  assert.deepEqual(
    seen,
    c.data.journal.map((d) => d.tick),
  );
  assert.equal(c.data.ack, seen.length);
});

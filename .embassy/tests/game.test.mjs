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
test("official journal resends the exact decision after a lost response and verifies only on finish", async () => {
  const transport = mockTransport(),
    workshop = randomUUID(),
    calls = [];
  let dropped = false,
    disk = {};
  const store = {
    load: async () => structuredClone(disk),
    save: async (v) => {
      disk = structuredClone(v);
    },
  };
  const lossy = async (op, ...args) => {
    const result = await transport(op, ...args);
    if (op === "decide") {
      calls.push(args[1]);
      if (!dropped) {
        dropped = true;
        throw new Error("Disconnected");
      }
    }
    return result;
  };
  let client = new Official(lossy, store, workshop, true, null);
  await client.connect("Test", "local");
  await assert.rejects(client.advance(officer), /Disconnected/);
  client = new Official(lossy, store, workshop, true, null);
  await client.connect("Test", "local");
  const after = await client.advance({
    choose: () => assert.fail("Must reuse journalled decision"),
  });
  assert.equal(after.decisions, 1);
  assert.deepEqual(calls[0], calls[1]);
  let frame = after;
  while (frame.status === "playing") frame = await client.advance(officer);
  assert.equal(frame.status, "verifying");
  assert.equal(frame.verified, false);
  frame = await client.advance(officer);
  assert.equal(frame.status, "closed");
  assert.equal(frame.verified, false);
  assert.equal(frame.metrics.score, 1045);
});
test("REST transport uses bearer auth, validates responses, and honours server pacing", async (t) => {
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
      /12 seconds/.test(e.message),
  );
  stub.mock.mockImplementation(async () => Response.json({ invalid: true }));
  await assert.rejects(call("status", { run_id: id }, {}, "test-only"));
});

test("consecutive intentional waits use the next-sequence hint and keep each Python observation", async (t) => {
  const workshop = randomUUID();
  const mock = mockTransport();
  const seen = [],
    submitted = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const op = url.endsWith("/participants")
      ? "register"
      : url.endsWith("/join")
        ? "join"
        : url.endsWith("/decisions")
          ? "decide"
          : "start";
    const body = JSON.parse(options.body);
    if (op === "decide") submitted.push({ ...body, at: performance.now() });
    const data = await mock(op, { workshop_id: workshop }, body);
    return Response.json(data, {
      headers: {
        "Embassy-Tick-Ms": "250",
        ...(op === "decide" && { "Embassy-Next-Wait-Ms": "60" }),
      },
    });
  });
  const client = new Official(
    remoteTransport("https://competition.example"),
    {
      load: async () => ({}),
      save: async () => {},
    },
    workshop,
    false,
    null,
  );
  await client.connect("Wait pilot", "test");
  const agent = {
    choose(obs) {
      seen.push(obs.simulation_time);
      return null; // Deliberate, even when an incident is available.
    },
  };
  for (let i = 0; i < 3; i++) await client.advance(agent);
  assert.deepEqual(seen, [0, 1, 2]);
  assert.deepEqual(client.frame().log, [
    { tick: 0, text: "Wait 3 ticks", waitTicks: 3 },
  ]);
  assert.deepEqual(
    submitted.map((r) => r.sequence),
    seen,
  );
  assert.equal(new Set(submitted.map((r) => r.idempotency_key)).size, 3);
  assert.ok(submitted[2].at - submitted[1].at >= 59);
});

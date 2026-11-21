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
    (e) => e.retryAfter === 4,
  );
  stub.mock.mockImplementation(async () => Response.json({ invalid: true }));
  await assert.rejects(call("status", { run_id: id }, {}, "test-only"));
});

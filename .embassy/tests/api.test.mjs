import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptDecision,
  earliestDecisionMs,
  runDeadlineMs,
  rest,
} from "@embassy/api";
import { Simulation, createScenario } from "@embassy/simulation";
test("official decisions reject extra fields and enforce owner, order, absolute pacing and retry receipts", async () => {
  const scenario = createScenario(4, "round-a"),
    sim = new Simulation(scenario);
  const runId = "b6c6ed94-98ca-422f-8609-bea1c42bffde";
  let row = {
    run_id: runId,
    participant_id: "p",
    scenario_key: "private",
    next_sequence: 0,
    started_ms: 0,
    checkpoint: sim.checkpoint(),
  };
  let receipt = null,
    writes = 0;
  const tx = {
    lockRun: async () => row,
    findReceipt: async (_, key) =>
      receipt?.idempotency_key === key ? receipt : null,
    commitDecision: async (r, v) => {
      row = r;
      receipt = v;
      writes++;
    },
  };
  const req = {
    sequence: 0,
    selected_task_id: "report-1",
    idempotency_key: runId,
  };
  const apply = (request, now, owner = "p") =>
    acceptDecision(tx, runId, owner, request, () => ({ scenario }), now);
  assert.throws(() =>
    rest.start.request.parse({ seed: 1, idempotency_key: runId }),
  );
  await assert.rejects(apply({ ...req, score: 100 }, 1));
  await assert.rejects(apply(req, 1, "q"));
  await assert.rejects(apply({ ...req, sequence: 3 }, 1));
  const early = await apply(req, 0);
  assert.equal(early.status, "too_early");
  sim.decide("report-1");
  assert.equal(early.retry_ms, sim.checkpoint().tick * 250 - 375);
  assert.deepEqual(await apply(req, early.retry_ms - 1), {
    status: "too_early",
    retry_ms: 1,
  });
  assert.equal(writes, 0);
  const ok = await apply(req, early.retry_ms);
  assert.equal(ok.status, "accepted");
  assert.deepEqual(await apply(req, early.retry_ms), ok);
  await assert.rejects(
    apply({ ...req, selected_task_id: null }, early.retry_ms),
  );
  assert.equal(writes, 1);
  assert.deepEqual(row.checkpoint, sim.checkpoint());
});

test("official clock gates terminal tick 360 at 4× and gives 90 wall seconds of grace", () => {
  const start = 1_000_000;
  const ready = (tick) =>
    earliestDecisionMs({ started_ms: start, checkpoint: { tick } });
  assert.equal(ready(0), start);
  assert.equal(ready(1), start);
  assert.equal(ready(2), start + 125);
  assert.equal(ready(360) - ready(359), 250);
  assert.equal(ready(360), start + 89_625);
  assert.equal(runDeadlineMs(start, 360), start + 180_000);
  assert.equal(runDeadlineMs(start, 120), start + 120_000);
});

import test from "node:test";
import assert from "node:assert/strict";
import { Simulation, shortestPath } from "@embassy/simulation";
import { fullCatalogue } from "@embassy/tasks";
import { newWorker } from "../../game/session.mjs";
import { Official, remoteTransport } from "../../game/official.mjs";
import { fixture } from "./fixture.mjs";

test("local Python plays the pinned production scenario through REST, reconnects and ranks", async (t) => {
  const db = await fixture();
  t.after(db.close);
  const worker = await newWorker();
  t.after(() => worker.close());
  const w = await db.workshop({ attempt_limit: 2 });
  assert.equal(
    (
      await db.request(
        "/admin/workshops/" + w.id,
        { action: "start" },
        db.cookie,
      )
    ).status,
    200,
  );
  const call = remoteTransport(db.origin);
  let saved,
    drop = true;
  const store = {
    load: async () => structuredClone(saved ?? {}),
    save: async (v) => {
      saved = structuredClone(v);
    },
  };
  const transport = async (op, ...args) => {
    const result = await call(op, ...args);
    if (op === "decide" && drop) {
      drop = false;
      throw new Error("Lost committed response");
    }
    return result;
  };
  const connect = () =>
    new Official(transport, store, w.id, false, db.origin + "/board/" + w.id);
  let client = connect();
  await client.connect("Python pilot", w.code);
  const [{ scenario }] = await db.admin`select scenario from embassy.scenarios`;
  const reference = new Simulation(scenario, fullCatalogue);
  assert.deepEqual(saved.status.observation, reference.observe());
  // Advance only the disposable DB's start timestamp to run every boundary at CI speed.
  await db.admin`update embassy.runs set started_at=started_at-interval '6 minutes' where id=${saved.status.run_id}`;
  await assert.rejects(client.advance(worker), /Lost committed response/);
  client = connect();
  await client.connect("Python pilot", w.code);
  while (reference.status === "playing") {
    const before = reference.observe();
    await client.advance(worker);
    const last = saved.status;
    const [accepted] =
      await db.admin`select selected_task_id from embassy.decisions where run_id=${last.run_id} and sequence=${last.next_sequence - 1}`;
    for (const task of before.available_tasks)
      assert.equal(
        shortestPath(before.agent.position, task.position).length,
        task.distance,
      );
    reference.decide(accepted.selected_task_id);
    assert.deepEqual(last.metrics, reference.metrics);
    assert.deepEqual(
      last.observation,
      reference.status === "playing" ? reference.observe() : null,
    );
  }
  const end = await client.advance(worker);
  assert.equal(end.verified, true);
  const { data } = await db.request("/workshops/" + w.id + "/display");
  assert.equal(data.entries[0].score, reference.metrics.score);
  assert.equal(data.entries[0].finalised, true);
  const second = await client.anotherAttempt();
  assert.equal(second.tick, 0);
  assert.equal(second.verified, false);
  assert.deepEqual(
    saved.status.observation,
    new Simulation(scenario, fullCatalogue).observe(),
  );
});

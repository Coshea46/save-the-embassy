import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";
import { batchLimit } from "@embassy/contracts";

test("v2 rejects invalid tails atomically, verifies overlapping retries, and enforces ownership, deadlines and attempt limits", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const w = await f.workshop(),
    base = "/v2/workshops/" + w.id + "/runs";
  await f.request("/admin/workshops/" + w.id, { action: "start" }, f.cookie);
  async function player(name) {
    const { data } = await f.request("/participants", { display_name: name });
    const headers = { authorization: "Bearer " + data.access_token };
    await f.request(
      "/workshops/" + w.id + "/join",
      { join_code: w.code },
      headers,
    );
    return headers;
  }
  const a = await player("Operator"),
    b = await player("Observer");
  const key = { idempotency_key: randomUUID() };
  const assignments = await Promise.all([
    f.request(base, key, a),
    f.request(base, key, a),
  ]);
  assert.deepEqual(assignments[0].data, assignments[1].data);
  const bundle = assignments[0].data;
  assert.ok(bundle.catalogue.definitions.length < 600);
  assert.equal(
    (await f.request(base, { idempotency_key: randomUUID() }, a)).status,
    409,
  );
  const path = "/v2/runs/" + bundle.run_id + "/decisions";
  const send = (decisions, auth = a) => f.request(path, { decisions }, auth);
  const waits = [0, 1, 2].map((sequence) => ({
    sequence,
    tick: sequence,
    selected_task_id: null,
    idempotency_key: randomUUID(),
  }));
  assert.equal((await send(waits, b)).status, 403);
  assert.equal((await send([waits[1]])).status, 409);
  assert.equal((await send(Array(batchLimit + 1).fill(waits[0]))).status, 422);
  assert.equal(
    (await send([waits[0], { ...waits[1], selected_task_id: "future" }]))
      .status,
    422,
  );
  assert.equal((await send([{ ...waits[0], score: 1234 }])).status, 422);
  assert.equal(
    (await f.admin`select count(*)::int n from embassy.decisions`)[0].n,
    0,
  );
  assert.equal((await send(waits.slice(0, 2))).data.next_sequence, 2);
  assert.equal((await send([{ ...waits[1], tick: 9 }])).status, 409);
  const twins = await Promise.all([send(waits.slice(1)), send(waits.slice(1))]);
  assert.equal(twins[0].data.next_sequence, 3);
  assert.deepEqual(twins[0].data, twins[1].data);
  assert.equal((await send([waits[0]])).data.next_sequence, 1);
  await f.admin`update embassy.runs set deadline=clock_timestamp()-interval '1 second' where id=${bundle.run_id}`;
  assert.equal((await send(waits)).status, 200);
  assert.equal(
    (
      await send([
        { ...waits[0], sequence: 3, tick: 3, idempotency_key: randomUUID() },
      ])
    ).status,
    410,
  );
  assert.equal(
    (await f.admin`select count(*)::int n from embassy.decisions`)[0].n,
    3,
  );
});

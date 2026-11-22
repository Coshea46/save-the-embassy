import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { replay } from "@embassy/simulation";
import { newWorker } from "../../game/session.mjs";
import { Official, remoteTransport } from "../../game/official.mjs";
import { fixture } from "./fixture.mjs";

async function until(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) assert.fail("Timed out waiting for verification");
    await delay(20);
  }
}
async function setup(t, wrap) {
  const f = await fixture();
  t.after(f.close);
  const w = await f.workshop({ attempt_limit: 2 });
  await f.request("/admin/workshops/" + w.id, { action: "start" }, f.cookie);
  const dir = await mkdtemp(join(tmpdir(), "embassy-journal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "state");
  const store = {
    load: async () => {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (e) {
        if (e.code === "ENOENT") return {};
        throw e;
      }
    },
    save: (v) => writeFile(file, JSON.stringify(v)),
  };
  const call = wrap(remoteTransport(f.origin));
  const open = async () => {
    const client = new Official(
      call,
      store,
      w.id,
      false,
      f.origin + "/board/" + w.id,
    );
    await client.connect("Pilot", w.code);
    t.after(() => client.sync.stop());
    return client;
  };
  const worker = await newWorker();
  t.after(() => worker.close());
  return { f, w, open, worker, store };
}
test("offline Python run survives a restart mid-route and lost batch and finish acknowledgements", async (t) => {
  let online = true,
    lostBatch = true,
    lostFinish = true;
  const requests = [];
  const { f, w, open, worker, store } = await setup(
    t,
    (call) =>
      async (op, ...args) => {
        if (!online) throw new Error("Wi-Fi disconnected");
        const ack = await call(op, ...args);
        requests.push(op);
        if (op === "batch" && lostBatch) {
          lostBatch = false;
          throw new Error("Lost batch response");
        }
        if (op === "finish" && lostFinish) {
          lostFinish = false;
          throw new Error("Lost final response");
        }
        return ack;
      },
  );
  let client = await open();
  online = false;
  await client.advance(worker);
  const mid = client.game.sim.checkpoint();
  await until(() => client.sync.offline);
  await client.sync.stop();
  client = await open();
  assert.deepEqual(mid, client.game.sim.checkpoint());
  assert.equal(requests.filter((r) => r === "assign").length, 1);
  while (client.game.sim.status === "playing") await client.advance(worker);
  const saved = await store.load();
  assert.equal(saved.ack, 0);
  assert.equal(client.frame().verified, false);
  assert.ok(client.frame().metrics.score > 0);
  const { scenario, catalogue } = saved.assignment;
  assert.deepEqual(
    replay(
      scenario,
      saved.journal.map((d) => d.selected_task_id),
      catalogue,
    ).checkpoint(),
    saved.local.checkpoint,
  );
  await f.request("/admin/workshops/" + w.id, { action: "end" }, f.cookie);
  online = true;
  await until(() => client.frame().verified || client.data.failure);
  assert.equal(client.data.failure, undefined);
  const [{ n }] = await f.admin`select count(*)::int n from embassy.decisions`;
  assert.equal(n, saved.journal.length);
  assert.equal(
    (await f.admin`select count(*)::int n from embassy.finishes`)[0].n,
    1,
  );
  const board = (await f.request("/workshops/" + w.id + "/display")).data;
  assert.equal(board.entries[0].score, client.frame().metrics.score);
  assert.ok(board.final && board.entries[0].finalised);
});
test(
  "twenty-second responses leave Python, movement, spawns, scoring and game over independent",
  { timeout: 240000 },
  async (t) => {
    let started = false;
    const { open, worker } = await setup(t, (call) => async (...args) => {
      const ack = await call(...args);
      if (args[0] === "batch") started = true;
      await delay(20000);
      return ack;
    });
    const client = await open();
    await client.advance(worker);
    await until(() => started);
    const events = new Set(),
      positions = new Set();
    while (client.game.sim.status === "playing") {
      const f = await client.advance(worker);
      for (const task of f.reports) events.add(task.id);
      positions.add(JSON.stringify(f.position));
    }
    assert.ok(
      events.size > 1 && positions.size > 1 && client.frame().metrics.score > 0,
    );
    assert.equal(client.data.ack, 0);
    await until(() => client.frame().verified || client.data.failure, 200000);
    assert.equal(client.data.verifiedScore, client.frame().metrics.score);
    assert.equal(client.frame().verified, true);
  },
);

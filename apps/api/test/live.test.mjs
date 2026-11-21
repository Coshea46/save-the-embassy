import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { watchBoard } from "../../leaderboard/src/live.js";
test("reconnect and notifications during a pending snapshot refetch the latest state", async () => {
  let reads = 0,
    notify,
    state,
    resolve,
    fail = false;
  const painted = [],
    errors = [];
  const stop = watchBoard({
    read: async () => {
      reads++;
      if (reads === 1)
        await new Promise((r) => {
          resolve = r;
        });
      if (fail) throw Error("offline");
      return reads;
    },
    paint: (v) => painted.push(v),
    subscribe: (n, s) => {
      notify = n;
      state = s;
      return () => {};
    },
    setState: () => {},
    onError: (e) => errors.push(e),
    debounce: 1,
    interval: 100000,
  });
  try {
    notify();
    await delay(8);
    resolve();
    await delay(15);
    assert.deepEqual(painted, [1, 2]);
    fail = true;
    notify();
    await delay(8);
    assert.equal(errors.length, 1);
    fail = false;
    state("SUBSCRIBED");
    await delay(8);
    assert.deepEqual(painted, [1, 2, 4]);
  } finally {
    stop();
  }
});

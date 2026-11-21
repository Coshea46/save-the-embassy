import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import test from "node:test";

test(
  "actual launcher runs Python, resets practice, and enters the unranked rehearsal",
  { timeout: 20000 },
  async (t) => {
    const child = spawn(process.execPath, ["apps/game/server.mjs"], {
      env: {
        ...process.env,
        EMBASSY_PORT: "0",
        EMBASSY_DECISIONS: "0",
        EMBASSY_API_URL: "",
        EMBASSY_LEADERBOARD_URL: "",
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    const closed = once(child, "close");
    t.after(async () => {
      child.kill();
      await closed;
    });
    const lines = createInterface({ input: child.stdout });
    const [message] = await once(lines, "line");
    const origin = message.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const html = await (await fetch(origin)).text();
    const token = html.match(/name="launch" content="([^"]+)"/)[1];
    const headers = {
      "x-embassy-launch": token,
      Origin: origin,
      "Content-Type": "application/json",
    };
    const send = async (path, body) => {
      const response = await fetch(origin + path, {
        method: body ? "POST" : "GET",
        headers,
        body: body && JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.status, 200, data.error);
      return data;
    };
    assert.equal((await fetch(origin + "/state")).status, 403);
    const state = await send("/state");
    assert.equal(state.tick, 0);
    const moved = await send("/step", { revision: state.revision });
    assert.equal(moved.tick, 1);
    assert(moved.active);
    assert.equal((await send("/step", { revision: state.revision })).tick, 1);
    const reset = await send("/practice", { seed: 7 });
    assert.equal(reset.tick, 0);
    assert.equal(reset.seed, 7);
    const joined = await send("/connect", {
      mode: "rehearsal",
      name: "Student",
      code: "",
    });
    assert.equal(joined.mode, "rehearsal");
    assert.equal(joined.verified, false);
    const frame = await send("/step", { revision: joined.revision });
    assert(frame.tick > 1);
    assert.equal(frame.leaderboard, null);
    for (const filename of [
      "floor.png",
      "paper.png",
      "ranger.png",
      "crest.png",
    ]) {
      const asset = await fetch(origin + "/" + filename);
      assert.deepEqual(
        Buffer.from(await asset.arrayBuffer()),
        readFileSync("apps/game/public/" + filename),
      );
    }
  },
);

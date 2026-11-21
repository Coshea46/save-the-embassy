import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./fixture.mjs";

test("production entry point recovers sessions, checkpoints and receipts after process replacement", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port,
    origin = "http://127.0.0.1:" + port;
  await new Promise((r) => probe.close(r));
  const password = randomBytes(32).toString("hex"),
    salt = randomBytes(16).toString("hex");
  await f.admin.unsafe(
    "create role rehearsal_web login inherit password '" +
      password +
      "' in role embassy_api",
  );
  const env = {
    ...process.env,
    DATABASE_URL:
      "postgres://rehearsal_web:" +
      password +
      "@127.0.0.1:" +
      f.dbPort +
      "/postgres",
    PUBLIC_ORIGIN: origin,
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
    ORGANISER_USERNAME: "director",
    ORGANISER_PASSWORD_HASH:
      salt + "." + scryptSync(password, salt, 64).toString("hex"),
    PORT: String(port),
  };
  let child;
  async function launch() {
    child = spawn(process.execPath, ["apps/api/dist/server.js"], {
      env,
      stdio: "ignore",
    });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error("Server failed to start");
      try {
        if ((await fetch(origin + "/health/ready")).ok) return;
      } catch {
        /* process is booting */
      }
      await delay(50);
    }
    throw Error("Readiness timeout");
  }
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      await exit;
    }
  }
  try {
    const w = await f.workshop();
    await f.request("/admin/workshops/" + w.id, { action: "start" }, f.cookie);
    await launch();
    const request = async (path, body, auth) => {
      const res = await fetch(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify(body),
      });
      assert.ok(res.ok, path + " " + res.status);
      return res.json();
    };
    const player = await request("/participants", {
      display_name: "Returning Agent",
    });
    const auth = { authorization: "Bearer " + player.access_token };
    await request("/workshops/" + w.id + "/join", { join_code: w.code }, auth);
    const run = await request(
      "/workshops/" + w.id + "/runs",
      { idempotency_key: randomUUID() },
      auth,
    );
    const decision = {
      sequence: 0,
      selected_task_id: null,
      idempotency_key: randomUUID(),
    };
    const path = "/runs/" + run.run_id;
    const receipt = await request(path + "/decisions", decision, auth);
    await stop();
    await launch();
    assert.deepEqual(await request(path, undefined, auth), receipt);
    assert.deepEqual(
      await request(path + "/decisions", decision, auth),
      receipt,
    );
    assert.equal(
      (await request("/workshops/" + w.id + "/leaderboard")).entries.length,
      1,
    );
  } finally {
    await stop();
  }
});

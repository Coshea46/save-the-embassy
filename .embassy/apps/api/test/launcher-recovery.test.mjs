import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fixture } from "./fixture.mjs";

test("killed local launcher resumes offline and protects the journal from a second writer", async (t) => {
  const f = await fixture();
  const home = await mkdtemp(join(tmpdir(), "embassy-launcher-"));
  const children = new Set();
  let online = true;
  const proxy = createServer(async (req, res) => {
    if (!online) {
      res.writeHead(503);
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const result = await fetch(f.origin + req.url, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        authorization: req.headers.authorization ?? "",
      },
      body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
    });
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(await result.text());
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const base = "http://127.0.0.1:" + proxy.address().port;
  t.after(async () => {
    await Promise.all([...children].map(stop));
    proxy.closeAllConnections();
    await new Promise((r) => proxy.close(r));
    await f.close();
    await rm(home, { recursive: true, force: true });
  });
  const w = await f.workshop({ attempt_limit: 2 });
  await f.request("/admin/workshops/" + w.id, { action: "start" }, f.cookie);
  const player = (
    await f.request("/participants", { display_name: "Saved pilot" })
  ).data;
  await f.request(
    "/workshops/" + w.id + "/join",
    { join_code: w.code },
    { authorization: "Bearer " + player.access_token },
  );
  const credentials = JSON.stringify({
    api_url: base,
    workshop_id: w.id,
    ...player,
  });
  async function stop(child) {
    const done = once(child, "close");
    child.kill("SIGKILL");
    await done;
    children.delete(child);
  }
  async function launch() {
    const child = spawn(process.execPath, ["apps/game/server.mjs"], {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        EMBASSY_PORT: "0",
        EMBASSY_API_URL: "",
        EMBASSY_LEADERBOARD_URL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    const lines = createInterface({ input: child.stdout });
    const [message] = await once(lines, "line");
    const origin = message.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const html = await (await fetch(origin)).text();
    const token = html.match(/name="launch" content="([^"]+)"/)[1];
    async function request(path, body) {
      const res = await fetch(origin + path, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          origin,
          "x-embassy-launch": token,
        },
        body: JSON.stringify(body),
      });
      return res.json();
    }
    return { request, child };
  }
  let launcher = await launch();
  const initial = await launcher.request("/connect", {
    mode: "import",
    credentials,
  });
  const first = await launcher.request("/step", { revision: initial.revision });
  assert.ok(first.active && first.tick === 1);
  online = false;
  const other = await launch();
  assert.match(
    (await other.request("/connect", { mode: "import", credentials })).error,
    /Another launcher/,
  );
  await stop(other.child);
  await stop(launcher.child);
  launcher = await launch();
  let frame = await launcher.request("/state");
  assert.equal(frame.mode, "official");
  assert.deepEqual(frame.active, first.active);
  assert.deepEqual(frame.position, first.position);
  assert.equal(frame.tick, 1);
  while (frame.status === "playing")
    frame = await launcher.request("/step", { revision: frame.revision });
  assert.equal(frame.verified, false);
  await stop(launcher.child);
  launcher = await launch();
  online = true;
  const deadline = Date.now() + 20000;
  do {
    frame = await launcher.request("/state");
    assert.equal(frame.verificationError, undefined);
    if (!frame.verified) await delay(100);
  } while (!frame.verified && Date.now() < deadline);
  assert.equal(frame.verified, true);
  assert.equal(frame.verifiedScore, frame.metrics.score);
  const files = await readdir(join(home, ".embassy-dispatch"));
  const saved = JSON.parse(
    await readFile(
      join(
        home,
        ".embassy-dispatch",
        files.find((n) => n.endsWith(".json")),
      ),
      "utf8",
    ),
  );
  assert.equal(saved.ack, saved.journal.length);
  assert.equal(saved.pending, null);
  assert.equal(
    (await f.admin`select count(*)::int n from embassy.runs`)[0].n,
    1,
  );
  const another = await launcher.request("/attempt", {});
  assert.equal(another.tick, 0);
  assert.equal(another.verified, false);
  assert.equal(
    (await f.admin`select count(*)::int n from embassy.runs`)[0].n,
    2,
  );
});

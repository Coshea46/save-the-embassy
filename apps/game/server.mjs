import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { rest } from "@embassy/contracts";
import { floor, newWorker, Practice } from "./session.mjs";
import {
  checkedUrl,
  credentialStore,
  mockTransport,
  Official,
  remoteTransport,
} from "./official.mjs";

const secret = randomBytes(24).toString("hex");
const files = new Map(
  Object.entries({
    "/": ["index.html", "text/html"],
    "/ui.js": ["ui.js", "text/javascript"],
    "/map.js": ["map.js", "text/javascript"],
    "/style.css": ["style.css", "text/css"],
    ...Object.fromEntries(
      ["floor", "ranger", "paper", "crest"].map((n) => [
        "/" + n + ".png",
        [n + ".png", "image/png"],
      ]),
    ),
  }),
);
const service = process.env.EMBASSY_API_URL
  ? checkedUrl(process.env.EMBASSY_API_URL)
  : null;
const leaderboard = process.env.EMBASSY_LEADERBOARD_URL
  ? checkedUrl(process.env.EMBASSY_LEADERBOARD_URL)
  : null;
let session = new Practice(42),
  bridge,
  busy = false,
  serial = 0,
  route = [];
const frame = () => ({
  ...session.frame(),
  revision: serial,
  route,
  floor,
  connected: Boolean(service),
});
const reply = (res, code, value) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};

async function resetAgent() {
  if (bridge) await bridge.close().catch(() => {});
  bridge = undefined;
  bridge = await newWorker();
}
async function operation(path, body) {
  route = [];
  if (path === "/practice") {
    const next = new Practice(body.seed ?? undefined, body.thresholds);
    await resetAgent();
    session = next;
  } else if (path === "/agent") await resetAgent();
  else if (path === "/connect") {
    const mock = body.mode === "rehearsal";
    let base = service;
    let workshop = mock ? randomUUID() : body.workshop;
    let player;
    if (body.mode === "import") {
      let imported;
      try {
        imported = JSON.parse(body.credentials);
        player = rest.register.response.parse({
          participant_id: imported.participant_id,
          access_token: imported.access_token,
        });
        workshop = imported.workshop_id;
        base = checkedUrl(imported.api_url);
      } catch {
        throw new Error(
          "Paste the complete credentials copied from the workshop website.",
        );
      }
      if (service && base !== service)
        throw new Error(
          "These credentials belong to another competition server.",
        );
    }
    if (
      !mock &&
      (!base ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(workshop))
    )
      throw new Error("Supply an official API URL and a valid workshop ID.");
    const store = mock
      ? { load: async () => ({}), save: async () => {} }
      : credentialStore(base, workshop);
    const next = new Official(
      mock ? mockTransport() : remoteTransport(base),
      store,
      workshop,
      mock,
      leaderboard ?? base + "/board/" + workshop,
    );
    await resetAgent();
    await next.connect(
      body.name || "Desk officer",
      mock ? "rehearsal" : body.code || "",
      player,
    );
    session = next;
  } else if (path === "/attempt") {
    if (!(session instanceof Official))
      throw new Error("Join an official workshop first.");
    await resetAgent();
    await session.anotherAttempt();
  } else if (path === "/step") {
    if (body.revision !== serial) return;
    if (!bridge) bridge = await newWorker();
    if (["playing", "verifying"].includes(session.frame().status))
      route = (await session.advance(bridge)).route ?? [];
  } else throw new Error("Unknown operation");
  serial++;
}
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  );
  const host = "127.0.0.1:" + server.address().port;
  if (req.headers.host !== host)
    return reply(res, 403, { error: "Open the printed loopback URL." });
  try {
    const path = req.url;
    if (req.method === "GET" && files.has(path)) {
      const [name, mime] = files.get(path);
      let content = await readFile(
        new URL("./public/" + name, import.meta.url),
      );
      if (path === "/")
        content = content.toString().replace("LAUNCH_TOKEN", secret);
      res.writeHead(200, { "Content-Type": mime });
      return res.end(content);
    }
    if (req.headers["x-embassy-launch"] !== secret)
      return reply(res, 403, { error: "Reload this tab." });
    if (req.method === "GET" && path === "/state")
      return reply(res, 200, frame());
    if (req.method !== "POST" || req.headers.origin !== "http://" + host)
      return reply(res, 403, { error: "Invalid request origin." });
    if (busy)
      return reply(res, 409, { error: "Another command is in progress." });
    busy = true;
    try {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 4096)
          throw new Error("Command too large.");
      }
      await operation(path, JSON.parse(raw || "{}"));
    } finally {
      busy = false;
    }
    reply(res, 200, frame());
  } catch (error) {
    reply(res, 400, { error: error.message, retryAfter: error.retryAfter });
  }
});
server.on("error", (error) => {
  console.error(error.message + " • Try setting EMBASSY_PORT to a free port.");
  process.exitCode = 1;
});
server.listen(Number(process.env.EMBASSY_PORT ?? 4173), "127.0.0.1", () => {
  console.log(
    "Embassy Dispatch is ready. Open http://127.0.0.1:" +
      server.address().port +
      " in your browser. Ctrl+C ends the session.",
  );
});
async function shutdown() {
  server.closeAllConnections();
  server.close();
  if (bridge) await bridge.close().catch(() => {});
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { randomBytes, scryptSync } from "node:crypto";
import { createApp } from "../dist/app.js";
export async function fixture({ port, dbPort, rt, publicKey } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "embassy-pg-"));
  if (!dbPort) {
    const probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    dbPort = probe.address().port;
    await new Promise((r) => probe.close(r));
  }
  const password = randomBytes(24).toString("hex"),
    organiserPassword = randomBytes(24).toString("hex");
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password,
    port: dbPort,
    persistent: false,
    autoRehydrateSymlinks: true,
    postgresFlags: [
      "-c",
      "unix_socket_directories=",
      "-c",
      "wal_level=logical",
      "-c",
      "track_io_timing=on",
      "-c",
      "listen_addresses=127.0.0.1",
    ],
    onLog: process.env.PG_TEST_LOG ? console.error : () => {},
    onError: console.error,
  });
  await server.initialise();
  await server.start();
  const url =
    "postgres://postgres:" + password + "@127.0.0.1:" + dbPort + "/postgres";
  const admin = postgres(url, { onnotice: () => {} }),
    db = postgres(url, {
      max: 12,
      prepare: false,
      connection: { role: "embassy_api" },
      onnotice: () => {},
    });
  let http;
  async function close() {
    if (http?.listening) await new Promise((r) => http.close(r));
    await db.end();
    await admin.end();
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
  try {
    await admin.unsafe(
      "create role anon; create role authenticated; create publication supabase_realtime",
    );
    const migrations = new URL(
      "../../../supabase/migrations/",
      import.meta.url,
    );
    for (const file of (await readdir(migrations))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(new URL(file, migrations), "utf8");
      await admin.begin((tx) => tx.unsafe(sql));
    }
    const salt = randomBytes(16).toString("hex");
    const settings = {
      origin: "http://127.0.0.1:" + String(port ?? 8080),
      organiser: "director",
      passwordHash:
        salt + "." + scryptSync(organiserPassword, salt, 64).toString("hex"),
      supabaseUrl: rt,
      publishableKey: publicKey,
    };
    const app = createApp(db, settings);
    http = await new Promise((resolve) => {
      const s = app.listen(port ?? 0, "127.0.0.1", () => resolve(s));
    });
    const origin = "http://127.0.0.1:" + http.address().port;
    settings.origin = origin;
    async function request(path, body, options = {}) {
      const start = performance.now();
      const response = await fetch(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...options,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return {
        status: response.status,
        data,
        headers: response.headers,
        ms: performance.now() - start,
      };
    }
    const login = await request("/admin/login", {
      username: "director",
      password: organiserPassword,
    });
    if (login.status !== 200)
      throw new Error("Fixture login failed: " + login.status);
    const cookie = { cookie: login.headers.get("set-cookie").split(";")[0] };
    async function workshop(options = {}) {
      const code = "OPEN-" + randomBytes(6).toString("hex").toUpperCase();
      const result = await request(
        "/admin/workshops",
        { title: "Midnight Helsinki", join_code: code, ...options },
        cookie,
      );
      if (result.status !== 201)
        throw new Error(
          "Workshop creation failed: " + JSON.stringify(result.data),
        );
      return { id: result.data.workshop_id, code };
    }
    return {
      admin,
      db,
      request,
      workshop,
      close,
      origin,
      cookie,
      organiserPassword,
      password,
      dbPort,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

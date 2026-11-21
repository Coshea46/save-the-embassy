import postgres from "postgres";
import { readFileSync } from "node:fs";
import { loadCatalogue } from "@embassy/tasks";
import { z } from "zod";
import { createApp, sweep } from "./app.js";

const env = z
  .object({
    DATABASE_URL: z.url(),
    PUBLIC_ORIGIN: z.url(),
    ORGANISER_USERNAME: z.string().min(1),
    ORGANISER_PASSWORD_HASH: z.string().regex(/^[a-f0-9]{32}\.[a-f0-9]{128}$/),
    SUPABASE_URL: z.url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
    PORT: z.coerce.number().int().positive().default(8080),
  })
  .parse(process.env);
if (!env.SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")) {
  let role;
  try {
    role = JSON.parse(
      Buffer.from(
        env.SUPABASE_PUBLISHABLE_KEY.split(".")[1] ?? "",
        "base64url",
      ).toString(),
    ).role;
  } catch {
    /* invalid public token */
  }
  if (role !== "anon")
    throw new Error("Expected a publishable key or legacy anon JWT");
}
const origin = new URL(env.PUBLIC_ORIGIN);
if (
  origin.protocol !== "https:" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
)
  throw new Error("Public hosting requires HTTPS");
const localDb = ["localhost", "127.0.0.1", "[::1]"].includes(
  new URL(env.DATABASE_URL).hostname,
);
const db = postgres(env.DATABASE_URL, {
  max: 12,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 30,
  ssl: process.env.DATABASE_CA_FILE
    ? {
        ca: readFileSync(process.env.DATABASE_CA_FILE, "utf8"),
        rejectUnauthorized: true,
      }
    : localDb
      ? undefined
      : "verify-full",
});
const app = createApp(db, {
  origin: origin.origin,
  organiser: env.ORGANISER_USERNAME,
  passwordHash: env.ORGANISER_PASSWORD_HASH,
  supabaseUrl: new URL(env.SUPABASE_URL).origin,
  publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
  trustProxy: process.env.TRUSTED_PROXY,
  catalogue: process.env.OFFICIAL_CATALOGUE_FILE
    ? loadCatalogue(
        JSON.parse(readFileSync(process.env.OFFICIAL_CATALOGUE_FILE, "utf8")),
        true,
      )
    : undefined,
});
const server = app.listen(env.PORT, () =>
  console.log("Competition API listening on", env.PORT),
);
server.requestTimeout = 15000;
let busy = false;
const timer = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await sweep(db);
  } catch {
    console.error("expiry_sweep_failed");
  } finally {
    busy = false;
  }
}, 10000);
async function close() {
  clearInterval(timer);
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
}
process.on("SIGTERM", close);
process.on("SIGINT", close);

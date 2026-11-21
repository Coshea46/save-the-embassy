// Run only against a disposable local Supabase stack and a locally configured API.
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { measure } from "./load.mjs";
function local(name) {
  const url = new URL(process.env[name]);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw Error(name + " must refer to the local test stack");
  return url;
}
const api = local("PUBLIC_ORIGIN"),
  url = local("SUPABASE_URL");
const db = postgres(local("DATABASE_URL").toString(), { max: 2 });
async function request(path, body, headers) {
  const t = performance.now();
  const r = await fetch(new URL(path, api), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return {
    status: r.status,
    data: await r.json(),
    headers: r.headers,
    ms: performance.now() - t,
  };
}
try {
  const login = await request("/admin/login", {
    username: process.env.ORGANISER_USERNAME,
    password: process.env.TEST_ORGANISER_PASSWORD,
  });
  if (login.status !== 200) throw Error("Local organiser login failed");
  const cookie = { cookie: login.headers.get("set-cookie").split(";")[0] };
  async function workshop(opts) {
    const code = randomUUID().slice(0, 8);
    const r = await request(
      "/admin/workshops",
      { title: "Realtime rehearsal", join_code: code, ...opts },
      cookie,
    );
    if (r.status !== 201)
      throw Error("Local workshop creation failed: " + r.status);
    return { id: r.data.workshop_id, code };
  }
  console.log(
    JSON.stringify(
      await measure(
        { db, admin: db, workshop, request, cookie },
        {
          realtime: {
            url: url.origin,
            key: process.env.SUPABASE_PUBLISHABLE_KEY,
          },
        },
      ),
      null,
      2,
    ),
  );
} finally {
  await db.end();
}

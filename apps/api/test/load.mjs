import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { subscribeStandings } from "../../leaderboard/src/live.js";
import { fixture } from "./fixture.mjs";

function stats(values) {
  const xs = values.toSorted((a, b) => a - b),
    pct = (p) => xs[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)];
  return xs.length
    ? {
        count: xs.length,
        p50_ms: +pct(0.5).toFixed(1),
        p95_ms: +pct(0.95).toFixed(1),
        p99_ms: +pct(0.99).toFixed(1),
        max_ms: +xs.at(-1).toFixed(1),
      }
    : { count: 0 };
}
async function waitFor(check, timeout = 60000) {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw Error("Timed out waiting for Realtime");
    await sleep(50);
  }
}
function viewer(url, key, workshop) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let stop;
  const delivered = new Map();
  async function connect() {
    let ready = false;
    stop = subscribeStandings(
      client,
      workshop,
      (e) => {
        if (e.new.score > 0 && !delivered.has(e.new.display_name))
          delivered.set(
            e.new.display_name,
            Date.now() - Date.parse(e.commit_timestamp),
          );
      },
      (status) => {
        ready = status === "SUBSCRIBED";
      },
      "UPDATE",
    );
    await waitFor(() => ready);
  }
  async function close() {
    await stop?.();
    stop = undefined;
    client.realtime.disconnect();
  }
  return { connect, close, delivered };
}
// Invoke only with an isolated fixture. No production DB or prior workshop is mutated.
export async function measure(f, { size = 150, realtime } = {}) {
  const start = performance.now(),
    times = [],
    phases = [],
    unexpected = [],
    viewers = [];
  const w = await f.workshop({ attempt_limit: 2 }),
    base = "/workshops/" + w.id;
  const users = Array.from({ length: size }, (_, i) => ({
    name: "Agent " + String(i + 1).padStart(3, "0"),
  }));
  async function call(path, body, headers, expected = 200) {
    const r = await f.request(path, body, headers);
    times.push(r.ms);
    if (r.status !== expected) {
      unexpected.push({ path, status: r.status });
      throw Error(
        path + " returned " + r.status + " " + JSON.stringify(r.data),
      );
    }
    return r;
  }
  async function burst(name, operation) {
    const before = performance.now(),
      count = times.length;
    const results = await Promise.allSettled(users.map(operation));
    const ms = performance.now() - before;
    phases.push({
      name,
      requests: times.length - count,
      requests_per_s: +(((times.length - count) * 1000) / ms).toFixed(1),
      ...stats(times.slice(count)),
    });
    for (const r of results) if (r.status === "rejected") throw r.reason;
  }
  const dbBefore = (
    await f.admin`select xact_commit,xact_rollback,blks_read,blks_hit,deadlocks from pg_stat_database where datname=current_database()`
  )[0];
  try {
    if (realtime)
      for (let i = 0; i < 2; i++) {
        const v = viewer(realtime.url, realtime.key, w.id);
        viewers.push(v);
        await v.connect();
      }
    await call("/admin" + base, { action: "start" }, f.cookie);
    await burst("register", async (u) => {
      const r = await call(
        "/participants",
        { display_name: u.name },
        undefined,
        201,
      );
      u.auth = { authorization: "Bearer " + r.data.access_token };
    });
    await burst("join", (u) =>
      call(base + "/join", { join_code: w.code }, u.auth),
    );
    await burst("start", async (u) => {
      u.run = (
        await call(base + "/runs", { idempotency_key: randomUUID() }, u.auth)
      ).data;
    });
    assert.equal(users[0].run.manifest.catalogue_version, "dispatch.1");
    for (const user of users)
      assert.deepEqual(user.run.observation, users[0].run.observation);
    if (viewers.length) await viewers[1].close();
    await burst("pacing rejection", async (u) => {
      u.choice = {
        sequence: 0,
        selected_task_id: u.run.observation.available_tasks[0].id,
        idempotency_key: randomUUID(),
      };
      const r = await call(
        "/runs/" + u.run.run_id + "/decisions",
        u.choice,
        u.auth,
        429,
      );
      u.ready = Date.now() + r.data.retry_ms;
    });
    await sleep(
      Math.max(0, Math.max(...users.map((u) => u.ready)) - Date.now() + 100),
    );
    await burst("simultaneous decision and exact retry", async (u) => {
      const path = "/runs/" + u.run.run_id + "/decisions";
      const [a, b] = await Promise.all([
        call(path, u.choice, u.auth),
        call(path, u.choice, u.auth),
      ]);
      assert.deepEqual(a.data, b.data);
      assert.equal(a.data.next_sequence, 1);
      assert.ok(a.data.metrics.score > 0);
    });
    if (viewers.length) {
      await waitFor(() => viewers[0].delivered.size === size, 30000);
      await viewers[1].connect();
    }
    await burst("recovery after lost responses", async (u) => {
      const r = await call("/runs/" + u.run.run_id, undefined, u.auth);
      assert.equal(r.data.next_sequence, 1);
    });
    let recovered;
    await burst("public snapshot reconnect", async () => {
      recovered = (await call(base + "/leaderboard")).data;
      assert.equal(recovered.entries.length, size);
      assert.ok(recovered.entries.every((e) => e.rank === 1 && e.score > 0));
    });
    const rows =
      await f.admin`select count(*)::int n,count(distinct d.run_id)::int distinct_runs from embassy.decisions d join embassy.runs r on r.id=d.run_id where r.workshop_id=${w.id}`;
    assert.deepEqual({ ...rows[0] }, { n: size, distinct_runs: size });
    const timings = [];
    for (let i = 0; i < 50; i++) {
      const a = performance.now();
      await f.db`select * from embassy.best where workshop_id=${w.id} order by score desc,survival_ticks desc,run_id`;
      timings.push(performance.now() - a);
    }
    await sleep(1100);
    await f.admin`select pg_stat_clear_snapshot()`;
    const dbAfter = (
      await f.admin`select xact_commit,xact_rollback,blks_read,blks_hit,deadlocks from pg_stat_database where datname=current_database()`
    )[0];
    const wall = (performance.now() - start) / 1000;
    return {
      manifest: users[0].run.manifest,
      participants: size,
      wall_seconds: +wall.toFixed(2),
      requests: times.length,
      requests_per_wall_second: +(times.length / wall).toFixed(1),
      expected_pacing_rejections: size,
      unexpected_http_errors: unexpected.length,
      api: stats(times),
      phases,
      database: {
        standings_query: stats(timings),
        ...Object.fromEntries(
          Object.keys(dbBefore).map((k) => [
            k,
            Number(dbAfter[k]) - Number(dbBefore[k]),
          ]),
        ),
      },
      realtime: viewers.length
        ? {
            connected_viewers: 2,
            commit_to_delivery: stats([...viewers[0].delivered.values()]),
            missed_by_offline_viewer: size - viewers[1].delivered.size,
            recovered_snapshot_rows: recovered.entries.length,
          }
        : null,
      decision_rows: rows[0].n,
      unique_runs: rows[0].distinct_runs,
    };
  } finally {
    for (const v of viewers) await v.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const f = await fixture();
  try {
    console.log(JSON.stringify(await measure(f), null, 2));
  } finally {
    await f.close();
  }
}

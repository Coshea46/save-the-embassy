import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./fixture.mjs";
import { rest } from "@embassy/contracts";
import { replay } from "@embassy/simulation";
import { sweep } from "../dist/app.js";
const key = () => ({ idempotency_key: randomUUID() });
test("competition over HTTP with separate Postgres transactions", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const { request: q, admin, db, cookie } = f;
  const w = await f.workshop({ attempt_limit: 2 }),
    base = "/workshops/" + w.id;
  async function player(name) {
    const result = await q("/participants", { display_name: name });
    assert.equal(result.status, 201);
    return {
      id: result.data.participant_id,
      auth: { authorization: "Bearer " + result.data.access_token },
    };
  }
  const alice = await player("Alice"),
    bob = await player("Bob"),
    impostor = await player("ALICE");
  const manage = (c) => q("/admin" + base, c, cookie),
    submit = (run, input, who = alice) =>
      q("/runs/" + run + "/decisions", input, who.auth);
  const join = (p, code = w.code) =>
    q(base + "/join", { join_code: code }, p.auth);
  let run, opening;
  await t.test(
    "registration, scope, private data and organiser permissions",
    async () => {
      assert.equal(
        (await q("/participants", { display_name: "=1+2" })).status,
        422,
      );
      assert.equal((await q(base + "/runs", key(), alice.auth)).status, 403);
      assert.equal(
        (await q(base + "/join", { join_code: w.code })).status,
        401,
      );
      assert.equal((await join(alice, "WRONG1")).status, 403);
      assert.equal((await join(alice)).status, 200);
      assert.equal((await join(alice)).status, 200);
      assert.equal((await join(impostor)).status, 409);
      assert.equal((await join(bob)).status, 200);
      assert.equal(
        (await q("/admin" + base, { action: "start" }, alice.auth)).status,
        401,
      );
      assert.equal(
        (
          await q(
            "/admin" + base,
            { action: "start" },
            { ...cookie, origin: "https://other.invalid" },
          )
        ).status,
        403,
      );
      assert.equal((await q(base + "/runs", key(), alice.auth)).status, 409);
      await assert.rejects(
        admin.begin(async (tx) => {
          await tx.unsafe("set local role anon");
          await tx`select * from embassy.sessions`;
        }),
        { code: "42501" },
      );
      await assert.rejects(
        admin.begin(async (tx) => {
          await tx.unsafe("set local role authenticated");
          await tx`delete from public.embassy_standings`;
        }),
        { code: "42501" },
      );
      assert.equal((await manage({ action: "start" })).status, 200);
      assert.equal(
        (await manage({ action: "configure", attempt_limit: 3 })).status,
        409,
      );
    },
  );
  await t.test(
    "equivalent official scenario and retry-safe creation",
    async () => {
      assert.equal(
        (await q(base + "/runs", { ...key(), seed: 5 }, alice.auth)).status,
        422,
      );
      const startKey = key(),
        [a, b] = await Promise.all(
          [1, 2].map(() => q(base + "/runs", startKey, alice.auth)),
        );
      assert.equal(a.status, 200);
      assert.deepEqual(a.data, b.data);
      opening = a.data;
      run = opening.run_id;
      const second = await q(base + "/runs", key(), bob.auth);
      assert.deepEqual(second.data.manifest, opening.manifest);
      assert.deepEqual(second.data.observation, opening.observation);
      assert.equal((await q("/runs/" + run, undefined, bob.auth)).status, 403);
      assert.equal((await q(base + "/runs", key(), alice.auth)).status, 409);
      const [p] = await admin`select scenario,catalogue from embassy.scenarios`;
      assert.equal(typeof p.scenario.seed, "number");
      assert.equal(p.scenario.manifest.catalogue_version, p.catalogue.version);
      assert.ok(!JSON.stringify(opening).includes('"seed"'));
      assert.equal(
        (await q(base + "/me", undefined, alice.auth)).data[0].run_id,
        run,
      );
    },
  );
  await t.test(
    "invalid input, absolute pacing, concurrency, integrity and recovery",
    async () => {
      const choose = {
        ...key(),
        sequence: 0,
        selected_task_id: opening.observation.available_tasks[0].id,
      };
      assert.equal((await submit(run, { ...choose, score: 1e6 })).status, 422);
      assert.equal((await submit(run, { ...choose, sequence: 2 })).status, 409);
      assert.equal(
        (await submit(run, { ...choose, selected_task_id: "unknown" })).status,
        422,
      );
      const early = await submit(run, choose);
      assert.equal(early.status, 429);
      assert.ok(early.data.retry_ms > 0);
      assert.equal(
        (
          await q(
            "/runs/" + run + "/finish",
            { ...key(), sequence: 0 },
            alice.auth,
          )
        ).status,
        409,
      );
      // Advance only the isolated test database clock budget. The HTTP API has no clock override.
      await admin`update embassy.runs set started_at=started_at-interval '360 seconds' where id=${run}`;
      const [a, b] = await Promise.all([
        submit(run, choose),
        submit(run, choose),
      ]);
      assert.equal(a.status, 200);
      assert.deepEqual(a.data, b.data);
      assert.ok(a.data.metrics.score > 0);
      const p = rest.leaderboard.response.parse(
        (await q(base + "/leaderboard")).data,
      );
      assert.equal(p.entries[0].display_name, "Alice");
      assert.equal(p.entries[0].score, a.data.metrics.score);
      const events = (await q(base + "/display")).data.activity;
      assert.equal(
        events[0].title,
        opening.observation.available_tasks[0].title,
      );
      const next = { sequence: 1, selected_task_id: null };
      const race = await Promise.all(
        [1, 2].map(() => submit(run, { ...key(), ...next })),
      );
      assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
      assert.deepEqual((await submit(run, choose)).data, a.data);
      assert.equal(
        (await submit(run, { ...choose, selected_task_id: null })).status,
        409,
      );
      const recovered = (await q("/runs/" + run, undefined, alice.auth)).data;
      assert.equal(recovered.next_sequence, 2);
      await assert.rejects(
        admin.begin(async (tx) => {
          await tx`update embassy.scenarios set scenario='{}'`;
        }),
      );
      await admin`update embassy.checkpoints set checksum='bad' where run_id=${run}`;
      assert.equal(
        (await submit(run, { ...key(), sequence: 2, selected_task_id: null }))
          .status,
        500,
      );
      await admin`update embassy.checkpoints set checksum=encode(sha256(convert_to(state::text,'UTF8')),'hex') where run_id=${run}`;
      assert.equal(
        (await q("/runs/" + run, undefined, alice.auth)).data.next_sequence,
        2,
      );
    },
  );
  await t.test(
    "terminal replay, attempt history, ties, eligibility, moderation and grace",
    async () => {
      let state = (await q("/runs/" + run, undefined, alice.auth)).data;
      while (state.status === "playing") {
        const r = await submit(run, {
          ...key(),
          sequence: state.next_sequence,
          selected_task_id: state.observation.available_tasks[0]?.id ?? null,
        });
        assert.equal(r.status, 200);
        state = r.data;
      }
      const [s] = await admin`select scenario,catalogue from embassy.scenarios`,
        decisions =
          await admin`select selected_task_id from embassy.decisions where run_id=${run} order by sequence`;
      assert.deepEqual(
        replay(
          s.scenario,
          decisions.map((d) => d.selected_task_id),
          s.catalogue,
        ).metrics,
        state.metrics,
      );
      const finish = { ...key(), sequence: state.next_sequence };
      const path = "/runs/" + run + "/finish";
      assert.deepEqual((await q(path, finish, alice.auth)).data, state);
      assert.deepEqual((await q(path, finish, alice.auth)).data, state);
      const r2 = (await q(base + "/runs", key(), alice.auth)).data;
      assert.notEqual(r2.run_id, run);
      assert.equal(
        (await q(base + "/leaderboard")).data.entries.filter(
          (x) => x.display_name === "Alice",
        ).length,
        1,
      );
      assert.equal(
        (
          await manage({
            action: "disqualify",
            run_id: run,
            reason: "moderated",
          })
        ).status,
        200,
      );
      const tied = (await q(base + "/leaderboard")).data.entries;
      assert.deepEqual(
        tied.map((e) => e.rank),
        [1, 1],
      );
      assert.equal(tied[0].score, 0);
      assert.equal(
        (
          await manage({
            action: "rename",
            participant_id: alice.id,
            display_name: "Aurora",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await manage({
            action: "reset",
            run_id: r2.run_id,
            reason: "approved restart",
          })
        ).status,
        200,
      );
      const last = await q(base + "/runs", key(), alice.auth);
      assert.equal(last.status, 200);
      assert.equal((await manage({ action: "end" })).status, 200);
      assert.equal((await q(base + "/runs", key(), bob.auth)).status, 409);
      assert.equal(
        (
          await submit(last.data.run_id, {
            ...key(),
            sequence: 0,
            selected_task_id: null,
          })
        ).status,
        200,
      );
      await admin`update embassy.runs set deadline=clock_timestamp()-interval '1 second' where finished_at is null`;
      assert.equal(
        (await q("/runs/" + last.data.run_id, undefined, alice.auth)).status,
        410,
      );
      await sweep(db);
      assert.equal((await q(base + "/display")).data.final, true);
      assert.equal(
        (await admin`select * from public.embassy_standings`).length,
        0,
      );
      assert.ok(
        (
          await q("/admin" + base + "/export", undefined, cookie)
        ).data.startsWith("rank,display_name"),
      );
      assert.ok(
        (await q("/admin/runs/" + run + "/decisions", undefined, cookie)).data
          .length > 0,
      );
      await assert.rejects(db`delete from embassy.audit`, { code: "42501" });
    },
  );
});

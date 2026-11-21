import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { createScenario } from "@embassy/simulation";
import { sampleCatalogue } from "@embassy/tasks";
import type { Catalogue } from "@embassy/contracts";
import {
  code,
  hash,
  HttpError,
  json,
  membership,
  name,
  project,
  requireValue,
  uuid,
  type Tx,
} from "./common.js";

const settings = z.strictObject({
  title: z.string().trim().min(1).max(100),
  join_code: code,
  prize: z
    .string()
    .trim()
    .max(150)
    .default("GRAND PRIZE: A 4-PACK OF WHITE MONSTER"),
  attempt_limit: z.number().int().min(1).max(20).default(1),
  entry_minutes: z.number().int().min(1).max(1440).default(30),
});
async function audit(
  tx: Tx,
  id: string,
  actor: string,
  action: string,
  details: unknown,
) {
  await tx`insert into embassy.audit(workshop_id,actor,action,details) values(${id},${actor},${action},${json(details)}::text::jsonb)`;
}
export async function createWorkshop(
  tx: Tx,
  actor: string,
  raw: unknown,
  catalogue: Catalogue = sampleCatalogue,
) {
  const w = settings.parse(raw),
    id = randomUUID(),
    scenarioId = randomUUID();
  const scenario = createScenario(
    randomBytes(4).readUInt32BE(),
    scenarioId,
    catalogue,
  );
  await tx`insert into embassy.scenarios values(${scenarioId},${json(scenario)}::text::jsonb,${json(catalogue)}::text::jsonb)`;
  await tx`insert into embassy.workshops(id,title,code_hash,prize,attempt_limit,entry_minutes,scenario_id)
    values(${id},${w.title},${hash(w.join_code)},${w.prize},${w.attempt_limit},${w.entry_minutes},${scenarioId})`;
  await audit(tx, id, actor, "create", { title: w.title });
  return { workshop_id: id };
}
const command = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("registration"), open: z.boolean() }),
  z.strictObject({ action: z.literal("start") }),
  z.strictObject({ action: z.literal("end") }),
  z.strictObject({
    action: z.literal("rename"),
    participant_id: uuid,
    display_name: name,
  }),
  z.strictObject({
    action: z.enum(["disqualify", "reset"]),
    run_id: uuid,
    reason: z.string().trim().min(1).max(200),
  }),
  settings.partial().extend({ action: z.literal("configure") }),
]);
export async function manage(tx: Tx, id: string, actor: string, raw: unknown) {
  const c = command.parse(raw);
  const w = requireValue(
    (await tx`select * from embassy.workshops where id=${id} for update`)[0],
  );
  switch (c.action) {
    case "configure":
      if (
        w.phase !== "lobby" &&
        (c.entry_minutes !== undefined || c.attempt_limit !== undefined)
      )
        throw new HttpError(409, "Round rules are frozen after start");
      await tx`update embassy.workshops set title=${c.title ?? w.title},prize=${c.prize ?? w.prize},code_hash=${c.join_code ? hash(c.join_code) : w.code_hash},
        attempt_limit=${c.attempt_limit ?? w.attempt_limit},entry_minutes=${c.entry_minutes ?? w.entry_minutes} where id=${id}`;
      break;
    case "registration":
      if (w.phase === "ended" && c.open)
        throw new HttpError(409, "Workshop has ended");
      await tx`update embassy.workshops set registration=${c.open} where id=${id}`;
      break;
    case "start":
      if (w.phase !== "lobby")
        throw new HttpError(409, "Workshop already started");
      await tx`update embassy.workshops set phase='running',entry_until=clock_timestamp()+entry_minutes*interval '1 minute' where id=${id}`;
      break;
    case "end":
      if (w.phase !== "running")
        throw new HttpError(409, "Workshop is not running");
      await tx`update embassy.workshops set phase='ended',registration=false,entry_until=least(entry_until,clock_timestamp()) where id=${id}`;
      break;
    case "rename": {
      const m = await membership(tx, id, c.participant_id);
      await tx`delete from public.embassy_standings where workshop_id=${id} and display_name=${m.display_name}`;
      await tx`update embassy.members set display_name=${c.display_name} where workshop_id=${id} and participant_id=${c.participant_id}`;
      await project(tx, id, c.participant_id, c.display_name);
      break;
    }
    case "disqualify":
    case "reset": {
      const r = requireValue(
        (
          await tx`select participant_id from embassy.runs where workshop_id=${id} and id=${c.run_id}`
        )[0],
      );
      const m = await membership(tx, id, r.participant_id);
      await tx`update embassy.runs set exclusion=${c.action === "reset" ? "reset" : "disqualified"} where id=${c.run_id}`;
      await project(tx, id, r.participant_id, m.display_name);
      break;
    }
  }
  const safe = { ...c };
  if ("join_code" in safe) delete safe.join_code;
  await audit(tx, id, actor, c.action, safe);
  return { ok: true };
}
export async function snapshot(tx: Tx, id: string) {
  const w = requireValue(
    (
      await tx`select id as workshop_id,title,prize,phase,registration,entry_until,clock_timestamp() as server_time
    from embassy.workshops where id=${id}`
    )[0],
  );
  const entries =
    await tx`select rank() over(order by score desc,survival_ticks desc)::int rank,display_name,score,survival_ticks,completed,status,
    finished_at is not null as finalised, (finished_at is null and seen_at < clock_timestamp()-interval '45 seconds') as disconnected
    from embassy.best where workshop_id=${id} order by score desc,survival_ticks desc,run_id`;
  const [counts] =
    await tx`select (select count(*)::int from embassy.members where workshop_id=${id}) players,
    count(distinct participant_id) filter(where status='playing' and finished_at is null)::int active,
    count(*) filter(where status='closed')::int closed, count(*) filter(where finished_at is null)::int pending
    from embassy.eligible where workshop_id=${id}`;
  const activity =
    await tx`select m.display_name,d.completed_title title,d.committed_at at from embassy.decisions d
    join embassy.runs r on r.id=d.run_id join embassy.members m using(workshop_id,participant_id)
    where r.workshop_id=${id} and r.exclusion is null and d.completed_title is not null order by d.committed_at desc limit 8`;
  const closed =
    await tx`select m.display_name,d.committed_at at from embassy.runs r join embassy.members m using(workshop_id,participant_id)
    join embassy.decisions d on d.run_id=r.id and d.sequence=r.next_sequence-1 join embassy.scores s on s.run_id=r.id
    where r.workshop_id=${id} and r.exclusion is null and s.status='closed' order by d.committed_at desc limit 5`;
  const entryClosed =
    w.phase === "ended" ||
    (w.entry_until !== null && w.entry_until <= w.server_time);
  return {
    ...w,
    entries,
    ...counts,
    activity,
    closures: closed,
    final: entryClosed && counts?.pending === 0,
  };
}
export async function monitor(tx: Tx, id: string) {
  const board = await snapshot(tx, id);
  const participants =
    await tx`select participant_id,display_name from embassy.members where workshop_id=${id} order by display_name`;
  const runs =
    await tx`select r.id,m.display_name,r.next_sequence,r.started_at,r.finished_at,r.exclusion,r.deadline,r.seen_at,s.score,s.status
    from embassy.runs r join embassy.members m using(workshop_id,participant_id) join embassy.scores s on s.run_id=r.id
    where r.workshop_id=${id} order by r.started_at desc`;
  return { board, participants, runs };
}

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { rest, type RunStatus, type Catalogue } from "@embassy/contracts";
import {
  Simulation,
  replay,
  RULESET,
  type Scenario,
  type Checkpoint,
} from "@embassy/simulation";
import {
  applyDecision,
  earliestDecisionMs,
  tickReadyMs,
  runDeadlineMs,
  type StoredRun,
} from "./index.js";
import {
  type Tx,
  HttpError,
  project,
  membership,
  json,
  requireValue,
} from "./common.js";

type Snapshot = { scenario: Scenario; catalogue: Catalogue };
type LoadedScenario = Snapshot & { eventCatalogue: Catalogue };
type LoadScenario = (tx: Tx, id: string) => Promise<LoadedScenario>;

// A workshop's scenario and catalogue are immutable in Postgres. Retain one
// snapshot per API instance so a room of players doesn't fetch 600 definitions
// on every decision. Different workshops and process restarts reload by ID.
export function scenarioLoader(): LoadScenario {
  let cached: { id: string; snapshot: LoadedScenario } | undefined;
  return async (tx, id) => {
    if (cached?.id === id) return cached.snapshot;
    const pinned = requireValue(
      (
        await tx<
          Snapshot[]
        >`select scenario,catalogue from embassy.scenarios where id=${id}`
      )[0],
    );
    // A decision can reference only definitions used by the pinned events.
    // Keep the complete original catalogue for independent final replay.
    const ids = new Set(pinned.scenario.events.map((e) => e.definition_id));
    const snapshot = {
      ...pinned,
      eventCatalogue: {
        version: pinned.catalogue.version,
        definitions: pinned.catalogue.definitions.filter((d) => ids.has(d.id)),
      },
    };
    cached = { id, snapshot };
    return snapshot;
  };
}

function status(run: string, seq: number, sim: Simulation): RunStatus {
  const cp = sim.checkpoint();
  return rest.status.response.parse({
    run_id: run,
    manifest: cp.manifest,
    next_sequence: seq,
    tick: cp.tick,
    status: sim.status,
    metrics: sim.metrics,
    observation: sim.status === "playing" ? sim.observe() : null,
  });
}
function assertVersion(scenario: Scenario) {
  if (scenario.manifest.ruleset_version !== RULESET)
    throw new HttpError(503, "Pinned engine version unavailable");
}
async function checkpoint(tx: Tx, run: string, cp: Checkpoint) {
  // Hash Postgres' canonical jsonb representation, independent of object key order.
  await tx`insert into embassy.checkpoints select ${run},j,encode(sha256(convert_to(j::text,'UTF8')),'hex')
    from (select ${json(cp)}::text::jsonb j) v on conflict(run_id) do update set state=excluded.state,checksum=excluded.checksum`;
}
async function score(tx: Tx, value: RunStatus) {
  const { score, survival_ticks, completed } = value.metrics;
  await tx`insert into embassy.scores values (${value.run_id},${score},${survival_ticks},${completed},${value.status})
    on conflict(run_id) do update set score=excluded.score,survival_ticks=excluded.survival_ticks,completed=excluded.completed,status=excluded.status`;
}
export async function start(
  tx: Tx,
  workshop: string,
  owner: string,
  raw: unknown,
  loadScenario: LoadScenario,
) {
  const { idempotency_key: key } = rest.start.request.parse(raw);
  const w = requireValue(
    (
      await tx`select * from embassy.workshops where id=${workshop} for share`
    )[0],
  );
  const member = await membership(tx, workshop, owner);
  const [prior] =
    await tx`select initial_response from embassy.runs where workshop_id=${workshop} and participant_id=${owner} and start_key=${key}`;
  if (prior) return prior.initial_response;
  const { now } = requireValue((await tx`select clock_timestamp() as now`)[0]);
  if (w.phase !== "running" || w.entry_until <= now)
    throw new HttpError(409, "Entry window closed");
  const [used] =
    await tx`select count(*)::int n, bool_or(finished_at is null and exclusion is null and deadline>=clock_timestamp()) active
    from embassy.runs where workshop_id=${workshop} and participant_id=${owner} and exclusion is distinct from 'reset'`;
  if (used?.active || used!.n >= w.attempt_limit)
    throw new HttpError(409, "Active run or attempt limit reached");
  const { scenario, catalogue } = await loadScenario(tx, w.scenario_id);
  assertVersion(scenario);
  const sim = new Simulation(scenario, catalogue);
  const id = randomUUID(),
    initial = status(id, 0, sim);
  const deadline = new Date(
    runDeadlineMs(now.getTime(), scenario.rules.horizon),
  );
  await tx`insert into embassy.runs(id,workshop_id,participant_id,scenario_id,start_key,initial_response,started_at,deadline)
    values(${id},${workshop},${owner},${w.scenario_id},${key},${json(initial)}::text::jsonb,${now},${deadline})`;
  await checkpoint(tx, id, sim.checkpoint());
  await score(tx, initial);
  await project(tx, workshop, owner, member.display_name);
  return initial;
}
export async function runAction(
  tx: Tx,
  action: "status" | "decide" | "finish",
  id: string,
  owner: string,
  raw: unknown,
  loadScenario: LoadScenario,
  adviseNextWait: (ms: number) => void,
) {
  const meta = requireValue(
    (
      await tx`select workshop_id,participant_id from embassy.runs where id=${id}`
    )[0],
  );
  if (meta.participant_id !== owner)
    throw new HttpError(403, "Run ownership mismatch");
  const member = await membership(tx, meta.workshop_id, owner);
  const row = requireValue(
    (
      await tx`select r.*,c.state,
    c.checksum=encode(sha256(convert_to(c.state::text,'UTF8')),'hex') intact,clock_timestamp() as now
    from embassy.runs r join embassy.checkpoints c on c.run_id=r.id
    where r.id=${id} for update of r`
    )[0],
  );
  const decision = action === "decide" ? rest.decide.request.parse(raw) : null;
  const finish = action === "finish" ? rest.finish.request.parse(raw) : null;
  const input = decision ?? finish;
  if (input) {
    const [receipt] =
      await tx`select sequence,selected_task_id,response,'decide' kind from embassy.decisions
      where run_id=${id} and idempotency_key=${input.idempotency_key} union all select sequence,null,response,'finish' from embassy.finishes
      where run_id=${id} and idempotency_key=${input.idempotency_key}`;
    if (receipt) {
      if (
        receipt.kind !== action ||
        receipt.sequence !== input.sequence ||
        (decision && receipt.selected_task_id !== decision.selected_task_id)
      )
        throw new HttpError(409, "Idempotency key used with different input");
      return receipt.response;
    }
  }
  if (row.exclusion || (!row.finished_at && row.now > row.deadline))
    throw new HttpError(410, "Attempt is no longer eligible");
  if (!row.intact) throw new Error("Checkpoint integrity failure");
  const { scenario, catalogue, eventCatalogue } = await loadScenario(
    tx,
    row.scenario_id,
  );
  const cp: Checkpoint = row.state;
  assertVersion(scenario);
  if (input && input.sequence !== row.next_sequence)
    throw new HttpError(409, "Unexpected sequence");
  if (decision) {
    if (cp.status !== "playing")
      throw new HttpError(409, "Run has reached its terminal checkpoint");
    if (
      decision.selected_task_id !== null &&
      !cp.open.includes(decision.selected_task_id)
    )
      throw new HttpError(422, "Unavailable task");
    const stored: StoredRun = {
      run_id: id,
      participant_id: owner,
      started_ms: row.started_at.getTime(),
      next_sequence: row.next_sequence,
      checkpoint: cp,
      scenario_key: row.scenario_id,
    };
    const { updated, response } = applyDecision(
      stored,
      decision,
      scenario,
      eventCatalogue,
    );
    const delay = earliestDecisionMs(updated) - row.now.getTime();
    if (delay > 0)
      throw new HttpError(
        429,
        "Wait for simulation time",
        delay,
        "simulation_pacing",
      );
    const selected = decision.selected_task_id;
    const completed = response.metrics.completed > cp.metrics.completed;
    const def =
      completed &&
      scenario.events.find((e) => e.id === selected)?.definition_id;
    const title = def
      ? eventCatalogue.definitions.find((d) => d.id === def)?.title
      : null;
    await tx`insert into embassy.decisions(run_id,sequence,selected_task_id,idempotency_key,response,completed_title)
      values(${id},${decision.sequence},${selected},${decision.idempotency_key},${json(response)}::text::jsonb,${title ?? null})`;
    await checkpoint(tx, id, updated.checkpoint);
    await tx`update embassy.runs set next_sequence=${updated.next_sequence},seen_at=clock_timestamp() where id=${id}`;
    await score(tx, response);
    await project(tx, meta.workshop_id, owner, member.display_name);
    // A deliberate wait always advances exactly one tick. Slow clients can spend
    // their accumulated time immediately. This hint never authorises a decision.
    if (response.status === "playing")
      adviseNextWait(
        Math.max(
          0,
          tickReadyMs(stored.started_ms, response.tick + 1) - row.now.getTime(),
        ),
      );
    return response;
  }
  const sim = Simulation.restore(scenario, cp, catalogue);
  const response = status(id, row.next_sequence, sim);
  if (finish) {
    if (cp.status === "playing" || row.finished_at)
      throw new HttpError(
        409,
        "Finish requires an unfinalised terminal checkpoint",
      );
    const history =
      await tx`select selected_task_id from embassy.decisions where run_id=${id} order by sequence`;
    if (
      history.length !== row.next_sequence ||
      !isDeepStrictEqual(
        replay(
          scenario,
          history.map((d) => d.selected_task_id),
          catalogue,
        ).checkpoint(),
        cp,
      )
    )
      throw new Error("Replay integrity failure");
    await tx`insert into embassy.finishes values(${id},${finish.sequence},${finish.idempotency_key},${json(response)}::text::jsonb)`;
    await tx`update embassy.runs set finished_at=clock_timestamp() where id=${id}`;
    await project(tx, meta.workshop_id, owner, member.display_name, true);
  }
  await tx`update embassy.runs set seen_at=clock_timestamp() where id=${id}`;
  return response;
}

import { rest, type DecisionRequest, type RunStatus } from "@embassy/contracts";
import {
  Simulation,
  type Checkpoint,
  type Scenario,
} from "@embassy/simulation";
import type { Catalogue } from "@embassy/contracts";

export { rest };
export type StoredRun = {
  run_id: string;
  participant_id: string;
  scenario_key: string;
  next_sequence: number;
  started_ms: number;
  checkpoint: Checkpoint;
};
export type AcceptedDecision = DecisionRequest & {
  run_id: string;
  response: RunStatus;
};
export interface RunTransaction {
  // Implement within one DB transaction; hold the row lock until commit.
  lockRun(runId: string): Promise<StoredRun>;
  findReceipt(
    runId: string,
    idempotencyKey: string,
  ): Promise<AcceptedDecision | null>;
  commitDecision(run: StoredRun, receipt: AcceptedDecision): Promise<void>;
}
export const OFFICIAL_TICK_MS = 250;
// Preserve the absolute 1.5-simulated-tick allowance, including on the terminal tick.
const PACE_ALLOWANCE_MS = 1.5 * OFFICIAL_TICK_MS;
const FINISH_GRACE_MS = 90_000;

export function runDeadlineMs(startMs: number, horizon: number) {
  return startMs + horizon * OFFICIAL_TICK_MS + FINISH_GRACE_MS;
}

export function tickReadyMs(
  startMs: number,
  tick: number,
  tickMs = OFFICIAL_TICK_MS,
  allowanceMs = PACE_ALLOWANCE_MS,
) {
  return startMs + Math.max(0, tick * tickMs - allowanceMs);
}

export function earliestDecisionMs(
  run: StoredRun,
  tickMs = OFFICIAL_TICK_MS,
  jitterMs = PACE_ALLOWANCE_MS,
) {
  return tickReadyMs(run.started_ms, run.checkpoint.tick, tickMs, jitterMs);
}
export function applyDecision(
  run: StoredRun,
  request: DecisionRequest,
  scenario: Scenario,
  catalogue?: Catalogue,
) {
  const decision = rest.decide.request.parse(request);
  if (decision.sequence !== run.next_sequence)
    throw new RangeError("Unexpected sequence");
  const simulation = Simulation.restore(scenario, run.checkpoint, catalogue);
  simulation.decide(decision.selected_task_id);
  const checkpoint = simulation.checkpoint();
  return {
    updated: { ...run, next_sequence: run.next_sequence + 1, checkpoint },
    response: rest.decide.response.parse({
      run_id: run.run_id,
      manifest: scenario.manifest,
      next_sequence: run.next_sequence + 1,
      tick: checkpoint.tick,
      status: simulation.status,
      metrics: simulation.metrics,
      observation:
        simulation.status === "playing" ? simulation.observe() : null,
    }),
  };
}

// The caller opens/commits the DB transaction and supplies its trusted clock.
export async function acceptDecision(
  tx: RunTransaction,
  runId: string,
  participantId: string,
  raw: unknown,
  scenarioFor: (key: string) => { scenario: Scenario; catalogue?: Catalogue },
  nowMs: number,
) {
  const request = rest.decide.request.parse(raw);
  const run = await tx.lockRun(runId);
  if (run.participant_id !== participantId)
    throw new Error("Run ownership mismatch");
  const cached = await tx.findReceipt(runId, request.idempotency_key);
  if (cached) {
    if (
      cached.sequence !== request.sequence ||
      cached.selected_task_id !== request.selected_task_id
    )
      throw new RangeError("Idempotency key reused with different payload");
    return { status: "accepted" as const, response: cached.response };
  }
  const { scenario, catalogue } = scenarioFor(run.scenario_key);
  const { updated, response } = applyDecision(
    run,
    request,
    scenario,
    catalogue,
  );
  const retryMs = earliestDecisionMs(updated) - nowMs;
  if (retryMs > 0) return { status: "too_early" as const, retry_ms: retryMs };
  await tx.commitDecision(updated, { ...request, run_id: runId, response });
  return { status: "accepted" as const, response };
}

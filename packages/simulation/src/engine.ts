import {
  type Catalogue,
  type Decision,
  type Incident,
  type Manifest,
  type Metrics,
  type Observation,
  type Position,
} from "@embassy/contracts";
import { sampleCatalogue } from "@embassy/tasks";
import { entrance, shortestPath, stations, samePosition } from "./map.js";
import { type Scenario, validateRules } from "./scenario.js";

export type Status = "playing" | "closed" | "finished";
type Job = { id: string; route: Position[]; remaining: number };
export type Checkpoint = {
  format: 1;
  manifest: Manifest;
  seed: number;
  tick: number;
  position: Position;
  status: Status;
  cursor: number;
  open: string[];
  job: Job | null;
  metrics: Metrics;
};
export function urgency(
  slack: number,
  [critical, very, urgent]: readonly [number, number, number],
) {
  if (slack <= critical) return "critical";
  if (slack <= very) return "very_urgent";
  return slack <= urgent ? "urgent" : "normal";
}

export class Simulation {
  private readonly scenario: Scenario;
  private readonly events: Map<string, Incident>;
  private readonly definitions: Map<string, Catalogue["definitions"][number]>;
  private state: Checkpoint;

  constructor(scenario: Scenario, catalogue: Catalogue = sampleCatalogue) {
    validateRules(scenario.rules);
    if (
      scenario.manifest.ruleset_version !== scenario.rules.version ||
      scenario.manifest.catalogue_version !== catalogue.version
    )
      throw new RangeError("Version mismatch");
    this.scenario = structuredClone(scenario);
    this.definitions = new Map(
      structuredClone(catalogue.definitions).map((d) => [d.id, d]),
    );
    this.events = new Map(this.scenario.events.map((e) => [e.id, e]));
    if (
      this.events.size !== scenario.events.length ||
      !scenario.events.every(
        (e, i, a) =>
          (i === 0 || e.spawn >= a[i - 1]!.spawn) &&
          e.spawn >= 0 &&
          e.spawn < scenario.rules.horizon &&
          e.deadline > e.spawn &&
          e.duration > 0 &&
          this.definitions.get(e.definition_id)?.rooms.includes(e.room) &&
          stations.some(
            (s) => s.room === e.room && samePosition(s.position, e.position),
          ),
      )
    )
      throw new RangeError("Invalid scenario event schedule");
    this.state = {
      format: 1,
      seed: scenario.seed,
      manifest: { ...scenario.manifest },
      tick: 0,
      status: "playing",
      position: { ...entrance },
      cursor: 0,
      open: [],
      job: null,
      metrics: {
        score: 0,
        survival_ticks: 0,
        completed: 0,
        failed: 0,
        travel: 0,
        offered_work: 0,
        offered_reward: 0,
        work_ticks: 0,
        idle_ticks: 0,
        optional_points: 0,
        mandatory_points: 0,
      },
    };
    this.spawn();
  }
  get status() {
    return this.state.status;
  }
  get busy() {
    return this.state.job !== null;
  }
  get metrics(): Metrics {
    return { ...this.state.metrics };
  }
  checkpoint(): Checkpoint {
    return structuredClone(this.state);
  }
  // Checkpoints are private server records or trusted local saves.
  static restore(
    scenario: Scenario,
    saved: Checkpoint,
    catalogue = sampleCatalogue,
  ) {
    const sim = new Simulation(scenario, catalogue);
    if (
      saved.format !== 1 ||
      saved.seed !== scenario.seed ||
      saved.manifest.scenario_id !== scenario.manifest.scenario_id ||
      saved.manifest.ruleset_version !== scenario.manifest.ruleset_version ||
      saved.manifest.catalogue_version !== scenario.manifest.catalogue_version
    )
      throw new RangeError("Checkpoint belongs to a different scenario");
    sim.state = structuredClone(saved);
    return sim;
  }
  observe(): Observation {
    const s = this.state;
    return {
      simulation_time: s.tick,
      agent: {
        position: { ...s.position },
        current_task_id: s.job?.id ?? null,
      },
      available_tasks: s.open
        .filter((id) => s.job?.id !== id)
        .map((id) => {
          const e = this.events.get(id)!;
          const d = this.definitions.get(e.definition_id)!;
          const distance = shortestPath(s.position, e.position).length;
          const remaining = e.deadline - s.tick;
          const slack = remaining - distance - e.duration;
          return {
            id,
            title: d.title,
            description: d.description,
            position: { ...e.position },
            priority: e.priority,
            reward: e.reward,
            duration: e.duration,
            mandatory: e.mandatory,
            time_remaining: remaining,
            distance,
            estimated_travel_time: distance,
            slack,
            urgency: urgency(slack, this.scenario.rules.urgency),
          };
        }),
    };
  }
  // Select a job without consuming a tick. Use step() to animate.
  select(id: Decision) {
    const s = this.state;
    if (s.status !== "playing" || s.job) throw new Error("No decision due");
    if (id === null) return;
    if (!s.open.includes(id))
      throw new RangeError("Unknown or unavailable task");
    const e = this.events.get(id)!;
    s.job = {
      id,
      route: shortestPath(s.position, e.position),
      remaining: e.duration,
    };
  }
  private spawn() {
    const s = this.state;
    let e;
    while ((e = this.scenario.events[s.cursor]) && e.spawn === s.tick) {
      s.cursor++;
      s.open.push(e.id);
      s.metrics.offered_reward += e.reward;
      s.metrics.offered_work += e.duration;
    }
  }
  step() {
    const s = this.state;
    if (s.status !== "playing") throw new Error("Run has ended");
    const job = s.job;
    s.metrics.survival_ticks = ++s.tick;
    if (!job) s.metrics.idle_ticks++;
    else if (job.route.length) {
      s.position = job.route.shift()!;
      s.metrics.travel++;
    } else {
      s.metrics.work_ticks++;
      if (--job.remaining === 0) {
        const e = this.events.get(job.id)!;
        s.metrics.completed++;
        s.metrics[e.mandatory ? "mandatory_points" : "optional_points"] +=
          e.reward;
        s.metrics.score += e.reward;
        s.open = s.open.filter((id) => id !== job.id);
        s.job = null;
      }
    }
    s.open = s.open.filter((id) => {
      const e = this.events.get(id)!;
      if (e.deadline > s.tick) return true;
      s.metrics.failed++;
      if (s.job?.id === id) s.job = null;
      if (e.mandatory) s.status = "closed";
      return false;
    });
    if (s.status === "playing" && s.tick === this.scenario.rules.horizon)
      s.status = "finished";
    if (s.status === "playing") this.spawn();
    else s.job = null;
  }
  // One logged decision consumes at least one tick, including a deliberate wait.
  decide(id: Decision) {
    this.select(id);
    do {
      this.step();
    } while (this.status === "playing" && this.busy);
  }
}
export function replay(
  scenario: Scenario,
  decisions: Iterable<Decision>,
  catalogue = sampleCatalogue,
) {
  const simulation = new Simulation(scenario, catalogue);
  for (const decision of decisions) simulation.decide(decision);
  return simulation;
}

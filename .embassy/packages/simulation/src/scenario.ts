import {
  type Catalogue,
  type CanonicalEvent,
  type Incident,
  type Manifest,
} from "@embassy/contracts";
import { sampleCatalogue } from "@embassy/tasks";
import { entrance, shortestPath, stations } from "./map.js";

export const RULESET = "embassy.1";
export type Stage = {
  start: number;
  gap: number;
  duration: number;
  slack: number;
  farWeight: number;
  mandatoryEvery: number;
};
export type Rules = {
  version: string;
  horizon: number;
  stages: readonly Stage[];
  bands: ReadonlyArray<{ reward: number; priority: number; extraWork: number }>;
  urgency: readonly [number, number, number];
};
export const standardRules: Rules = {
  version: RULESET,
  horizon: 360,
  urgency: [5, 15, 30],
  stages: [
    {
      start: 0,
      gap: 16,
      duration: 4,
      slack: 37,
      farWeight: 1,
      mandatoryEvery: 5,
    },
    {
      start: 100,
      gap: 12,
      duration: 6,
      slack: 24,
      farWeight: 3,
      mandatoryEvery: 4,
    },
    {
      start: 220,
      gap: 8,
      duration: 8,
      slack: 13,
      farWeight: 6,
      mandatoryEvery: 4,
    },
  ],
  bands: [
    { reward: 40, priority: 3, extraWork: 0 },
    { reward: 75, priority: 7, extraWork: 3 },
    { reward: 110, priority: 6, extraWork: 6 },
  ],
};
export type Scenario = {
  seed: number;
  manifest: Manifest;
  rules: Rules;
  events: Incident[];
};
function randomSource(seed: number) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError("Expected uint32 seed");
  let state = seed >>> 0;
  return (limit: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let v = Math.imul(state ^ (state >>> 15), state | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return Math.floor((((v ^ (v >>> 14)) >>> 0) / 4294967296) * limit);
  };
}
function pickWeighted<T>(
  items: readonly T[],
  weight: (item: T) => number,
  roll: (n: number) => number,
): T {
  let ticket = roll(items.reduce((n, item) => n + weight(item), 0));
  for (const item of items) {
    ticket -= weight(item);
    if (ticket < 0) return item;
  }
  throw new Error("Empty weighted pool");
}
export function validateRules(rules: Rules) {
  const natural = (v: number) => Number.isSafeInteger(v) && v >= 0;
  if (
    !rules.version ||
    !natural(rules.horizon) ||
    !rules.horizon ||
    rules.stages[0]?.start !== 0 ||
    !rules.bands.length ||
    rules.urgency.length !== 3 ||
    !rules.urgency.every((n, i, a) => natural(n) && (!i || n > a[i - 1]!)) ||
    !rules.stages.every(
      (s, i, a) =>
        Object.values(s).every(natural) &&
        s.gap > 0 &&
        s.duration > 0 &&
        s.mandatoryEvery > 0 &&
        s.farWeight > 0 &&
        (!i || s.start > a[i - 1]!.start),
    ) ||
    !rules.bands.every(
      (b) =>
        Object.values(b).every(natural) &&
        b.reward > 0 &&
        b.priority > 0 &&
        b.priority <= 10,
    )
  )
    throw new RangeError("Invalid scenario rules");
}
// This virtual workload is independent of every player's decisions.
export function canonicalEvents(
  seed: number,
  rules = standardRules,
): CanonicalEvent[] {
  validateRules(rules);
  const roll = randomSource(seed);
  const events: CanonicalEvent[] = [];
  let bag = [...rules.bands];
  let previous = entrance;
  let mandatoryDeadline = -1;
  for (let spawn = 0; spawn < rules.horizon; ) {
    const stage = [...rules.stages].reverse().find((s) => s.start <= spawn)!;
    if (!bag.length) bag = [...rules.bands];
    const band = bag.splice(roll(bag.length), 1)[0]!;
    const station = pickWeighted(
      stations,
      (s) =>
        shortestPath(previous, s.position).length >= 12 ? stage.farWeight : 3,
      roll,
    );
    const travel = shortestPath(previous, station.position).length;
    const demand = events
      .filter((e) => e.deadline > spawn)
      .reduce((n, e) => n + e.duration, 0);
    const duration = stage.duration + band.extraWork + roll(3);
    const mandatory =
      events.length % stage.mandatoryEvery === 0 && spawn >= mandatoryDeadline;
    // Any mandatory dispatch from a station can meet its own deadline.
    const travelBudget = mandatory
      ? Math.max(
          ...stations.map(
            (s) => shortestPath(s.position, station.position).length,
          ),
          travel,
        )
      : travel;
    const deadline =
      spawn +
      duration +
      travelBudget +
      stage.slack +
      Math.min(8, Math.floor(demand / 8)) +
      roll(5);
    events.push({
      id: "report-" + (events.length + 1),
      spawn,
      room: station.room,
      position: { ...station.position },
      priority: Math.min(10, band.priority + roll(3)),
      reward: band.reward,
      duration,
      deadline,
      mandatory,
    });
    if (mandatory) mandatoryDeadline = deadline;
    previous = station.position;
    spawn += stage.gap + roll(3);
  }
  return events;
}
export function createScenario(
  seed: number,
  scenarioId = "practice-" + seed,
  catalogue: Catalogue = sampleCatalogue,
  rules = standardRules,
): Scenario {
  const events = canonicalEvents(seed, rules);
  const flavour = randomSource((seed ^ 0xa53f91b7) >>> 0);
  return {
    seed,
    manifest: {
      scenario_id: scenarioId,
      ruleset_version: rules.version,
      catalogue_version: catalogue.version,
    },
    rules: structuredClone(rules),
    events: events.map((e) => {
      const def = pickWeighted(
        catalogue.definitions.filter((d) => d.rooms.includes(e.room)),
        (d) => d.weight,
        flavour,
      );
      return { ...e, definition_id: def.id };
    }),
  };
}

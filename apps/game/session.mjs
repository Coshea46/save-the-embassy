import { randomInt } from "node:crypto";
import {
  createScenario,
  Simulation,
  standardRules,
  stations,
  tiles,
  urgency,
} from "@embassy/simulation";
import { fullCatalogue } from "@embassy/tasks";
import { PythonBridge } from "./bridge.mjs";

export const floor = { tiles, stations };
export const roomAt = (position) =>
  stations.find(
    (s) => s.position.x === position.x && s.position.y === position.y,
  )?.room;

export class Practice {
  constructor(seed = randomInt(2 ** 32), thresholds = standardRules.urgency) {
    this.seed = seed;
    const scenario = createScenario(seed, undefined, fullCatalogue, {
      ...standardRules,
      urgency: thresholds,
    });
    this.sim = new Simulation(scenario, fullCatalogue);
    this.events = new Map(scenario.events.map((e) => [e.id, e]));
    this.stages = scenario.rules.stages;
    this.thresholds = thresholds;
    this.log = [];
    this.history = [];
    this.active = null;
    this.decisions = 0;
  }
  frame() {
    const obs = this.sim.observe();
    const cp = this.sim.checkpoint();
    const band = (t) =>
      ["Opening", "Mid-shift", "Rush"][
        this.stages.findLastIndex((s) => s.start <= this.events.get(t.id).spawn)
      ];
    const reports = obs.available_tasks.map((t) => ({
      ...t,
      room: roomAt(t.position),
      band: band(t),
    }));
    let active = null;
    if (cp.job) {
      const event = this.events.get(cp.job.id);
      const distance = cp.job.route.length;
      const remaining = event.deadline - cp.tick;
      const slack = remaining - distance - cp.job.remaining;
      active = {
        ...this.active,
        band: band(event),
        room: event.room,
        distance,
        estimated_travel_time: distance,
        time_remaining: remaining,
        slack,
        urgency: urgency(slack, this.thresholds),
        work_left: cp.job.remaining,
      };
    }
    return {
      mode: "practice",
      seed: this.seed,
      tick: cp.tick,
      status: cp.status,
      position: cp.position,
      active,
      reports,
      history: this.history,
      log: this.log,
      metrics: cp.metrics,
      decisions: this.decisions,
      verified: false,
    };
  }
  async advance(bridge) {
    const obs = this.sim.observe();
    if (!this.sim.busy) {
      const id = await bridge.choose(obs);
      this.sim.select(id);
      this.active = obs.available_tasks.find((t) => t.id === id) ?? null;
      this.decisions++;
      this.log.unshift({
        tick: obs.simulation_time,
        text: this.active ? "Selected " + this.active.title : "Wait one tick",
      });
    }
    const previous = [this.active, ...obs.available_tasks].filter(Boolean);
    const completed = this.sim.metrics.completed;
    this.sim.step();
    const cp = this.sim.checkpoint();
    const open = new Set(cp.open);
    for (const t of new Map(previous.map((t) => [t.id, t])).values()) {
      if (open.has(t.id)) continue;
      const done = t.id === this.active?.id && completed < cp.metrics.completed;
      this.history.unshift({
        tick: cp.tick,
        title: t.title,
        outcome: done ? "Completed" : "Expired",
        reward: done ? t.reward : 0,
      });
    }
    return this.frame();
  }
}

export async function newWorker() {
  const bridge = new PythonBridge({
    timeout: process.env.EMBASSY_DECISIONS === "1" ? 10000 : 3000,
  });
  try {
    await bridge.reset();
    return bridge;
  } catch (error) {
    await bridge.close().catch(() => {});
    throw error;
  }
}

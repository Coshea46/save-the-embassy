import { Simulation, createScenario } from "@embassy/simulation";
import { strategies } from "@embassy/strategies";
export function runBenchmark(seeds) {
  return seeds.flatMap((seed) => {
    const scenario = createScenario(seed);
    return Object.entries(strategies).map(([strategy, choose]) => {
      const sim = new Simulation(scenario);
      while (sim.status === "playing") sim.decide(choose(sim.observe()));
      return { seed, strategy, status: sim.status, ...sim.metrics };
    });
  });
}

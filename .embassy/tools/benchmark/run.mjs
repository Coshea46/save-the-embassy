import { Simulation, createScenario } from "@embassy/simulation";
import { strategies } from "@embassy/strategies";
import { fullCatalogue } from "@embassy/tasks";
export function runBenchmark(seeds) {
  return seeds.flatMap((seed) => {
    const scenario = createScenario(seed, undefined, fullCatalogue);
    return Object.entries(strategies).map(([strategy, choose]) => {
      const sim = new Simulation(scenario, fullCatalogue);
      while (sim.status === "playing") sim.decide(choose(sim.observe()));
      return { seed, strategy, status: sim.status, ...sim.metrics };
    });
  });
}

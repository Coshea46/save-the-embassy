import { fullCatalogue } from "@embassy/tasks";
import { createScenario, Simulation } from "@embassy/simulation";
import { newWorker } from "./session.mjs";
const seeds = (process.argv[2] ?? "1,7,42,2026").split(",").map((word) => {
  if (!/^\d+$/.test(word))
    throw new Error("Provide comma-separated integer seeds.");
  return Number(word);
});
const results = [];
for (const seed of seeds) {
  const game = new Simulation(
    createScenario(seed, undefined, fullCatalogue),
    fullCatalogue,
  );
  const agent = await newWorker();
  try {
    while (game.status === "playing")
      game.decide(await agent.choose(game.observe()));
    const { score, survival_ticks, completed } = game.metrics;
    results.push({
      seed,
      score,
      survival_ticks,
      completed,
      status: game.status,
    });
  } finally {
    await agent.close();
  }
}
console.table(results);
console.log(
  "Mean score:",
  results.reduce((sum, r) => sum + r.score, 0) / results.length,
);

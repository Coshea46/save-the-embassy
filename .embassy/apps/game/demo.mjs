import { createScenario, Simulation } from "./dist/index.js";
import { PythonBridge } from "./bridge.mjs";
const run = new Simulation(createScenario(Number(process.argv[2] ?? 42)));
const bridge = new PythonBridge();
try {
  await bridge.reset();
  while (run.status === "playing")
    run.decide(await bridge.choose(run.observe()));
  console.log(JSON.stringify({ status: run.status, ...run.metrics }, null, 2));
} finally {
  await bridge.close();
}

import { runBenchmark } from "./run.mjs";
const seeds = (process.argv[2] ?? "1,7,42,2026").split(",").map(Number);
console.log(JSON.stringify(runBenchmark(seeds), null, 2));

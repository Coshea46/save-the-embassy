import {
  canonicalEvents,
  entrance,
  shortestPath,
  standardRules,
} from "@embassy/simulation";
import { runBenchmark } from "../benchmark/run.mjs";
const count = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(count) || count < 1)
  throw new Error("Expected a positive scenario count");
const rows = [];
for (let seed = 0; seed < count; seed++) {
  const events = canonicalEvents(seed);
  let last = entrance;
  const row = {
    reward: 0,
    offeredWork: 0,
    route: 0,
    mandatory: 0,
    meanSlack: 0,
    peakOpen: 0,
  };
  for (const e of events) {
    const travel = shortestPath(last, e.position).length;
    row.reward += e.reward;
    row.offeredWork += e.duration;
    row.route += travel;
    row.meanSlack += e.deadline - e.spawn - travel - e.duration;
    row.mandatory += Number(e.mandatory);
    row.peakOpen = Math.max(
      row.peakOpen,
      events.filter((t) => t.spawn <= e.spawn && t.deadline > e.spawn).length,
    );
    last = e.position;
  }
  row.meanSlack /= events.length;
  const results = runBenchmark([seed]);
  for (const result of results) {
    row[result.strategy + "Score"] = result.score;
    row[result.strategy + "Survival"] = result.survival_ticks;
  }
  rows.push(row);
}
const summary = {};
for (const key of Object.keys(rows[0])) {
  const values = rows.map((r) => r[key]).sort((a, b) => a - b);
  const quantile = (q) => values[Math.floor(q * (count - 1))];
  summary[key] = {
    min: values[0],
    p10: quantile(0.1),
    median: quantile(0.5),
    p90: quantile(0.9),
    max: values.at(-1),
    mean: Number((values.reduce((n, v) => n + v, 0) / count).toFixed(2)),
  };
}
console.log(
  JSON.stringify(
    {
      count,
      firstSeed: 0,
      lastSeed: count - 1,
      horizon: standardRules.horizon,
      summary,
    },
    null,
    2,
  ),
);

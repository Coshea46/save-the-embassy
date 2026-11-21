import type { Strategy, Observation } from "@embassy/contracts";
type Task = Observation["available_tasks"][number];
function highest(value: (task: Task) => number): Strategy {
  return (observation) => {
    let best: Task | undefined;
    let score = -Infinity;
    for (const task of observation.available_tasks) {
      const candidate = value(task);
      if (candidate > score) {
        best = task;
        score = candidate;
      }
    }
    return best?.id ?? null;
  };
}
export const strategies = {
  priority: highest((t) => t.priority),
  deadline: highest((t) => -t.time_remaining),
  shortest: highest((t) => -t.duration),
  travel: highest((t) => -(t.distance + t.duration)),
  weighted: highest((t) =>
    t.slack < 0
      ? -Infinity
      : (t.mandatory ? 30 + 400 / (1 + t.slack) : 0) +
        t.reward / (t.duration + t.distance) +
        t.priority / (1 + t.slack),
  ),
} satisfies Record<string, Strategy>;

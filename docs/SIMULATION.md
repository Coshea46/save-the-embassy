# Simulation rules, embassy.1

One integer tick represents one simulated second. The standard run lasts at most 360 ticks. Tile coordinates start at (0,0) in the top-left. Floor, door and corridor tiles each cost one movement tick. Walls and furniture block movement. Breadth-first search visits north, east, south and west in that order. Routes exclude the starting tile and include the interaction point. Distance is the length of this route. Working on a report already at the agent's location costs only its work duration.

## Tick order and decisions

1. Create the run at reception corridor coordinate (9,5) and publish tick-zero spawns.
2. At a decision boundary, select an open ID or wait one tick with null. Invalid choices fail before mutating state. A selected job is non-preemptive.
3. Advance the clock by one. Move one tile, perform one work tick, or idle. Arrival and the first work tick are separate. The final work tick pays the reward, increments completed and removes the task.
4. Expire all remaining tasks with deadline at or before this tick. Expiry cancels a job in progress. Count every expired task. A mandatory expiry closes the embassy. Completion on the deadline succeeds.
5. Close on mandatory failure, otherwise finish at the horizon. Remaining unexpired reports earn zero and stay outstanding. Otherwise publish new reports for the current tick in event order, even while busy.
6. The next decision occurs when the run is playing and the job has finished or expired. decide(id) runs the entire selection. select(id) and step() expose individual ticks for animation. After select(null), call step() exactly once.

## Scheduling data

slack = time remaining − shortest travel time − work duration. Defaults are critical at slack ≤5, very urgent at 6–15, urgent at 16–30 and normal above 30. Negative slack means the job cannot finish from the current position. The observation omits the active job from available tasks and exposes its ID separately. Ask the agent only at decision boundaries.

Each completion pays the face reward exactly once. Mandatory and optional point subtotals sum to score. Priority is an imperfect signal of value. Short travel, feasible deadlines, upcoming expiry of visible mandatory jobs and the time spent on long work all affect which choice pays most. The clock never reads elapsed processing or rendering time. Metrics expose completed, expired, travel, idle, work performed and the total work and reward offered up to termination.

## Generation and fairness

Canonical events use a uint32 seed and an integer PRNG. Draw without replacement from a bag of reward, priority and work bands. Refill after one draw from every band to limit reward variation across seeds. Within a band, draw a weighted station, priority variation and duration variation. Longer inter-station routes become more likely later. Compute deadline budgets from the canonical route and work, stage slack and outstanding offered workload. Official schedules stay independent of agent performance. A separate seeded stream picks a compatible incident by catalogue weight. Flavour never consumes canonical draws.

The first task is mandatory with a deadline reachable from the starting tile. Mandatory windows do not overlap and include travel from the farthest station. Optional choices can still leave too little time to finish a mandatory report. Three configurable stages accelerate spawns and increase work while reducing slack. validateRules rejects invalid tick intervals. Changing bands, stages, map, tie order, scoring or generator behaviour requires a new rules version. Version changes to catalogue order, weights or content separately. Persist the immutable scenario manifest, seed, rules and catalogue used for each round.

The fairness CLI measures complete opportunity schedules before applying strategies, then simulates five policies to measure achievable scores and survival. In 1,000 standard scenarios (seeds 0–999), p10/median/p90 total offered reward was 2250/2325/2360, offered work was 316/328/337 ticks, and successive-station travel was 326/374/418 tiles. All had five mandatory reports. Median scores were 935 for priority-first and 1345 for weighted urgency/reward. Random practice runs still vary in difficulty. Compare official participants only within the same assigned scenario.

## Checkpoints

checkpoint() returns a detached JSON record with format, version manifest, seed, tick, cursor, open task IDs, active route and work remaining, coordinates, status and score counters. Simulation.restore(scenario, checkpoint, catalogue) consumes a trusted persisted checkpoint. Restore from the identical immutable scenario and catalogue. replay(scenario, decisions, catalogue) constructs fresh state and applies accepted choices in order. Never accept a participant's checkpoint for official verification. tests/fixtures/golden.json pins seed, choices and the complete terminal record.

# Architecture and development handoff

The game and API depend on the same compiled npm workspace, `@embassy/simulation`. The only external runtime dependency is Zod in the contracts package. Node hosts a Python child for local play. The platform uses a stored server scenario and a sequence of task choices to reproduce the score.

| Workspace or path | Exports or responsibility | Owner |
| --- | --- | --- |
| @embassy/contracts | positionSchema, integer, rooms, roomSchema, categoryTargets, catalogueSchema, definitionSchema, eventSchema, instanceSchema, taskViewSchema, observationSchema, manifestSchema, metricsSchema, statusSchema, rest, and their exported TS types | Shared |
| @embassy/tasks | loadCatalogue(raw, full?), sampleCatalogue; replace sample data with a versioned collection while retaining historical catalogues | Game owns catalogue content |
| @embassy/simulation | Simulation, replay, createScenario, canonicalEvents, standardRules, validateRules, RULESET, tiles, stations, entrance, walkable, samePosition, shortestPath, urgency; types Scenario, Stage, Rules, Checkpoint, Status | Shared |
| @embassy/strategies | strategies with priority, deadline, shortest, travel, weighted keys | Shared |
| @embassy/game | createScenario, Simulation, tiles, stations, urgency, observationSchema. Node-only PythonBridge is imported from apps/game/bridge.mjs | Game |
| @embassy/api | rest, applyDecision, acceptDecision, earliestDecisionMs; types StoredRun, AcceptedDecision, RunTransaction | Platform |
| apps/leaderboard and Supabase migrations | Public standings, realtime projection, organiser dashboard and projector view | Platform |
| tools/benchmark and tools/fairness | Seeded headless experiments | Shared |

## Game session

Create a separate Codex Cloud task using this repository and the foundation commit as its starting revision. Branch as `game`. Read AGENTS.md, this file, SIMULATION.md and WORKSHOP.md. Run the demo before editing. Build the pixel-art embassy, sprites, animation, minimap and urgency markers in apps/game. Use the exported map and actual engine coordinates. Call select followed by step for animation and decide for headless practice. Expose a participant's agent.py through the local launcher. Use rest schemas for official sessions. Leave the platform deployable independently by using a mock transport in game development.

Write the full original catalogue against definitionSchema. Validate the new collection with loadCatalogue(data, true), including all nine category counts, room coverage and uniqueness. Keep the sample catalogue for golden replay. Set a new immutable version for the full catalogue. The optional Decisions API strategy belongs in the local game and needs its own explicit configuration. Keep the default strategy usable offline. Expand WORKSHOP.md with the fork, clone, VS Code, Codex, run and submission flow. Open a PR for the game branch.

## Platform session

Start another Codex Cloud task at the same commit and branch as `platform`. Read AGENTS.md and API.md. Build the REST routes, transaction adapter, auth and workshop membership, immutable official scenario registry, verified scoring, Supabase policies and realtime leaderboard. Place the dashboard and projector mode in apps/leaderboard. Begin with sampleCatalogue and a server-assigned private scenario, so game assets and the larger catalogue are optional dependencies. Use the typed contracts and the exact engine. Exercise duplicate and concurrent requests against real Postgres. Open a separate PR for the platform branch.

If foundation has already merged, target main in both PRs. While foundation is open, target foundation and retarget after it merges. Add workspace dependencies using npm from the root. If both branches update package-lock.json, regenerate it from the merged manifests during integration.

## Official client boundary

The Python strategy sees only observationSchema data. The server owns the official seed, full schedule and checkpoint. The renderer needs only the public map, current position, visible task data and status. For a rich official animation the platform and game can agree a versioned extension for visible frames from accepted decisions. The current decision response is a scheduling-boundary snapshot. Practice can render every tick directly.

# Architecture and development handoff

The game and API depend on the same compiled npm workspace, `@embassy/simulation`. Node hosts a Python child for local play. The platform uses a stored server scenario and a sequence of task choices to reproduce the score.

| Workspace or path | Exports or responsibility | Owner |
| --- | --- | --- |
| @embassy/contracts | positionSchema, integer, rooms, roomSchema, categoryTargets, catalogueSchema, definitionSchema, eventSchema, instanceSchema, taskViewSchema, observationSchema, manifestSchema, metricsSchema, statusSchema, rest, and their exported TS types | Shared |
| @embassy/tasks | loadCatalogue(raw, full?), fullCatalogue (dispatch.1), sampleCatalogue (historical replay) | Game owns catalogue content |
| @embassy/simulation | Simulation, replay, createScenario, canonicalEvents, standardRules, validateRules, RULESET, tiles, stations, entrance, walkable, samePosition, shortestPath, urgency; types Scenario, Stage, Rules, Checkpoint, Status | Shared |
| @embassy/strategies | strategies with priority, deadline, shortest, travel, weighted keys | Shared |
| @embassy/game | createScenario, Simulation, tiles, stations, urgency, observationSchema. Node-only PythonBridge is imported from apps/game/bridge.mjs | Game |
| @embassy/api | rest, applyDecision, acceptDecision, earliestDecisionMs; types StoredRun, AcceptedDecision, RunTransaction | Platform |
| apps/leaderboard and Supabase migrations | Public standings, realtime projection, organiser dashboard and projector view | Platform |
| tools/benchmark and tools/fairness | Seeded headless experiments | Shared |

## Integrated runtime

The participant starts the loopback game from the repository root with `npm --prefix .embassy start`. On reset, the local worker loads the repository-root `agent.py` from source and keeps its `choose_next_task` function and module state for the run. The benchmark uses the same worker. It receives observations from the shared engine in practice and from the competition REST API in official mode. The launcher journals credentials, run IDs and pending decisions in the participant’s profile. Website registration and local registration both lead to the same participant protocol.

The organiser runs `npm run start:platform` in `.embassy/` after building. This service serves the leaderboard, registration and organiser pages on the API origin. Every new workshop stores its own immutable scenario and complete catalogue snapshot. The bundled default is `dispatch.1` with 600 definitions. Historical runs use their stored catalogue. PostgreSQL transactions apply decisions through the shared engine and publish the public standings projection. See [API details](API.md) and [deployment](PLATFORM.md).

## Official client boundary

The Python strategy sees only observationSchema data. The server owns the official seed, full schedule and checkpoint. The renderer needs only the public map, current position, visible task data and status. Official animation reconstructs the accepted route from the previous visible task, shared pathfinder and verified change in travel ticks. The decision response contains a scheduling-boundary snapshot. Practice can render every tick directly.

## Workshop workspace

Open the repository root in VS Code. Its Explorer settings hide the internal folders. Maintainers can open `.embassy/` directly or disable those entries in `.vscode/settings.json`. Run maintainer npm commands inside `.embassy/`, which owns the lockfile and all seven npm workspaces.

For a trusted project, `.codex/config.toml` selects the root README as Codex’s fallback instruction file. Its workshop instructions apply to root strategy requests. The README also includes an explicit, file-scoped prompt for participants. The maintainer instructions in `.embassy/AGENTS.md` cover the internal workspace.

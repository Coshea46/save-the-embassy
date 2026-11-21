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

The participant starts the loopback game with `npm start`. Its persistent Python worker receives observations from the shared engine in practice and from the competition REST API in official mode. The launcher journals credentials, run IDs and pending decisions in the participant’s profile. Website registration and local registration both lead to the same participant protocol.

The organiser runs `npm run start:platform` after building. This service serves the leaderboard, registration and organiser pages on the API origin. Every new workshop stores its own immutable scenario and complete catalogue snapshot. The bundled default is `dispatch.1` with 600 definitions. Historical runs use their stored catalogue. PostgreSQL transactions apply decisions through the shared engine and publish the public standings projection. See [API details](API.md) and [deployment](PLATFORM.md).

## Official client boundary

The Python strategy sees only observationSchema data. The server owns the official seed, full schedule and checkpoint. The renderer needs only the public map, current position, visible task data and status. Official animation reconstructs the accepted route from the previous visible task, shared pathfinder and verified change in travel ticks. The decision response contains a scheduling-boundary snapshot. Practice can render every tick directly.

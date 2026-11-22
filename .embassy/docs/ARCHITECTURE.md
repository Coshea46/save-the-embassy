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

The participant starts the loopback game from the repository root with `npm --prefix .embassy start`. On reset, the local worker loads the repository-root `agent.py` from source and keeps its `choose_next_task` function and module state for the run. The benchmark uses the same worker. It receives visible observations from the same local engine in both modes. The launcher journals credentials, run IDs and pending decisions in the participant’s profile. Website registration and local registration both lead to the same participant protocol.

The organiser runs `npm run start:platform` in `.embassy/` after building. This service serves the leaderboard, registration and organiser pages on the API origin. Every new workshop stores its own immutable scenario and complete catalogue snapshot. The bundled default is `dispatch.1` with 600 definitions. Historical runs use their stored catalogue. PostgreSQL transactions apply decisions through the shared engine and publish the public standings projection. See [API details](API.md) and [deployment](PLATFORM.md).

## Official client boundary

Practice constructs a local scenario. Competition receives a protocol-2 assignment over authenticated HTTPS and validates its schema, rules, manifest, event order, station positions and referenced definitions. Both feed the same controller in `apps/game/session.mjs`. Every local step calls Python when a decision is due and advances exactly one simulation tick. The browser controls playback speed, pause and animation. The browser’s step request is loopback-only.

The launcher saves a per-workshop journal in the participant’s private profile. A tick and any new decision, route, active job, history and log are saved together by flushed temporary-file replacement. Each journal belongs to one run. Entries before the acknowledgement cursor are accepted, subsequent entries are pending. One stored batch boundary and one finish UUID survive lost replies. The maximum journal length is the scenario horizon. The synchroniser sends at most 32 entries at a time with one in-flight request per run. Its timer and network calls never enter the tick or disk-write queue.

On relaunch, unfinished v2 profiles reopen locally, including terminal games with pending verification. Upload resumes even if the participant returns to Practice. A restarted Python process has fresh module globals; the stored run, choices and simulation checkpoint continue. Arbitrary Python process state cannot be serialised. A crash before a tick has been saved resumes from the preceding durable tick. Disk write failures surface in the local UI. Server restart recovery uses PostgreSQL receipts and checkpoints. See [the protocol](API.md) and [rollout procedure](PLATFORM.md#local-first-rollout).

## Workshop workspace

Open the repository root in VS Code. Its Explorer settings hide the internal folders. Maintainers can open `.embassy/` directly or disable those entries in `.vscode/settings.json`. Run maintainer npm commands inside `.embassy/`, which owns the lockfile and all seven npm workspaces.

For a trusted project, `.codex/config.toml` selects the root README as Codex’s fallback instruction file. Its workshop instructions apply to root strategy requests. The README also includes an explicit, file-scoped prompt for participants. The maintainer instructions in `.embassy/AGENTS.md` cover the internal workspace.

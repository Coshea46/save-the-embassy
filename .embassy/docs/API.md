# Official competition protocol

## Local-first launcher (protocol 2)

Registration, bearer authentication, workshop membership and opening the entry window are unchanged. The local launcher performs the following operations.

| Method and path | Request | Response |
| --- | --- | --- |
| POST /v2/workshops/:workshop_id/runs | Stable start UUID as `idempotency_key` | Protocol 2, run UUID, UTC submission deadline, pinned scenario and event catalogue |
| POST /v2/runs/:run_id/decisions | `decisions`, an ordered list of 1–32 records | Run UUID, next accepted sequence, independently calculated score at that boundary |
| POST /runs/:run_id/finish | Next sequence and stable finish UUID | Terminal RunStatus after full independent replay |
| GET /workshops/:workshop_id/display | None | Ranked snapshot and finalisation status |

The start transaction locks the participant’s membership, checks opening times and the configured attempt limit, and stores a 30-minute deadline from the database clock. A retry with the same start key returns the same assignment. Closing entry stops new attempts. Existing deadlines continue, including for offline players. The local launcher displays the deadline in local time. A pause, reconnect or changed laptop clock cannot extend it. After expiry, previously accepted requests still have receipts. New decisions and new finishes are ineligible.

The assignment contains the seed, manifest, rules and complete scheduled incident instances, plus only the pinned definitions those instances reference. Treat the downloaded schedule as inspectable. Python receives the shared engine’s visible observation at each decision boundary. Its function can return null at every tick, even when a task is available.

Each batch record contains `sequence` (zero-based), `idempotency_key`, `tick` and `selected_task_id` (ID or explicit null). The API rejects additional score, checkpoint or timing fields. The tick is an assertion against the current server checkpoint. Within one transaction the server locks the run, checks existing receipts, restores its own scenario and checkpoint, validates each choice, inserts the accepted suffix, and updates the checkpoint, score and public projection. Conflicting receipts, gaps and illegal choices fail the entire batch. An identical retried prefix returns its original end sequence and score. Per-run sequence and key constraints remain in force. Finish independently replays all stored choices and compares the entire terminal checkpoint before publishing final status.

The existing public Supabase Realtime publication carries committed standings. A reconnecting viewer reads the public snapshot. Realtime and leaderboard reads are outside the local gameplay loop.

| Background response | Launcher behaviour |
| --- | --- |
| Success | Save the batch acknowledgement. Continue with the next pending sequence. |
| HTTP 429 | Keep the batch and honour the server retry delay with jitter. |
| Disconnection, HTTP 408 or 5xx | Retry the same batch or finish with exponential backoff. |
| Conflicting decision, invalid choice, expired or excluded attempt | Show the server explanation. Keep the local score and journal. |

## Historical clients (protocol 1)

The routes and the pacing rules below apply to the original launcher. Existing runs retain their original deadline and receipts. Finish a previously started protocol-1 attempt using its original launcher; the new launcher identifies that situation before starting another attempt. Completed results and the best-attempt ranking span both protocols. New attempts started using the original launcher continue to use protocol 1 during rollout.

The shared Zod export `rest` defines exact request and response schemas. All object schemas reject unknown fields. IDs used in REST for participants, workshops, runs and idempotency are UUIDs. Client seeds, scores, elapsed times and checkpoints are excluded. The simulation can be used without a server for practice.

| Method and path | Body or query | Successful response |
| --- | --- | --- |
| POST /participants | display_name | participant_id, access_token |
| POST /workshops/:workshop_id/join | join_code | workshop_id, participant_id |
| POST /workshops/:workshop_id/runs | idempotency_key | RunStatus |
| POST /runs/:run_id/decisions | sequence, selected_task_id (string or null), idempotency_key | RunStatus |
| GET /runs/:run_id | empty | RunStatus |
| POST /runs/:run_id/finish | sequence, idempotency_key | verified terminal RunStatus |
| GET /workshops/:workshop_id/leaderboard | empty | workshop_id, entries with rank, display_name, score, survival_ticks |

RunStatus carries run_id, public scenario manifest, next_sequence, tick, status, metrics and an observation while playing. Authenticate participant routes with the registration bearer token. Scope every run to its owner and every start to a joined workshop. Organisers assign one immutable private scenario per official ranked round. Limit each participant to one ranked attempt per round, enforce in the database, and keep practice separate. Pin the full scenario and catalogue artefacts for replay. A participant cannot supply the seed.

### Legacy persistence

Use a single database transaction per decision. Acquire a row lock on the run, authenticate ownership and check the receipt keyed by (run_id, idempotency_key). Return the stored response for an identical retry, even after later decisions. Reject a changed payload or unexpected sequence with 409. Restore the stored checkpoint and apply exactly one decision through applyDecision. Write the immutable input, its response, next sequence and replacement checkpoint atomically. Add unique constraints for both (run_id, sequence) and (run_id, idempotency_key). A lost response can be retried. A rollback leaves all records at their preceding state.

acceptDecision provides this orchestration; implement RunTransaction using a real shared transaction or an equivalent version-checked atomic database function with retry. Independent Supabase HTTP writes do not form a transaction. Reject invalid IDs and unavailable jobs with 422, missing authentication with 401 and ownership violations with 403. Use the start key with participant and workshop to make start retries stable. Cache finish receipts too. Finish requires a terminal engine checkpoint and matching sequence. Replay the stored scenario and accepted decisions, compare terminal records and publish the verified result exactly once. Project only the public leaderboard columns through Supabase Realtime. Sort by score descending, then survival descending; equal values share rank. Use stable run ID order for display ties.

### Legacy pacing

Official runs advance at 4×. Each tick represents one simulated second and costs 250 ms of wall time. The server uses the database clock and gates the **resulting** tick, including the terminal tick, at `started_at + max(0, tick × 250 ms − 375 ms)`. The 1.5-tick allowance applies once from the start. Clients that fall behind can catch up without per-decision sleeps. Only accepted simulation decisions update scores.

A new 360-tick run has a 90-second nominal duration plus 90 wall-clock seconds of grace for slow requests, pauses, reconnection and finalisation. Closing entry preserves every existing deadline. The server checks stored receipts before expiry so a lost acknowledgement can still be recovered. An unfinished attempt that expires becomes ineligible.

### Legacy launcher

Use the service origin as the base URL. Send JSON with `Content-Type: application/json` and `Authorization: Bearer <access_token>` on every join, start, recovery, decision and finish. Browser registration at `/join` can copy a JSON object containing `api_url`, `workshop_id`, `participant_id` and `access_token` for local import. A code-only client first sends `POST /workshops/resolve` with `{"join_code":"..."}` to obtain the workshop UUID. Register once and save credentials outside the fork's tracked files.

Persist the start key before the first POST. Save the run ID and each exact pending decision, including its UUID, before sending it. A timeout or lost response calls for the identical request. HTTP 429 includes `reason` (`simulation_pacing` or `rate_limit`), exact `retry_ms` and a rounded-up HTTP `Retry-After` in seconds. Use the millisecond delay when present and fall back to the header. On restart, resend an outstanding request, then recover the latest boundary with `GET /runs/:id`. A stored receipt may describe an earlier boundary. If the run ID was lost, authenticated `GET /workshops/:id/me` lists the participant's own run IDs and deadlines. On a terminal snapshot, persist a new finish key and POST `next_sequence` as `sequence` to the finish route. A successful finish confirms full independent replay.

Run responses advertise `Embassy-Tick-Ms`. An accepted playing decision also provides `Embassy-Next-Wait-Ms`, the remaining delay for a one-tick wait at its next sequence. The launcher consumes this hint only when Python chooses `None` for that boundary. Each wait still gets its own observation, sequence and replay receipt. The database enforces the same clock for clients that ignore the hint.

HTTP 401 means the token is invalid or expired, 403 means wrong owner, workshop or join code, 409 means a conflicting key, sequence, name or round state, 410 means the attempt has expired or been excluded, and 422 means invalid input. 5xx responses and interrupted requests can be retried with the same key. A rejected decision leaves both score and sequence unchanged.

The default is one official attempt. An organiser may set 1–20 before starting. Each participant can have one open attempt at a time. Attempts in the same workshop always use the same pinned scenario. Rank each participant's highest eligible score, then longest survival, then use the run UUID only for stable display order. Equal score and survival share competition rank. A finalist must have a confirmed finish receipt. Live attempts remain provisional until finish or expiry. Closing entry starts no new runs and preserves the full duration plus 90 seconds of grace for runs already started.

The strict leaderboard response is unchanged. The website uses `GET /workshops/:id/display` for public counters, best-run status, task counts, recent completions and round metadata. The Realtime table contains only workshop ID, display name, verified score and survival ticks. Authoritative state and the full schedule stay in the private database schema. See [operation and deployment](PLATFORM.md).

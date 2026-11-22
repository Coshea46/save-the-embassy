# Local-first competition rehearsal, 22 November 2026

At seed 42 the starter Python agent reached tick 318 and scored 1,045 in every browser run. The previous launcher forced 4× and took 79.48 s to reach game over. Selecting 8× with the updated launcher took 39.77 s in Practice and 39.83 s in Official. In both modes Chromium rendered one frame per simulation tick and used the same tile interpolation, work animation and urgency markers. The per-tick parity test compares all frames and terminal checkpoints. [Practice capture](qa/local-first/after-practice.jpg) · [Official capture](qa/local-first/after-official.jpg) · [Previous Official capture](qa/local-first/before-official.jpg)

Against disposable PostgreSQL, all 200 players finished verification. Across six identical policies on seed 42, both protocols accepted 11,818 decisions. The previous launcher protocol used 15,557 participant requests, including 2,939 pacing rejections. Local-first used 1,567 participant requests, including concurrent duplicates, with fast and slow agents, disconnections and five-second acknowledgements. The playback rates differ. The new headless cohort used 5 ms tick delays to exercise backlog recovery. PostgreSQL recorded zero deadlocks and 5,959 commits. The API and simulated clients shared one Node process, which peaked at 314 MiB RSS and consumed 28.0 CPU seconds. [Previous measurements](qa/local-first/legacy-six-policies.json) · [Local-first measurements](qa/local-first/local-six-policies.json)

The separate Supabase rehearsal runs an API container and two real WebSocket subscribers. Its GitHub Actions artifact includes the participant request distribution, database counters, verification latency, commit-to-delivery delays, browser durations and screenshots. The subscriber checks final scores and survival ticks for every participant. Run the workflow on a trusted PR or use the disposable local stack described in [PLATFORM.md](PLATFORM.md). None of these tests use the production workshop database or measure the free Render service.

At 4×, the first visible clock change fell from 4.406 s to 0.072 s. The game-over timings were 79.41 s and 79.46 s respectively. With a real HTTP proxy holding each competition reply for 20 seconds, an 8× Chromium shift took 40.07 s, and the final confirmation appeared 43.31 s later with the same 1,045 points.

The failure tests delay every central API response by 20 seconds, finish offline, lose committed batch and finish replies, kill and restart the local launcher, and restart the API process. The launcher restores a mid-route or terminal checkpoint while offline. A second launcher cannot overwrite the same profile. Python process globals start fresh after a process restart.

# Historical workshop rehearsal, 21 November 2026

## Participant and organiser experience

A participant joined through the invitation website, copied their game credentials into the loopback launcher and ran the starter Python class. The server assigned the round, paced every decision, committed the score and replayed the complete history before issuing the finish receipt. In the captured run Aurora completed 14 tasks and closed at 05:21 with 1,155 verified points. The public projector named Aurora the winner. A separate official run survived all 360 ticks with 1,195 points.

| Running application | Capture |
| --- | --- |
| Practice with a moving agent and selectable report markers | [Practice](qa/practice.jpg) |
| Official Python run | [Game](qa/official.jpg) |
| Public live score and active status | [Standings](qa/standings.jpg) |
| Authenticated competition controls | [Organiser](qa/organiser.jpg) |
| Terminal game and verified score | [Result](qa/verified.jpg) |
| Fullscreen 1920 × 1080 winner presentation | [Projector](qa/projector.jpg) |

Chromium rendered all three sprites, both walking frames, work and celebration frames. A browser check detected zero, one, two and three urgency marks and the alternating pulse colours on the minimap. It clicked the document at the visible report's coordinates and checked the selected title, travel and reward. On practice seed 42 the starter scored 1,045 at 05:18. Restart restored tick zero. In a clean student checkout, edits producing an invalid task, an exception and a timeout each paused the game at tick zero. Reloading an async counting agent preserved its memory until its third choice. Reloading the starter then resumed scoring.

## Scenario and fairness

Every new workshop snapshots the full 600 definitions, the generated schedule and the rules. Participants see the manifest and currently visible jobs. The Python-to-HTTP regression checks every returned observation against the reference simulation, including task IDs, coordinates, path lengths and score. It drops an accepted response, reconnects, finishes, starts a second permitted attempt and checks that the best result survives. The historical sample fixture still replays unchanged. [Catalogue audit](../apps/game/qa/catalogue-audit.json) · [Rules](SIMULATION.md)

| Production catalogue, seeds 0–999 | Median score |
| --- | ---: |
| Priority first | 935 |
| Earliest deadline | 750 |
| Shortest job | 905 |
| Travel-aware | 1,130 |
| Weighted urgency and reward | 1,345 |

All policies faced the same opportunities per seed. Official placement uses verified score, then simulated survival ticks. Identical values share rank. The real-time pacing allowance is absolute from each player's start and a 90-second grace period accommodates catch-up. Losing connectivity beyond the individual deadline can still make a run ineligible.

## Synchronous 150-player burst

150 clients registered, joined, started, hit the pacing gate and retried their first scoring decision twice concurrently. The local API handled 1,201 requests in 20.38 seconds with zero unexpected HTTP errors and zero database deadlocks. All 150 scored updates reached the connected WebSocket observer. A second observer missed the burst and recovered all 150 rows from the snapshot after resubscribing. The database contained 150 distinct decision rows for 150 distinct runs. [Raw measurements](qa/realtime-load.json)

| Measurement | Result |
| --- | ---: |
| API P95 across all requests | 725.7 ms |
| Simultaneous decision and retry throughput | 333.6 requests/s |
| Standings SQL query P95, 50 reads | 1.6 ms |
| Commit to WebSocket delivery, median / P95 | 42 / 473 ms |
| Expected pacing rejections | 150 |

The local WebSocket run used PostgreSQL 18.7, wal2json and Supabase Realtime 2.148.3 with the runner-specific UUID adaptation described in the [platform rehearsal](PLATFORM-LOAD.md). The GitHub competition rehearsal uses a stock disposable Supabase stack, builds the deployment image, runs the same burst, then plays a full Chromium game. Its artifact contains measured timings, the verified result and screenshots. Campus Wi-Fi, a hosted Supabase instance, external HTTPS and 150 physical laptops remain venue-specific checks.

## Complete 150-player round

A separate real-time rehearsal ran 30 clients per policy through the production HTTP routes against one private scenario. All **150 of 150** received verified finish receipts. The API handled 9,963 requests in 360 seconds, including 4,680 legitimate pacing responses and 4,680 committed decisions. HTTP P95 was 258.6 ms. Each final score and metric breakdown matched the independent simulation for that policy. [Complete round measurements](qa/full-round.json)

| Policy | Players | Score per player | Terminal tick |
| --- | ---: | ---: | ---: |
| Weighted urgency and reward | 30 | 1,385 | 360 |
| Travel-aware | 30 | 1,165 | 360 |
| Shortest job | 30 | 1,030 | 360 |
| Priority first | 30 | 860 | 240 |
| Earliest deadline | 30 | 715 | 240 |

The combined Node API and load generator consumed 36.49 CPU seconds and peaked at 321.2 MiB sampled resident memory. PostgreSQL ran separately. This full-round rehearsal used JavaScript policy clients and measured the leaderboard through REST. The separate WebSocket burst and real Python browser runs cover Realtime and the participant launcher.

## Reproduce

From `.embassy/`, run:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:python
npm run build
npm run test:platform
npm run audit:catalogue
npm run fairness -- 1000
npm run agent:benchmark -- 1,7,42,2026
npm run load:platform
node apps/api/test/full-round.mjs
```

The Linux setup job extracts and executes the README's distro-specific commands on clean Ubuntu, Debian and Fedora containers, installs VS Code and starts the actual game with Python. The OS matrix also runs the launcher on native Windows, macOS and Ubuntu runners. Windows and Mac package-manager installation and interactive editor sign-in were not exercised. The [organiser guide](PLATFORM.md) covers Supabase, the six required hosting settings, image deployment and the local WebSocket test.

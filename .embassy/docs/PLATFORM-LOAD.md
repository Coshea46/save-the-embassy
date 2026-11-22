# 150-agent rehearsal

On 21 November 2026, 150 independent mock clients hit the real HTTP service and PostgreSQL 18.7. All ran the same privately assigned sample-catalogue scenario. Each client attempted its first scoring decision early, waited for the server's delay, then submitted it twice concurrently. All 150 clients reconnected and fetched standings. This covers a synchronised scoring burst; it is a local measurement with two WebSocket viewers, not a full workshop over campus Wi-Fi.

| HTTP phase | Requests | Requests/s during burst | Median ms | P95 ms |
| --- | ---: | ---: | ---: | ---: |
| Register | 150 | 534.8 | 232.7 | 266.4 |
| Join | 150 | 771.4 | 132.3 | 173.9 |
| Start | 150 | 479.4 | 211.1 | 289.2 |
| Pacing rejection | 150 | 716.5 | 138.5 | 194.7 |
| Simultaneous decision and exact retry | 300 | 623.4 | 334.5 | 441.1 |
| Recovery after lost responses | 150 | 741.1 | 136.3 | 193.2 |
| Public snapshot reconnect | 150 | 1198.7 | 95.7 | 117.3 |

Across 1,201 measured requests, wall time was 15.73 s including intentional pacing and setup. HTTP latency was 175.5 ms median, 417.9 ms P95 and 442.9 ms P99. There were 150 expected pacing rejections, zero unexpected HTTP errors and exactly 150 decision records for 150 runs. Every duplicate returned its original result.

Fifty best-attempt standings queries took 0.8 ms median and 2 ms P95, including the local SQL connection round trip. Database-wide counter deltas during the measurement were 2,498 commits, 156 rollbacks (including deliberate pacing rejections), 190,822 shared-buffer hits, 320 blocks read and zero deadlocks. Background and Realtime transactions contribute to those counters.

The connected observer received all 150 committed score updates through Supabase Realtime v2.148.3 and wal2json. Commit-to-WebSocket delivery was 63 ms median, 98 ms P95, 145 ms P99 and 166 ms maximum. The second observer missed all 150 updates while offline and recovered all 150 rows from REST after resubscribing.

For this local run, the Realtime service's UUID library used its random-node fallback because the runner restricts network-interface enumeration. Subscription handling, WAL decoding, RLS and WebSocket delivery ran against the actual service. The PR rehearsal workflow runs the same assertions against the stock Supabase CLI stack. Its measurements are saved as the competition-rehearsal artifact.

Use the commands in [PLATFORM.md](PLATFORM.md) to repeat either rehearsal. Repeat on the intended hosting tier, final catalogue and venue network before treating these figures as a capacity estimate.

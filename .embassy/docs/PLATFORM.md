# Running the competition

One Node service hosts the REST API, registration, standings, projector and organiser desk. Students run their own Python process. The only external stateful service is a dedicated Supabase project.

## Local rehearsal

Use Node 22.13 or newer, npm, Docker and the Supabase CLI. From the repository root, run `cd .embassy` once before the commands below.

```sh
npm ci
npm run build
npm run test:platform
supabase start
supabase migration list --local
supabase status
```

The embedded PostgreSQL suite starts its own temporary cluster and uses the restricted application role. It needs no Docker or hosted account. A newly started Supabase stack applies the committed migration and publishes only the public standings table. Use a fresh project directory/stack for rehearsals.

Copy `.env.example` to `.env`. Use the local database URL, API URL and publishable key (or legacy anon JWT) printed by the CLI. Set an organiser username and generate a password hash. In Bash, this reads the password without echo or shell history.

```bash
read -rs -p "Organiser password (16–256 characters): " workshop_password
echo
printf '%s' "$workshop_password" | node apps/api/password-hash.mjs
unset workshop_password
```

Put the output in `ORGANISER_PASSWORD_HASH`. Start the service with `node --env-file=.env apps/api/dist/server.js`. Visit `http://127.0.0.1:8080/organiser`, create a workshop, then open its invitation link. The code can be rotated in the settings. The entry clock starts when the organiser presses **Start competition**. The dashboard exposes standings, projector and CSV links for that workshop. Ending the entry window preserves each existing run's individual deadline. The projector declares all tied winners once entry is closed and every eligible run has finished or expired.

## Production

1. Choose a Supabase project dedicated to this competition. Run `supabase login` and `supabase link --project-ref YOUR_WORKSHOP_PROJECT_REF` from `.embassy/`. Run `supabase db push --dry-run`, inspect the proposed migration, then `supabase db push`. Verify the expected migration with `supabase migration list --linked`. The schema expects the standard Supabase roles and the `supabase_realtime` publication. The Data API should expose `public` and exclude `embassy`.
2. Using a database administrator, create an application login with a randomly generated password and membership in `embassy_api`. In psql, run `CREATE ROLE embassy_web LOGIN INHERIT;`, then `\password embassy_web` at the interactive prompt and `GRANT embassy_api TO embassy_web;`. Supply the login's direct or pooler connection string in `DATABASE_URL`. With Supavisor follow the project Connect panel and replace the postgres username with the custom role while preserving the project reference. URL-encode reserved characters in credentials.
3. Set the runtime variables below in the hosting dashboard. From `.embassy/`, build with `docker build -f deploy/Dockerfile.platform -t embassy-platform .`. Set the six required values in the table. Set `PUBLIC_ORIGIN` to the service’s exact HTTPS URL and deploy the approved commit. The blueprint selects the free plan and manual deployment. A plain Node host can instead build with `npm ci && npm run build` and start with `npm run start:platform`. Keep the API and frontend on the same origin. Hosting must support a continuously running Node service and outbound PostgreSQL connections. Wake and rehearse a scale-to-zero host before the event.
4. Test `/health/ready`, log in at `/organiser`, create a rehearsal workshop, and test registration, offline recovery, projection, moderation and final results. Project the link under **Projector**. Use a new workshop for the actual competition. Run a full rehearsal on the chosen host and room network.

### Moving the existing Render Blueprint

The **save-the-embassy** Blueprint manages **embassy-competition-31iy** on `main`. Blueprint auto-sync and service auto-deploy are both off. The old Blueprint reads `render.yaml` and builds `./Dockerfile.platform` with context `.`.

1. Confirm the PR competition rehearsal passed. It builds the moved Dockerfile and exercises that image against disposable Supabase, including readiness, Realtime and the browser round. Merge the reviewed PR and record the SHA.
2. On the existing Blueprint, set the file path to `.embassy/deploy/render.yaml` and keep manual sync. Generate a plan against the merged SHA. Check it targets service `srv-dc12b23l550s73d68rtg` and changes only the Dockerfile path and context. Stop if it proposes another service or any other change.
3. Obtain organiser approval for the exact plan, then apply it. Deploy the merged SHA on the existing service if applying the plan did not already deploy it.
4. Confirm the deploy is live, `/health/ready` returns 200, and the organiser desk and public board load. If rollout fails, keep or roll back to the last successful deployment. Restore the previous Git layout before restoring its Blueprint path and Docker settings.

| Variable | Value |
| --- | --- |
| DATABASE_URL | Server-only application login. Use the session or transaction pooler for IPv4-only hosts. The driver disables prepared statements. |
| DATABASE_CA_FILE | Path to the Supabase CA PEM when required by the database endpoint. For a Supabase pooler using the 2021 root, set this to `/app/certs/supabase-prod-ca-2021.crt` in the platform Docker image. Remote connections verify TLS certificates. |
| PUBLIC_ORIGIN | Exact external HTTPS origin, or loopback HTTP in development. |
| SUPABASE_URL | Supabase project API origin. |
| SUPABASE_PUBLISHABLE_KEY | Publishable key or legacy anon JWT. This is the only Supabase key sent to browsers. |
| ORGANISER_USERNAME, ORGANISER_PASSWORD_HASH | Named organiser account and salted scrypt hash. Sessions use a separate HttpOnly, SameSite=Strict cookie, secure over HTTPS, with an eight-hour lifetime. |
| TRUSTED_PROXY | Optional Express trust-proxy address/subnet for verified reverse proxies. Leave unset if the network path is unknown. |
| PORT | HTTP listen port, default 8080. |
| OFFICIAL_CATALOGUE_FILE | Optional server-side JSON override. The bundled default is dispatch.1. Validated for all 600 definitions when loaded. New workshops snapshot this artefact. Existing rounds retain their original schedules and catalogue. |

Every backend instance shares the same database, organiser configuration and engine build. Upgrade between workshops. Archive the deployed image with its ruleset tag before changing engine behaviour. A server rejects a stored scenario when its ruleset differs from the loaded engine. Applying an old ruleset again requires its matching archived build.

## Operations

- Liveness is `GET /health/live`. Readiness is `GET /health/ready` and checks the database schema. Monitor response latency, HTTP 5xx rates, PostgreSQL connections, Realtime replication lag and free-tier limits. Pacing 429s are expected. Logged internal errors omit request bodies and credentials.
- A public viewer reads the REST snapshot when it opens, subscribes to changes for the workshop, fetches again on subscription, and refreshes every eight seconds even during a WebSocket outage. Bursts are coalesced. If the board shows **Snapshot updates**, verify the key, Realtime endpoint, RLS read policy and publication membership. Inspect with `select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime';`.
- The API checks eligibility at read time. The sweep removes expired projections every ten seconds while a server is running. A missed heartbeat only changes the connectivity label. A disqualification removes the selected run from rankings immediately. A reset also frees its attempt slot. Both retain the decision log and write an organiser audit entry.
- Participant tokens last 30 days and are stored hashed on the server. Keep the token and pending request local. A participant who loses the only token cannot reclaim a name by re-registering. The organiser may rename the previous entry and disqualify its attempts. A join code admits anyone who knows it. At a pseudonymous event the organiser handles duplicate human entrants.
- To rotate organiser access, change the password hash, restart the service, and revoke existing sessions in the competition database with `DELETE FROM embassy.organiser_sessions WHERE actor = 'your-organiser-name';`. Export standings before archiving the workshop. Keep database backups and restore the matching image for historical replay.

## Load and Realtime checks

`npm run load:platform` starts an isolated PostgreSQL database, registers 200 distinct agents and verifies complete local-first runs, concurrent duplicate batches and reconnects. It prints latency percentiles, request throughput, database counters and transaction counts. No cloud resources are needed.

For the WebSocket measurement, start the local Supabase stack and Node API as above. Supply the same local environment and the organiser's cleartext password **only to the rehearsal process**, via a hidden prompt. The command creates a fresh workshop. Two real subscribers observe the round. One disconnects during the score burst and checks the snapshot on return.

```bash
read -rs -p "Local rehearsal organiser password: " TEST_ORGANISER_PASSWORD
echo
export TEST_ORGANISER_PASSWORD
node --env-file=.env apps/api/test/local-stack.mjs
unset TEST_ORGANISER_PASSWORD
```

The test rejects remote target URLs. It compares the number of accepted rows with the complete local journals, checks concurrent retry responses, and verifies every player’s score and survival against independent simulation. The connected observer must receive a positive scored update for every player. The disconnected observer reads the complete standings after reconnecting. Commit-to-delivery timing uses the database commit timestamp and a subscriber on the same machine. See [the integrated measurements and browser captures](INTEGRATION.md).

For a legacy protocol-1 comparison at 4× using five scheduling policies across 200 clients, run `npm run build` followed by `node apps/api/test/full-round.mjs`. It checks every final score against a replay and reports request latency, decision latency including pacing, CPU and memory measurements. Pass `--wait-only` to exercise 200 agents that return a one-tick wait at every boundary, or `--mandatory-only` to exercise frequent waits through the full horizon.


## Local-first rollout

1. Review the PR and the checks on its latest commit, including the Windows, macOS and Linux clean installations and the 200-player Supabase rehearsal. Use the rehearsal artifact for hosted-runner timings. Merge the reviewed branch into `main` and record the resulting SHA. Keep the Render service on manual deployment.
2. Between workshops, record the currently deployed SHA, export current standings and confirm a recoverable database backup. From the repository root, change into `.embassy`. Run `supabase migration list --linked` and `supabase db push --dry-run` against the existing competition project. Confirm the only new migration is `20261122195900_local_competition.sql`. Apply it with `supabase db push` and verify the linked migration list. The change adds a small protocol column to runs with default 1. It preserves existing rows, grants and publication membership.
3. In Render, open the existing `embassy-competition-31iy` service and manually deploy the recorded merge commit. Its existing Blueprint path, Docker context, CA certificate and environment variables already support this release. The previous API continues to work with the additive migration.
4. Wait for `/health/ready` to return 200. Compare the pre-deployment standings export with the existing workshop. In a separate organiser-created smoke-test workshop, register, import credentials, pause connectivity after assignment, complete the run, reconnect and confirm the same score on a separate leaderboard browser. Check the private organiser view and an existing historical result.
5. Distribute the updated launcher once the smoke test passes. Students use the same three-step README and launch command. Let active legacy attempts finish using their original launcher and deadlines.
6. If rollback is necessary, pause new starts and redeploy the recorded prior Render commit. Keep the additive migration, data and participant journals. Legacy clients still work. Restore the v2 API before outstanding v2 deadlines to allow pending batches to finish. For an attempt that expired during an extended outage, the organiser can audit it and explicitly grant a replacement attempt under the workshop’s rules.

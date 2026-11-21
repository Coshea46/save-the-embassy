# Running the competition

One Node service hosts the REST API, registration, standings, projector and organiser desk. Students run their own Python process. The only external stateful service is a dedicated Supabase project.

## Local rehearsal

Use Node 22.13 or newer, npm, Docker and the Supabase CLI. Run the commands at repository root.

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

1. Choose a Supabase project dedicated to this competition. Run `supabase login` and `supabase link --project-ref YOUR_WORKSHOP_PROJECT_REF` from the repository root. Run `supabase db push --dry-run`, inspect the proposed migration, then `supabase db push`. Verify the expected migration with `supabase migration list --linked`. The schema expects the standard Supabase roles and the `supabase_realtime` publication. The Data API should expose `public` and exclude `embassy`.
2. Using a database administrator, create an application login with a randomly generated password and membership in `embassy_api`. In psql, run `CREATE ROLE embassy_web LOGIN INHERIT;`, then `\password embassy_web` at the interactive prompt and `GRANT embassy_api TO embassy_web;`. Supply the login's direct or pooler connection string in `DATABASE_URL`. With Supavisor follow the project Connect panel and replace the postgres username with the custom role while preserving the project reference. URL-encode reserved characters in credentials.
3. Set the runtime variables below in the hosting dashboard. Build from the repository root with `docker build -f Dockerfile.platform -t embassy-platform .` and run the image behind HTTPS. A Render Blueprint is provided in `render.yaml` with manual deployment and the free plan. A plain Node host can instead build with `npm ci && npm run build` and start with `npm run start:platform`. Keep the API and frontend on the same origin. Hosting must support a continuously running Node service and outbound PostgreSQL connections. Wake and rehearse a scale-to-zero host before the event.
4. Test `/health/ready`, log in at `/organiser`, create a rehearsal workshop, and test registration, pace/retry, projection, moderation and final results. Project the link under **Projector**. Use a new workshop for the actual competition. Run a full rehearsal on the chosen host and room network.

| Variable | Value |
| --- | --- |
| DATABASE_URL | Server-only application login. Use the session or transaction pooler for IPv4-only hosts. The driver disables prepared statements. |
| DATABASE_CA_FILE | Optional path to the Supabase CA PEM. Remote connections verify TLS certificates. |
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

`npm run load:platform` starts an isolated PostgreSQL database, registers 150 distinct agents and submits paced decisions, duplicate POSTs and reconnect bursts. It prints latency percentiles, per-burst throughput, database counters and transaction counts. No cloud resources are needed.

For the WebSocket measurement, start the local Supabase stack and Node API as above. Supply the same local environment and the organiser's cleartext password **only to the rehearsal process**, via a hidden prompt. The command creates a fresh workshop. Two real subscribers observe the round. One disconnects during the score burst and checks the snapshot on return.

```bash
read -rs -p "Local rehearsal organiser password: " TEST_ORGANISER_PASSWORD
echo
export TEST_ORGANISER_PASSWORD
node --env-file=.env apps/api/test/local-stack.mjs
unset TEST_ORGANISER_PASSWORD
```

The test rejects remote target URLs. It asserts exactly one decision per entrant, exact retry responses, equal final standings and delivery of every scored update to the connected observer. Commit-to-delivery timing uses the database commit timestamp and a subscriber on the same machine. See [the measured rehearsal](PLATFORM-LOAD.md).

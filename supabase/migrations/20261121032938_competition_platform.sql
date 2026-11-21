-- Only the public standings projection is exposed through the Data API.
create schema embassy;
revoke all on schema embassy from public, anon, authenticated;
create table embassy.scenarios (
  id uuid primary key, scenario jsonb not null, catalogue jsonb not null
);
create function embassy.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Immutable competition record'; end $$;
create trigger frozen before update or delete on embassy.scenarios
for each row execute function embassy.immutable();

create table embassy.workshops (
  id uuid primary key, title text not null, code_hash text not null unique,
  prize text not null, attempt_limit integer not null check (attempt_limit between 1 and 20),
  entry_minutes integer not null check (entry_minutes between 1 and 1440),
  registration boolean not null default true,
  phase text not null default 'lobby' check (phase in ('lobby','running','ended')),
  entry_until timestamptz, scenario_id uuid not null references embassy.scenarios,
  created_at timestamptz not null default now()
);
create table embassy.participants (id uuid primary key, name text not null);
create table embassy.sessions (
  token_hash text primary key, participant_id uuid not null references embassy.participants,
  expires_at timestamptz not null default now() + interval '30 days'
);
create table embassy.organiser_sessions (
  token_hash text primary key, actor text not null, expires_at timestamptz not null default now() + interval '8 hours'
);
create table embassy.members (
  workshop_id uuid references embassy.workshops, participant_id uuid references embassy.participants,
  display_name text not null, primary key(workshop_id, participant_id)
);
create unique index member_name on embassy.members(workshop_id, lower(display_name));
create table embassy.runs (
  id uuid primary key, workshop_id uuid not null, participant_id uuid not null,
  scenario_id uuid not null references embassy.scenarios, start_key uuid not null,
  initial_response jsonb not null, next_sequence integer not null default 0 check(next_sequence>=0),
  started_at timestamptz not null default clock_timestamp(), deadline timestamptz not null,
  seen_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  exclusion text check (exclusion in ('disqualified','reset','expired')),
  foreign key(workshop_id,participant_id) references embassy.members,
  unique(workshop_id,participant_id,start_key)
);
create index run_member on embassy.runs(workshop_id,participant_id);
create index pending_deadline on embassy.runs(deadline) where finished_at is null and exclusion is null;
create table embassy.checkpoints (
  run_id uuid primary key references embassy.runs, state jsonb not null, checksum text not null
);
create table embassy.decisions (
  run_id uuid references embassy.runs, sequence integer not null, selected_task_id text,
  idempotency_key uuid not null, response jsonb not null, completed_title text,
  committed_at timestamptz not null default clock_timestamp(),
  primary key(run_id,sequence), unique(run_id,idempotency_key)
);
create index recent_decisions on embassy.decisions(committed_at desc) where completed_title is not null;
create table embassy.finishes (
  run_id uuid primary key references embassy.runs, sequence integer not null, idempotency_key uuid not null, response jsonb not null
);
create table embassy.scores (
  run_id uuid primary key references embassy.runs, score integer not null,
  survival_ticks integer not null, completed integer not null, status text not null
);
create table embassy.audit (
  id bigint generated always as identity primary key, workshop_id uuid not null references embassy.workshops,
  actor text not null, action text not null, details jsonb not null, created_at timestamptz not null default now()
);
create trigger audit_immutable before update or delete on embassy.audit for each row execute function embassy.immutable();
create table embassy.rate_limits (bucket text primary key, hits integer not null, until_at timestamptz not null);
create index rate_expiry on embassy.rate_limits(until_at);
create view embassy.eligible as
select r.id as run_id,r.workshop_id,r.participant_id,m.display_name,r.finished_at,r.seen_at,s.*
from embassy.runs r join embassy.members m using(workshop_id,participant_id)
join lateral (select score,survival_ticks,completed,status from embassy.scores where run_id=r.id) s on true
where r.exclusion is null and (r.finished_at is not null or r.deadline>=clock_timestamp());
create view embassy.best as
select distinct on(workshop_id,participant_id) * from embassy.eligible
order by workshop_id,participant_id,score desc,survival_ticks desc,run_id;

create table public.embassy_standings (
  workshop_id uuid not null references embassy.workshops, display_name text not null,
  score integer not null, survival_ticks integer not null, primary key(workshop_id,display_name)
);
alter table public.embassy_standings enable row level security;
revoke all on public.embassy_standings from public, anon, authenticated;
grant select on public.embassy_standings to anon, authenticated;
create policy read_standings on public.embassy_standings for select to anon, authenticated using(true);
alter publication supabase_realtime add table public.embassy_standings;

create role embassy_api nologin;
grant usage on schema embassy, public to embassy_api;
grant select on all tables in schema embassy to embassy_api;
grant insert on embassy.scenarios,embassy.audit,embassy.decisions,embassy.finishes,embassy.participants to embassy_api;
grant insert,update on embassy.workshops,embassy.members,embassy.runs,embassy.checkpoints,embassy.scores to embassy_api;
grant insert,update,delete on embassy.sessions,embassy.organiser_sessions,embassy.rate_limits to embassy_api;
grant usage on all sequences in schema embassy to embassy_api;
grant select,insert,update,delete on public.embassy_standings to embassy_api;
create policy server_standings on public.embassy_standings for all to embassy_api using(true) with check(true);

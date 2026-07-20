-- supabase/schema.sql
-- Run once in the Supabase SQL Editor. Creates raw_events.events (server mirror of the local
-- events log) and operational.trips/legs (server mirror of the local projection), with RLS.
-- Companion to mobile/db/schema.sql (local) and docs/data-layer/erd.md (RLS design reasoning).

create schema if not exists raw_events;

grant usage on schema raw_events to authenticated;

grant usage on schema raw_events to service_role;
grant select on raw_events.events to service_role;

comment on schema raw_events is
  'Server mirror of the local events log, synced from device via the outbox worker. Append-only.';

-- ============================================================
-- raw_events.events
-- ============================================================
create table raw_events.events (
    event_id        text primary key,          -- same client-generated UUID as locally; also the
                                                 -- sync idempotency key (INSERT ... ON CONFLICT DO NOTHING)
    event_type      text not null,
    event_domain    text not null,
    event_version   integer not null,

    occurred_at     timestamptz not null,
    recorded_at     timestamptz not null,
    received_at     timestamptz not null default now(),   -- server-stamped; see trigger below

    device_id       text not null,
    user_id         uuid not null references auth.users (id),

    trip_id         text,                       -- references a concept, not a row — same reasoning
    leg_id          text,                       -- as schema.sql's dotted FK; not a real FK here either

    payload         jsonb not null,             -- native jsonb here — Postgres has real JSON support,
                                                 -- unlike SQLite locally, so no json_valid() CHECK needed

    check (event_version >= 1),
    check (occurred_at::date <= recorded_at::date),

    check (
        (event_domain = 'trip'    and event_type in ('trip_started', 'trip_ended', 'trip_deleted')
                                   and trip_id is not null and leg_id is null)
        or
        (event_domain = 'trip'    and event_type in ('leg_boarded', 'leg_alighted')
                                   and trip_id is not null and leg_id is not null)
        or
        (event_domain = 'product' and event_type in ('screen_viewed', 'station_detail_opened',
                                                       'route_detail_opened', 'feature_used',
                                                       'trip_draft_started', 'draft_leg_added',
                                                       'draft_leg_removed', 'trip_draft_committed',
                                                       'trip_draft_abandoned')
                                   and trip_id is null and leg_id is null)
    )
);

comment on column raw_events.events.received_at is
  'Server-stamped the instant a row lands — never client-set (see trigger below). received_at minus
   recorded_at gives real sync latency for the dashboard''s p50/p95 metric (dashboard-spec.md).';

-- Force received_at server-side regardless of what the client sends — trusting the client to just
-- leave a column alone isn't a real guarantee; a trigger is. Same "enforce at the layer that can't
-- be bypassed" reasoning as RLS itself and the grain CHECK above.
create or replace function raw_events.stamp_received_at()
returns trigger as $$
begin
    new.received_at := now();
    return new;
end;
$$ language plpgsql security definer;

create trigger trg_events_stamp_received_at
before insert on raw_events.events
for each row execute function raw_events.stamp_received_at();

create index idx_raw_events_user_id on raw_events.events (user_id);      -- RLS hot path
create index idx_raw_events_trip_id on raw_events.events (trip_id) where trip_id is not null;
create index idx_raw_events_occurred_at on raw_events.events (occurred_at);
create index idx_raw_events_device_id on raw_events.events (device_id);  -- earns its index HERE,
                                                                          -- genuinely multi-tenant
                                                                          -- (unlike the local table)

alter table raw_events.events enable row level security;

-- Append-only by omission: no UPDATE/DELETE grant exists on this table at all, for any role.
-- Stronger than an RLS policy could give you — a missing grant rejects the operation outright,
-- before any policy or row is even considered.
grant select, insert on raw_events.events to authenticated;

create policy "select own events"
  on raw_events.events for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "insert own events"
  on raw_events.events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
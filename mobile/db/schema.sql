-- SubwayQuest — local SQLite schema
-- See docs/data-layer/event-taxonomy.md for the full event taxonomy this schema encodes.

PRAGMA foreign_keys = ON;

-- =============================================================================
-- events — the immutable, append-only event log. Source of truth.
--
-- Never UPDATE or DELETE a row here. There is no edit mode and no partial
-- correction — the only way to fix an already-logged trip is trip_deleted
-- (full removal) followed by re-logging it correctly. See taxonomy doc's
-- "Commit model" and "Correction events".
-- =============================================================================
CREATE TABLE events (
    event_id        TEXT PRIMARY KEY,          -- client-generated UUID; also the sync idempotency key
    event_type      TEXT NOT NULL,
    event_domain    TEXT NOT NULL,              -- 'trip' | 'product'
    event_version   INTEGER NOT NULL,           -- versions the payload shape for this event_type

    occurred_at     TEXT NOT NULL,              -- ISO8601. Date component is user-picked (backdating allowed),
                                                 -- time component is actual current time at logging — see
                                                 -- taxonomy doc's "Date-only backdating". Never free-typed.
    recorded_at     TEXT NOT NULL,              -- ISO8601, local write time

    device_id       TEXT NOT NULL,              -- client-generated; secondary diagnostic/multi-device
                                                 -- identifier now that user_id (real auth) is the actual
                                                 -- tenant/security key — see event-taxonomy.md's Envelope
    user_id         TEXT NOT NULL,              -- maps to Supabase auth.users.id — real auth from day one,
                                                 -- not deferred (see event-taxonomy.md's Envelope section);
                                                 -- known at write time since sign-in happens before any event exists

    trip_id         TEXT,                       -- real column (not in payload) for enforcement + filtering; nullable per event_type, see CHECK below
    leg_id          TEXT,                       -- same reasoning as trip_id

    payload         TEXT NOT NULL,              -- JSON; shape defined per (event_type, event_version) in the taxonomy doc

    CHECK (event_version >= 1),
    CHECK (json_valid(payload)),

    -- occurred_at's date can never be later than the date it was actually recorded —
    -- backdating to the past is allowed, backdating to the future is not.
    CHECK (date(occurred_at) <= date(recorded_at)),

    -- Enforces domain/grain consistency in one place, at the database level,
    -- instead of trusting app code to always set trip_id/leg_id/event_domain correctly.
    -- Every known event_type is listed explicitly — adding a new type means touching
    -- this constraint, which is the point: it can't silently drift out of sync with
    -- the taxonomy doc.
    --
    -- Trip-grain events are only ever written as part of an atomic "Log Trip" commit
    -- (see docs/data-layer/event-taxonomy.md, "Commit model") — there is no
    -- half-formed trip state, which is why there's no auto-close event type here.
    -- trip_deleted is the one trip-grain event that happens later, against an
    -- already-committed trip — it needs trip_id but no leg_id, same shape as
    -- trip_started/trip_ended, so it shares their branch below.
    CHECK (
        (event_domain = 'trip'    AND event_type IN ('trip_started', 'trip_ended', 'trip_deleted')
                                   AND trip_id IS NOT NULL AND leg_id IS NULL)
        OR
        (event_domain = 'trip'    AND event_type IN ('leg_boarded', 'leg_alighted')
                                   AND trip_id IS NOT NULL AND leg_id IS NOT NULL)
        OR
        (event_domain = 'product' AND event_type IN ('screen_viewed', 'station_detail_opened',
                                                       'route_detail_opened', 'feature_used',
                                                       'trip_draft_started', 'draft_leg_added',
                                                       'draft_leg_removed', 'trip_draft_committed',
                                                       'trip_draft_abandoned')
                                   AND trip_id IS NULL AND leg_id IS NULL)
                                   -- trip_id/leg_id stay NULL here even for trip_draft_committed,
                                   -- whose payload does reference a real trip_id — kept as JSON, not
                                   -- a column, so every product event follows one uniform rule. See
                                   -- taxonomy doc's "Draft-session events" for the reasoning.
    )
);

-- Every "does this trip already have an X" / "build the current trip's leg list"
-- query filters on trip_id — this is the hot path, run on every app foreground.
CREATE INDEX idx_events_trip_id ON events (trip_id) WHERE trip_id IS NOT NULL;

-- Supports chronological trip history / "recent trips" without a full table scan.
CREATE INDEX idx_events_occurred_at ON events (occurred_at);

-- Deliberately NOT indexing device_id locally: this local SQLite file only ever
-- holds one device's own rows, so every row shares the same device_id and an
-- index on it would filter nothing. It earns an index once this table exists in
-- the shared, multi-tenant Supabase/BigQuery layer — noted in the taxonomy doc's
-- open-questions list, not duplicated here.


-- =============================================================================
-- sync_status — local-only outbox tracking. One row per event, always.
--
-- This is genuinely 1:1 with events (unlike trip_id on events, which points at
-- a concept the log itself defines, not a row that has to exist first) — every
-- event needs exactly one sync_status row, so a real FK is correct here.
-- =============================================================================
CREATE TABLE sync_status (
    event_id          TEXT PRIMARY KEY REFERENCES events (event_id),
    status            TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'synced' | 'failed'
    attempt_count     INTEGER NOT NULL DEFAULT 0,
    last_attempt_at   TEXT,                              -- ISO8601, NULL until the first sync attempt
    last_error        TEXT,                              -- NULL unless status = 'failed'
    synced_at         TEXT,                               -- ISO8601, NULL until status = 'synced'

    CHECK (status IN ('pending', 'synced', 'failed')),
    CHECK (attempt_count >= 0),

    -- synced_at is set if and only if status is 'synced' — can't have one without the other.
    CHECK ((status = 'synced') = (synced_at IS NOT NULL)),

    -- a 'failed' row should always carry a reason; otherwise the worker just
    -- retries forever with no clue why it kept failing.
    CHECK (status != 'failed' OR last_error IS NOT NULL)
);

-- The sync worker's core query: "give me everything not yet confirmed synced."
CREATE INDEX idx_sync_status_unsynced ON sync_status (status) WHERE status != 'synced';

-- Every event gets a sync_status row the moment it's written — the app never has
-- to remember to create one, which removes an entire class of "event exists but
-- never got queued to sync" bugs.
CREATE TRIGGER trg_events_create_sync_status
AFTER INSERT ON events
BEGIN
    INSERT INTO sync_status (event_id, status) VALUES (NEW.event_id, 'pending');
END;


-- =============================================================================
-- trips / legs — the mutable projection, built FROM the event log, never
-- written independently of it. The event log stays the source of truth; these
-- tables exist so the UI has cheap current-state to render without replaying
-- the whole log on every screen. (App code applies each new event to these
-- tables as it's written — not done here as triggers, since the projection
-- logic needs judgment a CHECK can't express. Constraints below cover the
-- shape of a valid *result*, not how to compute one.)
--
-- No status column on either table: under atomic commit, a trip's start+end
-- and a leg's boarding+alighting are always known together by the time any row
-- is written, so an 'in_progress' state is never actually observable — see
-- taxonomy doc's "Not yet decided" for the reasoning. destination_station_id/
-- ended_at and exit_station_id/alighted_at are plain NOT NULL as a result.
--
-- Deletion note: trip_deleted removes the trip's row here (and its legs)
-- rather than flagging it — see taxonomy doc's "Correction events". A trips
-- row that exists is always a live, complete trip.
-- =============================================================================
CREATE TABLE trips (
    trip_id                  TEXT PRIMARY KEY,     -- same UUID as the trip_started event's trip_id
    device_id                TEXT NOT NULL,
    user_id                  TEXT NOT NULL,        -- real auth from day one, mirrors events.user_id

    origin_station_id        TEXT NOT NULL,
    destination_station_id   TEXT NOT NULL,

    started_at               TEXT NOT NULL,
    ended_at                  TEXT NOT NULL
);

CREATE TABLE legs (
    leg_id             TEXT PRIMARY KEY,       -- same UUID as the leg_boarded event's leg_id
    trip_id            TEXT NOT NULL REFERENCES trips (trip_id),
    sequence           INTEGER NOT NULL,       -- 1-based position within the trip; used for ordering
                                                -- and for identifying transfers between consecutive legs

    route_id           TEXT NOT NULL,
    entry_station_id   TEXT NOT NULL,          -- named entry/exit here rather than the event payload's shared "station_id",
    exit_station_id    TEXT NOT NULL,          -- since one row needs to hold both

    boarded_at          TEXT NOT NULL,
    alighted_at          TEXT NOT NULL,

    UNIQUE (trip_id, sequence),
    CHECK (sequence >= 1)
);

-- "Get this trip's legs in order" — runs whenever a trip's detail view renders.
CREATE INDEX idx_legs_trip_id ON legs (trip_id);
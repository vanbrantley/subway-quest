"""
mobile/db/migration_v6_tests.py

Required test for DatabaseContext.tsx's migration-to-version-6 SQL recipe --
same rigor standard as migration_v3_tests.py, run via plain Python sqlite3
against the exact SQL statements the TS migration runs (see
DatabaseContext.tsx's MIGRATIONS[toVersion: 6]). Not exercising
DatabaseContext.tsx's actual TS control flow (that needs expo-sqlite/a
device), but the SQL itself -- the genuinely risky, hand-crafted part -- is
identical either way (same reasoning schema-tests.py's own header gives).

Simulates a device already on schema v5 (post is_test migration), runs
migration 6, and asserts: pre-existing events/sync_status data survives the
events rename-dance untouched (same recipe as migration 3, repeated here
since SQLite still has no ALTER TABLE for modifying a CHECK constraint), the
2 new trivia_facts_enabled/disabled event_types are now accepted, and the new
trivia_global_preference projection table exists with the right shape.

Run: python3 mobile/db/migration_v6_tests.py
"""

import sqlite3
import sys

failures = []


def check(description, condition):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {description}")
    if not condition:
        failures.append(description)


# Schema as it stands right after migration 5 (is_test added to events/trips/saved_stations).
V5_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE events (
    event_id        TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    event_domain    TEXT NOT NULL,
    event_version   INTEGER NOT NULL,
    occurred_at     TEXT NOT NULL,
    recorded_at     TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    trip_id         TEXT,
    leg_id          TEXT,
    payload         TEXT NOT NULL,
    is_test         INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1)),
    CHECK (event_version >= 1),
    CHECK (json_valid(payload)),
    CHECK (date(occurred_at) <= date(recorded_at)),
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
                                                       'trip_draft_abandoned', 'station_saved',
                                                       'station_unsaved')
                                   AND trip_id IS NULL AND leg_id IS NULL)
    )
);
CREATE INDEX idx_events_trip_id ON events (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX idx_events_occurred_at ON events (occurred_at);
CREATE TABLE sync_status (
    event_id          TEXT PRIMARY KEY REFERENCES events (event_id),
    status            TEXT NOT NULL DEFAULT 'pending',
    attempt_count     INTEGER NOT NULL DEFAULT 0,
    last_attempt_at   TEXT,
    last_error        TEXT,
    synced_at         TEXT
);
CREATE TRIGGER trg_events_create_sync_status
AFTER INSERT ON events
BEGIN
    INSERT INTO sync_status (event_id, status) VALUES (NEW.event_id, 'pending');
END;
CREATE TABLE saved_stations (
    station_id   TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    saved_at     TEXT NOT NULL,
    is_test      INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1)),
    PRIMARY KEY (station_id, user_id)
);
PRAGMA user_version = 5;
"""

# The exact statements DatabaseContext.tsx's toVersion:6 migration runs, in
# the exact order, run outside a transaction here the same way initSchema does
# (foreign_keys toggled off/on around it).
MIGRATION_V6_SQL = """
DROP INDEX IF EXISTS idx_events_trip_id;
DROP INDEX IF EXISTS idx_events_occurred_at;
DROP TRIGGER IF EXISTS trg_events_create_sync_status;
CREATE TABLE events_v6_new (
    event_id        TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    event_domain    TEXT NOT NULL,
    event_version   INTEGER NOT NULL,
    occurred_at     TEXT NOT NULL,
    recorded_at     TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    trip_id         TEXT,
    leg_id          TEXT,
    payload         TEXT NOT NULL,
    is_test         INTEGER NOT NULL DEFAULT 0,
    CHECK (event_version >= 1),
    CHECK (json_valid(payload)),
    CHECK (is_test IN (0, 1)),
    CHECK (date(occurred_at) <= date(recorded_at)),
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
                                                       'trip_draft_abandoned', 'station_saved',
                                                       'station_unsaved', 'trivia_facts_enabled',
                                                       'trivia_facts_disabled')
                                   AND trip_id IS NULL AND leg_id IS NULL)
    )
);
INSERT INTO events_v6_new SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_v6_new RENAME TO events;
CREATE INDEX idx_events_trip_id ON events (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX idx_events_occurred_at ON events (occurred_at);
CREATE TRIGGER trg_events_create_sync_status
AFTER INSERT ON events
BEGIN
    INSERT INTO sync_status (event_id, status) VALUES (NEW.event_id, 'pending');
END;
CREATE TABLE IF NOT EXISTS trivia_global_preference (
    user_id      TEXT PRIMARY KEY,
    enabled      INTEGER NOT NULL,
    updated_at   TEXT NOT NULL,
    is_test      INTEGER NOT NULL DEFAULT 0,
    CHECK (enabled IN (0, 1)),
    CHECK (is_test IN (0, 1))
);
"""


def insert_event(cur, event_id, event_type, event_domain, trip_id, leg_id, payload, is_test=0):
    cur.execute(
        """INSERT INTO events
           (event_id, event_type, event_domain, event_version, occurred_at, recorded_at,
            device_id, user_id, trip_id, leg_id, payload, is_test)
           VALUES (?, ?, ?, 1, '2026-07-10T09:00:00Z', '2026-07-10T09:00:00Z', 'dev1', 'user1', ?, ?, ?, ?)""",
        (event_id, event_type, event_domain, trip_id, leg_id, payload, is_test),
    )


def run():
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.executescript(V5_SCHEMA)

    # Real pre-existing data on a "device" already at schema v5 before ever
    # seeing this migration.
    insert_event(cur, "e1", "trip_started", "trip", "trip1", None, "{}")
    conn.commit()

    before_events = cur.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    before_sync = cur.execute("SELECT COUNT(*) FROM sync_status").fetchone()[0]

    # trivia_facts_enabled is rejected under the OLD (v5) schema -- confirms
    # the repro actually matches reality before applying the fix.
    try:
        insert_event(cur, "pre-fix", "trivia_facts_enabled", "product", None, None, "{}")
        conn.commit()
        pre_fix_rejected = False
    except sqlite3.IntegrityError:
        conn.rollback()
        pre_fix_rejected = True
    check("repro: trivia_facts_enabled rejected under the OLD (v5) schema", pre_fix_rejected)

    # --- Apply migration 6, exactly as initSchema does: FK off, run, FK on ---
    cur.execute("PRAGMA foreign_keys = OFF;")
    cur.executescript(MIGRATION_V6_SQL)
    cur.execute("PRAGMA user_version = 6;")
    cur.execute("PRAGMA foreign_keys = ON;")
    conn.commit()

    after_events = cur.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    after_sync = cur.execute("SELECT COUNT(*) FROM sync_status").fetchone()[0]
    version = cur.execute("PRAGMA user_version").fetchone()[0]
    scratch_table = cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='events_v6_new'"
    ).fetchone()
    sync_status_fk = cur.execute("SELECT sql FROM sqlite_master WHERE name='sync_status'").fetchone()[0]

    check("pre-existing event row preserved through migration", before_events == after_events == 1)
    check("pre-existing sync_status row preserved through migration", before_sync == after_sync == 1)
    check("user_version reaches 6", version == 6)
    check("scratch table events_v6_new no longer exists under that name (renamed into events)", scratch_table is None)
    check(
        "sync_status's FK still resolves to 'events', not rewritten to a scratch name",
        "events_v6_new" not in sync_status_fk,
    )

    tables = {row[0] for row in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    check("trivia_global_preference table exists after migration", "trivia_global_preference" in tables)

    # --- The actual fix: are the new event types now accepted? ---
    for event_type in ["trivia_facts_enabled", "trivia_facts_disabled"]:
        try:
            insert_event(cur, f"e-{event_type}", event_type, "product", None, None, "{}")
            conn.commit()
            ok = True
        except sqlite3.IntegrityError:
            ok = False
        check(f"{event_type} accepted after migration 6", ok)

    trigger_fired = cur.execute(
        "SELECT COUNT(*) FROM sync_status WHERE event_id = 'e-trivia_facts_enabled'"
    ).fetchone()[0]
    check("trigger still creates a sync_status row on the rebuilt table", trigger_fired == 1)

    idx_count = cur.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='events' AND name LIKE 'idx_events%'"
    ).fetchone()[0]
    check("both events indexes recreated", idx_count == 2)

    # Old event types still work correctly post-migration.
    try:
        insert_event(cur, "e-old", "station_saved", "product", None, None, '{"station_id":"L08"}')
        conn.commit()
        old_type_ok = True
    except sqlite3.IntegrityError:
        old_type_ok = False
    check("pre-existing event types (e.g. station_saved) still accepted post-migration", old_type_ok)

    # New table shape actually usable.
    cur.execute("INSERT INTO trivia_global_preference (user_id, enabled, updated_at) VALUES ('user1', 0, '2026-07-10T09:00:00Z')")
    conn.commit()
    check("trivia_global_preference accepts a row post-migration", cur.execute("SELECT COUNT(*) FROM trivia_global_preference").fetchone()[0] == 1)

    conn.close()


if __name__ == "__main__":
    run()
    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("All checks passed.")

"""
mobile/db/migration_v3_tests.py

Required test for DatabaseContext.tsx's migration-to-version-3 SQL recipe —
same rigor standard as schema_tests.py, run via plain Python sqlite3 against
the exact SQL statements the TS migration runs (see DatabaseContext.tsx's
MIGRATIONS[toVersion: 3]). Not exercising DatabaseContext.tsx's actual TS
control flow (that needs expo-sqlite/a device), but the SQL itself -- the
genuinely risky, hand-crafted part -- is identical either way, since both
bindings wrap the same underlying SQLite C library (same reasoning
schema_tests.py's own header already gives for testing schema.sql this way).

Real bug this test exists to catch: migration 2 (adds saved_stations) was
shipped without also widening events' grain CHECK to accept
station_saved/station_unsaved -- SQLite has no ALTER TABLE for modifying a
CHECK constraint on an existing table, so any device that already ran
migration 2 kept the OLD events table forever and got a CHECK-constraint
failure the moment saveStation()/unsaveStation() tried to insert. Caught
on-device, fixed by shipping migration 3 (SQLite's own documented
rename/recreate/copy recipe), which is what this file verifies: data
preserved, the trigger/indexes rebuilt correctly, and the new event types
actually accepted afterward.

Run: python3 mobile/db/migration_v3_tests.py
"""

import sqlite3
import sys

failures = []


def check(description, condition):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {description}")
    if not condition:
        failures.append(description)


OLD_EVENTS_CHECK = """
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
    )
"""

OLD_SCHEMA = f"""
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
    CHECK (event_version >= 1),
    CHECK (json_valid(payload)),
    CHECK (date(occurred_at) <= date(recorded_at)),
    {OLD_EVENTS_CHECK}
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
-- migration 2 already ran on this simulated device -- saved_stations exists,
-- but events (above) is still stuck on the OLD check. This is exactly the
-- stuck state a real device that hit the bug is in.
CREATE TABLE saved_stations (station_id TEXT PRIMARY KEY, saved_at TEXT NOT NULL);
PRAGMA user_version = 2;
"""

# The exact statements DatabaseContext.tsx's toVersion:3 migration runs, in
# the exact order, run outside a transaction here the same way initSchema
# does (foreign_keys toggled off/on around it).
MIGRATION_V3_SQL = """
DROP INDEX IF EXISTS idx_events_trip_id;
DROP INDEX IF EXISTS idx_events_occurred_at;
DROP TRIGGER IF EXISTS trg_events_create_sync_status;
CREATE TABLE events_v3_new (
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
INSERT INTO events_v3_new SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_v3_new RENAME TO events;
CREATE INDEX idx_events_trip_id ON events (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX idx_events_occurred_at ON events (occurred_at);
CREATE TRIGGER trg_events_create_sync_status
AFTER INSERT ON events
BEGIN
    INSERT INTO sync_status (event_id, status) VALUES (NEW.event_id, 'pending');
END;
"""


def insert_event(cur, event_id, event_type, event_domain, trip_id, leg_id, payload):
    cur.execute(
        """INSERT INTO events
           (event_id, event_type, event_domain, event_version, occurred_at, recorded_at,
            device_id, user_id, trip_id, leg_id, payload)
           VALUES (?, ?, ?, 1, '2026-07-10T09:00:00Z', '2026-07-10T09:00:00Z', 'dev1', 'user1', ?, ?, ?)""",
        (event_id, event_type, event_domain, trip_id, leg_id, payload),
    )


def run():
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.executescript(OLD_SCHEMA)

    # Real pre-existing data on a "device" that already logged a trip before
    # ever seeing this migration.
    insert_event(cur, "e1", "trip_started", "trip", "trip1", None, "{}")
    conn.commit()

    before_events = cur.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    before_sync = cur.execute("SELECT COUNT(*) FROM sync_status").fetchone()[0]

    # station_saved is rejected under the OLD schema -- confirms the repro
    # actually matches the real bug before applying the fix.
    try:
        insert_event(cur, "pre-fix", "station_saved", "product", None, None, '{"station_id":"L08"}')
        conn.commit()
        pre_fix_rejected = False
    except sqlite3.IntegrityError:
        conn.rollback()
        pre_fix_rejected = True
    check("repro: station_saved rejected under the OLD (migration-2-only) schema", pre_fix_rejected)

    # --- Apply migration 3, exactly as initSchema does: FK off, run, FK on ---
    cur.execute("PRAGMA foreign_keys = OFF;")
    cur.executescript(MIGRATION_V3_SQL)
    cur.execute("PRAGMA user_version = 3;")
    cur.execute("PRAGMA foreign_keys = ON;")
    conn.commit()

    after_events = cur.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    after_sync = cur.execute("SELECT COUNT(*) FROM sync_status").fetchone()[0]
    version = cur.execute("PRAGMA user_version").fetchone()[0]
    scratch_table = cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='events_v3_new'"
    ).fetchone()
    sync_status_fk = cur.execute("SELECT sql FROM sqlite_master WHERE name='sync_status'").fetchone()[0]

    check("pre-existing event row preserved through migration", before_events == after_events == 1)
    check("pre-existing sync_status row preserved through migration", before_sync == after_sync == 1)
    check("user_version reaches 3", version == 3)
    check("scratch table events_v3_new no longer exists under that name (renamed into events)", scratch_table is None)
    check(
        "sync_status's FK still resolves to 'events', not rewritten to a scratch name -- "
        "the actual second bug caught: renaming events AWAY (even temporarily) silently "
        "rewrites other tables' stored FK text to the scratch name",
        "events_v3_new" not in sync_status_fk and "events_before" not in sync_status_fk,
    )

    saved_stations_intact = cur.execute("SELECT COUNT(*) FROM saved_stations").fetchone()
    check("saved_stations (from migration 2) untouched by migration 3", saved_stations_intact[0] == 0)

    # --- The actual bug: does the fixed schema now accept it? ---
    try:
        insert_event(cur, "e2", "station_saved", "product", None, None, '{"station_id":"L08"}')
        conn.commit()
        post_fix_ok = True
    except sqlite3.IntegrityError:
        post_fix_ok = False
    check("station_saved accepted after migration 3 (the actual fix)", post_fix_ok)

    try:
        insert_event(cur, "e3", "station_unsaved", "product", None, None, '{"station_id":"L08"}')
        conn.commit()
        unsaved_ok = True
    except sqlite3.IntegrityError:
        unsaved_ok = False
    check("station_unsaved accepted after migration 3", unsaved_ok)

    trigger_fired = cur.execute("SELECT COUNT(*) FROM sync_status WHERE event_id = 'e2'").fetchone()[0]
    check("trigger still creates a sync_status row on the rebuilt table", trigger_fired == 1)

    idx_count = cur.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='events' AND name LIKE 'idx_events%'"
    ).fetchone()[0]
    check("both events indexes recreated", idx_count == 2)

    # Old event types still work correctly post-migration -- the rebuild
    # shouldn't have narrowed anything, only widened it.
    try:
        insert_event(cur, "e4", "leg_boarded", "trip", "trip1", "leg1", "{}")
        conn.commit()
        old_type_ok = True
    except sqlite3.IntegrityError:
        old_type_ok = False
    check("pre-existing event types (e.g. leg_boarded) still accepted post-migration", old_type_ok)

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

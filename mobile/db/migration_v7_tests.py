"""
mobile/db/migration_v7_tests.py

Required test for DatabaseContext.tsx's migration-to-version-7 SQL recipe --
same rigor standard as migration_v3_tests.py/migration_v6_tests.py, run via
plain Python sqlite3 against the exact SQL statements the TS migration runs
(see DatabaseContext.tsx's MIGRATIONS[toVersion: 7]). Not exercising
DatabaseContext.tsx's actual TS control flow (that needs expo-sqlite/a
device), but the SQL itself -- the genuinely risky, hand-crafted part -- is
identical either way (same reasoning schema-tests.py's own header gives).

Simulates a device already on schema v6 (post trivia-preference migration),
runs migration 7, and asserts: pre-existing events/sync_status data survives
the events rename-dance untouched (same recipe as migrations 3 and 6,
repeated here since SQLite still has no ALTER TABLE for modifying a CHECK
constraint), and the 2 new borough_detail_opened/neighborhood_detail_opened
event_types are now accepted. This is the fix for the real on-device crash
those two event types caused before the CHECK was widened to match
projection.ts's TS type (which had been updated without a matching migration).

Run: python3 mobile/db/migration_v7_tests.py
"""

import sqlite3
import sys

failures = []


def check(description, condition):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {description}")
    if not condition:
        failures.append(description)


# Schema as it stands right after migration 6 (trivia_facts_enabled/disabled added).
V6_SCHEMA = """
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
CREATE TABLE trivia_global_preference (
    user_id      TEXT PRIMARY KEY,
    enabled      INTEGER NOT NULL,
    updated_at   TEXT NOT NULL,
    is_test      INTEGER NOT NULL DEFAULT 0,
    CHECK (enabled IN (0, 1)),
    CHECK (is_test IN (0, 1))
);
PRAGMA user_version = 6;
"""

# The exact statements DatabaseContext.tsx's toVersion:7 migration runs, in
# the exact order, run outside a transaction here the same way initSchema does
# (foreign_keys toggled off/on around it).
MIGRATION_V7_SQL = """
DROP INDEX IF EXISTS idx_events_trip_id;
DROP INDEX IF EXISTS idx_events_occurred_at;
DROP TRIGGER IF EXISTS trg_events_create_sync_status;
CREATE TABLE events_v7_new (
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
                                                       'trivia_facts_disabled', 'borough_detail_opened',
                                                       'neighborhood_detail_opened')
                                   AND trip_id IS NULL AND leg_id IS NULL)
    )
);
INSERT INTO events_v7_new SELECT * FROM events;
DROP TABLE events;
ALTER TABLE events_v7_new RENAME TO events;
CREATE INDEX idx_events_trip_id ON events (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX idx_events_occurred_at ON events (occurred_at);
CREATE TRIGGER trg_events_create_sync_status
AFTER INSERT ON events
BEGIN
    INSERT INTO sync_status (event_id, status) VALUES (NEW.event_id, 'pending');
END;
"""


def insert_event(cur, event_id, event_type, event_domain, trip_id, leg_id, payload, is_test=0):
    cur.execute(
        """INSERT INTO events
           (event_id, event_type, event_domain, event_version, occurred_at, recorded_at,
            device_id, user_id, trip_id, leg_id, payload, is_test)
           VALUES (?, ?, ?, 1, '2026-09-04T09:00:00Z', '2026-09-04T09:00:00Z', 'dev1', 'user1', ?, ?, ?, ?)""",
        (event_id, event_type, event_domain, trip_id, leg_id, payload, is_test),
    )


def run():
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.executescript(V6_SCHEMA)

    # Real pre-existing data on a "device" already at schema v6 before ever
    # seeing this migration.
    insert_event(cur, "e1", "trip_started", "trip", "trip1", None, "{}")
    conn.commit()

    before_events = cur.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    before_sync = cur.execute("SELECT COUNT(*) FROM sync_status").fetchone()[0]

    # borough_detail_opened is rejected under the OLD (v6) schema -- confirms
    # the repro actually matches the on-device crash before applying the fix.
    try:
        insert_event(cur, "pre-fix", "borough_detail_opened", "product", None, None, "{}")
        conn.commit()
        pre_fix_rejected = False
    except sqlite3.IntegrityError:
        conn.rollback()
        pre_fix_rejected = True
    check("repro: borough_detail_opened rejected under the OLD (v6) schema", pre_fix_rejected)

    # --- Apply migration 7, exactly as initSchema does: FK off, run, FK on ---
    cur.execute("PRAGMA foreign_keys = OFF;")
    cur.executescript(MIGRATION_V7_SQL)
    cur.execute("PRAGMA user_version = 7;")
    cur.execute("PRAGMA foreign_keys = ON;")
    conn.commit()

    after_events = cur.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    after_sync = cur.execute("SELECT COUNT(*) FROM sync_status").fetchone()[0]
    version = cur.execute("PRAGMA user_version").fetchone()[0]
    scratch_table = cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='events_v7_new'"
    ).fetchone()
    sync_status_fk = cur.execute("SELECT sql FROM sqlite_master WHERE name='sync_status'").fetchone()[0]

    check("pre-existing event row preserved through migration", before_events == after_events == 1)
    check("pre-existing sync_status row preserved through migration", before_sync == after_sync == 1)
    check("user_version reaches 7", version == 7)
    check("scratch table events_v7_new no longer exists under that name (renamed into events)", scratch_table is None)
    check(
        "sync_status's FK still resolves to 'events', not rewritten to a scratch name",
        "events_v7_new" not in sync_status_fk,
    )

    # --- The actual fix: are the new event types now accepted? ---
    for event_type in ["borough_detail_opened", "neighborhood_detail_opened"]:
        try:
            insert_event(cur, f"e-{event_type}", event_type, "product", None, None, "{}")
            conn.commit()
            ok = True
        except sqlite3.IntegrityError:
            ok = False
        check(f"{event_type} accepted after migration 7", ok)

    trigger_fired = cur.execute(
        "SELECT COUNT(*) FROM sync_status WHERE event_id = 'e-borough_detail_opened'"
    ).fetchone()[0]
    check("trigger still creates a sync_status row on the rebuilt table", trigger_fired == 1)

    idx_count = cur.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='events' AND name LIKE 'idx_events%'"
    ).fetchone()[0]
    check("both events indexes recreated", idx_count == 2)

    # Old event types still work correctly post-migration.
    try:
        insert_event(cur, "e-old", "trivia_facts_enabled", "product", None, None, "{}")
        conn.commit()
        old_type_ok = True
    except sqlite3.IntegrityError:
        old_type_ok = False
    check("pre-existing event types (e.g. trivia_facts_enabled) still accepted post-migration", old_type_ok)

    # trivia_global_preference (untouched by this migration) still intact.
    tables = {row[0] for row in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    check("trivia_global_preference table still exists after migration", "trivia_global_preference" in tables)

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

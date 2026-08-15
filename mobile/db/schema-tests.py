"""
mobile/db/schema_tests.py

Persisted, re-runnable version of the checks that were run interactively
during the data-layer design session — kept as a real artifact instead of
scrollback, per the ERD's rigor checklist claiming "tested against real
inserts" (item 4).

Deliberately plain Python + sqlite3, not a JS/Jest suite matching the app's
own language: schema.sql's constraints are pure SQLite (CHECK, triggers,
indexes), which behave identically under any binding — Python's sqlite3
here, expo-sqlite on-device — since both wrap the same underlying SQLite C
library. This validates the schema itself, independent of app runtime, and
doesn't require standing up a full JS test framework ahead of CI (checklist
item 8, deliberately still a later phase).

Run: python3 mobile/db/schema_tests.py
"""

import json
import sqlite3
import sys
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"

failures = []


def check(description, condition):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {description}")
    if not condition:
        failures.append(description)


def fresh_db():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA_PATH.read_text())
    return conn


def insert_event(cur, expect_ok, desc, **kw):
    kw.setdefault("leg_id", None)
    kw.setdefault("trip_id", None)
    kw.setdefault("user_id", "user1")  # NOT NULL now — real auth from day one
    cols = ",".join(kw.keys())
    qs = ",".join("?" for _ in kw)
    try:
        cur.execute(f"INSERT INTO events ({cols}) VALUES ({qs})", list(kw.values()))
        ok = True
    except sqlite3.IntegrityError:
        ok = False
    check(desc, ok == expect_ok)


def test_domain_grain_check():
    conn = fresh_db()
    cur = conn.cursor()

    insert_event(cur, True, "trip_started: valid",
        event_id="e1", event_type="trip_started", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip1", payload="{}")

    insert_event(cur, True, "leg_boarded: valid",
        event_id="e2", event_type="leg_boarded", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip1", leg_id="leg1", payload="{}")

    insert_event(cur, False, "leg_boarded missing leg_id: rejected",
        event_id="e3", event_type="leg_boarded", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip1", leg_id=None, payload="{}")

    insert_event(cur, False, "product event with trip_id set: rejected",
        event_id="e4", event_type="screen_viewed", event_domain="product", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip1", payload=json.dumps({"screen_name": "map"}))

    insert_event(cur, False, "trip_auto_closed (retired event type): rejected",
        event_id="e5", event_type="trip_auto_closed", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip1", payload="{}")

    insert_event(cur, False, "trip_leg_undone (retired event type): rejected",
        event_id="e6", event_type="trip_leg_undone", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip1", payload="{}")

    insert_event(cur, True, "trip_deleted: valid",
        event_id="e7", event_type="trip_deleted", event_domain="trip", event_version=1,
        occurred_at="2026-07-11T15:00:00Z", recorded_at="2026-07-11T15:00:00Z",
        device_id="dev1", trip_id="trip1", payload=json.dumps({"reason": "test"}))

    for draft_type in ["trip_draft_started", "draft_leg_added", "draft_leg_removed",
                        "trip_draft_committed", "trip_draft_abandoned"]:
        insert_event(cur, True, f"{draft_type}: valid product event",
            event_id=f"d-{draft_type}", event_type=draft_type, event_domain="product", event_version=1,
            occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
            device_id="dev1", payload=json.dumps({"draft_id": "draft1"}))

    for save_type in ["station_saved", "station_unsaved"]:
        insert_event(cur, True, f"{save_type}: valid product event",
            event_id=f"s-{save_type}", event_type=save_type, event_domain="product", event_version=1,
            occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
            device_id="dev1", payload=json.dumps({"station_id": "L08"}))

    insert_event(cur, False, "station_saved with trip_id set: rejected",
        event_id="s-bad", event_type="station_saved", event_domain="product", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip1", payload=json.dumps({"station_id": "L08"}))

    conn.close()


def test_saved_stations_table():
    """saved_stations is a projection off station_saved/station_unsaved events,
    same relationship as trips/legs — grain is station_id (GTFS stop_id),
    deliberately not complex_id. See schema.sql's comment on this table.

    user_id + composite (station_id, user_id) primary key confirmed here
    directly -- schema v3 and earlier had no user_id column at all, which is
    exactly what let one account's saved stations leak into another
    account's view on the same device (both share one local SQLite file).
    Two different accounts must be able to independently save the same real
    station without colliding; the same account saving the same station
    twice must still be rejected."""
    conn = fresh_db()
    cur = conn.cursor()

    cur.execute("INSERT INTO saved_stations (station_id, user_id, saved_at) VALUES (?, ?, ?)",
                ("L08", "user1", "2026-07-10T09:00:00Z"))
    cur.execute("SELECT COUNT(*) FROM saved_stations")
    check("saved_stations: accepts a row", cur.fetchone()[0] == 1)

    try:
        cur.execute("INSERT INTO saved_stations (station_id, user_id, saved_at) VALUES (?, ?, ?)",
                    ("L08", "user1", "2026-07-11T09:00:00Z"))
        ok = True
    except sqlite3.IntegrityError:
        ok = False
    check("saved_stations: duplicate (station_id, user_id) rejected (PRIMARY KEY)", ok is False)

    cur.execute("INSERT INTO saved_stations (station_id, user_id, saved_at) VALUES (?, ?, ?)",
                ("L08", "user2", "2026-07-12T09:00:00Z"))
    cur.execute("SELECT COUNT(*) FROM saved_stations WHERE station_id = 'L08'")
    check("saved_stations: a different user_id can save the same station_id", cur.fetchone()[0] == 2)

    try:
        cur.execute("INSERT INTO saved_stations (station_id, saved_at) VALUES (?, ?)",
                    ("R01", "2026-07-10T09:00:00Z"))
        ok = True
    except sqlite3.IntegrityError:
        ok = False
    check("saved_stations row with NULL user_id: rejected", ok is False)

    conn.close()


def test_is_test_column():
    """Dev/prod data separation -- events, trips, and saved_stations all
    carry is_test, defaulting to 0 (not test) so every existing insert
    statement in this file keeps working unchanged. See schema.sql's
    comments on this column and docs/data-layer.md's "Dev/prod data
    separation"."""
    conn = fresh_db()
    cur = conn.cursor()

    insert_event(cur, True, "events: is_test defaults to 0 when not specified",
        event_id="e1", event_type="trip_started", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-10T09:00:00Z",
        device_id="dev1", trip_id="trip1", payload="{}")
    cur.execute("SELECT is_test FROM events WHERE event_id = 'e1'")
    check("events: is_test default is 0", cur.fetchone()[0] == 0)

    insert_event(cur, True, "events: is_test accepts 1",
        event_id="e2", event_type="trip_started", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-10T09:00:00Z",
        device_id="dev1", trip_id="trip2", is_test=1, payload="{}")
    cur.execute("SELECT is_test FROM events WHERE event_id = 'e2'")
    check("events: is_test=1 accepted", cur.fetchone()[0] == 1)

    insert_event(cur, False, "events: is_test=2 rejected (CHECK)",
        event_id="e3", event_type="trip_started", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-10T09:00:00Z",
        device_id="dev1", trip_id="trip3", is_test=2, payload="{}")

    cur.execute("""INSERT INTO trips (trip_id, device_id, user_id, origin_station_id,
                                       destination_station_id, started_at, ended_at)
                   VALUES ('trip1', 'dev1', 'user1', 'L08', '631', '2026-07-10T09:00:00Z', '2026-07-10T09:22:00Z')""")
    cur.execute("SELECT is_test FROM trips WHERE trip_id = 'trip1'")
    check("trips: is_test default is 0", cur.fetchone()[0] == 0)

    cur.execute("""INSERT INTO trips (trip_id, device_id, user_id, origin_station_id,
                                       destination_station_id, started_at, ended_at, is_test)
                   VALUES ('trip2', 'dev1', 'user1', 'L08', '631', '2026-07-10T09:00:00Z', '2026-07-10T09:22:00Z', 1)""")
    cur.execute("SELECT is_test FROM trips WHERE trip_id = 'trip2'")
    check("trips: is_test=1 accepted", cur.fetchone()[0] == 1)

    cur.execute("INSERT INTO saved_stations (station_id, user_id, saved_at) VALUES ('L08', 'user1', '2026-07-10T09:00:00Z')")
    cur.execute("SELECT is_test FROM saved_stations WHERE station_id = 'L08' AND user_id = 'user1'")
    check("saved_stations: is_test default is 0", cur.fetchone()[0] == 0)

    conn.close()


def test_json_validity():
    conn = fresh_db()
    cur = conn.cursor()
    insert_event(cur, False, "malformed JSON payload: rejected",
        event_id="e1", event_type="screen_viewed", event_domain="product", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", payload="not json")
    conn.close()


def test_future_date_check():
    conn = fresh_db()
    cur = conn.cursor()
    insert_event(cur, False, "occurred_at dated after recorded_at: rejected",
        event_id="e1", event_type="trip_started", event_domain="trip", event_version=1,
        occurred_at="2026-07-15T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip1", payload="{}")
    insert_event(cur, True, "same-day occurred_at, time after recorded_at: fine (date-only check)",
        event_id="e2", event_type="trip_started", event_domain="trip", event_version=1,
        occurred_at="2026-07-11T23:59:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip2", payload="{}")
    conn.close()


def test_user_id_required():
    """Real auth from day one — user_id must be NOT NULL, on events and on trips."""
    conn = fresh_db()
    cur = conn.cursor()

    insert_event(cur, False, "event with NULL user_id: rejected (auth required from day one)",
        event_id="e1", event_type="trip_started", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", user_id=None, trip_id="trip1", payload="{}")

    try:
        cur.execute("""INSERT INTO trips (trip_id, device_id, user_id, origin_station_id,
                                           destination_station_id, started_at, ended_at)
                       VALUES ('trip1', 'dev1', NULL, 'L08', '631', '2026-07-10T09:00:00Z', '2026-07-10T09:22:00Z')""")
        ok = True
    except sqlite3.IntegrityError:
        ok = False
    check("trips row with NULL user_id: rejected", ok is False)

    conn.close()


def test_sync_status_trigger():
    conn = fresh_db()
    cur = conn.cursor()
    insert_event(cur, True, "trip_started for trigger test",
        event_id="e1", event_type="trip_started", event_domain="trip", event_version=1,
        occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id="trip1", payload="{}")
    cur.execute("SELECT status FROM sync_status WHERE event_id = 'e1'")
    row = cur.fetchone()
    check("sync_status row auto-created with status='pending'", row is not None and row[0] == "pending")
    conn.close()


def test_full_trip_lifecycle():
    """Mirrors commitTrip/deleteTrip from projection.ts exactly, end to end."""
    conn = fresh_db()
    cur = conn.cursor()

    trip_id = "trip1"
    insert_event(cur, True, "commitTrip bundle: trip_started",
        event_id="e1", event_type="trip_started", event_domain="trip", event_version=1,
        occurred_at="2026-07-05T16:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id=trip_id, payload=json.dumps({"origin_station_id": "L08"}))
    insert_event(cur, True, "commitTrip bundle: leg_boarded (leg 1)",
        event_id="e2", event_type="leg_boarded", event_domain="trip", event_version=1,
        occurred_at="2026-07-05T16:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id=trip_id, leg_id="leg1", payload=json.dumps({"station_id": "L08", "route_id": "L"}))
    insert_event(cur, True, "commitTrip bundle: leg_alighted (leg 1)",
        event_id="e3", event_type="leg_alighted", event_domain="trip", event_version=1,
        occurred_at="2026-07-05T16:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id=trip_id, leg_id="leg1", payload=json.dumps({"station_id": "L03"}))
    insert_event(cur, True, "commitTrip bundle: trip_ended",
        event_id="e4", event_type="trip_ended", event_domain="trip", event_version=1,
        occurred_at="2026-07-05T16:00:00Z", recorded_at="2026-07-11T14:00:00Z",
        device_id="dev1", trip_id=trip_id, payload=json.dumps({"destination_station_id": "L03"}))

    cur.execute("""INSERT INTO trips (trip_id, device_id, user_id, origin_station_id, destination_station_id, started_at, ended_at)
                   VALUES (?, 'dev1', 'user1', 'L08', 'L03', '2026-07-05T16:00:00Z', '2026-07-05T16:00:00Z')""", (trip_id,))
    cur.execute("""INSERT INTO legs (leg_id, trip_id, sequence, route_id, entry_station_id, exit_station_id, boarded_at, alighted_at)
                   VALUES ('leg1', ?, 1, 'L', 'L08', 'L03', '2026-07-05T16:00:00Z', '2026-07-05T16:00:00Z')""", (trip_id,))

    cur.execute("SELECT COUNT(*) FROM trips")
    check("projection: 1 trip row after commit", cur.fetchone()[0] == 1)
    cur.execute("SELECT COUNT(*) FROM legs")
    check("projection: 1 leg row after commit", cur.fetchone()[0] == 1)
    cur.execute("SELECT COUNT(*) FROM sync_status WHERE status = 'pending'")
    check("all 4 committed events queued to sync", cur.fetchone()[0] == 4)

    # deleteTrip
    insert_event(cur, True, "deleteTrip: trip_deleted",
        event_id="e5", event_type="trip_deleted", event_domain="trip", event_version=1,
        occurred_at="2026-07-11T15:00:00Z", recorded_at="2026-07-11T15:00:00Z",
        device_id="dev1", trip_id=trip_id, payload=json.dumps({"reason": "test"}))
    cur.execute("DELETE FROM legs WHERE trip_id = ?", (trip_id,))
    cur.execute("DELETE FROM trips WHERE trip_id = ?", (trip_id,))

    cur.execute("SELECT COUNT(*) FROM trips")
    check("projection: 0 trip rows after delete", cur.fetchone()[0] == 0)
    cur.execute("SELECT COUNT(*) FROM legs")
    check("projection: 0 leg rows after delete", cur.fetchone()[0] == 0)
    cur.execute("SELECT COUNT(*) FROM events WHERE trip_id = ?", (trip_id,))
    check("event log unaffected by delete (5 events, permanent)", cur.fetchone()[0] == 5)

    conn.close()


if __name__ == "__main__":
    test_domain_grain_check()
    test_json_validity()
    test_future_date_check()
    test_user_id_required()
    test_sync_status_trigger()
    test_full_trip_lifecycle()
    test_saved_stations_table()
    test_is_test_column()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("All checks passed.")
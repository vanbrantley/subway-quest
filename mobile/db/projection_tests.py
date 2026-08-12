"""
mobile/db/projection_tests.py

Required test for projection.ts's deleteTrip() (lines ~170-190) — previously
untested directly (only indirect coverage: rehydrate_tests.ts exercises the
*replay* path for a trip_deleted event arriving from remote sync, and
schema_tests.py validates the events table's grain CHECK in isolation;
neither exercises deleteTrip()'s own three statements as a unit).

Same rationale as schema_tests.py/migration_v3_tests.py for using plain
Python sqlite3 against real schema.sql rather than a JS/Jest suite:
projection.ts imports expo-sqlite directly (unlike the zero-RN-import "pure
logic" files — rehydrate_logic.ts/quests_logic.ts/stations_logic.ts — that
get tested via plain tsx), so it can't run outside a device/RN runtime as
TypeScript. The SQL deleteTrip() runs is the genuinely risky, hand-crafted
part, and it's binding-independent — both expo-sqlite on-device and Python's
sqlite3 here wrap the same underlying SQLite C library. This validates the
SQL; it does not exercise projection.ts's actual TS control flow (argument
plumbing, CommitContext wiring) — that gap is closed by on-device manual
verification instead (see docs/status.md's delete-trip UI item).

Run: python3 mobile/db/projection_tests.py
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


def seed_trip(cur, trip_id, leg_id, occurred_at="2026-07-10T09:00:00Z", recorded_at="2026-07-11T14:00:00Z"):
    """Seeds one committed one-leg trip -- the event bundle plus the resulting
    trips/legs projection rows, mirroring what commitTrip() produces (see
    projection.ts's commitTrip/writeProjectionRows)."""
    events = [
        ("trip_started", "trip", trip_id, None, json.dumps({"origin_station_id": "127"})),
        ("leg_boarded", "trip", trip_id, leg_id, json.dumps({"station_id": "127", "route_id": "1", "sequence": 1})),
        ("leg_alighted", "trip", trip_id, leg_id, json.dumps({"station_id": "132"})),
        ("trip_ended", "trip", trip_id, None, json.dumps({"destination_station_id": "132"})),
    ]
    for i, (event_type, event_domain, tid, lid, payload) in enumerate(events):
        cur.execute(
            """INSERT INTO events
               (event_id, event_type, event_domain, event_version, occurred_at, recorded_at,
                device_id, user_id, trip_id, leg_id, payload)
               VALUES (?, ?, ?, 1, ?, ?, 'dev1', 'user1', ?, ?, ?)""",
            (f"{trip_id}-e{i}", event_type, event_domain, occurred_at, recorded_at, tid, lid, payload),
        )
    cur.execute(
        """INSERT INTO trips (trip_id, device_id, user_id, origin_station_id, destination_station_id, started_at, ended_at)
           VALUES (?, 'dev1', 'user1', '127', '132', ?, ?)""",
        (trip_id, occurred_at, occurred_at),
    )
    cur.execute(
        """INSERT INTO legs (leg_id, trip_id, sequence, route_id, entry_station_id, exit_station_id, boarded_at, alighted_at)
           VALUES (?, ?, 1, '1', '127', '132', ?, ?)""",
        (leg_id, trip_id, occurred_at, occurred_at),
    )


def run_delete_trip(cur, trip_id, reason=None, occurred_at="2026-07-12T09:00:00Z", recorded_at="2026-07-12T09:00:00Z"):
    """The literal three statements deleteTrip() runs (projection.ts:180-189),
    in the exact order, transcribed here so drift is visible on review."""
    cur.execute(
        """INSERT INTO events
           (event_id, event_type, event_domain, event_version, occurred_at, recorded_at,
            device_id, user_id, trip_id, leg_id, payload)
           VALUES (?, 'trip_deleted', 'trip', 1, ?, ?, 'dev1', 'user1', ?, NULL, ?)""",
        (f"{trip_id}-deleted", occurred_at, recorded_at, trip_id, json.dumps({"reason": reason})),
    )
    cur.execute("DELETE FROM legs WHERE trip_id = ?", (trip_id,))
    cur.execute("DELETE FROM trips WHERE trip_id = ?", (trip_id,))


def test_delete_trip_basic():
    conn = fresh_db()
    cur = conn.cursor()
    conn.execute("PRAGMA foreign_keys = ON;")

    seed_trip(cur, "tripA", "legA")
    seed_trip(cur, "tripB", "legB")  # untouched control trip -- isolation check
    conn.commit()

    run_delete_trip(cur, "tripA", reason="wrong line")
    conn.commit()

    deleted_event = cur.execute(
        "SELECT trip_id, leg_id, payload FROM events WHERE event_type = 'trip_deleted' AND trip_id = 'tripA'"
    ).fetchone()
    check("trip_deleted event was written", deleted_event is not None)
    check("trip_deleted event's trip_id matches the deleted trip", deleted_event[0] == "tripA")
    check("trip_deleted event's leg_id is NULL (trip-grain, not leg-grain)", deleted_event[1] is None)
    check("trip_deleted event's payload carries the given reason", json.loads(deleted_event[2])["reason"] == "wrong line")

    trip_row = cur.execute("SELECT 1 FROM trips WHERE trip_id = 'tripA'").fetchone()
    leg_rows = cur.execute("SELECT COUNT(*) FROM legs WHERE trip_id = 'tripA'").fetchone()[0]
    check("deleted trip's row removed from trips projection", trip_row is None)
    check("deleted trip's rows removed from legs projection", leg_rows == 0)

    other_trip = cur.execute("SELECT 1 FROM trips WHERE trip_id = 'tripB'").fetchone()
    other_legs = cur.execute("SELECT COUNT(*) FROM legs WHERE trip_id = 'tripB'").fetchone()[0]
    check("other trip's row untouched", other_trip is not None)
    check("other trip's legs untouched", other_legs == 1)

    conn.close()


def test_delete_trip_no_reason():
    conn = fresh_db()
    cur = conn.cursor()
    seed_trip(cur, "tripC", "legC")
    conn.commit()

    run_delete_trip(cur, "tripC", reason=None)  # matches deleteTrip(db, tripId, ctx) with reason omitted
    conn.commit()

    payload = cur.execute(
        "SELECT payload FROM events WHERE event_type = 'trip_deleted' AND trip_id = 'tripC'"
    ).fetchone()[0]
    check("omitted reason serializes as payload.reason = null (matches `reason ?? null` in projection.ts)",
          json.loads(payload)["reason"] is None)

    conn.close()


def test_deletion_order_is_load_bearing():
    """deleteTrip() deletes legs before trips -- confirms that order isn't
    incidental: legs.trip_id REFERENCES trips(trip_id) with no ON DELETE
    CASCADE, so under PRAGMA foreign_keys = ON, deleting a trips row while its
    legs still reference it must fail."""
    conn = fresh_db()
    cur = conn.cursor()
    conn.execute("PRAGMA foreign_keys = ON;")
    seed_trip(cur, "tripD", "legD")
    conn.commit()

    reverse_order_failed = False
    try:
        cur.execute("DELETE FROM trips WHERE trip_id = 'tripD'")
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        reverse_order_failed = True
    check("deleting trips before legs is rejected by the FK (confirms deleteTrip()'s legs-then-trips order is required, not incidental)",
          reverse_order_failed)

    # Now the correct order, same trip -- confirms the fix actually works.
    cur.execute("DELETE FROM legs WHERE trip_id = 'tripD'")
    cur.execute("DELETE FROM trips WHERE trip_id = 'tripD'")
    conn.commit()
    check("legs-then-trips (deleteTrip()'s actual order) succeeds",
          cur.execute("SELECT 1 FROM trips WHERE trip_id = 'tripD'").fetchone() is None)

    conn.close()


if __name__ == "__main__":
    test_delete_trip_basic()
    test_delete_trip_no_reason()
    test_deletion_order_is_load_bearing()
    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("All checks passed.")

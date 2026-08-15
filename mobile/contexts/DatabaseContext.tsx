// mobile/contexts/DatabaseContext.tsx
// Opens SQLite once, at the root, instead of each screen managing its own
// connection. Reads db/schema.sql at runtime via expo-asset rather than
// keeping a second hand-copied DDL string — schema.sql stays the one
// source of truth schema_tests.py also runs against, so the two can't drift.
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as SQLite from 'expo-sqlite';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import schemaAsset from '../db/schema.sql';

const DB_NAME = 'subwayquest.db';
const DatabaseContext = createContext<SQLite.SQLiteDatabase | null>(null);

// Versioned delta migrations for devices that already ran schema.sql once —
// editing schema.sql alone does nothing for them (initSchema's fresh-install
// branch below only ever runs on a brand-new database). Each entry here is
// applied, in order, to any device below its toVersion. A fresh install
// skips this list entirely: it runs the current schema.sql (which already
// includes every table these migrations exist to add) once and jumps
// straight to SCHEMA_VERSION, so both paths converge on the same schema.
//
// `run` rather than a plain SQL string, deliberately — migration 3 below
// needs more than one statement plus a specific ordering, and a future
// migration might too.
const SCHEMA_VERSION = 5;
const MIGRATIONS: { toVersion: number; run: (db: SQLite.SQLiteDatabase) => Promise<void> }[] = [
    {
        // Adds saved_stations — see schema.sql's own comment on this table
        // for the grain reasoning (station_id, not complex_id).
        toVersion: 2,
        run: async (db) => {
            await db.execAsync(`CREATE TABLE IF NOT EXISTS saved_stations (
                station_id TEXT PRIMARY KEY,
                saved_at   TEXT NOT NULL
            );`);
        },
    },
    {
        // FIX for a real bug caught on-device: migration 2 only added
        // saved_stations — it never widened `events`' grain CHECK to accept
        // station_saved/station_unsaved, so any device that ran migration 2
        // still had the OLD constraint and got a CHECK-constraint failure
        // the moment saveStation()/unsaveStation() tried to insert one.
        // SQLite has no `ALTER TABLE ... ` for modifying a CHECK constraint
        // on an existing table — this is SQLite's own documented recipe for
        // that (https://www.sqlite.org/lang_altertable.html, "Making Other
        // Kinds Of Table Schema Changes"): build the new table under a
        // temporary name, copy every row across untouched, drop the old
        // table, then rename the new one into place. This is why migration
        // 2's version couldn't just be silently "fixed": any device that
        // already completed it (like the one this bug was caught on) is
        // permanently past that checkpoint, so the fix has to ship as its
        // own, later version instead.
        //
        // Order matters here in a way that isn't obvious: the new table is
        // built under a TEMPORARY name and renamed INTO "events" at the
        // end, never the other way around. Renaming "events" AWAY (even
        // temporarily) silently rewrites every other object's stored
        // reference to it — confirmed directly: sync_status's FK clause
        // (`REFERENCES events (event_id)`) got rewritten by SQLite itself
        // to `REFERENCES "events_old" (event_id)` the moment `events` was
        // renamed to `events_old`, which then pointed at nothing once that
        // scratch table was dropped, breaking every future insert through
        // the trigger. Only ever renaming INTO the name something else
        // already references avoids this rewrite entirely.
        toVersion: 3,
        run: async (db) => {
            await db.execAsync(`DROP INDEX IF EXISTS idx_events_trip_id;`);
            await db.execAsync(`DROP INDEX IF EXISTS idx_events_occurred_at;`);
            await db.execAsync(`DROP TRIGGER IF EXISTS trg_events_create_sync_status;`);
            await db.execAsync(`
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
            `);
            await db.execAsync(`INSERT INTO events_v3_new SELECT * FROM events;`);
            await db.execAsync(`DROP TABLE events;`);
            await db.execAsync(`ALTER TABLE events_v3_new RENAME TO events;`);
            await db.execAsync(`CREATE INDEX idx_events_trip_id ON events (trip_id) WHERE trip_id IS NOT NULL;`);
            await db.execAsync(`CREATE INDEX idx_events_occurred_at ON events (occurred_at);`);
            await db.execAsync(`
                CREATE TRIGGER trg_events_create_sync_status
                AFTER INSERT ON events
                BEGIN
                    INSERT INTO sync_status (event_id, status) VALUES (NEW.event_id, 'pending');
                END;
            `);
        },
    },
    {
        // REAL BUG FIXED (found via on-device testing with a second account):
        // saved_stations had no user_id column, on the incorrect assumption
        // that this local database only ever holds one account's rows — it
        // actually shares one physical SQLite file across every account
        // that's ever signed in on this device (see DatabaseContext.tsx's
        // own DB_NAME). Every saved_stations query was consequently
        // unscoped, so one account's saved stations showed up under the
        // next account that signed in. Dropping and recreating rather than
        // ALTER TABLE ... ADD COLUMN — there's no reliable way to backfill
        // which account an existing row actually belongs to from local data
        // alone, and RehydrationGate's wipe-on-account-switch (added
        // alongside this fix) plus normal rehydration will repopulate each
        // account's real saved stations from Supabase, which already has
        // them correctly scoped by user_id. One-time cost: any saved
        // stations for the CURRENTLY signed-in account at the moment this
        // migration runs are lost locally (not in Supabase) and need a
        // manual re-save; this predates the fix, not a gap in it. Primary
        // key becomes composite (station_id, user_id) — station_id alone
        // can't be the key anymore now that two different accounts can each
        // legitimately save the same real station.
        toVersion: 4,
        run: async (db) => {
            await db.execAsync(`DROP TABLE IF EXISTS saved_stations;`);
            await db.execAsync(`CREATE TABLE saved_stations (
                station_id   TEXT NOT NULL,
                user_id      TEXT NOT NULL,
                saved_at     TEXT NOT NULL,
                PRIMARY KEY (station_id, user_id)
            );`);
        },
    },
    {
        // Dev/prod data separation: adds is_test to events, trips, and
        // saved_stations, so the same Apple ID/Supabase account can be used
        // for ongoing dev-mode testing and real personal use without the
        // two ever mixing (see lib/devMode.ts and docs/data-layer.md's
        // "Dev/prod data separation"). Plain ADD COLUMN is safe here (no
        // drop/recreate needed, unlike migration 4's saved_stations
        // primary-key change) since every column has a NOT NULL DEFAULT.
        // Existing local rows default to 0 (not test) -- fine, since local
        // data on an existing device predates this feature and its own
        // account-scoping is already correct; the meaningful flagging
        // starts from whatever a build writes going forward.
        toVersion: 5,
        run: async (db) => {
            await db.execAsync(`ALTER TABLE events ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1));`);
            await db.execAsync(`ALTER TABLE trips ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1));`);
            await db.execAsync(`ALTER TABLE saved_stations ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1));`);
        },
    },
    // A future migration slots in here as { toVersion: N, run: ... } — bump
    // SCHEMA_VERSION to match and add the equivalent DDL to schema.sql for
    // fresh installs. No other change to initSchema needed.
];

async function initSchema(db: SQLite.SQLiteDatabase) {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = row?.user_version ?? 0;

    if (currentVersion === 0) {
        // Fresh install — schema.sql already reflects every table through
        // SCHEMA_VERSION, so this runs once and lands directly on the
        // latest version. Never takes the delta path below.
        const asset = Asset.fromModule(schemaAsset);
        await asset.downloadAsync();
        const schemaSql = await new File(asset.localUri!).text();
        await db.execAsync(schemaSql);
        await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        return;
    }

    if (currentVersion >= SCHEMA_VERSION) return; // already current

    // Foreign keys must be off for migration 3's rename/recreate of `events`
    // (sync_status.event_id holds a real FK to it) — SQLite treats toggling
    // this pragma as a no-op if attempted inside a transaction, so it has
    // to happen outside withTransactionAsync's BEGIN/COMMIT, not inside it.
    await db.execAsync('PRAGMA foreign_keys = OFF;');
    try {
        // Existing device below the latest version — apply every migration
        // still owed to it, in order, inside one transaction. A crash
        // mid-way leaves user_version untouched, so the next launch retries
        // cleanly from the same starting point rather than landing
        // half-migrated.
        await db.withTransactionAsync(async () => {
            for (const migration of MIGRATIONS) {
                if (currentVersion < migration.toVersion) {
                    await migration.run(db);
                    await db.execAsync(`PRAGMA user_version = ${migration.toVersion}`);
                }
            }
        });
    } finally {
        await db.execAsync('PRAGMA foreign_keys = ON;');
    }
}

export function DatabaseProvider({ children, onReady }: { children: ReactNode; onReady?: () => void }) {
    const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);

    useEffect(() => {
        let mounted = true;
        (async () => {
            const database = await SQLite.openDatabaseAsync(DB_NAME);
            await initSchema(database);
            if (mounted) { setDb(database); onReady?.(); }
        })();
        return () => { mounted = false; };
    }, [onReady]);

    if (!db) return null; // root layout's splash logic should key off this too, alongside auth
    return <DatabaseContext.Provider value={db}>{children}</DatabaseContext.Provider>;
}

export function useDb(): SQLite.SQLiteDatabase {
    const db = useContext(DatabaseContext);
    if (!db) throw new Error('useDb() called outside DatabaseProvider, or before it finished opening');
    return db;
}
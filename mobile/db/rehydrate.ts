// mobile/db/rehydrate.ts
//
// I/O wrapper around rehydrate_logic.ts's pure logic — device/network-facing,
// not directly unit-testable outside the app runtime (see rehydrate_logic.ts
// for why the planning logic itself lives in a separate, pure file).

import type * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { writeProjectionRows, type CommitContext } from './projection';
import { planRehydration, planSavedStations, type RemoteEventRow } from './rehydrate_logic';

const LAST_SEEN_USER_KEY = 'subwayquest_last_seen_user_id';

/** Wipes local trips/legs/events/saved_stations if a DIFFERENT account has
 *  signed in on this device before this one. The whole app shares one local
 *  SQLite file regardless of which account is active (DatabaseContext.tsx's
 *  DB_NAME is a static filename, not per-user) -- confirmed on-device that a
 *  second account signing in saw the first account's saved stations,
 *  because saved_stations wasn't scoped by user_id (now fixed alongside
 *  this). This is a second line of defense for that whole class of bug, not
 *  just today's instance: if any FUTURE local table is ever added without a
 *  user_id filter, this still prevents it from leaking between accounts on
 *  a shared device, by not letting stale rows sit around to leak from.
 *
 *  Safe by the app's own existing design, not a new risk: local SQLite is
 *  already treated as a rebuildable projection of Supabase, never a second
 *  source of truth (that's the entire premise needsRehydration/
 *  rehydrateFromRemote below already run on) -- wiping it just means the
 *  normal rehydration path runs again right after, restoring this user's
 *  own real data from Supabase.
 *
 *  Must run BEFORE needsRehydration/rehydrateFromRemote so a wipe correctly
 *  triggers a fresh rehydrate in the same pass, not on the next launch. */
export async function wipeIfDifferentAccount(db: SQLite.SQLiteDatabase, userId: string): Promise<void> {
    const lastSeen = await SecureStore.getItemAsync(LAST_SEEN_USER_KEY);
    if (lastSeen !== userId) {
        if (lastSeen !== null) {
            // A different account was signed in on this device before this
            // one -- clear every local table, children before parents
            // (sync_status -> events' event_id FK, legs -> trips' trip_id
            // FK) so this doesn't trip a foreign-key violation (foreign_keys
            // is ON during normal runtime -- see DatabaseContext.tsx).
            await db.withTransactionAsync(async () => {
                await db.execAsync('DELETE FROM sync_status;');
                await db.execAsync('DELETE FROM legs;');
                await db.execAsync('DELETE FROM trips;');
                await db.execAsync('DELETE FROM events;');
                await db.execAsync('DELETE FROM saved_stations;');
            });
        }
        await SecureStore.setItemAsync(LAST_SEEN_USER_KEY, userId);
    }
}

export async function needsRehydration(db: SQLite.SQLiteDatabase, userId: string): Promise<boolean> {
    // Scoped by user_id -- an earlier version counted every row in the
    // shared local `trips` table regardless of owner, so on a device that
    // already had another account's trips locally, a genuinely new user's
    // own count came back non-zero and rehydration silently never ran for
    // them, even if they had real remote history to restore.
    const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM trips WHERE user_id = ?', [userId]);
    return (row?.count ?? 0) === 0;
}

/** Fetches this user's raw_events history and replays it into the local
 *  projection — one transaction for the whole replay (see data-layer.md's
 *  "The whole replay is one local transaction" for why partial replay would
 *  break needsRehydration's own trigger check). Covers both trips (the
 *  original concern) and saved stations (milestone 9) — same single trigger
 *  (needsRehydration, above) covers both, folded into the same
 *  all-or-nothing transaction rather than a second, separate replay path. */
export async function rehydrateFromRemote(
    db: SQLite.SQLiteDatabase,
    userId: string
): Promise<{ tripsRestored: number; tripsSkippedDeleted: number; savedStationsRestored: number }> {
    const [tripEventsResult, savedEventsResult] = await Promise.all([
        supabase
            .schema('raw_events')
            .from('events')
            .select('*')
            .eq('user_id', userId)
            .eq('event_domain', 'trip')
            .order('recorded_at', { ascending: true }),
        supabase
            .schema('raw_events')
            .from('events')
            .select('*')
            .eq('user_id', userId)
            .in('event_type', ['station_saved', 'station_unsaved'])
            .order('recorded_at', { ascending: true }),
    ]);

    if (tripEventsResult.error) {
        throw new Error(`rehydrateFromRemote: trip fetch failed — ${tripEventsResult.error.message}`);
    }
    if (savedEventsResult.error) {
        throw new Error(`rehydrateFromRemote: saved-station fetch failed — ${savedEventsResult.error.message}`);
    }

    const plan = planRehydration((tripEventsResult.data ?? []) as RemoteEventRow[]);
    const savedStations = planSavedStations((savedEventsResult.data ?? []) as RemoteEventRow[]);

    await db.withTransactionAsync(async () => {
        for (const trip of plan.restore) {
            const ctx: CommitContext = { deviceId: trip.deviceId, userId };
            await writeProjectionRows(db, trip.tripId, trip.legIds, trip.draft, ctx, trip.occurredAt);
        }
        for (const station of savedStations) {
            await db.runAsync(
                `INSERT OR REPLACE INTO saved_stations (station_id, user_id, saved_at) VALUES (?, ?, ?)`,
                [station.stationId, userId, station.savedAt]
            );
        }
    });

    if (plan.skippedIncomplete.length > 0) {
        console.warn('rehydrateFromRemote: skipped incomplete trip event sets:', plan.skippedIncomplete);
    }

    return {
        tripsRestored: plan.restore.length,
        tripsSkippedDeleted: plan.skippedDeleted.length,
        savedStationsRestored: savedStations.length,
    };
}
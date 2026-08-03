// mobile/db/rehydrate.ts
//
// I/O wrapper around rehydrate_logic.ts's pure logic — device/network-facing,
// not directly unit-testable outside the app runtime (see rehydrate_logic.ts
// for why the planning logic itself lives in a separate, pure file).

import type * as SQLite from 'expo-sqlite';
import { supabase } from '../lib/supabase';
import { writeProjectionRows, type CommitContext } from './projection';
import { planRehydration, planSavedStations, type RemoteEventRow } from './rehydrate_logic';

export async function needsRehydration(db: SQLite.SQLiteDatabase): Promise<boolean> {
    const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM trips');
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
                `INSERT OR REPLACE INTO saved_stations (station_id, saved_at) VALUES (?, ?)`,
                [station.stationId, station.savedAt]
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
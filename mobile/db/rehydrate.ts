// mobile/db/rehydrate.ts
//
// I/O wrapper around rehydrate-plan.ts's pure logic — device/network-facing,
// not directly unit-testable outside the app runtime (see rehydrate-plan.ts
// for why the planning logic itself lives in a separate, pure file).

import type * as SQLite from 'expo-sqlite';
import { supabase } from '../lib/supabase';
import { writeProjectionRows, type CommitContext } from './projection';
import { planRehydration, type RemoteEventRow } from './rehydrate-plan';

export async function needsRehydration(db: SQLite.SQLiteDatabase): Promise<boolean> {
    const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM trips');
    return (row?.count ?? 0) === 0;
}

/** Fetches this user's raw_events history and replays it into the local
 *  projection — one transaction for the whole replay (see data-layer.md's
 *  "The whole replay is one local transaction" for why partial replay would
 *  break needsRehydration's own trigger check). */
export async function rehydrateFromRemote(
    db: SQLite.SQLiteDatabase,
    userId: string
): Promise<{ tripsRestored: number; tripsSkippedDeleted: number }> {
    const { data, error } = await supabase
        .schema('raw_events')
        .from('events')
        .select('*')
        .eq('user_id', userId)
        .eq('event_domain', 'trip')
        .order('recorded_at', { ascending: true });

    if (error) throw new Error(`rehydrateFromRemote: fetch failed — ${error.message}`);

    const plan = planRehydration((data ?? []) as RemoteEventRow[]);

    await db.withTransactionAsync(async () => {
        for (const trip of plan.restore) {
            const ctx: CommitContext = { deviceId: trip.deviceId, userId };
            await writeProjectionRows(db, trip.tripId, trip.legIds, trip.draft, ctx, trip.occurredAt);
        }
    });

    if (plan.skippedIncomplete.length > 0) {
        console.warn('rehydrateFromRemote: skipped incomplete trip event sets:', plan.skippedIncomplete);
    }

    return { tripsRestored: plan.restore.length, tripsSkippedDeleted: plan.skippedDeleted.length };
}
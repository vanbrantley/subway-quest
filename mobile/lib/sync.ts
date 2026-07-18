// mobile/lib/sync.ts
import type * as SQLite from 'expo-sqlite';
import { supabase } from './supabase';

type LocalEventRow = {
    event_id: string;
    event_type: string;
    event_domain: 'trip' | 'product';
    event_version: number;
    occurred_at: string;
    recorded_at: string;
    device_id: string;
    user_id: string;
    trip_id: string | null;
    leg_id: string | null;
    payload: string; // JSON text locally; raw_events.events wants jsonb
};

function toRemoteRow(row: LocalEventRow) {
    return {
        event_id: row.event_id,
        event_type: row.event_type,
        event_domain: row.event_domain,
        event_version: row.event_version,
        occurred_at: row.occurred_at,
        recorded_at: row.recorded_at,
        device_id: row.device_id,
        user_id: row.user_id,
        trip_id: row.trip_id,
        leg_id: row.leg_id,
        payload: JSON.parse(row.payload),
        // received_at deliberately omitted — server-stamped by
        // raw_events.stamp_received_at(), never client-set.
    };
}

async function markSynced(db: SQLite.SQLiteDatabase, eventIds: string[]) {
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
        for (const id of eventIds) {
            await db.runAsync(
                `UPDATE sync_status SET status = 'synced', synced_at = ?, last_attempt_at = ? WHERE event_id = ?`,
                [now, now, id]
            );
        }
    });
}

async function markFailed(db: SQLite.SQLiteDatabase, eventIds: string[], error: string) {
    const now = new Date().toISOString();
    await db.withTransactionAsync(async () => {
        for (const id of eventIds) {
            await db.runAsync(
                `UPDATE sync_status SET status = 'failed', last_error = ?, last_attempt_at = ?, attempt_count = attempt_count + 1 WHERE event_id = ?`,
                [error, now, id]
            );
        }
    });
}

/**
 * Flushes every not-yet-synced local event to Supabase's raw_events.events.
 * Trip-domain events sync as one multi-row insert per trip_id — a single
 * Postgres statement is atomic, matching data-layer.md's "one remote
 * transaction per committed trip, not row-by-row." Product events sync one
 * row at a time, any order — no atomicity guarantee needed there.
 * Idempotent throughout: a retried row that already landed remotely is a
 * safe no-op (ON CONFLICT DO NOTHING via ignoreDuplicates), never a
 * duplicate or an error.
 */
export async function syncPendingEvents(db: SQLite.SQLiteDatabase): Promise<void> {
    const pending = await db.getAllAsync<LocalEventRow>(
        `SELECT e.* FROM events e
         JOIN sync_status s ON s.event_id = e.event_id
         WHERE s.status != 'synced'
         ORDER BY e.recorded_at ASC`
    );
    if (pending.length === 0) return;

    const tripEvents = pending.filter((e) => e.event_domain === 'trip');
    const productEvents = pending.filter((e) => e.event_domain === 'product');

    const byTripId = new Map<string, LocalEventRow[]>();
    for (const row of tripEvents) {
        const key = row.trip_id!; // trip-domain rows always have trip_id — schema CHECK enforces it
        if (!byTripId.has(key)) byTripId.set(key, []);
        byTripId.get(key)!.push(row);
    }

    for (const [, rows] of byTripId) {
        const { error } = await supabase
            .schema('raw_events')
            .from('events')
            .upsert(rows.map(toRemoteRow), { onConflict: 'event_id', ignoreDuplicates: true });

        if (error) {
            await markFailed(db, rows.map((r) => r.event_id), error.message);
        } else {
            await markSynced(db, rows.map((r) => r.event_id));
        }
    }

    for (const row of productEvents) {
        const { error } = await supabase
            .schema('raw_events')
            .from('events')
            .upsert([toRemoteRow(row)], { onConflict: 'event_id', ignoreDuplicates: true });

        if (error) {
            await markFailed(db, [row.event_id], error.message);
        } else {
            await markSynced(db, [row.event_id]);
        }
    }
}
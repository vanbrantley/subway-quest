// mobile/db/projection.ts
//
// The only two operations that ever touch the trips/legs projection.
//
// There is deliberately no generic "apply(event) -> mutate projection"
// dispatcher. trips.destination_station_id, legs.exit_station_id, and every
// other previously-conditional field are plain NOT NULL (see schema.sql) —
// they can only be satisfied once the whole trip is known, which it always
// is by the time "Log Trip" is tapped (see docs/data-layer/event-taxonomy.md,
// "Commit model"). So the projection is always written as complete rows,
// never built up incrementally event-by-event.

import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';

export type DraftLeg = {
    sequence: number; // 1-based, contiguous — the draft screen is responsible for
    // maintaining this via push/pop; schema.sql's UNIQUE(trip_id, sequence)
    // and CHECK(sequence >= 1) catch a violation if it doesn't
    routeId: string;
    directionId: string;
    entryStationId: string;
    exitStationId: string;
};

export type TripDraft = {
    originStationId: string;
    destinationStationId: string;
    legs: DraftLeg[]; // must be non-empty
    pickedDate: string; // 'YYYY-MM-DD' — user-selected via the date picker,
    // defaults to today in the UI layer (see "Date-only backdating")
};

export type CommitContext = {
    deviceId: string;
    userId: string | null;
};

const EVENT_VERSION = 1;

/** Combines the user-picked date with the actual current time-of-day.
 *  Only the date is ever user-editable — see taxonomy doc's "Date-only backdating". */
function buildOccurredAt(pickedDate: string): string {
    const timeOfDay = new Date().toISOString().slice(11); // 'HH:MM:SS.sssZ'
    return `${pickedDate}T${timeOfDay}`;
}

async function insertEvent(
    db: SQLite.SQLiteDatabase,
    params: {
        eventType: string;
        eventDomain: 'trip' | 'product';
        occurredAt: string;
        recordedAt: string;
        ctx: CommitContext;
        tripId: string | null;
        legId: string | null;
        payload: object;
    }
): Promise<void> {
    await db.runAsync(
        `INSERT INTO events
       (event_id, event_type, event_domain, event_version,
        occurred_at, recorded_at, device_id, user_id, trip_id, leg_id, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            randomUUID(), params.eventType, params.eventDomain, EVENT_VERSION,
            params.occurredAt, params.recordedAt, params.ctx.deviceId, params.ctx.userId,
            params.tripId, params.legId, JSON.stringify(params.payload),
        ]
    );
}

/**
 * Commits a drafted trip: writes the full trip-domain event bundle
 * (trip_started, every leg's leg_boarded/leg_alighted, trip_ended) and the
 * complete trips/legs projection rows, all in one atomic transaction. See
 * file header — this is intentionally not built as "apply each event."
 *
 * Returns the new trip_id.
 */
export async function commitTrip(
    db: SQLite.SQLiteDatabase,
    draft: TripDraft,
    ctx: CommitContext
): Promise<string> {
    if (draft.legs.length === 0) {
        throw new Error('commitTrip: a trip must have at least one leg');
    }

    const tripId = randomUUID();
    const legIds = draft.legs.map(() => randomUUID());
    const occurredAt = buildOccurredAt(draft.pickedDate);
    const recordedAt = new Date().toISOString();

    await db.withTransactionAsync(async () => {
        await insertEvent(db, {
            eventType: 'trip_started', eventDomain: 'trip', occurredAt, recordedAt, ctx,
            tripId, legId: null,
            payload: { origin_station_id: draft.originStationId },
        });

        for (let i = 0; i < draft.legs.length; i++) {
            const leg = draft.legs[i];
            const legId = legIds[i];

            await insertEvent(db, {
                eventType: 'leg_boarded', eventDomain: 'trip', occurredAt, recordedAt, ctx,
                tripId, legId,
                payload: { station_id: leg.entryStationId, route_id: leg.routeId, direction_id: leg.directionId },
            });

            await insertEvent(db, {
                eventType: 'leg_alighted', eventDomain: 'trip', occurredAt, recordedAt, ctx,
                tripId, legId,
                payload: { station_id: leg.exitStationId },
            });
        }

        await insertEvent(db, {
            eventType: 'trip_ended', eventDomain: 'trip', occurredAt, recordedAt, ctx,
            tripId, legId: null,
            payload: { destination_station_id: draft.destinationStationId },
        });

        // Projection: one complete row per trip, one complete row per leg —
        // never a partial insert followed by an update.
        await db.runAsync(
            `INSERT INTO trips
         (trip_id, device_id, user_id, origin_station_id, destination_station_id, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tripId, ctx.deviceId, ctx.userId, draft.originStationId, draft.destinationStationId, occurredAt, occurredAt]
        );

        for (let i = 0; i < draft.legs.length; i++) {
            const leg = draft.legs[i];
            const legId = legIds[i];
            await db.runAsync(
                `INSERT INTO legs
           (leg_id, trip_id, sequence, route_id, direction_id,
            entry_station_id, exit_station_id, boarded_at, alighted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [legId, tripId, leg.sequence, leg.routeId, leg.directionId, leg.entryStationId, leg.exitStationId, occurredAt, occurredAt]
            );
        }
    });

    return tripId;
}

/**
 * Deletes an already-logged trip: writes trip_deleted (permanent record in
 * the event log) and removes the trip's rows from the projection. This is
 * the only repair path — there is no edit mode. See taxonomy doc's
 * "Correction events".
 */
export async function deleteTrip(
    db: SQLite.SQLiteDatabase,
    tripId: string,
    ctx: CommitContext,
    reason?: string
): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const occurredAt = buildOccurredAt(today);
    const recordedAt = new Date().toISOString();

    await db.withTransactionAsync(async () => {
        await insertEvent(db, {
            eventType: 'trip_deleted', eventDomain: 'trip', occurredAt, recordedAt, ctx,
            tripId, legId: null,
            payload: { reason: reason ?? null },
        });

        await db.runAsync(`DELETE FROM legs WHERE trip_id = ?`, [tripId]);
        await db.runAsync(`DELETE FROM trips WHERE trip_id = ?`, [tripId]);
    });
}
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
    userId: string; // required — real auth exists from day one, sign-in happens before any trip
    // can be drafted, so this is always known. Not nullable.
};

const EVENT_VERSION = 1;
const LEG_BOARDED_VERSION = 2; // payload gained `sequence` — see data-layer.md's
// "Rehydration-on-sign-in" section for why

/** Local calendar date ('YYYY-MM-DD') for a given moment. Deliberately NOT
 *  `date.toISOString().slice(0, 10)` — that returns the UTC calendar date,
 *  which is wrong near local midnight (see buildOccurredAt below). */
export function localDateString(d: Date = new Date()): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Combines the user-picked local calendar date with the actual current
 *  local time-of-day, producing a correct UTC instant. Only the date is
 *  ever user-editable — see taxonomy doc's "Date-only backdating".
 *
 *  FIXED (was a real bug): the original implementation built this by
 *  slicing the time-of-day off `new Date().toISOString()` (always UTC) and
 *  gluing it directly onto the local `pickedDate` string. Those are two
 *  different reference frames — the result claimed to be UTC (`Z` suffix)
 *  but wasn't, and could resolve to a date a full day off from what
 *  actually happened depending on the offset and time of day. Fixed by
 *  constructing the moment from consistent local-time components via the
 *  Date constructor (which interprets year/month/day/hours as local time),
 *  then letting `toISOString()` do one correct local→UTC conversion. */
function buildOccurredAt(pickedDate: string): string {
    const [year, month, day] = pickedDate.split('-').map(Number);
    const now = new Date();
    const localMoment = new Date(
        year, month - 1, day,
        now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()
    );
    return localMoment.toISOString();
}

async function insertEvent(
    db: SQLite.SQLiteDatabase,
    params: {
        eventType: string;
        eventDomain: 'trip' | 'product';
        eventVersion?: number;
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
            randomUUID(), params.eventType, params.eventDomain, params.eventVersion ?? EVENT_VERSION,
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
                eventVersion: LEG_BOARDED_VERSION,
                tripId, legId,
                payload: { station_id: leg.entryStationId, route_id: leg.routeId, sequence: leg.sequence },
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

        // Projection write — shared with rehydrate.ts's replay path, one
        // implementation of "what a trip's projection rows look like."
        await writeProjectionRows(db, tripId, legIds, draft, ctx, occurredAt);
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
    const today = localDateString();
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

export async function writeProductEvent(
    db: SQLite.SQLiteDatabase,
    eventType: 'screen_viewed' | 'station_detail_opened' | 'route_detail_opened' | 'feature_used'
        | 'trip_draft_started' | 'draft_leg_added' | 'draft_leg_removed'
        | 'trip_draft_committed' | 'trip_draft_abandoned',
    payload: object,
    ctx: CommitContext
): Promise<void> {
    const occurredAt = buildOccurredAt(localDateString());
    const recordedAt = new Date().toISOString();
    await insertEvent(db, { eventType, eventDomain: 'product', occurredAt, recordedAt, ctx, tripId: null, legId: null, payload });
}

/**
  * Writes the trips/legs projection rows for a fully-known trip — no event
  * writes here, just the projection. Shared by commitTrip (live commits) and
  * rehydrate.ts (replaying remote events — no local event bundle to write,
  * since raw_events already holds them server-side).
  * */
export async function writeProjectionRows(
    db: SQLite.SQLiteDatabase,
    tripId: string,
    legIds: string[],
    draft: TripDraft,
    ctx: CommitContext,
    occurredAt: string
): Promise<void> {
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
            (leg_id, trip_id, sequence, route_id,
             entry_station_id, exit_station_id, boarded_at, alighted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [legId, tripId, leg.sequence, leg.routeId, leg.entryStationId, leg.exitStationId, occurredAt, occurredAt]
        );
    }
}
// mobile/db/rehydrate_logic.ts
//
// Pure planning logic for rehydration — deliberately zero imports of
// expo-sqlite, supabase, or anything React Native touches, so this file can
// be tested with a plain Node/tsx run (see rehydrate_tests.ts), not just
// on-device. rehydrate.ts (the I/O wrapper) imports from here, never the
// reverse.

export type RemoteEventRow = {
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
    payload: Record<string, unknown>;
};

export type RehydratedTrip = {
    tripId: string;
    draft: {
        originStationId: string;
        destinationStationId: string;
        pickedDate: string;
        legs: { sequence: number; routeId: string; entryStationId: string; exitStationId: string }[];
    };
    legIds: string[];
    deviceId: string;
    occurredAt: string;
};

export type RehydrationPlan = {
    restore: RehydratedTrip[];
    skippedDeleted: string[];
    skippedIncomplete: string[];
};

/** Pure — given this user's trip-domain remote events, decides what to
 *  restore, what to skip (deleted), what to skip (incomplete/malformed). */
export function planRehydration(events: RemoteEventRow[]): RehydrationPlan {
    const byTripId = new Map<string, RemoteEventRow[]>();
    for (const row of events) {
        if (!row.trip_id) continue;
        if (!byTripId.has(row.trip_id)) byTripId.set(row.trip_id, []);
        byTripId.get(row.trip_id)!.push(row);
    }

    const restore: RehydratedTrip[] = [];
    const skippedDeleted: string[] = [];
    const skippedIncomplete: string[] = [];

    for (const [tripId, tripEvents] of byTripId) {
        if (tripEvents.some((e) => e.event_type === 'trip_deleted')) {
            skippedDeleted.push(tripId);
            continue;
        }

        const tripStarted = tripEvents.find((e) => e.event_type === 'trip_started');
        const tripEnded = tripEvents.find((e) => e.event_type === 'trip_ended');
        const boardedEvents = tripEvents.filter((e) => e.event_type === 'leg_boarded');
        const alightedEvents = tripEvents.filter((e) => e.event_type === 'leg_alighted');

        if (!tripStarted || !tripEnded || boardedEvents.length === 0) {
            skippedIncomplete.push(tripId);
            continue;
        }

        const orderedBoarded = [...boardedEvents].sort((a, b) => {
            const seqA = typeof a.payload.sequence === 'number' ? (a.payload.sequence as number) : 0;
            const seqB = typeof b.payload.sequence === 'number' ? (b.payload.sequence as number) : 0;
            return seqA - seqB;
        });

        let incomplete = false;
        const legs = orderedBoarded.map((boarded, i) => {
            const legId = boarded.leg_id!;
            const alighted = alightedEvents.find((a) => a.leg_id === legId);
            if (!alighted) incomplete = true;
            return {
                sequence: typeof boarded.payload.sequence === 'number' ? (boarded.payload.sequence as number) : i + 1,
                routeId: boarded.payload.route_id as string,
                entryStationId: boarded.payload.station_id as string,
                exitStationId: alighted ? (alighted.payload.station_id as string) : '',
                legId,
            };
        });

        if (incomplete) {
            skippedIncomplete.push(tripId);
            continue;
        }

        restore.push({
            tripId,
            draft: {
                originStationId: tripStarted.payload.origin_station_id as string,
                destinationStationId: tripEnded.payload.destination_station_id as string,
                pickedDate: tripStarted.occurred_at.slice(0, 10),
                legs: legs.map(({ legId, ...rest }) => rest),
            },
            legIds: legs.map((l) => l.legId),
            deviceId: tripStarted.device_id,
            occurredAt: tripStarted.occurred_at,
        });
    }

    return { restore, skippedDeleted, skippedIncomplete };
}

export type RehydratedSavedStation = { stationId: string; savedAt: string };

/** Pure — folds a user's station_saved/station_unsaved event history into a
 *  final saved-set. Last-write-wins per station_id, ordered by recorded_at
 *  (real device write time — more reliable than occurred_at, which is never
 *  backdated for these events anyway). Only stations whose most recent
 *  event is station_saved survive in the result. Same "replay the event log
 *  into a final projection" shape as planRehydration, just a simpler
 *  binary-toggle fold instead of trip reconstruction. */
export function planSavedStations(events: RemoteEventRow[]): RehydratedSavedStation[] {
    const latest = new Map<string, { action: 'saved' | 'unsaved'; recordedAt: string; occurredAt: string }>();

    for (const row of events) {
        if (row.event_type !== 'station_saved' && row.event_type !== 'station_unsaved') continue;
        const stationId = row.payload.station_id as string;
        const existing = latest.get(stationId);
        if (!existing || row.recorded_at > existing.recordedAt) {
            latest.set(stationId, {
                action: row.event_type === 'station_saved' ? 'saved' : 'unsaved',
                recordedAt: row.recorded_at,
                occurredAt: row.occurred_at,
            });
        }
    }

    const result: RehydratedSavedStation[] = [];
    for (const [stationId, v] of latest) {
        if (v.action === 'saved') result.push({ stationId, savedAt: v.occurredAt });
    }
    return result;
}
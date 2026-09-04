// mobile/db/trips.ts
// Trip-level reads that aren't specific to any one station -- split out of
// stations.ts because getTripEndpoints is shared by both the Station page's
// visit history (filtered to trips through one station) and the Profile
// page's full trip history (every trip), and neither is really "about
// stations."
import type * as SQLite from 'expo-sqlite';
import { testDataFilterSql } from './testDataFilter';
import { routeIdsForLine } from '../lib/subwayData';

export type TripEndpoints = {
    entryRouteId: string | null;
    entryStationId: string | null;
    exitRouteId: string | null;
    exitStationId: string | null;
};

/** Given a set of trip ids, returns each trip's first (lowest-sequence) and
 *  last (highest-sequence) leg -- the line actually ridden into the overall
 *  origin and out of the overall exit. `trips` carries origin/destination
 *  station ids but not route_id, so this always needs a `legs` lookup.
 *  Batched (one query for every trip id, reduced in JS) rather than one
 *  query per trip -- same "batched, merged in JS" shape as
 *  stations.ts's getAllStationStatuses, for the same reason. */
export async function getTripEndpoints(
    db: SQLite.SQLiteDatabase,
    tripIds: string[]
): Promise<Map<string, TripEndpoints>> {
    const result = new Map<string, TripEndpoints>();
    if (tripIds.length === 0) return result;

    const placeholders = tripIds.map(() => '?').join(',');
    const legRows = await db.getAllAsync<{
        trip_id: string;
        sequence: number;
        route_id: string;
        entry_station_id: string;
        exit_station_id: string;
    }>(
        `SELECT trip_id, sequence, route_id, entry_station_id, exit_station_id
         FROM legs WHERE trip_id IN (${placeholders}) ORDER BY trip_id, sequence`,
        tripIds
    );

    const endsByTrip = new Map<string, { first: (typeof legRows)[number]; last: (typeof legRows)[number] }>();
    for (const row of legRows) {
        const existing = endsByTrip.get(row.trip_id);
        if (!existing) {
            endsByTrip.set(row.trip_id, { first: row, last: row });
        } else {
            existing.last = row; // rows are ordered by sequence within a trip_id, so the latest seen row is always the current max
        }
    }

    for (const tripId of tripIds) {
        const ends = endsByTrip.get(tripId);
        result.set(tripId, {
            entryRouteId: ends?.first.route_id ?? null,
            entryStationId: ends?.first.entry_station_id ?? null,
            exitRouteId: ends?.last.route_id ?? null,
            exitStationId: ends?.last.exit_station_id ?? null,
        });
    }
    return result;
}

export type TripHistoryEntry = { tripId: string; startedAt: string } & TripEndpoints;

/** Every trip this rider has logged, most recent first -- feeds the Profile
 *  page's trip history, same row shape (date + origin + exit, via
 *  getTripEndpoints) as the Station page's per-station visit history. */
export async function getTripHistory(db: SQLite.SQLiteDatabase, userId: string): Promise<TripHistoryEntry[]> {
    const tripRows = await db.getAllAsync<{ trip_id: string; started_at: string }>(
        `SELECT trip_id, started_at FROM trips WHERE user_id = ? ${testDataFilterSql()} ORDER BY started_at DESC`,
        [userId]
    );
    if (tripRows.length === 0) return [];

    const endpoints = await getTripEndpoints(db, tripRows.map((t) => t.trip_id));
    return tripRows.map((t) => ({
        tripId: t.trip_id,
        startedAt: t.started_at,
        ...(endpoints.get(t.trip_id) ?? { entryRouteId: null, entryStationId: null, exitRouteId: null, exitStationId: null }),
    }));
}

/** Every trip that included at least one leg on the given display line, most
 *  recent first -- feeds the Line page's Visit History, same row shape (date
 *  + overall origin/exit, via getTripEndpoints) as the Station page's
 *  per-station visit history. `lineId` is the Line page's display id (e.g.
 *  'S' for the combined shuttle overview), not necessarily a real route_id --
 *  see routeIdsForLine. DISTINCT matters here: a trip can have more than one
 *  qualifying leg (e.g. riding the same route twice in one trip, or two
 *  different real shuttle route_ids under lineId === 'S'). */
export async function getLineVisitHistory(
    db: SQLite.SQLiteDatabase,
    userId: string,
    lineId: string
): Promise<TripHistoryEntry[]> {
    const routeIds = routeIdsForLine(lineId);
    if (routeIds.length === 0) return [];

    const placeholders = routeIds.map(() => '?').join(',');
    const visitRows = await db.getAllAsync<{ trip_id: string; started_at: string }>(
        `SELECT DISTINCT t.trip_id, t.started_at FROM legs l JOIN trips t ON l.trip_id = t.trip_id
         WHERE t.user_id = ? AND l.route_id IN (${placeholders}) ${testDataFilterSql('t.')}
         ORDER BY t.started_at DESC`,
        [userId, ...routeIds]
    );
    if (visitRows.length === 0) return [];

    const endpoints = await getTripEndpoints(db, visitRows.map((r) => r.trip_id));
    return visitRows.map((v) => ({
        tripId: v.trip_id,
        startedAt: v.started_at,
        ...(endpoints.get(v.trip_id) ?? { entryRouteId: null, entryStationId: null, exitRouteId: null, exitStationId: null }),
    }));
}

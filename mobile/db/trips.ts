// mobile/db/trips.ts
// Trip-level reads that aren't specific to any one station -- split out of
// stations.ts because getTripEndpoints is shared by both the Station page's
// visit history (filtered to trips through one station) and the Profile
// page's full trip history (every trip), and neither is really "about
// stations."
import type * as SQLite from 'expo-sqlite';
import { testDataFilterSql } from './testDataFilter';
import { routeIdsForLine } from '../lib/subwayData';
import { groupLegsByStopPure, type LineLegEntry, type StopRideEvent } from './trips_logic';

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

/** Every leg this user has ridden on any of the given route_ids -- batched
 *  (one query for every route id), same pattern as getTripEndpoints. Feeds
 *  getLineStopRideHistory below. */
export async function getLegsForRoutes(
    db: SQLite.SQLiteDatabase,
    userId: string,
    routeIds: string[]
): Promise<LineLegEntry[]> {
    if (routeIds.length === 0) return [];

    const placeholders = routeIds.map(() => '?').join(',');
    const rows = await db.getAllAsync<{
        leg_id: string; trip_id: string; entry_station_id: string; exit_station_id: string;
        boarded_at: string; alighted_at: string;
    }>(
        `SELECT l.leg_id, l.trip_id, l.entry_station_id, l.exit_station_id, l.boarded_at, l.alighted_at
         FROM legs l JOIN trips t ON l.trip_id = t.trip_id
         WHERE t.user_id = ? AND l.route_id IN (${placeholders}) ${testDataFilterSql('t.')}
         ORDER BY l.boarded_at DESC`,
        [userId, ...routeIds]
    );
    return rows.map((r) => ({
        legId: r.leg_id, tripId: r.trip_id,
        entryStationId: r.entry_station_id, exitStationId: r.exit_station_id,
        boardedAt: r.boarded_at, alightedAt: r.alighted_at,
    }));
}

/** This user's ride history on a given display line, grouped by stop_id --
 *  feeds the Line page's per-stop "ride history" disclosure. `lineId` is the
 *  Line page's display id (e.g. 'S' for the combined shuttle overview), not
 *  necessarily a real route_id -- see routeIdsForLine. */
export async function getLineStopRideHistory(
    db: SQLite.SQLiteDatabase,
    userId: string,
    lineId: string
): Promise<Record<string, StopRideEvent[]>> {
    const legs = await getLegsForRoutes(db, userId, routeIdsForLine(lineId));
    return groupLegsByStopPure(legs);
}

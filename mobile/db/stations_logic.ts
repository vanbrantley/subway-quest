// mobile/db/stations_logic.ts
//
// Pure profile/station-status computation -- zero imports of expo-sqlite,
// RN, or anything that transitively pulls in RN/SVG source (same reasoning
// as quests_logic.ts/rehydrate_logic.ts's split -- importing subwayData.ts
// directly would pull in lineIcons.tsx -> react-native-svg). stations.ts
// (the I/O wrapper) queries SQLite and the bundled stations.json, then calls
// into this file with plain data -- never the reverse. Testable via plain
// tsx, no device needed.

import type { RiderHistory } from './quests_logic';

// stop_id -> reference data needed for display/aggregation. Built by
// stations.ts from bundled stations.json -- this module never reads JSON
// files or SQLite itself.
export type StationRefLookup = Record<string, { name: string; borough: string }>;

export type StationStatus = { visited: boolean; saved: boolean };

export type FavoriteStation = { stationId: string; name: string; rideCount: number };
export type RouteRideCount = { routeId: string; rideCount: number };
export type BoroughCoverage = { borough: string; visited: number; total: number; pct: number };

export type ProfileStats = {
    ridesLogged: number;
    stationsVisited: number;
    totalStations: number;
    pctVisitedOverall: number; // 0-100, rounded to 1 decimal
    pctVisitedByBorough: BoroughCoverage[];
    favoriteStations: FavoriteStation[]; // most-visited, ties included
    favoriteLines: RouteRideCount[]; // most-ridden, ties included
};

/** Every distinct GTFS stop_id this rider has ever entered or exited at --
 *  the deliberate stop_id grain shared with saved_stations (see
 *  data-layer.md's grain note), NOT complex_id. */
export function getVisitedStationIdsPure(history: RiderHistory): Set<string> {
    const visited = new Set<string>();
    for (const leg of history.legs) {
        visited.add(leg.entryStationId);
        visited.add(leg.exitStationId);
    }
    return visited;
}

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

export function computeProfileStatsPure(
    history: RiderHistory,
    stationRefs: StationRefLookup,
    allStationIds: string[] // every real station, for the "total" denominator
): ProfileStats {
    const visited = getVisitedStationIdsPure(history);

    // Rides per station -- entry AND exit both count, since "most-visited"
    // is about how often this station showed up in a trip, not distinct
    // trips touching it.
    const stationRideCounts = new Map<string, number>();
    for (const leg of history.legs) {
        stationRideCounts.set(leg.entryStationId, (stationRideCounts.get(leg.entryStationId) ?? 0) + 1);
        stationRideCounts.set(leg.exitStationId, (stationRideCounts.get(leg.exitStationId) ?? 0) + 1);
    }
    const maxStationCount = stationRideCounts.size > 0 ? Math.max(...stationRideCounts.values()) : 0;
    const favoriteStations: FavoriteStation[] = maxStationCount > 0
        ? [...stationRideCounts.entries()]
            .filter(([, c]) => c === maxStationCount)
            .map(([stationId, rideCount]) => ({
                stationId, rideCount,
                name: stationRefs[stationId]?.name ?? stationId,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [];

    // Rides per route.
    const routeRideCounts = new Map<string, number>();
    for (const leg of history.legs) {
        routeRideCounts.set(leg.routeId, (routeRideCounts.get(leg.routeId) ?? 0) + 1);
    }
    const maxRouteCount = routeRideCounts.size > 0 ? Math.max(...routeRideCounts.values()) : 0;
    const favoriteLines: RouteRideCount[] = maxRouteCount > 0
        ? [...routeRideCounts.entries()]
            .filter(([, c]) => c === maxRouteCount)
            .map(([routeId, rideCount]) => ({ routeId, rideCount }))
            .sort((a, b) => a.routeId.localeCompare(b.routeId))
        : [];

    // % visited by borough.
    const boroughTotals = new Map<string, number>();
    const boroughVisited = new Map<string, number>();
    for (const stationId of allStationIds) {
        const borough = stationRefs[stationId]?.borough;
        if (!borough) continue;
        boroughTotals.set(borough, (boroughTotals.get(borough) ?? 0) + 1);
        if (visited.has(stationId)) boroughVisited.set(borough, (boroughVisited.get(borough) ?? 0) + 1);
    }
    const pctVisitedByBorough: BoroughCoverage[] = [...boroughTotals.entries()]
        .map(([borough, total]) => {
            const v = boroughVisited.get(borough) ?? 0;
            return { borough, visited: v, total, pct: total > 0 ? round1((v / total) * 100) : 0 };
        })
        .sort((a, b) => a.borough.localeCompare(b.borough));

    return {
        ridesLogged: history.trips.length,
        stationsVisited: visited.size,
        totalStations: allStationIds.length,
        pctVisitedOverall: allStationIds.length > 0 ? round1((visited.size / allStationIds.length) * 100) : 0,
        pctVisitedByBorough,
        favoriteStations,
        favoriteLines,
    };
}

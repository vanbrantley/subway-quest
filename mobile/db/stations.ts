// mobile/db/stations.ts
//
// Thin I/O wrapper: queries local SQLite (trips/legs/saved_stations) and the
// bundled stations.json, calls into stations_logic.ts's pure computation.
// Never re-implements evaluation logic here -- same "one place owns this"
// principle as quests.ts/quests_logic.ts.

import * as SQLite from 'expo-sqlite';
import stationsData from '../data/stations.json';
import { loadRiderHistory } from './quests';
import { getTripEndpoints, type TripEndpoints } from './trips';
import { testDataFilterSql } from './testDataFilter';
import {
    computeProfileStatsPure,
    type StationRefLookup,
    type StationStatus,
    type ProfileStats,
} from './stations_logic';

export type { StationStatus, ProfileStats } from './stations_logic';

type StationsFile = Record<string, { name: string; borough: string; complex_id: string }>;
const STATIONS = stationsData as unknown as StationsFile;
const ALL_STATION_IDS = Object.keys(STATIONS);
const STATION_REFS: StationRefLookup = Object.fromEntries(
    Object.entries(STATIONS).map(([stopId, s]) => [stopId, { name: s.name, borough: s.borough }])
);

async function loadVisitedSet(db: SQLite.SQLiteDatabase, userId: string): Promise<Set<string>> {
    const rows = await db.getAllAsync<{ station_id: string }>(
        `SELECT entry_station_id AS station_id FROM legs l JOIN trips t ON l.trip_id = t.trip_id WHERE t.user_id = ? ${testDataFilterSql('t.')}
         UNION
         SELECT exit_station_id AS station_id FROM legs l JOIN trips t ON l.trip_id = t.trip_id WHERE t.user_id = ? ${testDataFilterSql('t.')}`,
        [userId, userId]
    );
    return new Set(rows.map((r) => r.station_id));
}

async function loadSavedSet(db: SQLite.SQLiteDatabase, userId: string): Promise<Set<string>> {
    const rows = await db.getAllAsync<{ station_id: string }>(
        `SELECT station_id FROM saved_stations WHERE user_id = ? ${testDataFilterSql()}`,
        [userId]
    );
    return new Set(rows.map((r) => r.station_id));
}

/** Single-station visited/saved status, for the canonical Station page. */
export async function getStationStatus(
    db: SQLite.SQLiteDatabase,
    userId: string,
    stationId: string
): Promise<StationStatus> {
    const row = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) as c FROM legs l JOIN trips t ON l.trip_id = t.trip_id
         WHERE t.user_id = ? AND (l.entry_station_id = ? OR l.exit_station_id = ?) ${testDataFilterSql('t.')}`,
        [userId, stationId, stationId]
    );
    const saved = await db.getFirstAsync<{ station_id: string }>(
        `SELECT station_id FROM saved_stations WHERE station_id = ? AND user_id = ? ${testDataFilterSql()}`,
        [stationId, userId]
    );
    return { visited: (row?.c ?? 0) > 0, saved: !!saved };
}

/** Every station's visited/saved status in one pass -- for the Map tab
 *  (496 markers, must not be 496 queries). Two queries total, merged in JS. */
export async function getAllStationStatuses(
    db: SQLite.SQLiteDatabase,
    userId: string
): Promise<Record<string, StationStatus>> {
    const [visitedSet, savedSet] = await Promise.all([loadVisitedSet(db, userId), loadSavedSet(db, userId)]);
    const result: Record<string, StationStatus> = {};
    for (const stationId of ALL_STATION_IDS) {
        result[stationId] = { visited: visitedSet.has(stationId), saved: savedSet.has(stationId) };
    }
    return result;
}

export type StationVisit = { tripId: string; startedAt: string } & TripEndpoints;

/** Dates this rider passed through a given station (entry or exit on any
 *  leg), most recent first -- feeds the Station page's visit history, along
 *  with the overall trip's start (first leg's line + origin) and end (last
 *  leg's line + exit), not just this leg, via trips.ts's getTripEndpoints
 *  (shared with the Profile page's full trip history -- same row shape). */
export async function getStationVisitHistory(
    db: SQLite.SQLiteDatabase,
    userId: string,
    stationId: string
): Promise<StationVisit[]> {
    const visitRows = await db.getAllAsync<{ trip_id: string; started_at: string }>(
        `SELECT DISTINCT t.trip_id, t.started_at FROM legs l JOIN trips t ON l.trip_id = t.trip_id
         WHERE t.user_id = ? AND (l.entry_station_id = ? OR l.exit_station_id = ?) ${testDataFilterSql('t.')}
         ORDER BY t.started_at DESC`,
        [userId, stationId, stationId]
    );
    if (visitRows.length === 0) return [];

    const endpoints = await getTripEndpoints(db, visitRows.map((r) => r.trip_id));
    return visitRows.map((v) => ({
        tripId: v.trip_id,
        startedAt: v.started_at,
        ...(endpoints.get(v.trip_id) ?? { entryRouteId: null, entryStationId: null, exitRouteId: null, exitStationId: null }),
    }));
}

export type SavedStation = { stationId: string; savedAt: string; name: string; visited: boolean };

/** Saved Stations list for Profile -- deliberately no auto-removal on
 *  visiting (see ui-spec.md's Profile tab spec): a visited station stays in
 *  this list, just with visited: true. */
export async function getSavedStations(
    db: SQLite.SQLiteDatabase,
    userId: string
): Promise<SavedStation[]> {
    const rows = await db.getAllAsync<{ station_id: string; saved_at: string }>(
        `SELECT station_id, saved_at FROM saved_stations WHERE user_id = ? ${testDataFilterSql()} ORDER BY saved_at DESC`,
        [userId]
    );
    if (rows.length === 0) return [];
    const visitedSet = await loadVisitedSet(db, userId);
    return rows.map((r) => ({
        stationId: r.station_id,
        savedAt: r.saved_at,
        name: STATION_REFS[r.station_id]?.name ?? r.station_id,
        visited: visitedSet.has(r.station_id),
    }));
}

/** Profile mini-dashboard aggregate stats -- rides logged, stations visited,
 *  % of network (overall + by borough), favorite station/line. */
export async function getProfileStats(db: SQLite.SQLiteDatabase, userId: string): Promise<ProfileStats> {
    const { history } = await loadRiderHistory(db, userId);
    return computeProfileStatsPure(history, STATION_REFS, ALL_STATION_IDS);
}

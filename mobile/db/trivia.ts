// mobile/db/trivia.ts
//
// Thin I/O wrapper: queries local SQLite (trips/legs/trivia_global_preference),
// reads the bundled trivia.json/stations.json/transfers.json, and calls into
// trivia_logic.ts's pure diff. Never re-implements the unlock/reveal logic
// here -- one place owns "what counts as a trivia reveal," same principle as
// quests.ts/quests_logic.ts.
//
// Whether an individual station/line's fact pill is expanded is NOT
// persisted here -- it's plain local component state (see
// StationTriviaFact.tsx/LineTriviaFact.tsx). Only the global Fun Facts
// on/off switch (Settings) is a real per-user preference.

import * as SQLite from 'expo-sqlite';
import { loadRiderHistory } from './quests';
import { normalizeRouteIdForIcon } from '../lib/subwayData';
import { testDataFilterSql } from './testDataFilter';
import triviaData from '../data/trivia.json';
import stationsData from '../data/stations.json';
import transfersData from '../data/transfers.json';
import type { ComplexLookup, RiderHistory } from './quests_logic';
import { TriviaFile, TriviaReveal, computeTripTriviaRevealsPure } from './trivia_logic';

const TRIVIA = triviaData as unknown as TriviaFile;

// ---- stop_id -> complex_id, built independently here (not imported from
// quests.ts) -- same "each I/O wrapper rebuilds its own small lookups from
// bundled JSON" convention quests.ts/stations.ts already follow. ----
type StationsFile = Record<string, { complex_id: string }>;
const STATIONS = stationsData as unknown as StationsFile;
const COMPLEX_LOOKUP: ComplexLookup = Object.fromEntries(
    Object.entries(STATIONS).map(([stopId, s]) => [stopId, Number(s.complex_id)])
);

// ---- complex_id -> transfer-complex info, verbatim copy of db/quests.ts's
// own construction (see that file for the "why transfers.json, not
// Object.entries(stations.json)'s first match" reasoning). ----
type TransferComplex = { display_name: string; gtfs_stop_ids: string[] };
type TransfersFile = Record<string, TransferComplex>;
const TRANSFERS = transfersData as unknown as TransfersFile;
const COMPLEX_NAMES: Record<number, string> = {};
const COMPLEX_REPRESENTATIVE_STOP: Record<number, string> = {};
for (const [cid, t] of Object.entries(TRANSFERS)) {
    COMPLEX_NAMES[Number(cid)] = t.display_name.replace(/\s*\([^)]*\)$/, '');
    COMPLEX_REPRESENTATIVE_STOP[Number(cid)] = t.gtfs_stop_ids[0];
}

// Folds express variants (6X/7X/FX) into their local counterpart before the
// pure diff ever sees a leg's routeId -- trivia.json only ever keys lines by
// the real/local display route_id, never an express variant.
function normalizeHistory(history: RiderHistory): RiderHistory {
    return {
        trips: history.trips,
        legs: history.legs.map((l) => ({ ...l, routeId: normalizeRouteIdForIcon(l.routeId) })),
    };
}

/** TriviaReveal enriched with what Trip Summary actually needs to render a
 *  specific, navigable row -- trivia_logic.ts can't resolve these itself
 *  (it's pure, no data files), so computeTripTriviaReveals adds them here
 *  after calling the pure diff. */
export type TriviaRevealDetail =
    | { kind: 'station'; complexId: number; fact: string; stopId: string | null; displayName: string; routeId: string | null }
    | { kind: 'line'; routeId: string; fact: string; displayName: string };

/** Computes which station/line facts this trip newly touched/rode for the
 *  first time ever -- diffs the rider's full history with the trip included
 *  against the same history with it filtered back out, same "recompute from
 *  full history, don't cache" shape as quests.ts's computeTripQuestProgress.
 *  Still the underlying mechanism behind Trip Summary's "New discovery"
 *  spotlight even though Station/Line pages no longer gate display on it. */
export async function computeTripTriviaReveals(
    db: SQLite.SQLiteDatabase,
    userId: string,
    tripId: string
): Promise<TriviaRevealDetail[]> {
    const { history: rawAfter } = await loadRiderHistory(db, userId);
    const after = normalizeHistory(rawAfter);
    const before: RiderHistory = {
        trips: after.trips.filter((t) => t.tripId !== tripId),
        legs: after.legs.filter((l) => l.tripId !== tripId),
    };
    // Already alias-normalized by normalizeHistory above.
    const thisTripLegs = after.legs.filter((l) => l.tripId === tripId);

    return computeTripTriviaRevealsPure(TRIVIA, before, after, COMPLEX_LOOKUP).map((r): TriviaRevealDetail => {
        if (r.kind === 'station') {
            const stopId = COMPLEX_REPRESENTATIVE_STOP[r.complexId] ?? null;
            // The specific route this trip actually rode to reach the
            // revealed complex -- not just any route serving it -- found by
            // scanning this trip's own legs (there's always at least one,
            // since the reveal was necessarily caused by one of them).
            const matchingLeg = thisTripLegs.find((l) =>
                COMPLEX_LOOKUP[l.entryStationId] === r.complexId || COMPLEX_LOOKUP[l.exitStationId] === r.complexId
            );
            return {
                kind: 'station',
                complexId: r.complexId,
                fact: r.fact,
                stopId,
                displayName: COMPLEX_NAMES[r.complexId] ?? `Unknown station (${r.complexId})`,
                routeId: matchingLeg?.routeId ?? null,
            };
        }
        return { kind: 'line', routeId: r.routeId, fact: r.fact, displayName: `${r.routeId} line` };
    });
}

/** Global Fun Facts on/off (Settings). Default true -- absence of a row
 *  means the feature stays on, matching how it already shipped in v1. */
export async function getTriviaFactsEnabled(
    db: SQLite.SQLiteDatabase, userId: string
): Promise<boolean> {
    const row = await db.getFirstAsync<{ enabled: number }>(
        `SELECT enabled FROM trivia_global_preference WHERE user_id = ? ${testDataFilterSql()}`,
        [userId]
    );
    return row ? row.enabled === 1 : true;
}

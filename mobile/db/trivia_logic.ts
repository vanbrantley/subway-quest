// mobile/db/trivia_logic.ts
//
// Pure trivia-unlock diffing -- zero imports of expo-sqlite, RN, or anything
// that transitively pulls in RN/SVG source, same split as quests_logic.ts
// (see its header comment for why). trivia.ts (the I/O wrapper) queries
// SQLite and the bundled trivia.json/stations.json/transfers.json, resolves
// route_id aliasing (6X -> 6, etc.) via subwayData.ts's normalizeRouteIdForIcon,
// then calls into this file with plain, already-normalized data -- never the
// reverse. Testable via plain tsx, no device needed (see trivia_logic_tests.ts).

import type { RiderHistory, ComplexLookup } from './quests_logic';

export type TriviaFile = {
    stations: Record<string, { fact: string }>;
    lines: Record<string, { fact: string }>;
};

export type TriviaReveal =
    | { kind: 'station'; complexId: number; fact: string }
    | { kind: 'line'; routeId: string; fact: string };

// Same shape as quests_logic.ts's complexIdsVisited -- reimplemented locally
// rather than imported since that helper isn't exported (each _logic module
// stays self-contained, same convention quests_logic.ts/stations_logic.ts
// already follow).
function complexIdsTouched(history: RiderHistory, complexLookup: ComplexLookup): Set<number> {
    const touched = new Set<number>();
    const addStop = (stopId: string) => {
        const cid = complexLookup[stopId];
        if (cid !== undefined) touched.add(cid);
    };
    for (const trip of history.trips) {
        addStop(trip.originStationId);
        addStop(trip.destinationStationId);
    }
    for (const leg of history.legs) {
        addStop(leg.entryStationId);
        addStop(leg.exitStationId);
    }
    return touched;
}

// Assumes every leg's routeId has ALREADY been folded through
// normalizeRouteIdForIcon by the caller (trivia.ts) -- this module has no
// alias table of its own, so a raw 6X/7X/FX leg would silently never match
// the 6/7/F line fact if history weren't pre-normalized.
function routesRidden(history: RiderHistory): Set<string> {
    return new Set(history.legs.map((l) => l.routeId));
}

// Diffs "touched/ridden before this trip" against "touched/ridden after" and
// returns only entities that are newly true -- a fact that was already
// unlocked before this trip never reappears, matching quests'
// computeTripQuestProgressPure "before vs after" shape. Every trivia fact is
// a lifetime first-touch unlock (no per-trip-only mechanism like quests'
// `per_trip` kind exists here), so a plain before/after diff over full
// history is sufficient -- no `thisTripLegs` parameter needed.
export function computeTripTriviaRevealsPure(
    trivia: TriviaFile,
    historyBefore: RiderHistory,
    historyAfter: RiderHistory,
    complexLookup: ComplexLookup
): TriviaReveal[] {
    const reveals: TriviaReveal[] = [];

    const touchedBefore = complexIdsTouched(historyBefore, complexLookup);
    const touchedAfter = complexIdsTouched(historyAfter, complexLookup);
    for (const [complexIdStr, entry] of Object.entries(trivia.stations)) {
        const complexId = Number(complexIdStr);
        if (!touchedBefore.has(complexId) && touchedAfter.has(complexId)) {
            reveals.push({ kind: 'station', complexId, fact: entry.fact });
        }
    }

    const riddenBefore = routesRidden(historyBefore);
    const riddenAfter = routesRidden(historyAfter);
    for (const [routeId, entry] of Object.entries(trivia.lines)) {
        if (!riddenBefore.has(routeId) && riddenAfter.has(routeId)) {
            reveals.push({ kind: 'line', routeId, fact: entry.fact });
        }
    }

    return reveals;
}

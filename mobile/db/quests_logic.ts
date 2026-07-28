// mobile/db/quests_logic.ts
//
// Pure quest-evaluation logic -- zero imports of expo-sqlite, RN, or anything
// that transitively pulls in RN/SVG source. Same reasoning as
// rehydrate-logic.ts's split: importing subwayData.ts directly would pull in
// lineIcons.tsx -> react-native-svg, the same "Flow-syntax RN source a plain
// Node run can't parse" problem expo-sqlite caused for rehydrate.ts.
// quests.ts (the I/O wrapper) queries SQLite and the bundled
// stations.json/quests.json/route_stops.json, then calls into this file with
// plain data -- never the reverse. Testable via plain tsx, no device needed
// (see quests_logic_tests.ts).

// ============================================================================
// Types mirroring the real trips/legs projection (see schema.sql)
// ============================================================================

export type Leg = {
    legId: string;
    tripId: string;
    sequence: number;
    routeId: string;
    entryStationId: string; // GTFS stop_id, e.g. "R01" -- NOT a complex_id
    exitStationId: string;  // same
};

export type Trip = {
    tripId: string;
    originStationId: string;      // GTFS stop_id
    destinationStationId: string; // GTFS stop_id
};

// A user's whole lifetime trip/leg history, already loaded -- this module
// never queries anything itself.
export type RiderHistory = {
    trips: Trip[];
    legs: Leg[]; // every leg across every trip, any order
};

// stop_id -> complex_id. Built by quests.ts from the bundled stations.json.
// REAL CORRECTNESS REQUIREMENT: legs/trips store stop_id, but every quest
// criteria below references complex_id (e.g. 611 for Times Sq) -- this
// translation must happen before any station-set membership check, or
// nothing will ever match. Same requirement documented in build_quests.py's
// module docstring for the dbt side.
export type ComplexLookup = Record<string, number>;

// ============================================================================
// Criteria shapes -- mirrors network/quests_source.json's schema exactly
// (see milestone-8-achievements.md's criteria schema tables)
// ============================================================================

export type LifetimeSetCriteria =
    | { type: 'all_stations'; stations: number[] }
    | { type: 'min_count_stations'; stations: number[]; count: number }
    | { type: 'all_groups'; groups: number[][] }
    | { type: 'min_count_groups'; groups: number[][]; count: number }
    | { type: 'all_station_route_pairs'; pairs: { station: number; route: string }[] }
    | { type: 'all_routes'; routes?: string[] };

export type PerTripCriteria =
    | { type: 'leg_count_min'; count: number }
    | { type: 'full_line_ride'; route: string } // 'any' or a real route_id
    | { type: 'route_letters_spell_word'; word: string }
    | { type: 'geographic_endpoints'; start: number; end: number };

export type CountingCriteria =
    | { type: 'ride_count_route'; route: string; count: number } // 'any' or a real route_id
    | { type: 'transfer_count'; count: number };

export type Quest = {
    title: string;
    description: string;
    mechanism: 'lifetime_set' | 'per_trip' | 'counting';
    criteria: LifetimeSetCriteria | PerTripCriteria | CountingCriteria;
    blocked?: boolean; // e.g. s_tier -- resolver already excludes these from quests.json,
    // but the type allows for it defensively
};

export type QuestsFile = Record<string, Quest>;

export type QuestProgress = {
    questId: string;
    completed: boolean;
    // Human-render-ready fraction where the criteria shape supports one
    // cleanly (min_count_*, all_*, counting quests). null for per_trip
    // quests, which the UI shows as a plain checklist/badge, not a fraction.
    current: number | null;
    target: number | null;
};

export type QuestDeltaResult = {
    questId: string;
    title: string;
    newlyCompleted: true; // this array only ever holds quests that newly flipped to complete
};

// ============================================================================
// Helpers
// ============================================================================

function complexIdsVisited(history: RiderHistory, complexLookup: ComplexLookup): Set<number> {
    const visited = new Set<number>();
    const addStop = (stopId: string) => {
        const cid = complexLookup[stopId];
        if (cid !== undefined) visited.add(cid);
    };
    for (const trip of history.trips) {
        addStop(trip.originStationId);
        addStop(trip.destinationStationId);
    }
    for (const leg of history.legs) {
        addStop(leg.entryStationId);
        addStop(leg.exitStationId);
    }
    return visited;
}

function routesRidden(history: RiderHistory): Set<string> {
    return new Set(history.legs.map((l) => l.routeId));
}

function stationRoutePairsRidden(history: RiderHistory, complexLookup: ComplexLookup): Set<string> {
    const pairs = new Set<string>();
    const addPair = (stopId: string, routeId: string) => {
        const cid = complexLookup[stopId];
        if (cid !== undefined) pairs.add(`${cid}:${routeId}`);
    };
    for (const leg of history.legs) {
        addPair(leg.entryStationId, leg.routeId);
        addPair(leg.exitStationId, leg.routeId);
    }
    return pairs;
}

function legsByTrip(legs: Leg[]): Map<string, Leg[]> {
    const byTrip = new Map<string, Leg[]>();
    for (const leg of legs) {
        if (!byTrip.has(leg.tripId)) byTrip.set(leg.tripId, []);
        byTrip.get(leg.tripId)!.push(leg);
    }
    return byTrip;
}

function transferCount(history: RiderHistory): number {
    // A transfer exists where one leg's exit matches the next leg's entry
    // station, same trip, consecutive sequence -- mirrors int_transfers'
    // LAG()-over-sequence logic (see dbt-coverage.md), computed locally.
    let count = 0;
    for (const legs of legsByTrip(history.legs).values()) {
        const ordered = [...legs].sort((a, b) => a.sequence - b.sequence);
        for (let i = 1; i < ordered.length; i++) {
            if (ordered[i - 1].exitStationId === ordered[i].entryStationId) count++;
        }
    }
    return count;
}

function ridesPerRoute(history: RiderHistory): Map<string, number> {
    const counts = new Map<string, number>();
    for (const leg of history.legs) {
        counts.set(leg.routeId, (counts.get(leg.routeId) ?? 0) + 1);
    }
    return counts;
}

// ============================================================================
// Mechanism 1: lifetime set-membership
// ============================================================================

/** allRealRoutes is required (not optional) here even though most criteria
 *  don't need it -- 'all_routes' with no explicit list (all_lines_rider)
 *  means "every real route, dynamically," and this module has no bundled
 *  data of its own to resolve that from. The wrapper always has the real
 *  route list on hand cheaply (route_stops.json's keys), so it's simplest to
 *  always pass it rather than making this module's signature conditional. */
export function evaluateLifetimeSet(
    criteria: LifetimeSetCriteria,
    history: RiderHistory,
    complexLookup: ComplexLookup,
    allRealRoutes: string[]
): { completed: boolean; current: number; target: number } {
    switch (criteria.type) {
        case 'all_stations': {
            const visited = complexIdsVisited(history, complexLookup);
            const have = criteria.stations.filter((cid) => visited.has(cid)).length;
            return { completed: have === criteria.stations.length, current: have, target: criteria.stations.length };
        }
        case 'min_count_stations': {
            const visited = complexIdsVisited(history, complexLookup);
            const have = criteria.stations.filter((cid) => visited.has(cid)).length;
            return { completed: have >= criteria.count, current: have, target: criteria.count };
        }
        case 'all_groups': {
            const visited = complexIdsVisited(history, complexLookup);
            const groupsHit = criteria.groups.filter((g) => g.some((cid) => visited.has(cid))).length;
            return { completed: groupsHit === criteria.groups.length, current: groupsHit, target: criteria.groups.length };
        }
        case 'min_count_groups': {
            const visited = complexIdsVisited(history, complexLookup);
            const groupsHit = criteria.groups.filter((g) => g.some((cid) => visited.has(cid))).length;
            return { completed: groupsHit >= criteria.count, current: groupsHit, target: criteria.count };
        }
        case 'all_station_route_pairs': {
            const pairsRidden = stationRoutePairsRidden(history, complexLookup);
            const have = criteria.pairs.filter((p) => pairsRidden.has(`${p.station}:${p.route}`)).length;
            return { completed: have === criteria.pairs.length, current: have, target: criteria.pairs.length };
        }
        case 'all_routes': {
            const ridden = routesRidden(history);
            const needed = criteria.routes ?? allRealRoutes;
            const have = needed.filter((r) => ridden.has(r)).length;
            return { completed: have === needed.length, current: have, target: needed.length };
        }
    }
}

// ============================================================================
// Mechanism 2: per-trip property check
// ============================================================================

export function evaluatePerTrip(
    criteria: PerTripCriteria,
    legs: Leg[], // this ONE trip's legs
    context: { complexLookup: ComplexLookup; fullRouteSpans: Record<string, string[]> }
): boolean {
    const ordered = [...legs].sort((a, b) => a.sequence - b.sequence);
    if (ordered.length === 0) return false;

    switch (criteria.type) {
        case 'leg_count_min':
            return ordered.length >= criteria.count;

        case 'full_line_ride': {
            const routeIds = criteria.route === 'any'
                ? [...new Set(ordered.map((l) => l.routeId))]
                : [criteria.route];
            return routeIds.some((routeId) => {
                const legsOnRoute = ordered.filter((l) => l.routeId === routeId);
                const fullSpan = context.fullRouteSpans[routeId];
                if (legsOnRoute.length === 0 || !fullSpan || fullSpan.length === 0) return false;
                const riddenStops = new Set<string>();
                for (const leg of legsOnRoute) {
                    riddenStops.add(leg.entryStationId);
                    riddenStops.add(leg.exitStationId);
                }
                // DOCUMENTED SIMPLIFICATION: checks station-SET coverage, not
                // strict end-to-end ordering. A branching route has no single
                // "full span" to walk in order (same reasoning as
                // build_quests.py's branch-tail computation) -- fullRouteSpans
                // is the union across all branches, so this can't distinguish
                // "rode one branch fully" from "hopped between branches and
                // happened to cover the same station set." Acceptable for v1;
                // revisit only if this proves gameable in practice.
                return fullSpan.every((stopId) => riddenStops.has(stopId));
            });
        }

        case 'route_letters_spell_word':
            return ordered.map((l) => l.routeId).join('') === criteria.word;

        case 'geographic_endpoints': {
            const firstEntry = ordered[0].entryStationId;
            const lastExit = ordered[ordered.length - 1].exitStationId;
            return context.complexLookup[firstEntry] === criteria.start
                && context.complexLookup[lastExit] === criteria.end;
        }
    }
}

// ============================================================================
// Mechanism 3: lifetime counting
// ============================================================================

export function evaluateCounting(
    criteria: CountingCriteria,
    history: RiderHistory
): { completed: boolean; current: number; target: number } {
    switch (criteria.type) {
        case 'ride_count_route': {
            const counts = ridesPerRoute(history);
            if (criteria.route === 'any') {
                const best = counts.size === 0 ? 0 : Math.max(...counts.values());
                return { completed: best >= criteria.count, current: best, target: criteria.count };
            }
            const have = counts.get(criteria.route) ?? 0;
            return { completed: have >= criteria.count, current: have, target: criteria.count };
        }
        case 'transfer_count': {
            const have = transferCount(history);
            return { completed: have >= criteria.count, current: have, target: criteria.count };
        }
    }
}

// ============================================================================
// Dispatch across all quests + trip-complete delta
// ============================================================================

export function getAllQuestProgressPure(
    quests: QuestsFile,
    history: RiderHistory,
    complexLookup: ComplexLookup,
    allRealRoutes: string[],
    fullRouteSpans: Record<string, string[]>
): QuestProgress[] {
    return Object.entries(quests).map(([questId, quest]) => {
        if (quest.mechanism === 'lifetime_set') {
            const r = evaluateLifetimeSet(quest.criteria as LifetimeSetCriteria, history, complexLookup, allRealRoutes);
            return { questId, ...r };
        }
        if (quest.mechanism === 'counting') {
            const r = evaluateCounting(quest.criteria as CountingCriteria, history);
            return { questId, ...r };
        }
        // per_trip: "completed" = at least one past trip satisfied it. No
        // fractional progress makes sense here -- either some trip did or none did.
        const completed = [...legsByTrip(history.legs).values()].some((tripLegs) =>
            evaluatePerTrip(quest.criteria as PerTripCriteria, tripLegs, { complexLookup, fullRouteSpans })
        );
        return { questId, completed, current: null, target: null };
    });
}

/** Which quests did THIS specific trip newly complete. historyBefore must
 *  exclude the trip in question; historyAfter must include it; thisTripLegs
 *  is that trip's legs alone (for per_trip checks, which have no meaningful
 *  "before" state -- they're satisfied per-trip, not cumulatively; a quest
 *  counts as newly-completed-by-this-trip if THIS trip satisfies it, whether
 *  or not some earlier trip also happened to). */
export function computeTripQuestDeltaPure(
    quests: QuestsFile,
    historyBefore: RiderHistory,
    historyAfter: RiderHistory,
    thisTripLegs: Leg[],
    complexLookup: ComplexLookup,
    allRealRoutes: string[],
    fullRouteSpans: Record<string, string[]>
): QuestDeltaResult[] {
    const results: QuestDeltaResult[] = [];
    for (const [questId, quest] of Object.entries(quests)) {
        let completedBefore = false;
        let completedAfter = false;

        if (quest.mechanism === 'lifetime_set') {
            completedBefore = evaluateLifetimeSet(quest.criteria as LifetimeSetCriteria, historyBefore, complexLookup, allRealRoutes).completed;
            completedAfter = evaluateLifetimeSet(quest.criteria as LifetimeSetCriteria, historyAfter, complexLookup, allRealRoutes).completed;
        } else if (quest.mechanism === 'counting') {
            completedBefore = evaluateCounting(quest.criteria as CountingCriteria, historyBefore).completed;
            completedAfter = evaluateCounting(quest.criteria as CountingCriteria, historyAfter).completed;
        } else {
            completedAfter = evaluatePerTrip(quest.criteria as PerTripCriteria, thisTripLegs, { complexLookup, fullRouteSpans });
        }

        if (!completedBefore && completedAfter) {
            results.push({ questId, title: quest.title, newlyCompleted: true });
        }
    }
    return results;
}
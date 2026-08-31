// mobile/db/insights_logic.ts
//
// Pure insight-fact computation -- zero imports of expo-sqlite, RN, or
// anything that transitively pulls in RN/SVG source. Same split as
// quests_logic.ts/trivia_logic.ts: insights.ts (the I/O wrapper) queries
// SQLite and bundled JSON, then calls into this file with plain data --
// never the reverse. Testable via plain tsx, no device needed (see
// insights_logic_tests.ts).
//
// Deliberately NOT tied to any quest -- these are general analytical facts
// about a trip (how many times you've ridden this exact route before, a
// milestone unique-station count, etc.), computed the same "diff full
// history with the trip in vs. filtered out" way quests/trivia already do.
// Each fact is a plain tagged-union value with a `priority` (see
// milestoneRank below) and nothing about display text -- rendering is a
// template lookup in trip.tsx, entirely separate, so a future narration
// layer (e.g. LLM-generated phrasing) can consume the same facts without
// this module changing at all.

import type { ComplexLookup, Leg, RiderHistory } from './quests_logic';
import { ridesPerRoute, tripSignaturesByTrip } from './quests_logic';
import { getVisitedStationIdsPure } from './stations_logic';

export type InsightFact =
    | { type: 'nth_trip_overall'; n: number; priority: number }
    | { type: 'unique_trip_pattern'; n: number; priority: number }
    | { type: 'trip_repeat_count'; count: number; priority: number }
    | { type: 'nth_unique_station'; n: number; stopId: string; routeId: string; priority: number }
    | { type: 'new_line_ridden'; routeId: string; priority: number }
    | { type: 'route_ride_count'; routeId: string; count: number; priority: number }; // count is always > 1 -- see new_line_ridden for the first-ever ride

/** A "discovery" -- a brand new station or line, the two things this app is
 *  fundamentally about finding. Always shown in full when present, never
 *  subject to selectInsightsForDisplay's ranking/cap -- unlike everything
 *  else in InsightFact, these aren't competing for a limited slot, they're
 *  their own always-visible section (see trip.tsx). */
export function isDiscoveryFact(fact: InsightFact): boolean {
    return fact.type === 'nth_unique_station' || fact.type === 'new_line_ridden';
}

/** Shared "how notable is this number" scale, used both to sort facts and to
 *  decide (via selectInsightsForDisplay) which ones clear the bar for
 *  display. Round numbers and firsts read as milestones; everything else is
 *  a flat low baseline so it still sorts below any milestone but never
 *  disappears outright (selectInsightsForDisplay's "nothing else on the
 *  page" branch still wants access to it). */
export function milestoneRank(n: number): number {
    if (n === 1) return 100;
    if (n % 100 === 0) return 90;
    if (n % 50 === 0) return 80;
    if (n % 25 === 0) return 70;
    if (n % 10 === 0) return 60;
    return 20;
}

/** A brand-new trip PATTERN (the whole station sequence, not any single
 *  station or line -- those are discoveries, see isDiscoveryFact) is common
 *  and expected early in an account's history -- exploring new routes IS
 *  what the first few weeks of using this app look like. Scoring every one
 *  of them at max priority made early trip history feel repetitive: nearly
 *  every early trip has *some* new pattern, so it always won the priority
 *  contest over everything else competing for the single "other insight"
 *  slot (see selectInsightsForDisplay). Scaling by how much history already
 *  existed before this trip fixes that -- a new pattern is unremarkable on
 *  trip #4, but genuinely noteworthy if it's still happening after an
 *  established history. */
function firstEverPriority(priorTripCount: number): number {
    if (priorTripCount < 10) return 35;
    if (priorTripCount < 50) return 65;
    return 95;
}

// Trip ids in the order the rider actually took them (by started_at, tripId
// as a deterministic tiebreak for equal timestamps -- e.g. bulk-imported
// history). tripDates only needs to cover historyAfter's trips.
function chronologicalTripOrder(history: RiderHistory, tripDates: Record<string, string>): string[] {
    return [...history.trips]
        .sort((a, b) => {
            const byDate = (tripDates[a.tripId] ?? '').localeCompare(tripDates[b.tripId] ?? '');
            return byDate !== 0 ? byDate : a.tripId.localeCompare(b.tripId);
        })
        .map((t) => t.tripId);
}

// Walks trips in chronological order, assigning each distinct signature a
// rank the first time it's ever seen ("this is the Nth unique trip you've
// ridden") -- every later trip sharing that signature gets the same rank but
// isFirst=false, marking it as a repeat rather than a new pattern.
function rankTripPatterns(
    order: string[],
    sigByTrip: Map<string, string>
): { rankByTripId: Map<string, number>; isFirstByTripId: Map<string, boolean> } {
    const rankOfSignature = new Map<string, number>();
    const rankByTripId = new Map<string, number>();
    const isFirstByTripId = new Map<string, boolean>();
    let nextRank = 0;
    for (const tripId of order) {
        const sig = sigByTrip.get(tripId);
        if (sig === undefined) continue;
        let rank = rankOfSignature.get(sig);
        if (rank === undefined) {
            nextRank++;
            rank = nextRank;
            rankOfSignature.set(sig, rank);
            isFirstByTripId.set(tripId, true);
        } else {
            isFirstByTripId.set(tripId, false);
        }
        rankByTripId.set(tripId, rank);
    }
    return { rankByTripId, isFirstByTripId };
}

// This trip's touched stop_ids in ride order (first leg's entry, then every
// leg's exit) -- same ordering rule as quests_logic.ts's tripSignature(),
// deduped so a station touched twice in one trip (e.g. a transfer back
// through the same complex) only ever contributes one nth_unique_station fact.
function orderedTouchedStops(thisTripLegs: Leg[]): { stopId: string; routeId: string }[] {
    const ordered = [...thisTripLegs].sort((a, b) => a.sequence - b.sequence);
    const seen = new Set<string>();
    const stops: { stopId: string; routeId: string }[] = [];
    const push = (stopId: string, routeId: string) => {
        if (!seen.has(stopId)) {
            seen.add(stopId);
            stops.push({ stopId, routeId });
        }
    };
    for (const leg of ordered) {
        push(leg.entryStationId, leg.routeId);
        push(leg.exitStationId, leg.routeId);
    }
    return stops;
}

/** Every insight fact this trip produces, unfiltered and unranked-for-display
 *  (sorted by priority only) -- selectInsightsForDisplay is the separate step
 *  that decides how many of these are actually worth showing. Mirrors
 *  computeTripQuestProgressPure's before/after diff shape: historyAfter is
 *  the full history with this trip already in it, historyBefore is the same
 *  history with tripId filtered back out, thisTripLegs is just this trip's
 *  own legs. tripDates (tripId -> started_at) must cover every trip in
 *  historyAfter, not just this one -- needed to place this trip in
 *  chronological order among all the rider's trips. */
export function computeTripInsightsPure(
    historyBefore: RiderHistory,
    historyAfter: RiderHistory,
    thisTripLegs: Leg[],
    tripId: string,
    tripDates: Record<string, string>,
    complexLookup: ComplexLookup
): InsightFact[] {
    const facts: InsightFact[] = [];

    // ---- nth_trip_overall ----
    const order = chronologicalTripOrder(historyAfter, tripDates);
    const overallIndex = order.indexOf(tripId);
    if (overallIndex !== -1) {
        const n = overallIndex + 1;
        facts.push({ type: 'nth_trip_overall', n, priority: milestoneRank(n) });
    }

    // ---- unique_trip_pattern / trip_repeat_count (mutually exclusive) ----
    const sigByTrip = tripSignaturesByTrip(historyAfter, complexLookup);
    const thisSig = sigByTrip.get(tripId);
    if (thisSig !== undefined) {
        const { rankByTripId, isFirstByTripId } = rankTripPatterns(order, sigByTrip);
        if (isFirstByTripId.get(tripId)) {
            const n = rankByTripId.get(tripId)!;
            facts.push({ type: 'unique_trip_pattern', n, priority: Math.max(milestoneRank(n), firstEverPriority(historyBefore.trips.length)) });
        } else {
            const count = [...sigByTrip.values()].filter((sig) => sig === thisSig).length;
            facts.push({ type: 'trip_repeat_count', count, priority: milestoneRank(count) });
        }
    }

    // ---- nth_unique_station, one per station this trip visited for the first time ----
    const visited = getVisitedStationIdsPure(historyBefore); // mutated below to dedup within this trip
    let stationCount = visited.size;
    for (const { stopId, routeId } of orderedTouchedStops(thisTripLegs)) {
        if (!visited.has(stopId)) {
            visited.add(stopId);
            stationCount++;
            facts.push({ type: 'nth_unique_station', n: stationCount, stopId, routeId, priority: milestoneRank(stationCount) });
        }
    }

    // ---- new_line_ridden (discovery) / route_ride_count (mutually exclusive
    // per route, same first-vs-repeat split as unique_trip_pattern/trip_repeat_count) ----
    const ridesAfter = ridesPerRoute(historyAfter);
    const seenRoutes = new Set<string>();
    for (const leg of [...thisTripLegs].sort((a, b) => a.sequence - b.sequence)) {
        if (seenRoutes.has(leg.routeId)) continue;
        seenRoutes.add(leg.routeId);
        const count = ridesAfter.get(leg.routeId) ?? 0;
        if (count === 1) {
            facts.push({ type: 'new_line_ridden', routeId: leg.routeId, priority: 100 });
        } else {
            facts.push({ type: 'route_ride_count', routeId: leg.routeId, count, priority: milestoneRank(count) });
        }
    }

    return facts.sort((a, b) => b.priority - a.priority);
}

// Round multiples of 10+, or a first-ever -- see milestoneRank.
const NOTABLE_THRESHOLD = 60;
const MAX_ROUTINE_INSIGHTS = 3;

/** Decides which of the NON-discovery facts (nth_trip_overall,
 *  unique_trip_pattern, trip_repeat_count, route_ride_count -- never
 *  nth_unique_station/new_line_ridden, see isDiscoveryFact) are actually
 *  worth showing, given whether the Trip Summary page already has other
 *  content (Quest progress or a trivia reveal) and whether this trip itself
 *  produced any discoveries. Kept separate from computeTripInsightsPure
 *  (always returns every fact, unfiltered) and from rendering (per-type text
 *  templates) -- a clean compute -> select -> render split.
 *
 *  When the page already has other content, only add one fact, and only if
 *  it clears a real notability bar -- don't pile on.
 *
 *  A repeat of a trip the rider has taken before is the one exception to
 *  that cap: it's ALWAYS included whenever this trip has no discoveries
 *  (hasDiscoveries=false), regardless of priority rank or whether Quest
 *  progress/trivia are already showing -- "you've done this exact trip N
 *  times" is exactly the piece of information a trip with no new
 *  stations/lines should surface every time, not something that can lose out
 *  to an unrelated quest tick or to other route_ride_count milestones on a
 *  multi-leg trip. When there's no other content AND no discoveries, the cap
 *  relaxes further (up to MAX_ROUTINE_INSIGHTS, backfilled by priority) so a
 *  plain repeat commute isn't reduced to a single line -- this is what
 *  guarantees the section is never empty on a routine trip, the whole point
 *  of encouraging every trip to get logged, even the boring ones.
 *
 *  Generic over T (rather than fixed to InsightFact) so it also works on
 *  EnrichedInsightFact[] (insights.ts's I/O-layer type, which adds
 *  stationName to nth_unique_station) without narrowing back to the bare
 *  pure-layer shape. */
export function selectInsightsForDisplay<T extends { type: string; priority: number }>(
    facts: T[],
    hasOtherContent: boolean,
    hasDiscoveries: boolean
): T[] {
    const sorted = [...facts].sort((a, b) => b.priority - a.priority);
    const repeat = sorted.find((f) => f.type === 'trip_repeat_count');

    if (hasOtherContent) {
        const notable = sorted.filter((f) => f.priority >= NOTABLE_THRESHOLD).slice(0, 1);
        if (repeat && !hasDiscoveries && !notable.includes(repeat)) return [...notable, repeat];
        return notable;
    }

    // hasOtherContent is false, which (per trip.tsx's hasOtherContent
    // computation) already implies hasDiscoveries is false too -- the
    // guarantee below always applies here.
    if (!repeat) return sorted.slice(0, MAX_ROUTINE_INSIGHTS);
    const rest = sorted.filter((f) => f !== repeat).slice(0, MAX_ROUTINE_INSIGHTS - 1);
    return [repeat, ...rest].sort((a, b) => b.priority - a.priority);
}

// mobile/db/insights_logic_tests.ts
//
// Required test, same standard as quests_logic_tests.ts / rehydrate_tests.ts
// -- confirmed directly, not assumed. Runs via plain tsx/node, no device
// needed (see insights_logic.ts's header for why this module has zero RN
// imports). Run: npx tsx mobile/db/insights_logic_tests.ts

import type { Leg, RiderHistory, Trip } from './quests_logic';
import { computeTripInsightsPure, isDiscoveryFact, milestoneRank, selectInsightsForDisplay, type InsightFact } from './insights_logic';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
    if (condition) {
        passed++;
    } else {
        failed++;
        console.error(`  FAIL: ${name}`);
    }
}

// ---- fixtures ----

const complexLookup: Record<string, number> = { S1: 1, S2: 2, S3: 3, S4: 4 };

function leg(tripId: string, sequence: number, routeId: string, entry: string, exit: string): Leg {
    return { legId: `${tripId}-${sequence}`, tripId, sequence, routeId, entryStationId: entry, exitStationId: exit };
}

function trip(tripId: string, origin: string, dest: string): Trip {
    return { tripId, originStationId: origin, destinationStationId: dest };
}

function find<T extends InsightFact['type']>(facts: InsightFact[], type: T): Extract<InsightFact, { type: T }> | undefined {
    return facts.find((f) => f.type === type) as Extract<InsightFact, { type: T }> | undefined;
}

// ---- milestoneRank ----

check('milestoneRank: 1 is a first-ever, ranks highest', milestoneRank(1) === 100);
check('milestoneRank: 100 ranks above 50', milestoneRank(100) > milestoneRank(50));
check('milestoneRank: 50 ranks above 25', milestoneRank(50) > milestoneRank(25));
check('milestoneRank: 25 ranks above 10', milestoneRank(25) > milestoneRank(10));
check('milestoneRank: 10 ranks above a non-round number', milestoneRank(10) > milestoneRank(47));
check('milestoneRank: non-round numbers all share the same low baseline', milestoneRank(23) === milestoneRank(47));

// ---- nth_trip_overall: chronological rank, independent of logging order ----

{
    const trips = [trip('t1', 'S1', 'S2'), trip('t2', 'S1', 'S2'), trip('t3', 'S1', 'S2')];
    const legs = [leg('t1', 1, 'A', 'S1', 'S2'), leg('t2', 1, 'A', 'S1', 'S2'), leg('t3', 1, 'A', 'S1', 'S2')];
    const historyAfter: RiderHistory = { trips, legs };
    // t3's real date falls between t1 and t2 -- chronological order is t1, t3, t2.
    const tripDates = { t1: '2024-01-01', t2: '2024-01-05', t3: '2024-01-03' };
    const historyBefore: RiderHistory = {
        trips: trips.filter((t) => t.tripId !== 't3'),
        legs: legs.filter((l) => l.tripId !== 't3'),
    };
    const facts = computeTripInsightsPure(historyBefore, historyAfter, [leg('t3', 1, 'A', 'S1', 'S2')], 't3', tripDates, complexLookup);
    const f = find(facts, 'nth_trip_overall');
    check('nth_trip_overall: ranks by started_at, not by trip_id/logging order', f?.n === 2);
}

// ---- unique_trip_pattern: first occurrence of a signature ----

{
    const t1 = trip('t1', 'S1', 'S2');
    const legs = [leg('t1', 1, 'A', 'S1', 'S2')];
    const historyAfter: RiderHistory = { trips: [t1], legs };
    const historyBefore: RiderHistory = { trips: [], legs: [] };
    const tripDates = { t1: '2024-01-01' };
    const facts = computeTripInsightsPure(historyBefore, historyAfter, legs, 't1', tripDates, complexLookup);
    check('unique_trip_pattern: a rider\'s very first trip is a new pattern, rank 1', find(facts, 'unique_trip_pattern')?.n === 1);
    check('unique_trip_pattern: no trip_repeat_count fires alongside it', find(facts, 'trip_repeat_count') === undefined);
    check('unique_trip_pattern: the very first trip ever is always maximally notable', (find(facts, 'unique_trip_pattern')?.priority ?? 0) === 100);
}

// ---- firstEverPriority: a "first ever" fact is scored relative to how much
// history already existed, not flatly maximal -- see insights_logic.ts's doc
// comment on firstEverPriority for why (repeatedly seeing "new route!" on
// every early trip isn't actually novel; the same fact after an established
// history genuinely is). ----

{
    // Wider lookup than the module fixture's complexLookup -- this block
    // needs many distinct station pairs to construct many distinct trip
    // signatures, unlike the other blocks' single S1-S4 loop.
    const wideComplexLookup: Record<string, number> = { ...complexLookup };
    for (let i = 5; i < 200; i++) wideComplexLookup[`S${i}`] = i;

    const early = trip('t1', 'S1', 'S2');
    const earlyLegs = [leg('t1', 3, 'A', 'S3', 'S4')]; // a 3rd-rank pattern -- not round, so milestoneRank alone would score it low
    const priorTrips: Trip[] = [trip('p1', 'S5', 'S6'), trip('p2', 'S7', 'S8')]; // 2 prior trips, distinct signatures
    const priorLegs: Leg[] = [leg('p1', 1, 'A', 'S5', 'S6'), leg('p2', 1, 'A', 'S7', 'S8')];
    const historyAfterEarly: RiderHistory = { trips: [...priorTrips, early], legs: [...priorLegs, ...earlyLegs] };
    const historyBeforeEarly: RiderHistory = { trips: priorTrips, legs: priorLegs };
    const tripDatesEarly = { p1: '2024-01-01', p2: '2024-01-02', t1: '2024-01-03' };
    const earlyFacts = computeTripInsightsPure(historyBeforeEarly, historyAfterEarly, earlyLegs, 't1', tripDatesEarly, wideComplexLookup);
    const earlyPattern = find(earlyFacts, 'unique_trip_pattern');
    check('firstEverPriority: a non-round new-pattern rank early in history is scored low, not maximal', earlyPattern?.n === 3 && earlyPattern?.priority === 35);

    // Same shape, but with 50 prior trips (each a distinct signature) -- an
    // established rider still finding a new pattern is genuinely notable,
    // so it should score high even though its rank (51st) is just as
    // non-round as the 3rd was above.
    const manyPriorTrips: Trip[] = [];
    const manyPriorLegs: Leg[] = [];
    const manyTripDates: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
        const tid = `established-${i}`;
        manyPriorTrips.push(trip(tid, 'S5', `S${i + 100}`));
        manyPriorLegs.push(leg(tid, 1, 'A', 'S5', `S${i + 100}`)); // distinct signature per trip
        manyTripDates[tid] = `2024-01-01`; // exact date doesn't matter, only that all 50 precede t1
    }
    const historyAfterEstablished: RiderHistory = { trips: [...manyPriorTrips, early], legs: [...manyPriorLegs, ...earlyLegs] };
    const historyBeforeEstablished: RiderHistory = { trips: manyPriorTrips, legs: manyPriorLegs };
    const establishedFacts = computeTripInsightsPure(
        historyBeforeEstablished, historyAfterEstablished, earlyLegs, 't1',
        { ...manyTripDates, t1: '2024-02-01' }, wideComplexLookup
    );
    const establishedPattern = find(establishedFacts, 'unique_trip_pattern');
    check('firstEverPriority: the same kind of first after an established history scores high', establishedPattern?.n === 51 && establishedPattern?.priority === 95);
}

// ---- trip_repeat_count: a later trip with the same signature ----

{
    const t1 = trip('t1', 'S1', 'S2');
    const t2 = trip('t2', 'S1', 'S2');
    const legs = [leg('t1', 1, 'A', 'S1', 'S2'), leg('t2', 1, 'A', 'S1', 'S2')];
    const historyAfter: RiderHistory = { trips: [t1, t2], legs };
    const tripDates = { t1: '2024-01-01', t2: '2024-01-02' };

    const historyBeforeT2: RiderHistory = { trips: [t1], legs: legs.filter((l) => l.tripId === 't1') };
    const factsT2 = computeTripInsightsPure(historyBeforeT2, historyAfter, [leg('t2', 1, 'A', 'S1', 'S2')], 't2', tripDates, complexLookup);
    check('trip_repeat_count: repeating an earlier trip pattern counts both occurrences', find(factsT2, 'trip_repeat_count')?.count === 2);
    check('trip_repeat_count: no unique_trip_pattern fires for the repeat', find(factsT2, 'unique_trip_pattern') === undefined);

    const historyBeforeT1: RiderHistory = { trips: [t2], legs: legs.filter((l) => l.tripId === 't2') };
    const factsT1 = computeTripInsightsPure(historyBeforeT1, historyAfter, [leg('t1', 1, 'A', 'S1', 'S2')], 't1', tripDates, complexLookup);
    check('unique_trip_pattern: the chronologically-first occurrence gets the new-pattern fact, not the repeat', find(factsT1, 'unique_trip_pattern')?.n === 1);
}

// ---- nth_unique_station: one fact per newly-visited station, in ride order ----

{
    const other = trip('tOther', 'S1', 'S2');
    const target = trip('t1', 'S1', 'S4');
    const otherLegs = [leg('tOther', 1, 'X', 'S1', 'S2')]; // visited before: S1, S2
    const targetLegs = [leg('t1', 1, 'Y', 'S1', 'S3'), leg('t1', 2, 'Z', 'S3', 'S4')]; // S1 seen, S3 new, S4 new
    const historyAfter: RiderHistory = { trips: [other, target], legs: [...otherLegs, ...targetLegs] };
    const historyBefore: RiderHistory = { trips: [other], legs: otherLegs };
    const tripDates = { tOther: '2024-01-01', t1: '2024-01-02' };

    const facts = computeTripInsightsPure(historyBefore, historyAfter, targetLegs, 't1', tripDates, complexLookup);
    const stationFacts = facts.filter((f): f is Extract<InsightFact, { type: 'nth_unique_station' }> => f.type === 'nth_unique_station');
    check('nth_unique_station: only genuinely new stations produce a fact (S1 already visited excluded)', stationFacts.length === 2);
    check('nth_unique_station: ranks continue from the prior visited count (2 before this trip)', stationFacts[0]?.n === 3 && stationFacts[0]?.stopId === 'S3');
    check('nth_unique_station: second new station in the same trip continues the count', stationFacts[1]?.n === 4 && stationFacts[1]?.stopId === 'S4');
}

// ---- new_line_ridden (discovery) / route_ride_count (repeat): mutually exclusive per route ----

{
    const target = trip('t1', 'S1', 'S2');
    const fillerLegs: Leg[] = [];
    for (let i = 0; i < 9; i++) fillerLegs.push(leg('tFiller', i + 1, 'A', 'S1', 'S2'));
    const targetLegs = [leg('t1', 1, 'A', 'S1', 'S2'), leg('t1', 2, 'B', 'S2', 'S1')];
    const historyAfter: RiderHistory = { trips: [trip('tFiller', 'S1', 'S2'), target], legs: [...fillerLegs, ...targetLegs] };
    const historyBefore: RiderHistory = { trips: [trip('tFiller', 'S1', 'S2')], legs: fillerLegs };
    const tripDates = { tFiller: '2024-01-01', t1: '2024-01-02' };

    const facts = computeTripInsightsPure(historyBefore, historyAfter, targetLegs, 't1', tripDates, complexLookup);
    const routeA = find(facts, 'route_ride_count');
    const routeB = find(facts, 'new_line_ridden');
    check('route_ride_count: A hits a round milestone (9 prior + this trip = 10)', routeA?.routeId === 'A' && routeA?.count === 10);
    check('new_line_ridden: B is a first-ever ride, gets its own discovery fact instead of route_ride_count', routeB?.routeId === 'B');
    check('new_line_ridden: no route_ride_count fires alongside it for the same route', find(facts, 'route_ride_count')?.routeId !== 'B');
    check('isDiscoveryFact: new_line_ridden counts as a discovery, route_ride_count does not', isDiscoveryFact(routeB!) && !isDiscoveryFact(routeA!));
}

// ---- isDiscoveryFact ----

check('isDiscoveryFact: nth_unique_station is a discovery', isDiscoveryFact({ type: 'nth_unique_station', n: 1, stopId: 'S1', routeId: 'A', priority: 100 }));
check('isDiscoveryFact: new_line_ridden is a discovery', isDiscoveryFact({ type: 'new_line_ridden', routeId: 'A', priority: 100 }));
check('isDiscoveryFact: trip_repeat_count is not a discovery', !isDiscoveryFact({ type: 'trip_repeat_count', count: 5, priority: 20 }));
check('isDiscoveryFact: nth_trip_overall is not a discovery', !isDiscoveryFact({ type: 'nth_trip_overall', n: 5, priority: 20 }));

// ---- selectInsightsForDisplay: the "sweet spot" adaptive cap ----
// NOTE: discoveries (nth_unique_station/new_line_ridden) never reach this
// function in real usage -- trip.tsx filters them out into their own
// always-shown bucket first (see isDiscoveryFact above). These fixtures
// intentionally only use non-discovery fact types.

{
    const facts: InsightFact[] = [
        { type: 'nth_trip_overall', n: 47, priority: milestoneRank(47) }, // 20, not notable
        { type: 'route_ride_count', routeId: 'A', count: 100, priority: milestoneRank(100) }, // 90, notable
        { type: 'route_ride_count', routeId: 'B', count: 23, priority: milestoneRank(23) }, // 20, not notable
    ]; // no trip_repeat_count in this fixture -- that guarantee is covered separately below

    const withOtherContent = selectInsightsForDisplay(facts, true, false);
    check('selectInsightsForDisplay: with other content, caps to 1 and only the notable one', withOtherContent.length === 1 && withOtherContent[0].priority === 90);

    const withoutOtherContent = selectInsightsForDisplay(facts, false, false);
    check('selectInsightsForDisplay: with no other content, shows up to 3 regardless of notability', withoutOtherContent.length === 3);
    check('selectInsightsForDisplay: still sorted by priority descending', withoutOtherContent[0].priority === 90);

    const allRoutine: InsightFact[] = [
        { type: 'nth_trip_overall', n: 47, priority: milestoneRank(47) },
        { type: 'route_ride_count', routeId: 'A', count: 23, priority: milestoneRank(23) },
    ];
    check('selectInsightsForDisplay: with other content, none notable -> shows nothing', selectInsightsForDisplay(allRoutine, true, false).length === 0);
    check('selectInsightsForDisplay: with no other content, never empty even if nothing is round', selectInsightsForDisplay(allRoutine, false, false).length === 2);
}

// ---- selectInsightsForDisplay: trip_repeat_count is a guaranteed floor
// whenever this trip had no discoveries, not just another entry competing
// for a priority slot -- and that guarantee holds even when Quest
// progress/trivia are already showing, as long as there's no discovery. ----

{
    const facts: InsightFact[] = [
        { type: 'nth_trip_overall', n: 100, priority: milestoneRank(100) }, // 90
        { type: 'route_ride_count', routeId: 'A', count: 50, priority: milestoneRank(50) }, // 80
        { type: 'route_ride_count', routeId: 'B', count: 25, priority: milestoneRank(25) }, // 70
        { type: 'trip_repeat_count', count: 23, priority: milestoneRank(23) }, // 20 -- would lose a naive top-3-by-priority cut
    ];

    const routine = selectInsightsForDisplay(facts, false, false);
    check(
        'selectInsightsForDisplay: a repeat trip always includes trip_repeat_count, even outranked by 3+ other facts',
        routine.length === 3 && routine.some((f) => f.type === 'trip_repeat_count')
    );
    check(
        'selectInsightsForDisplay: the guaranteed slot displaces the lowest-priority competitor (route B), not a higher one',
        routine.some((f) => f.type === 'nth_trip_overall') && routine.some((f) => f.type === 'route_ride_count' && f.routeId === 'A')
            && !routine.some((f) => f.type === 'route_ride_count' && f.routeId === 'B')
    );

    const withOtherContentNoDiscovery = selectInsightsForDisplay(facts, true, false);
    check(
        'selectInsightsForDisplay: with other content but no discovery, trip_repeat_count is still guaranteed, added alongside the one notable fact',
        withOtherContentNoDiscovery.some((f) => f.type === 'trip_repeat_count')
            && withOtherContentNoDiscovery.some((f) => f.type === 'nth_trip_overall')
            && withOtherContentNoDiscovery.length === 2
    );

    const withDiscovery = selectInsightsForDisplay(facts, true, true);
    check(
        'selectInsightsForDisplay: with a discovery this trip, the guarantee is off -- trip_repeat_count can lose out like anything else',
        !withDiscovery.some((f) => f.type === 'trip_repeat_count') && withDiscovery.length === 1
    );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

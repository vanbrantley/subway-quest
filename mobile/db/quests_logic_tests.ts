// mobile/db/quests_logic_tests.ts
//
// Required test, same standard as rehydrate_tests.ts / schema_tests.py --
// confirmed directly, not assumed. Runs via plain tsx/node, no device needed
// (see quests_logic.ts's header for why this module has zero RN imports).

import {
    Leg, Trip, RiderHistory, QuestsFile,
    evaluateLifetimeSet, evaluatePerTrip, evaluateCounting,
    getAllQuestProgressPure, computeTripQuestProgressPure, getQuestBreakdown, questIdsForStation,
} from './quests_logic';

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

// Complex 611 = Times Sq (multiple stop_ids), 222 = Roosevelt Island, 143 = Inwood-207 St
const complexLookup: Record<string, number> = {
    R16: 611, A27: 611, '127': 611, '902': 611,
    B06: 222,
    A02: 143,
    A03: 144, // Dyckman St
};

function leg(tripId: string, sequence: number, routeId: string, entry: string, exit: string): Leg {
    return { legId: `${tripId}-${sequence}`, tripId, sequence, routeId, entryStationId: entry, exitStationId: exit };
}

function trip(tripId: string, origin: string, dest: string): Trip {
    return { tripId, originStationId: origin, destinationStationId: dest };
}

// ---- Mechanism 1: lifetime set-membership ----

{
    const history: RiderHistory = {
        trips: [trip('t1', 'R16', 'B06')],
        legs: [leg('t1', 1, 'N', 'R16', 'B06')],
    };
    const r = evaluateLifetimeSet({ type: 'all_stations', stations: [611, 222] }, history, complexLookup, []);
    check('all_stations: both visited via trip origin/dest -> completed', r.completed === true && r.current === 2);
}

{
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'N', 'R16', 'A02')] };
    const r = evaluateLifetimeSet({ type: 'min_count_stations', stations: [611, 222, 143], count: 2 }, history, complexLookup, []);
    check('min_count_stations: 2 of 3 visited (611, 143), threshold 2 -> completed', r.completed === true && r.current === 2);
}

{
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'N', 'R16', 'A02')] };
    const r = evaluateLifetimeSet({ type: 'all_groups', groups: [[611, 222], [143, 144]] }, history, complexLookup, []);
    check('all_groups: one station touched per group -> completed', r.completed === true && r.current === 2);
}

{
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'N', 'R16', 'R16')] };
    const r = evaluateLifetimeSet({ type: 'all_groups', groups: [[611, 222], [143, 144]] }, history, complexLookup, []);
    check('all_groups: only 1 of 2 groups touched -> not completed', r.completed === false && r.current === 1);
}

{
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'GS', 'R16', 'R16')] };
    const r = evaluateLifetimeSet(
        { type: 'all_station_route_pairs', pairs: [{ station: 611, route: 'GS' }, { station: 611, route: 'N' }] },
        history, complexLookup, []
    );
    check('all_station_route_pairs: 1 of 2 real pairs ridden -> not completed', r.completed === false && r.current === 1);
}

{
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'A', 'A02', 'A02'), leg('t1', 2, 'N', 'R16', 'R16')] };
    const r = evaluateLifetimeSet({ type: 'all_routes' }, history, complexLookup, ['A', 'N', 'Q']);
    check('all_routes (dynamic, no explicit list): 2 of 3 real routes ridden -> not completed', r.completed === false && r.current === 2 && r.target === 3);
}

// ---- Mechanism 2: per-trip property check ----

{
    const legs = [leg('t1', 1, 'A', 'x', 'y'), leg('t1', 2, 'N', 'y', 'z')];
    check('leg_count_min: 2 legs, threshold 2 -> true', evaluatePerTrip({ type: 'leg_count_min', count: 2 }, legs, { complexLookup, fullRouteSpans: {} }) === true);
    check('leg_count_min: 2 legs, threshold 3 -> false', evaluatePerTrip({ type: 'leg_count_min', count: 3 }, legs, { complexLookup, fullRouteSpans: {} }) === false);
}

{
    const fullRouteSpans = { A: ['s1', 's2', 's3'] };
    const legsFullyRidden = [leg('t1', 1, 'A', 's1', 's2'), leg('t1', 2, 'A', 's2', 's3')];
    const legsPartial = [leg('t1', 1, 'A', 's1', 's2')];
    check('full_line_ride: entire span covered -> true',
        evaluatePerTrip({ type: 'full_line_ride', route: 'A' }, legsFullyRidden, { complexLookup, fullRouteSpans }) === true);
    check('full_line_ride: partial span -> false',
        evaluatePerTrip({ type: 'full_line_ride', route: 'A' }, legsPartial, { complexLookup, fullRouteSpans }) === false);
    check('full_line_ride: route "any" matches if any one ridden route is fully covered',
        evaluatePerTrip({ type: 'full_line_ride', route: 'any' }, legsFullyRidden, { complexLookup, fullRouteSpans }) === true);
}

{
    const words = ['JAM', 'CAB', 'BAG'];
    const legs = [leg('t1', 1, 'J', 'x', 'y'), leg('t1', 2, 'A', 'y', 'z'), leg('t1', 3, 'M', 'z', 'w')];
    check('route_letters_spell_word: J-A-M in order, "JAM" in word list -> true',
        evaluatePerTrip({ type: 'route_letters_spell_word', words }, legs, { complexLookup, fullRouteSpans: {} }) === true);
    const wrongOrder = [leg('t1', 1, 'A', 'x', 'y'), leg('t1', 2, 'J', 'y', 'z'), leg('t1', 3, 'M', 'z', 'w')];
    check('route_letters_spell_word: wrong order still not a match even though letters overlap "CAB" -> false',
        evaluatePerTrip({ type: 'route_letters_spell_word', words }, wrongOrder, { complexLookup, fullRouteSpans: {} }) === false);
    const notInList = [leg('t1', 1, 'R', 'x', 'y'), leg('t1', 2, 'A', 'y', 'z'), leg('t1', 3, 'M', 'z', 'w')];
    check('route_letters_spell_word: spells a real word ("RAM") not in the curated list -> false',
        evaluatePerTrip({ type: 'route_letters_spell_word', words }, notInList, { complexLookup, fullRouteSpans: {} }) === false);
}

{
    const legs = [leg('t1', 1, 'A', 'A02', 'R16'), leg('t1', 2, 'N', 'R16', 'B06')];
    check('geographic_endpoints: first entry / last exit match -> true',
        evaluatePerTrip({ type: 'geographic_endpoints', start: 143, end: 222 }, legs, { complexLookup, fullRouteSpans: {} }) === true);
    check('geographic_endpoints: reversed start/end does NOT match -> false',
        evaluatePerTrip({ type: 'geographic_endpoints', start: 222, end: 143 }, legs, { complexLookup, fullRouteSpans: {} }) === false);
}

// ---- Mechanism 3: lifetime counting ----

{
    const history: RiderHistory = {
        trips: [],
        legs: [leg('t1', 1, 'A', 'x', 'y'), leg('t2', 1, 'A', 'x', 'y'), leg('t3', 1, 'N', 'x', 'y')],
    };
    const r = evaluateCounting({ type: 'ride_count_route', route: 'A', count: 2 }, history);
    check('ride_count_route: 2 A-line legs, threshold 2 -> completed', r.completed === true && r.current === 2);

    const rAny = evaluateCounting({ type: 'ride_count_route', route: 'any', count: 2 }, history);
    check('ride_count_route "any": best route (A, 2 legs) meets threshold -> completed', rAny.completed === true && rAny.current === 2);
}

{
    // Every leg after a trip's first counts as a transfer, regardless of whether
    // entry/exit stop_ids literally match -- a transfer's entry is auto-set to
    // "the correct platform at that complex," which is frequently a different
    // stop_id (e.g. Union Sq complex 602: exiting the 6 at stop_id 635, entering
    // the L at stop_id L03). t1 has a same-stop_id transfer (635 -> 635, the old
    // test's shape); t2 has a different-stop_id transfer at the same real-world
    // complex (635 -> L03) -- both must count, since the old exact-match logic
    // silently missed cases like t2.
    const history: RiderHistory = {
        trips: [],
        legs: [
            leg('t1', 1, 'A', 'x', 'R16'), leg('t1', 2, 'N', 'R16', 'y'),
            leg('t2', 1, '6', 'x', '635'), leg('t2', 2, 'L', 'L03', 'w'),
            leg('t3', 1, 'A', 'x', 'y'), // single-leg trip, no transfer
        ],
    };
    const r = evaluateCounting({ type: 'transfer_count', count: 2 }, history);
    check('transfer_count: 1 transfer per 2-leg trip, including different-stop_id transfers, single-leg trip contributes 0',
        r.current === 2 && r.completed === true);
}

// ---- getAllQuestProgressPure ----

{
    const quests: QuestsFile = {
        roosevelt_island: {
            title: 'Island Hopper', description: 'x', mechanism: 'lifetime_set',
            criteria: { type: 'all_stations', stations: [222] },
        },
        n_legger: {
            title: '2-Legger', description: 'x', mechanism: 'per_trip',
            criteria: { type: 'leg_count_min', count: 2 },
        },
    };
    const history: RiderHistory = {
        trips: [trip('t1', 'R16', 'A02')],
        legs: [leg('t1', 1, 'N', 'R16', 'B06'), leg('t1', 2, 'A', 'B06', 'A02')],
    };
    const progress = getAllQuestProgressPure(quests, history, complexLookup, [], {});
    check('getAllQuestProgressPure: both quests show completed after the trip',
        progress.every((p) => p.completed === true));
}

// ---- computeTripQuestProgressPure: full completion ----

{
    const quests: QuestsFile = {
        roosevelt_island: {
            title: 'Island Hopper', description: 'x', mechanism: 'lifetime_set',
            criteria: { type: 'all_stations', stations: [222] },
        },
        n_legger: {
            title: '2-Legger', description: 'x', mechanism: 'per_trip',
            criteria: { type: 'leg_count_min', count: 2 },
        },
    };
    const historyBefore: RiderHistory = { trips: [], legs: [] };
    const newTripLegs = [leg('t1', 1, 'N', 'R16', 'B06'), leg('t1', 2, 'A', 'B06', 'A02')];
    const historyAfter: RiderHistory = { trips: [trip('t1', 'R16', 'A02')], legs: newTripLegs };

    const delta = computeTripQuestProgressPure(quests, historyBefore, historyAfter, newTripLegs, complexLookup, [], {});
    const deltaIds = delta.map((d) => d.questId).sort();
    check('computeTripQuestProgressPure: both quests appear, both newly complete',
        deltaIds.length === 2 && deltaIds[0] === 'n_legger' && deltaIds[1] === 'roosevelt_island'
        && delta.every((d) => d.completedBefore === false && d.completedAfter === true));
}

// ---- computeTripQuestProgressPure: PARTIAL progress (the actual bug being fixed --
// a quest that made progress but isn't complete must still appear) ----

{
    const quests: QuestsFile = {
        beachy: {
            title: 'Beachy', description: 'Visit {count} beach stations.', mechanism: 'lifetime_set',
            criteria: { type: 'min_count_stations', stations: [222, 143, 144, 611, 1, 2], count: 6 },
        },
    };
    const historyBefore: RiderHistory = { trips: [], legs: [] };
    const newTripLegs = [leg('t1', 1, 'M', 'B06', 'B06')]; // visits complex 222 only -- 1 of 6, nowhere near complete
    const historyAfter: RiderHistory = { trips: [trip('t1', 'B06', 'B06')], legs: newTripLegs };

    const delta = computeTripQuestProgressPure(quests, historyBefore, historyAfter, newTripLegs, complexLookup, [], {});
    check('computeTripQuestProgressPure: partial (1/6) progress still appears, not just completions',
        delta.length === 1 && delta[0].questId === 'beachy'
        && delta[0].currentBefore === 0 && delta[0].currentAfter === 1
        && delta[0].completedBefore === false && delta[0].completedAfter === false);
}

// ---- computeTripQuestProgressPure: no change -> quest does NOT appear ----

{
    const quests: QuestsFile = {
        roosevelt_island: {
            title: 'Island Hopper', description: 'x', mechanism: 'lifetime_set',
            criteria: { type: 'all_stations', stations: [222] },
        },
    };
    const historyBefore: RiderHistory = { trips: [trip('t0', 'B06', 'B06')], legs: [leg('t0', 1, 'M', 'B06', 'B06')] };
    const newTripLegs = [leg('t1', 1, 'A', 'A02', 'A02')]; // touches complex 143, unrelated to this quest
    const historyAfter: RiderHistory = {
        trips: [...historyBefore.trips, trip('t1', 'A02', 'A02')],
        legs: [...historyBefore.legs, ...newTripLegs],
    };
    const delta = computeTripQuestProgressPure(quests, historyBefore, historyAfter, newTripLegs, complexLookup, [], {});
    check('computeTripQuestProgressPure: quest untouched by this trip does not appear at all', delta.length === 0);
}

// ---- computeTripQuestProgressPure: per_trip quest satisfied again by a later trip
// still appears (not just "first time ever") ----

{
    const quests: QuestsFile = {
        n_legger: {
            title: '2-Legger', description: 'x', mechanism: 'per_trip',
            criteria: { type: 'leg_count_min', count: 2 },
        },
    };
    const earlierLegs = [leg('t0', 1, 'A', 'x', 'y'), leg('t0', 2, 'N', 'y', 'z')]; // already satisfied once
    const newTripLegs = [leg('t1', 1, 'A', 'x', 'y'), leg('t1', 2, 'N', 'y', 'z')]; // satisfies it again
    const historyBefore: RiderHistory = { trips: [], legs: earlierLegs };
    const historyAfter: RiderHistory = { trips: [], legs: [...earlierLegs, ...newTripLegs] };
    const delta = computeTripQuestProgressPure(quests, historyBefore, historyAfter, newTripLegs, complexLookup, [], {});
    check('computeTripQuestProgressPure: per_trip quest reappears on a later qualifying trip, not just the first',
        delta.length === 1 && delta[0].questId === 'n_legger');
}

// ---- getQuestBreakdown ----

{
    const quest = {
        title: 'Beachy', description: 'x', mechanism: 'lifetime_set' as const,
        criteria: { type: 'min_count_stations' as const, stations: [222, 143, 144], count: 2 },
    };
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'M', 'B06', 'B06'), leg('t2', 1, 'A', 'A02', 'A02')] };
    const b = getQuestBreakdown(quest, history, complexLookup, [], {});
    check('getQuestBreakdown (stations): correct visited flags and trip attribution',
        b.kind === 'stations'
        && b.items.find((i) => i.complexId === 222)?.visited === true
        && (b.items.find((i) => i.complexId === 222)?.tripIds.includes('t1') ?? false)
        && b.items.find((i) => i.complexId === 144)?.visited === false);
}

{
    const quest = {
        title: 'Five Boroughs', description: 'x', mechanism: 'lifetime_set' as const,
        criteria: { type: 'all_groups' as const, groups: [[222, 611], [143, 144]] },
    };
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'M', 'B06', 'B06')] };
    const b = getQuestBreakdown(quest, history, complexLookup, [], {});
    check('getQuestBreakdown (groups): group 0 visited via complex 222/t1, group 1 untouched',
        b.kind === 'groups'
        && b.items[0].visited === true && b.items[0].visitedComplexIds.includes(222) && b.items[0].tripIds.includes('t1')
        && b.items[1].visited === false && b.items[1].visitedComplexIds.length === 0);
}

// ---- min_per_group (the Deja Vu fix: a same-name cluster should only count
// once you've genuinely visited 2+ of its members, not just 1) ----

{
    const quest = {
        title: 'Déjà Vu', description: 'x', mechanism: 'lifetime_set' as const,
        criteria: { type: 'min_count_groups' as const, groups: [[333, 413], [143, 144]], count: 2, min_per_group: 2 },
    };
    // Visiting only ONE member of a 2-member group should NOT count under min_per_group: 2
    const onlyOneVisited: RiderHistory = { trips: [], legs: [leg('t1', 1, '2', 'A02', 'A02')] }; // visits complex 143 only, 1 of group 2's 2 members
    const rOnlyOne = evaluateLifetimeSet(quest.criteria, onlyOneVisited, complexLookup, []);
    check('min_per_group=2: visiting only 1 of 2 members does NOT count the group', rOnlyOne.current === 0);

    const bothVisited: RiderHistory = {
        trips: [], legs: [leg('t1', 1, 'A', 'A02', 'A02'), leg('t2', 1, 'A', 'A03', 'A03')], // A02->143, A03->144, both members of group 1
    };
    const rBoth = evaluateLifetimeSet(quest.criteria, bothVisited, complexLookup, []);
    check('min_per_group=2: visiting both members of a group DOES count it', rBoth.current === 1);
}

{
    // Regression check: min_per_group defaults to 1 (existing OR behavior) when
    // absent, so boroughs/branching_out (which never set it) are unaffected.
    const criteria = { type: 'all_groups' as const, groups: [[611, 222], [143, 144]] }; // no min_per_group
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'N', 'R16', 'R16')] }; // visits only complex 611, 1 of group 0
    const r = evaluateLifetimeSet(criteria, history, complexLookup, []);
    check('all_groups with no min_per_group still uses OR semantics (1 member is enough) -- no regression', r.current === 1);
}

{
    const quest = {
        title: '2-Legger', description: 'x', mechanism: 'per_trip' as const,
        criteria: { type: 'leg_count_min' as const, count: 2 },
    };
    const history: RiderHistory = {
        trips: [], legs: [
            leg('t1', 1, 'A', 'x', 'y'), leg('t1', 2, 'N', 'y', 'z'), // qualifies (2 legs)
            leg('t2', 1, 'A', 'x', 'y'), // does not qualify (1 leg)
        ],
    };
    const b = getQuestBreakdown(quest, history, complexLookup, [], {});
    check('getQuestBreakdown (per_trip): only the qualifying trip is listed',
        b.kind === 'per_trip' && b.qualifyingTripIds.length === 1 && b.qualifyingTripIds[0] === 't1');
}

{
    const quest = {
        title: 'Line Loyalist', description: 'x', mechanism: 'counting' as const,
        criteria: { type: 'ride_count_route' as const, route: 'A', count: 3 },
    };
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'A', 'x', 'y'), leg('t2', 1, 'A', 'x', 'y')] };
    const b = getQuestBreakdown(quest, history, complexLookup, [], {});
    check('getQuestBreakdown (counting): current/target correct, both contributing trips listed',
        b.kind === 'counting' && b.current === 2 && b.target === 3
        && b.contributingTripIds.sort().join(',') === 't1,t2');
    check('getQuestBreakdown (counting, ride_count_route explicit): contributingRoute is the explicit route',
        b.kind === 'counting' && b.contributingRoute === 'A');
}

{
    // route: 'any' -- contributingRoute must resolve to the actual best route
    // (N, ridden twice), not stay unresolved, so a quest like Line Loyalist
    // can say WHICH line its count refers to.
    const quest = {
        title: 'Line Loyalist', description: 'x', mechanism: 'counting' as const,
        criteria: { type: 'ride_count_route' as const, route: 'any', count: 2 },
    };
    const history: RiderHistory = {
        trips: [],
        legs: [leg('t1', 1, 'N', 'x', 'y'), leg('t2', 1, 'N', 'x', 'y'), leg('t3', 1, 'A', 'x', 'y')],
    };
    const b = getQuestBreakdown(quest, history, complexLookup, [], {});
    check('getQuestBreakdown (counting, ride_count_route "any"): contributingRoute resolves to the best route',
        b.kind === 'counting' && b.contributingRoute === 'N');
}

{
    // transfer_count has no single-route concept -- contributingRoute must
    // stay null, unlike ride_count_route.
    const quest = { title: 'Transfer Master', description: 'x', mechanism: 'counting' as const, criteria: { type: 'transfer_count' as const, count: 1 } };
    const history: RiderHistory = { trips: [], legs: [leg('t1', 1, 'A', 'x', 'y'), leg('t1', 2, 'N', 'y', 'z')] };
    const b = getQuestBreakdown(quest, history, complexLookup, [], {});
    check('getQuestBreakdown (counting, transfer_count): contributingRoute is null',
        b.kind === 'counting' && b.contributingRoute === null);
}

// ---- questIdsForStation ----

{
    const quests: QuestsFile = {
        roosevelt_island: { title: 'x', description: 'x', mechanism: 'lifetime_set', criteria: { type: 'all_stations', stations: [222] } },
        beachy: { title: 'x', description: 'x', mechanism: 'lifetime_set', criteria: { type: 'min_count_stations', stations: [222, 58], count: 1 } },
        boroughs: { title: 'x', description: 'x', mechanism: 'lifetime_set', criteria: { type: 'all_groups', groups: [[222, 611], [143]] } },
        crossroads: { title: 'x', description: 'x', mechanism: 'lifetime_set', criteria: { type: 'all_station_route_pairs', pairs: [{ station: 222, route: 'M' }] } },
        all_lines: { title: 'x', description: 'x', mechanism: 'lifetime_set', criteria: { type: 'all_routes' } },
        top_to_bottom: { title: 'x', description: 'x', mechanism: 'per_trip', criteria: { type: 'geographic_endpoints', start: 222, end: 999 } },
        n_legger: { title: 'x', description: 'x', mechanism: 'per_trip', criteria: { type: 'leg_count_min', count: 3 } },
        line_loyalist: { title: 'x', description: 'x', mechanism: 'counting', criteria: { type: 'ride_count_route', route: 'any', count: 5 } },
        unrelated: { title: 'x', description: 'x', mechanism: 'lifetime_set', criteria: { type: 'all_stations', stations: [999] } },
    };
    const matches = questIdsForStation(quests, 222).sort();
    check('questIdsForStation: matches all_stations, min_count_stations, all_groups, all_station_route_pairs, and geographic_endpoints',
        matches.join(',') === 'beachy,boroughs,crossroads,roosevelt_island,top_to_bottom');
    check('questIdsForStation: does NOT match all_routes, leg_count_min, counting, or an unrelated station list',
        !matches.includes('all_lines') && !matches.includes('n_legger')
        && !matches.includes('line_loyalist') && !matches.includes('unrelated'));
}

// ---- report ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
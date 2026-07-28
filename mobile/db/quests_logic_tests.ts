// mobile/db/quests_logic_tests.ts
//
// Required test, same standard as rehydrate_tests.ts / schema_tests.py --
// confirmed directly, not assumed. Runs via plain tsx/node, no device needed
// (see quests_logic.ts's header for why this module has zero RN imports).

import {
    Leg, Trip, RiderHistory, QuestsFile,
    evaluateLifetimeSet, evaluatePerTrip, evaluateCounting,
    getAllQuestProgressPure, computeTripQuestDeltaPure,
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
    const legs = [leg('t1', 1, 'J', 'x', 'y'), leg('t1', 2, 'A', 'y', 'z'), leg('t1', 3, 'M', 'z', 'w')];
    check('route_letters_spell_word: J-A-M in order -> true',
        evaluatePerTrip({ type: 'route_letters_spell_word', word: 'JAM' }, legs, { complexLookup, fullRouteSpans: {} }) === true);
    const wrongOrder = [leg('t1', 1, 'A', 'x', 'y'), leg('t1', 2, 'J', 'y', 'z'), leg('t1', 3, 'M', 'z', 'w')];
    check('route_letters_spell_word: wrong order -> false',
        evaluatePerTrip({ type: 'route_letters_spell_word', word: 'JAM' }, wrongOrder, { complexLookup, fullRouteSpans: {} }) === false);
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
    // t1: leg1 exits R16, leg2 enters R16 -- a real transfer. t2: no matching exit/entry -- not a transfer.
    const history: RiderHistory = {
        trips: [],
        legs: [
            leg('t1', 1, 'A', 'x', 'R16'), leg('t1', 2, 'N', 'R16', 'y'),
            leg('t2', 1, 'A', 'x', 'y'), leg('t2', 2, 'N', 'z', 'w'),
        ],
    };
    const r = evaluateCounting({ type: 'transfer_count', count: 1 }, history);
    check('transfer_count: exactly 1 real transfer detected across 2 trips', r.current === 1 && r.completed === true);
}

// ---- Dispatch + delta ----

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
    const historyAfter: RiderHistory = {
        trips: [trip('t1', 'R16', 'A02')],
        legs: newTripLegs,
    };

    const delta = computeTripQuestDeltaPure(quests, historyBefore, historyAfter, newTripLegs, complexLookup, [], {});
    const deltaIds = delta.map((d) => d.questId).sort();
    check('computeTripQuestDelta: both a lifetime_set and a per_trip quest newly complete',
        deltaIds.length === 2 && deltaIds[0] === 'n_legger' && deltaIds[1] === 'roosevelt_island');

    const progress = getAllQuestProgressPure(quests, historyAfter, complexLookup, [], {});
    check('getAllQuestProgressPure: both quests show completed after the trip',
        progress.every((p) => p.completed === true));
}

{
    // Already-complete quest before this trip should NOT show up in the delta again
    const quests: QuestsFile = {
        roosevelt_island: {
            title: 'Island Hopper', description: 'x', mechanism: 'lifetime_set',
            criteria: { type: 'all_stations', stations: [222] },
        },
    };
    const historyBefore: RiderHistory = { trips: [trip('t0', 'B06', 'B06')], legs: [leg('t0', 1, 'N', 'B06', 'B06')] };
    const newTripLegs = [leg('t1', 1, 'A', 'A02', 'B06')];
    const historyAfter: RiderHistory = {
        trips: [...historyBefore.trips, trip('t1', 'A02', 'B06')],
        legs: [...historyBefore.legs, ...newTripLegs],
    };
    const delta = computeTripQuestDeltaPure(quests, historyBefore, historyAfter, newTripLegs, complexLookup, [], {});
    check('computeTripQuestDelta: quest already completed before this trip does NOT re-appear', delta.length === 0);
}

// ---- report ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
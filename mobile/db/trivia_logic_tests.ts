// mobile/db/trivia_logic_tests.ts
//
// Required test, same standard as quests_logic_tests.ts -- confirmed
// directly, not assumed. Runs via plain tsx/node, no device needed (see
// trivia_logic.ts's header for why this module has zero RN imports).

import type { RiderHistory } from './quests_logic';
import { computeTripTriviaRevealsPure, TriviaFile } from './trivia_logic';

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

// Complex 611 = Times Sq, spanning multiple stop_ids (127/725/902/A27/R16),
// same as the real transfers.json entry. 222 = Roosevelt Island (single
// stop_id, B06).
const complexLookup: Record<string, number> = {
    R16: 611, A27: 611, '127': 611, '902': 611, '725': 611,
    B06: 222,
};

const trivia: TriviaFile = {
    stations: {
        '611': { fact: 'Times Sq fact' },
        '222': { fact: 'Roosevelt Island fact' },
    },
    lines: {
        A: { fact: 'A line fact' },
        N: { fact: 'N line fact' },
    },
};

type Leg = RiderHistory['legs'][number];
type Trip = RiderHistory['trips'][number];

function leg(tripId: string, sequence: number, routeId: string, entry: string, exit: string): Leg {
    return { legId: `${tripId}-${sequence}`, tripId, sequence, routeId, entryStationId: entry, exitStationId: exit };
}

function trip(tripId: string, origin: string, dest: string): Trip {
    return { tripId, originStationId: origin, destinationStationId: dest };
}

const empty: RiderHistory = { trips: [], legs: [] };

// ---- station reveal via trip origin/destination ----

{
    const after: RiderHistory = { trips: [trip('t1', 'R16', 'B06')], legs: [leg('t1', 1, 'N', 'R16', 'B06')] };
    const reveals = computeTripTriviaRevealsPure(trivia, empty, after, complexLookup);
    const stationReveals = reveals.filter((r) => r.kind === 'station').map((r) => (r as { complexId: number }).complexId).sort();
    check('station fact reveals via trip origin/destination for both newly-touched complexes',
        stationReveals.join(',') === '222,611');
}

// ---- station reveal via a leg's entry/exit only (not trip endpoints) ----

{
    const after: RiderHistory = { trips: [], legs: [leg('t1', 1, 'A', 'A27', 'B06')] };
    const reveals = computeTripTriviaRevealsPure(trivia, empty, after, complexLookup);
    const stationReveals = reveals.filter((r) => r.kind === 'station').map((r) => (r as { complexId: number }).complexId).sort();
    check('station fact reveals via leg entry/exit even with no trip-level origin/destination match',
        stationReveals.join(',') === '222,611');
}

// ---- multi-stop_id complex unlocks regardless of which member stop_id is used ----

{
    const after: RiderHistory = { trips: [], legs: [leg('t1', 1, '7', '725', '725')] };
    const reveals = computeTripTriviaRevealsPure(trivia, empty, after, complexLookup);
    check('Times Sq (complex 611) reveals via stop_id 725, not just R16',
        reveals.some((r) => r.kind === 'station' && r.complexId === 611));
}

// ---- line reveal on first ride ----

{
    const after: RiderHistory = { trips: [], legs: [leg('t1', 1, 'A', 'x', 'y')] };
    const reveals = computeTripTriviaRevealsPure(trivia, empty, after, complexLookup);
    check('A line fact reveals on first ride',
        reveals.length === 1 && reveals[0].kind === 'line' && reveals[0].routeId === 'A');
}

// ---- no reveal when nothing changed ----

{
    const history: RiderHistory = { trips: [trip('t1', 'R16', 'R16')], legs: [leg('t1', 1, 'N', 'R16', 'R16')] };
    const reveals = computeTripTriviaRevealsPure(trivia, history, history, complexLookup);
    check('identical before/after history produces no reveals', reveals.length === 0);
}

// ---- no repeat reveal on a later trip that re-touches an already-unlocked station/line ----

{
    const before: RiderHistory = { trips: [trip('t1', 'R16', 'R16')], legs: [leg('t1', 1, 'N', 'R16', 'R16')] };
    const after: RiderHistory = {
        trips: [...before.trips, trip('t2', 'R16', 'R16')],
        legs: [...before.legs, leg('t2', 1, 'N', 'R16', 'R16')],
    };
    const reveals = computeTripTriviaRevealsPure(trivia, before, after, complexLookup);
    check('a second trip through an already-unlocked complex does not reveal again', reveals.length === 0);
}

// ---- a station reveal and a line reveal can both fire on the same trip ----

{
    const after: RiderHistory = { trips: [], legs: [leg('t1', 1, 'A', 'A27', 'B06')] };
    const reveals = computeTripTriviaRevealsPure(trivia, empty, after, complexLookup);
    check('a station reveal (611, 222 via A27/B06) and a line reveal (A) both fire on the same trip',
        reveals.filter((r) => r.kind === 'station').length === 2
        && reveals.filter((r) => r.kind === 'line').length === 1);
}

// ---- an unauthored station/line never reveals, even if touched/ridden ----

{
    const after: RiderHistory = { trips: [], legs: [leg('t1', 1, 'Q', 'unrelated-stop', 'unrelated-stop')] };
    const lookupWithExtra = { ...complexLookup, 'unrelated-stop': 999 };
    const reveals = computeTripTriviaRevealsPure(trivia, empty, after, lookupWithExtra);
    check('a complex/route with no authored fact never reveals', reveals.length === 0);
}

// ---- report ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

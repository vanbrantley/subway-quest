// mobile/db/stations_logic_tests.ts
//
// Required test, same standard as rehydrate_tests.ts / quests_logic_tests.ts
// -- confirmed directly, not assumed. Runs via plain tsx/node, no device
// needed (see stations_logic.ts's header for why this module has zero RN
// imports).

import type { Leg, Trip, RiderHistory } from './quests_logic';
import { getVisitedStationIdsPure, computeProfileStatsPure, computeTopFavoritesPure, type StationRefLookup } from './stations_logic';

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

function leg(tripId: string, sequence: number, routeId: string, entry: string, exit: string): Leg {
    return { legId: `${tripId}-${sequence}`, tripId, sequence, routeId, entryStationId: entry, exitStationId: exit };
}

function trip(tripId: string, origin: string, dest: string): Trip {
    return { tripId, originStationId: origin, destinationStationId: dest };
}

const stationRefs: StationRefLookup = {
    A1: { name: 'Astoria-Ditmars Blvd', borough: 'Q' },
    A2: { name: 'Astoria Blvd', borough: 'Q' },
    B1: { name: 'Union Sq', borough: 'M' },
    B2: { name: 'Times Sq', borough: 'M' },
    C1: { name: 'Crown Hts', borough: 'Bk' },
};
const allStationIds = ['A1', 'A2', 'B1', 'B2', 'C1']; // 2 Q, 2 M, 1 Bk

// ---- getVisitedStationIdsPure ----
{
    const history: RiderHistory = {
        trips: [trip('t1', 'A1', 'B1')],
        legs: [leg('t1', 1, 'N', 'A1', 'B1')],
    };
    const visited = getVisitedStationIdsPure(history);
    check('entry and exit stations both counted as visited', visited.has('A1') && visited.has('B1'));
    check('unvisited station not counted', !visited.has('B2'));
}

// ---- computeProfileStatsPure: rides logged / stations visited / % overall ----
{
    const history: RiderHistory = {
        trips: [trip('t1', 'A1', 'B1'), trip('t2', 'A1', 'A2')],
        legs: [leg('t1', 1, 'N', 'A1', 'B1'), leg('t2', 1, 'W', 'A1', 'A2')],
    };
    const stats = computeProfileStatsPure(history, stationRefs, allStationIds);
    check('ridesLogged counts trips, not legs', stats.ridesLogged === 2);
    check('stationsVisited counts distinct stop_ids (A1, B1, A2)', stats.stationsVisited === 3);
    check('pctVisitedOverall = 3/5 = 60', stats.pctVisitedOverall === 60);
}

// ---- % visited by borough ----
{
    const history: RiderHistory = {
        trips: [trip('t1', 'A1', 'A1')],
        legs: [leg('t1', 1, 'N', 'A1', 'A1')],
    };
    const stats = computeProfileStatsPure(history, stationRefs, allStationIds);
    const queens = stats.pctVisitedByBorough.find((b) => b.borough === 'Q');
    const manhattan = stats.pctVisitedByBorough.find((b) => b.borough === 'M');
    check('Queens: 1 of 2 visited = 50%', queens?.visited === 1 && queens?.total === 2 && queens?.pct === 50);
    check('Manhattan: 0 of 2 visited = 0%', manhattan?.visited === 0 && manhattan?.pct === 0);
}

// ---- empty history doesn't crash, everything zeroed ----
{
    const history: RiderHistory = { trips: [], legs: [] };
    const stats = computeProfileStatsPure(history, stationRefs, allStationIds);
    check('empty history: 0% overall', stats.pctVisitedOverall === 0);
}

// ---- computeTopFavoritesPure: ranked descending, ties broken alphabetically ----
{
    const legs = [
        leg('t1', 1, 'N', 'A1', 'B1'), // A1 +1, B1 +1, N +1
        leg('t2', 1, 'N', 'B1', 'A1'), // B1 +1, A1 +1, N +1
        leg('t3', 1, 'L', 'B1', 'B2'), // B1 +1, B2 +1, L +1
    ];
    // A1: 2, B1: 3, B2: 1 | N: 2, L: 1
    const { stations, lines } = computeTopFavoritesPure(legs, stationRefs, 5);
    check('stations ranked descending by ride count', stations[0].stationId === 'B1' && stations[0].rideCount === 3);
    check('all distinct stations returned when under the limit', stations.length === 3);
    check('lines ranked descending by ride count', lines[0].routeId === 'N' && lines[0].rideCount === 2);
}

// ---- computeTopFavoritesPure: limit truncates, no zero-padding below it ----
{
    const legs = [
        leg('t1', 1, 'N', 'A1', 'A2'),
        leg('t2', 1, 'N', 'B1', 'B2'),
        leg('t3', 1, 'N', 'C1', 'A1'),
    ];
    const { stations } = computeTopFavoritesPure(legs, stationRefs, 2);
    check('limit truncates the ranked list', stations.length === 2);
}

// ---- computeTopFavoritesPure: empty legs returns empty, no crash ----
{
    const { stations, lines } = computeTopFavoritesPure([], stationRefs, 5);
    check('empty legs: no favorite stations', stations.length === 0);
    check('empty legs: no favorite lines', lines.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

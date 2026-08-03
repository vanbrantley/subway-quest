// mobile/db/stations_logic_tests.ts
//
// Required test, same standard as rehydrate_tests.ts / quests_logic_tests.ts
// -- confirmed directly, not assumed. Runs via plain tsx/node, no device
// needed (see stations_logic.ts's header for why this module has zero RN
// imports).

import type { Leg, Trip, RiderHistory } from './quests_logic';
import { getVisitedStationIdsPure, computeProfileStatsPure, type StationRefLookup } from './stations_logic';

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
const displayableRoutes = ['N', 'W', 'L', '4'];

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
    const stats = computeProfileStatsPure(history, stationRefs, allStationIds, displayableRoutes);
    check('ridesLogged counts trips, not legs', stats.ridesLogged === 2);
    check('stationsVisited counts distinct stop_ids (A1, B1, A2)', stats.stationsVisited === 3);
    check('pctVisitedOverall = 3/5 = 60', stats.pctVisitedOverall === 60);
}

// ---- favorite station: most-visited by entry+exit count, ties included ----
{
    const history: RiderHistory = {
        trips: [trip('t1', 'A1', 'B1'), trip('t2', 'B1', 'A1')],
        legs: [leg('t1', 1, 'N', 'A1', 'B1'), leg('t2', 1, 'N', 'B1', 'A1')],
    };
    const stats = computeProfileStatsPure(history, stationRefs, allStationIds, displayableRoutes);
    // A1 and B1 each appear twice (once as entry, once as exit, across the two trips)
    check('favorite station is a tie between A1 and B1', stats.favoriteStations.length === 2);
    check('tie sorted by name', stats.favoriteStations[0].stationId === 'A1'); // "Astoria-Ditmars Blvd" < "Union Sq"
}

// ---- favorite line / least-travelled line ----
{
    const history: RiderHistory = {
        trips: [trip('t1', 'A1', 'B1'), trip('t2', 'A1', 'B1'), trip('t3', 'B1', 'B2')],
        legs: [
            leg('t1', 1, 'N', 'A1', 'B1'),
            leg('t2', 1, 'N', 'A1', 'B1'),
            leg('t3', 1, 'L', 'B1', 'B2'),
        ],
    };
    const stats = computeProfileStatsPure(history, stationRefs, allStationIds, displayableRoutes);
    check('favorite line is N (ridden twice)', stats.favoriteLines.length === 1 && stats.favoriteLines[0].routeId === 'N');
    check('least-travelled line is L (ridden once) — never an unridden line like W or 4', stats.leastTravelledLines.length === 1 && stats.leastTravelledLines[0].routeId === 'L');
}

// ---- % visited by borough ----
{
    const history: RiderHistory = {
        trips: [trip('t1', 'A1', 'A1')],
        legs: [leg('t1', 1, 'N', 'A1', 'A1')],
    };
    const stats = computeProfileStatsPure(history, stationRefs, allStationIds, displayableRoutes);
    const queens = stats.pctVisitedByBorough.find((b) => b.borough === 'Q');
    const manhattan = stats.pctVisitedByBorough.find((b) => b.borough === 'M');
    check('Queens: 1 of 2 visited = 50%', queens?.visited === 1 && queens?.total === 2 && queens?.pct === 50);
    check('Manhattan: 0 of 2 visited = 0%', manhattan?.visited === 0 && manhattan?.pct === 0);
}

// ---- empty history doesn't crash, everything zeroed ----
{
    const history: RiderHistory = { trips: [], legs: [] };
    const stats = computeProfileStatsPure(history, stationRefs, allStationIds, displayableRoutes);
    check('empty history: no favorite stations', stats.favoriteStations.length === 0);
    check('empty history: no favorite lines', stats.favoriteLines.length === 0);
    check('empty history: no least-travelled lines (nothing ridden at all)', stats.leastTravelledLines.length === 0);
    check('empty history: 0% overall', stats.pctVisitedOverall === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

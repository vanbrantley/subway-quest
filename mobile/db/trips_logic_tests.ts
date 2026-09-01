// mobile/db/trips_logic_tests.ts
//
// Required test, same standard as stations_logic_tests.ts. Runs via plain
// tsx/node, no device needed.

import { groupLegsByStopPure, type LineLegEntry } from './trips_logic';

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

function legRow(legId: string, tripId: string, entry: string, exit: string, boardedAt: string, alightedAt: string): LineLegEntry {
    return { legId, tripId, entryStationId: entry, exitStationId: exit, boardedAt, alightedAt };
}

// ---- basic grouping: boarded under entry, alighted under exit ----
{
    const legs = [legRow('l1', 't1', 'A', 'B', '2026-01-01T00:00:00.000Z', '2026-01-01T00:10:00.000Z')];
    const grouped = groupLegsByStopPure(legs);
    check('entry station gets a boarded event', grouped['A']?.length === 1 && grouped['A'][0].kind === 'boarded');
    check('exit station gets an alighted event', grouped['B']?.length === 1 && grouped['B'][0].kind === 'alighted');
}

// ---- a stop appearing as both an entry (one leg) and exit (another leg) accumulates both ----
{
    const legs = [
        legRow('l1', 't1', 'A', 'B', '2026-01-01T00:00:00.000Z', '2026-01-01T00:10:00.000Z'),
        legRow('l2', 't2', 'B', 'C', '2026-01-02T00:00:00.000Z', '2026-01-02T00:10:00.000Z'),
    ];
    const grouped = groupLegsByStopPure(legs);
    check('B has both an alighted event (from l1) and a boarded event (from l2)', grouped['B']?.length === 2);
}

// ---- sorted most-recent-first ----
{
    const legs = [
        legRow('l1', 't1', 'A', 'B', '2026-01-01T00:00:00.000Z', '2026-01-01T00:10:00.000Z'),
        legRow('l2', 't2', 'A', 'C', '2026-01-05T00:00:00.000Z', '2026-01-05T00:10:00.000Z'),
    ];
    const grouped = groupLegsByStopPure(legs);
    check('A sorted with the most recent boarded event first', grouped['A'][0].at === '2026-01-05T00:00:00.000Z');
}

// ---- a round-trip through the same stop (entry === exit of the same leg) ----
{
    const legs = [legRow('l1', 't1', 'A', 'A', '2026-01-01T00:00:00.000Z', '2026-01-01T00:10:00.000Z')];
    const grouped = groupLegsByStopPure(legs);
    check('same stop as both entry and exit gets both events', grouped['A']?.length === 2);
}

// ---- empty input ----
check('empty legs produce an empty grouping', Object.keys(groupLegsByStopPure([])).length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

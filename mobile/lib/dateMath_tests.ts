// mobile/lib/dateMath_tests.ts
//
// Required test, same standard as db/stations_logic_tests.ts. Runs via plain
// tsx/node, no device needed (this module has zero RN imports).

import {
    addDaysLocal, rangeToStartDate, localMidnightToIsoUtc,
    dayOfWeekLocal, daysBetweenLocal, localDateString,
} from './dateMath';

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

// ---- addDaysLocal: plain forward/backward ----
check('addDaysLocal forward within a month', addDaysLocal('2026-08-10', 5) === '2026-08-15');
check('addDaysLocal backward within a month', addDaysLocal('2026-08-10', -5) === '2026-08-05');

// ---- addDaysLocal: month rollover ----
check('addDaysLocal rolls forward into next month', addDaysLocal('2026-08-30', 3) === '2026-09-02');
check('addDaysLocal rolls backward into previous month', addDaysLocal('2026-09-02', -3) === '2026-08-30');

// ---- addDaysLocal: year rollover ----
check('addDaysLocal rolls backward across a year boundary', addDaysLocal('2026-01-03', -5) === '2025-12-29');
check('addDaysLocal rolls forward across a year boundary', addDaysLocal('2025-12-29', 5) === '2026-01-03');

// ---- rangeToStartDate ----
{
    const today = new Date(2026, 7, 31); // Aug 31, 2026 (local) -- a Monday
    check("rangeToStartDate('all') has no cutoff", rangeToStartDate('all', today) === null);
    check("rangeToStartDate('7d') is 6 days back (7 days inclusive of today)", rangeToStartDate('7d', today) === '2026-08-25');
    check("rangeToStartDate('30d') is 29 days back (30 days inclusive of today)", rangeToStartDate('30d', today) === '2026-08-02');
}

// ---- localMidnightToIsoUtc round-trips through Date correctly ----
{
    const iso = localMidnightToIsoUtc('2026-08-31');
    const roundTripped = new Date(iso);
    check('localMidnightToIsoUtc produces a parseable UTC instant', !Number.isNaN(roundTripped.getTime()));
    check('localMidnightToIsoUtc round-trips back to the same local calendar day', localDateString(roundTripped) === '2026-08-31');
}

// ---- dayOfWeekLocal ----
check('dayOfWeekLocal: Aug 30 2026 is a Sunday', dayOfWeekLocal('2026-08-30') === 0);
check('dayOfWeekLocal: Aug 31 2026 is a Monday', dayOfWeekLocal('2026-08-31') === 1);

// ---- daysBetweenLocal ----
check('daysBetweenLocal counts a 30-day span correctly', daysBetweenLocal('2026-08-01', '2026-08-31') === 30);
check('daysBetweenLocal is 0 for the same day', daysBetweenLocal('2026-08-31', '2026-08-31') === 0);
check('daysBetweenLocal is negative when `to` precedes `from`', daysBetweenLocal('2026-08-31', '2026-08-01') === -30);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

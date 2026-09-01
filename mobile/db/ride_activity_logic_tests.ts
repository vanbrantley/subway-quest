// mobile/db/ride_activity_logic_tests.ts
//
// Required test, same standard as stations_logic_tests.ts. Runs via plain
// tsx/node, no device needed.

import { bucketRidesByLocalDay, buildHeatmapWeeks, computeStreaksPure, type DayCount } from './ride_activity_logic';

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

// ---- bucketRidesByLocalDay: multiple rides same local day count together ----
{
    // Both instants fall on 2026-08-31 in a UTC-negative timezone (e.g. US
    // Eastern), even though the second is technically the next UTC day --
    // this is exactly the local-vs-UTC bucketing distinction the module
    // exists to get right. We can't pin an exact local day without knowing
    // the test runner's TZ, so instead assert the *grouping* invariant: two
    // instants a few hours apart on the same real day always land in the
    // same bucket, regardless of TZ.
    const dayCounts = bucketRidesByLocalDay(['2026-08-31T10:00:00.000Z', '2026-08-31T14:00:00.000Z']);
    check('same-day rides bucket together', dayCounts.length === 1 && dayCounts[0].count === 2);
}

// ---- bucketRidesByLocalDay: distinct days, sorted ascending ----
{
    const dayCounts = bucketRidesByLocalDay(['2026-08-05T12:00:00.000Z', '2026-08-01T12:00:00.000Z', '2026-08-05T18:00:00.000Z']);
    check('two distinct days produced', dayCounts.length === 2);
    check('sorted ascending', dayCounts[0].date < dayCounts[1].date);
    check('Aug 5 has count 2', dayCounts.find((d) => d.date.endsWith('-05'))?.count === 2);
}

// ---- bucketRidesByLocalDay: empty input ----
check('empty timestamps -> empty day counts', bucketRidesByLocalDay([]).length === 0);

// ---- buildHeatmapWeeks: dense grid, correct shape and today placement ----
{
    const dayCounts: DayCount[] = [{ date: '2026-08-31', count: 3 }];
    const weeks = buildHeatmapWeeks(dayCounts, '2026-08-31', 4);
    check('4 weeks requested -> 4 week columns', weeks.length === 4);
    check('every week has 7 days', weeks.every((w) => w.length === 7));
    const lastWeek = weeks[weeks.length - 1];
    const todayCell = lastWeek.find((c) => c.date === '2026-08-31');
    check('today appears in the last week with its count', todayCell?.count === 3);
    check('a day with no rides is 0-filled, not missing', lastWeek.some((c) => c.count === 0));
}

// ---- buildHeatmapWeeks: month-boundary alignment (grid stays dense across it) ----
{
    const weeks = buildHeatmapWeeks([], '2026-09-01', 2);
    const allDates = weeks.flat().map((c) => c.date);
    check('grid spans the Aug/Sep boundary without gaps', allDates.includes('2026-08-31') && allDates.includes('2026-09-01'));
    check('every cell 0 when no rides logged', weeks.flat().every((c) => c.count === 0));
}

// ---- computeStreaksPure: simple consecutive-day streak ----
{
    const dayCounts: DayCount[] = [
        { date: '2026-08-29', count: 1 },
        { date: '2026-08-30', count: 1 },
        { date: '2026-08-31', count: 1 },
    ];
    const { currentStreak, longestStreak } = computeStreaksPure(dayCounts, '2026-08-31');
    check('3-day consecutive streak, today included', currentStreak === 3);
    check('longest streak matches current here', longestStreak === 3);
}

// ---- computeStreaksPure: a gap day breaks the streak ----
{
    const dayCounts: DayCount[] = [
        { date: '2026-08-20', count: 1 },
        { date: '2026-08-21', count: 1 },
        // gap: no ride on 8/22-8/29
        { date: '2026-08-30', count: 1 },
        { date: '2026-08-31', count: 1 },
    ];
    const { currentStreak, longestStreak } = computeStreaksPure(dayCounts, '2026-08-31');
    check('current streak only counts the unbroken tail', currentStreak === 2);
    check('longest streak still finds the earlier 2-day run', longestStreak === 2);
}

// ---- computeStreaksPure: grace day -- today missing, yesterday present, streak still alive ----
{
    const dayCounts: DayCount[] = [
        { date: '2026-08-29', count: 1 },
        { date: '2026-08-30', count: 1 },
        // no ride logged yet today (2026-08-31)
    ];
    const { currentStreak } = computeStreaksPure(dayCounts, '2026-08-31');
    check('streak stays alive when only yesterday is missing today\'s ride', currentStreak === 2);
}

// ---- computeStreaksPure: a full missed day zeroes the current streak ----
{
    const dayCounts: DayCount[] = [
        { date: '2026-08-28', count: 1 },
        { date: '2026-08-29', count: 1 },
        // 8/30 AND 8/31 both missed
    ];
    const { currentStreak, longestStreak } = computeStreaksPure(dayCounts, '2026-08-31');
    check('two full missed days zeroes the current streak', currentStreak === 0);
    check('longest streak is unaffected by the gap', longestStreak === 2);
}

// ---- computeStreaksPure: empty history ----
{
    const { currentStreak, longestStreak } = computeStreaksPure([], '2026-08-31');
    check('no ride history -> both streaks 0', currentStreak === 0 && longestStreak === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

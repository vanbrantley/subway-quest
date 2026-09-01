// mobile/db/ride_activity_logic.ts
//
// Pure ride-activity aggregation for the Profile page's calendar heatmap and
// streak stats -- zero imports of expo-sqlite/RN, same split as
// stations_logic.ts/quests_logic.ts. Operates entirely on trips[].startedAt
// (already loaded for the Profile page's trip history) -- no new SQL needed.
//
// Bucketing is done in JS via lib/dateMath's local-day helpers, deliberately
// NOT SQLite's date()/strftime(): trips.started_at is always a UTC instant
// (see db/projection.ts's buildOccurredAt), and SQLite's date() would bucket
// by UTC calendar day, which is the wrong day near local midnight -- the
// same bug class documented on buildOccurredAt itself.

import { localDateString, addDaysLocal, dayOfWeekLocal } from '../lib/dateMath';

export type DayCount = { date: string; count: number }; // local YYYY-MM-DD, ascending

/** Buckets a list of trip start timestamps (ISO8601 UTC instants) into
 *  per-local-day ride counts. Sparse -- only days with >=1 ride appear. */
export function bucketRidesByLocalDay(startedAtTimestamps: string[]): DayCount[] {
    const counts = new Map<string, number>();
    for (const iso of startedAtTimestamps) {
        const day = localDateString(new Date(iso));
        counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

export type HeatmapCell = { date: string; count: number };

/** Dense week grid for the calendar heatmap -- outer array is weeks
 *  oldest->newest, each inner array is 7 days Sun..Sat (every day present,
 *  0-filled where there's no ride), with the last week always containing
 *  `todayLocal`. */
export function buildHeatmapWeeks(dayCounts: DayCount[], todayLocal: string, weeksBack: number): HeatmapCell[][] {
    const countByDay = new Map(dayCounts.map((d) => [d.date, d.count]));
    const daysSinceWeekStart = dayOfWeekLocal(todayLocal); // how far today is from this week's Sunday

    const weeks: HeatmapCell[][] = [];
    for (let w = weeksBack - 1; w >= 0; w--) {
        const week: HeatmapCell[] = [];
        for (let dow = 0; dow < 7; dow++) {
            const offset = dow - daysSinceWeekStart - w * 7;
            const date = addDaysLocal(todayLocal, offset);
            week.push({ date, count: countByDay.get(date) ?? 0 });
        }
        weeks.push(week);
    }
    return weeks;
}

export type StreakStats = { currentStreak: number; longestStreak: number };

/** Current + longest consecutive-local-day ride streaks. Current streak uses
 *  grace-day semantics: it stays alive if the most recent ride day is today
 *  OR yesterday (not logging a ride yet today doesn't zero out yesterday's
 *  streak), and drops to 0 only once a full calendar day passes with no
 *  ride at all. */
export function computeStreaksPure(dayCounts: DayCount[], todayLocal: string): StreakStats {
    const activeDays = [...new Set(dayCounts.filter((d) => d.count > 0).map((d) => d.date))].sort();
    if (activeDays.length === 0) return { currentStreak: 0, longestStreak: 0 };

    let longestStreak = 1;
    let run = 1;
    for (let i = 1; i < activeDays.length; i++) {
        run = addDaysLocal(activeDays[i - 1], 1) === activeDays[i] ? run + 1 : 1;
        longestStreak = Math.max(longestStreak, run);
    }

    const mostRecent = activeDays[activeDays.length - 1];
    const yesterday = addDaysLocal(todayLocal, -1);
    let currentStreak = 0;
    if (mostRecent === todayLocal || mostRecent === yesterday) {
        currentStreak = 1;
        for (let i = activeDays.length - 1; i > 0; i--) {
            if (addDaysLocal(activeDays[i - 1], 1) === activeDays[i]) {
                currentStreak++;
            } else {
                break;
            }
        }
    }

    return { currentStreak, longestStreak };
}

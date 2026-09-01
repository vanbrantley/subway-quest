// mobile/lib/dateMath.ts
//
// Pure local-calendar-day date math -- zero imports, shared by every
// time-range filter, the ride-activity heatmap, and streak computation. See
// db/projection.ts's buildOccurredAt() comment for why local-vs-UTC day
// bucketing is a real correctness concern here, not pedantry: trips.started_at
// is always a UTC instant, but a rider thinks in local calendar days.

export type TimeRange = 'all' | '30d' | '7d';

export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/** Local calendar date ('YYYY-MM-DD') for a given moment. Deliberately NOT
 *  `date.toISOString().slice(0, 10)` -- that's the UTC calendar date, wrong
 *  near local midnight. */
export function localDateString(d: Date = new Date()): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Parses a 'YYYY-MM-DD' string as local midnight -- NOT `new Date(dateStr)`,
 *  which the JS spec treats as UTC for a bare date-only ISO string and would
 *  silently shift the day near local midnight (the same bug class
 *  buildOccurredAt's fix note in db/projection.ts documents). */
function parseLocalDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

export function addDaysLocal(dateStr: string, days: number): string {
    const d = parseLocalDate(dateStr);
    d.setDate(d.getDate() + days);
    return localDateString(d);
}

/** 0 = Sunday .. 6 = Saturday, for the given local calendar day. */
export function dayOfWeekLocal(dateStr: string): number {
    return parseLocalDate(dateStr).getDay();
}

/** Whole local calendar days from `fromDateStr` to `toDateStr` (positive if
 *  `to` is later). Used to size the heatmap's scroll window from the
 *  earliest ride to today. */
export function daysBetweenLocal(fromDateStr: string, toDateStr: string): number {
    const from = parseLocalDate(fromDateStr).getTime();
    const to = parseLocalDate(toDateStr).getTime();
    return Math.round((to - from) / 86400000);
}

/** Local midnight of the given calendar day, as a UTC ISO instant -- for
 *  comparing against started_at (always UTC) when filtering by a local
 *  calendar-day cutoff. Same local->UTC construction technique as
 *  buildOccurredAt in db/projection.ts. */
export function localMidnightToIsoUtc(dateStr: string): string {
    return parseLocalDate(dateStr).toISOString();
}

/** Trailing-N-local-days start date for a time-range filter, inclusive of
 *  today. null for 'all' (no cutoff). */
export function rangeToStartDate(range: TimeRange, today: Date = new Date()): string | null {
    if (range === 'all') return null;
    const todayStr = localDateString(today);
    return range === '30d' ? addDaysLocal(todayStr, -29) : addDaysLocal(todayStr, -6); // '7d'
}

function ordinalDay(day: number): string {
    const rem100 = day % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
    switch (day % 10) {
        case 1: return `${day}st`;
        case 2: return `${day}nd`;
        case 3: return `${day}rd`;
        default: return `${day}th`;
    }
}

/** 'YYYY-MM-DD' -> "August 3rd" (current local year), or "August 3rd, 2025"
 *  once the calendar year has turned over -- used by RideHeatmap's
 *  tap-to-reveal readout. */
export function friendlyDateLocal(dateStr: string, todayLocal: string = localDateString()): string {
    const [yearStr, monthStr, dayStr] = dateStr.split('-');
    const label = `${MONTH_NAMES[Number(monthStr) - 1]} ${ordinalDay(Number(dayStr))}`;
    return yearStr === todayLocal.slice(0, 4) ? label : `${label}, ${yearStr}`;
}

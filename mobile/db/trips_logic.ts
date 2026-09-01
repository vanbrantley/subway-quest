// mobile/db/trips_logic.ts
//
// Pure per-stop grouping of ridden legs -- zero imports of expo-sqlite/RN,
// same split as stations_logic.ts/quests_logic.ts. trips.ts (the I/O
// wrapper) queries SQLite, then calls into this file with plain leg rows.
// Feeds the Line page's per-stop ride history section.

export type LineLegEntry = {
    legId: string;
    tripId: string;
    entryStationId: string;
    exitStationId: string;
    boardedAt: string;
    alightedAt: string;
};

export type StopRideEvent = { tripId: string; legId: string; at: string; kind: 'boarded' | 'alighted' };

/** Groups a line's ridden legs by stop_id -- a 'boarded' event under the
 *  entry station, an 'alighted' event under the exit station. Same entry+exit
 *  grain as "visited" everywhere else in the app (see stations_logic.ts's
 *  getVisitedStationIdsPure) -- legs only record entry/exit, not every
 *  station physically passed through, so this is "rode from/to this stop,"
 *  not full route tracing. Each stop's list sorted most-recent-first. */
export function groupLegsByStopPure(legs: LineLegEntry[]): Record<string, StopRideEvent[]> {
    const byStop: Record<string, StopRideEvent[]> = {};
    for (const leg of legs) {
        (byStop[leg.entryStationId] ??= []).push({ tripId: leg.tripId, legId: leg.legId, at: leg.boardedAt, kind: 'boarded' });
        (byStop[leg.exitStationId] ??= []).push({ tripId: leg.tripId, legId: leg.legId, at: leg.alightedAt, kind: 'alighted' });
    }
    for (const stopId of Object.keys(byStop)) {
        byStop[stopId].sort((a, b) => b.at.localeCompare(a.at));
    }
    return byStop;
}

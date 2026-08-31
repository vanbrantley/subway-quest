// mobile/db/insights.ts
//
// Thin I/O wrapper: reuses quests.ts's loadRiderHistory (same trips/legs
// query every module needs) and the bundled stations.json, then calls into
// insights_logic.ts's pure fact computation. Never re-implements the
// computation here -- same principle as quests.ts/trivia.ts.

import * as SQLite from 'expo-sqlite';
import stationsData from '../data/stations.json';
import { loadRiderHistory } from './quests';
import type { ComplexLookup, RiderHistory } from './quests_logic';
import { computeTripInsightsPure, type InsightFact } from './insights_logic';

// ---- stop_id -> complex_id, built independently here from bundled
// stations.json -- same "each I/O wrapper rebuilds its own small lookups"
// convention quests.ts/trivia.ts already follow. ----
type StationsFile = Record<string, { complex_id: string; name: string }>;
const STATIONS = stationsData as unknown as StationsFile;
const COMPLEX_LOOKUP: ComplexLookup = Object.fromEntries(
    Object.entries(STATIONS).map(([stopId, s]) => [stopId, Number(s.complex_id)])
);

/** InsightFact enriched with what Trip Summary needs to render a specific
 *  row -- insights_logic.ts can't resolve a stop_id into a display name
 *  itself (it's pure, no data files), so computeTripInsights adds it here
 *  after calling the pure computation. Every other fact type needs no
 *  enrichment (nothing beyond ids/counts to display). */
export type EnrichedInsightFact = Exclude<InsightFact, { type: 'nth_unique_station' }> | (
    Extract<InsightFact, { type: 'nth_unique_station' }> & { stationName: string }
);

/** Every general (non-quest) analytical fact about this trip -- how many
 *  times this exact trip has been ridden, milestone unique-station counts,
 *  what number unique trip this is, rides-per-line, etc. Recomputed from
 *  full history on every call, same "diff with the trip in vs. filtered
 *  out, no cached state" shape as quests.ts's computeTripQuestProgress --
 *  correct whether called right after logging or on a much later revisit. */
export async function computeTripInsights(
    db: SQLite.SQLiteDatabase,
    userId: string,
    tripId: string
): Promise<EnrichedInsightFact[]> {
    const { history: historyAfter, tripDates } = await loadRiderHistory(db, userId);
    const historyBefore: RiderHistory = {
        trips: historyAfter.trips.filter((t) => t.tripId !== tripId),
        legs: historyAfter.legs.filter((l) => l.tripId !== tripId),
    };
    const thisTripLegs = historyAfter.legs.filter((l) => l.tripId === tripId);

    const facts = computeTripInsightsPure(historyBefore, historyAfter, thisTripLegs, tripId, tripDates, COMPLEX_LOOKUP);
    return facts.map((f): EnrichedInsightFact => {
        if (f.type === 'nth_unique_station') {
            return { ...f, stationName: STATIONS[f.stopId]?.name ?? f.stopId };
        }
        return f;
    });
}

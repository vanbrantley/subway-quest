// mobile/db/quests.ts
//
// Thin I/O wrapper: queries local SQLite (trips/legs), reads the bundled
// quests.json/stations.json/route_stops.json, and calls into quests-logic.ts's
// pure evaluators. Never re-implements evaluation logic here -- one place
// owns "what counts as quest progress," same principle as writeProjectionRows
// being the one place that owns "what a committed trip's projection rows
// look like" (see projection.ts).

import * as SQLite from 'expo-sqlite';
import questsData from '../data/quests.json';
import stationsData from '../data/stations.json';
import routeStopsData from '../data/route_stops.json';
import {
    RiderHistory, ComplexLookup, QuestsFile,
    QuestProgress, QuestDeltaResult,
    getAllQuestProgressPure, computeTripQuestDeltaPure,
} from './quests_logic';

const QUESTS = questsData as unknown as QuestsFile;

// ---- stop_id -> complex_id, built once from the bundled stations.json.
// See quests-logic.ts's ComplexLookup doc comment for why this translation is
// non-optional. ----
type StationsFile = Record<string, { complex_id: string }>;
const STATIONS = stationsData as unknown as StationsFile;
const COMPLEX_LOOKUP: ComplexLookup = Object.fromEntries(
    Object.entries(STATIONS).map(([stopId, s]) => [stopId, Number(s.complex_id)])
);

// ---- every real route_id, for all_routes criteria with no explicit list ----
type Branch = { branch_id: string; stops: string[] };
type RouteStopsFile = Record<string, Record<string, Branch[]>>;
const ROUTE_STOPS = routeStopsData as unknown as RouteStopsFile;
const ALL_REAL_ROUTES: string[] = Object.keys(ROUTE_STOPS);

// ---- full station span per route (all branches flattened, deduped), for
// full_line_ride. Mirrors resolve_route_branches' branch-reading approach on
// the Python side, but wants the union, not the exclusive tails -- no
// trunk/tail split needed here. ----
const FULL_ROUTE_SPANS: Record<string, string[]> = Object.fromEntries(
    Object.entries(ROUTE_STOPS).map(([routeId, directions]) => {
        const stops = new Set<string>();
        for (const branches of Object.values(directions)) {
            for (const branch of branches) {
                for (const stopId of branch.stops) stops.add(stopId);
            }
        }
        return [routeId, [...stops]];
    })
);

async function loadRiderHistory(db: SQLite.SQLiteDatabase, userId: string): Promise<RiderHistory> {
    const trips = await db.getAllAsync<{
        trip_id: string; origin_station_id: string; destination_station_id: string;
    }>(`SELECT trip_id, origin_station_id, destination_station_id FROM trips WHERE user_id = ?`, [userId]);

    const legs = await db.getAllAsync<{
        leg_id: string; trip_id: string; sequence: number; route_id: string;
        entry_station_id: string; exit_station_id: string;
    }>(
        `SELECT l.leg_id, l.trip_id, l.sequence, l.route_id, l.entry_station_id, l.exit_station_id
         FROM legs l JOIN trips t ON l.trip_id = t.trip_id WHERE t.user_id = ?`,
        [userId]
    );

    return {
        trips: trips.map((t) => ({
            tripId: t.trip_id, originStationId: t.origin_station_id, destinationStationId: t.destination_station_id,
        })),
        legs: legs.map((l) => ({
            legId: l.leg_id, tripId: l.trip_id, sequence: l.sequence, routeId: l.route_id,
            entryStationId: l.entry_station_id, exitStationId: l.exit_station_id,
        })),
    };
}

/** Progress on every quest -- feeds the achievements list page,
 *  StationQuestsList, and ProfileQuestsSummary. */
export async function getAllQuestProgress(
    db: SQLite.SQLiteDatabase,
    userId: string
): Promise<QuestProgress[]> {
    const history = await loadRiderHistory(db, userId);
    return getAllQuestProgressPure(QUESTS, history, COMPLEX_LOOKUP, ALL_REAL_ROUTES, FULL_ROUTE_SPANS);
}

/** Progress on a single quest, plus its title/description -- feeds the
 *  challenge-detail page. */
export async function getQuestDetail(
    db: SQLite.SQLiteDatabase,
    userId: string,
    questId: string
): Promise<(QuestProgress & { title: string; description: string }) | null> {
    const quest = QUESTS[questId];
    if (!quest) return null;
    const all = await getAllQuestProgress(db, userId);
    const match = all.find((p) => p.questId === questId);
    if (!match) return null;
    return { ...match, title: quest.title, description: quest.description };
}

/**
 * Which quests did THIS specific trip newly complete -- feeds the Trip
 * Detail/Summary page's "which quest(s) that trip contributed progress
 * toward" (see ui-spec.md).
 *
 * DESIGN NOTE, worth confirming: this recomputes historyBefore by loading
 * the full post-commit history and filtering the given tripId back out,
 * rather than being called from inside commitTrip's own transaction with the
 * draft already in hand. data-layer.md's original framing described the
 * latter ("computed inside the same commit transaction... since the new
 * trip's legs are already in hand at that moment"). This version is simpler
 * to wire (call it from trip.tsx using the tripId param it already has, no
 * changes needed to commitTrip's signature or transaction) and is exactly as
 * correct -- set membership doesn't care about insertion order, only about
 * "before this trip existed" vs "after." At this project's real data scale
 * the extra query is negligible. If the original in-transaction approach is
 * preferred, this can be refactored to accept the draft directly and called
 * from within commitTrip instead -- flagging the tradeoff rather than
 * silently picking one.
 */
export async function computeTripQuestDelta(
    db: SQLite.SQLiteDatabase,
    userId: string,
    tripId: string
): Promise<QuestDeltaResult[]> {
    const historyAfter = await loadRiderHistory(db, userId); // trip is already committed by the time this is called
    const historyBefore: RiderHistory = {
        trips: historyAfter.trips.filter((t) => t.tripId !== tripId),
        legs: historyAfter.legs.filter((l) => l.tripId !== tripId),
    };
    const thisTripLegs = historyAfter.legs.filter((l) => l.tripId === tripId);

    return computeTripQuestDeltaPure(
        QUESTS, historyBefore, historyAfter, thisTripLegs, COMPLEX_LOOKUP, ALL_REAL_ROUTES, FULL_ROUTE_SPANS
    );
}
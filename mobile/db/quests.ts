// mobile/db/quests.ts
//
// Thin I/O wrapper: queries local SQLite (trips/legs), reads the bundled
// quests.json/stations.json/route_stops.json, and calls into quests_logic.ts's
// pure evaluators. Never re-implements evaluation logic here -- one place
// owns "what counts as quest progress," same principle as writeProjectionRows
// being the one place that owns "what a committed trip's projection rows
// look like" (see projection.ts).

import * as SQLite from 'expo-sqlite';
import questsData from '../data/quests.json';
import stationsData from '../data/stations.json';
import routeStopsData from '../data/route_stops.json';
import {
    RiderHistory, ComplexLookup, QuestsFile, Quest,
    QuestProgress, QuestTripProgress, QuestBreakdown,
    getAllQuestProgressPure, computeTripQuestProgressPure,
    evaluateQuestProgress, getQuestBreakdown as getQuestBreakdownPure,
    questIdsForStation,
} from './quests_logic';

export type { QuestTripProgress } from './quests_logic';

const QUESTS = questsData as unknown as QuestsFile;

// ---- stop_id -> complex_id, built once from the bundled stations.json.
// See quests_logic.ts's ComplexLookup doc comment for why this translation is
// non-optional. ----
type StationsFile = Record<string, { complex_id: string; name: string }>;
const STATIONS = stationsData as unknown as StationsFile;
const COMPLEX_LOOKUP: ComplexLookup = Object.fromEntries(
    Object.entries(STATIONS).map(([stopId, s]) => [stopId, Number(s.complex_id)])
);

// complex_id -> display name, for enriching breakdown items with real station
// names -- the pure module only knows complex_ids (numbers), and screens
// shouldn't have to import stations.json separately just to label them.
// First name seen per complex_id wins (a physical complex is served by
// multiple stop_ids, occasionally with tiny naming variants -- not worth
// reconciling here, matches build_quests.py's own dedupe-by-complex pattern).
const COMPLEX_NAMES: Record<number, string> = {};
for (const s of Object.values(STATIONS)) {
    const cid = Number(s.complex_id);
    if (!(cid in COMPLEX_NAMES)) COMPLEX_NAMES[cid] = s.name;
}

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

/** Substitutes the {count} placeholder some quest descriptions carry (e.g.
 *  Beachy's "Visit at least {count} beach stations.") with the criteria's
 *  actual count value. Lives here, not in quests_logic.ts, since it's string
 *  formatting for display, not a progress fact -- same reasoning as
 *  title/description enrichment happening at this layer, not the pure one. */
function formatDescription(quest: Quest): string {
    const criteria = quest.criteria as { count?: number };
    return criteria.count !== undefined
        ? quest.description.replace('{count}', String(criteria.count))
        : quest.description;
}

async function loadRiderHistory(
    db: SQLite.SQLiteDatabase,
    userId: string
): Promise<{ history: RiderHistory; tripDates: Record<string, string> }> {
    const trips = await db.getAllAsync<{
        trip_id: string; origin_station_id: string; destination_station_id: string; started_at: string;
    }>(`SELECT trip_id, origin_station_id, destination_station_id, started_at FROM trips WHERE user_id = ?`, [userId]);

    const legs = await db.getAllAsync<{
        leg_id: string; trip_id: string; sequence: number; route_id: string;
        entry_station_id: string; exit_station_id: string;
    }>(
        `SELECT l.leg_id, l.trip_id, l.sequence, l.route_id, l.entry_station_id, l.exit_station_id
         FROM legs l JOIN trips t ON l.trip_id = t.trip_id WHERE t.user_id = ?`,
        [userId]
    );

    return {
        history: {
            trips: trips.map((t) => ({
                tripId: t.trip_id, originStationId: t.origin_station_id, destinationStationId: t.destination_station_id,
            })),
            legs: legs.map((l) => ({
                legId: l.leg_id, tripId: l.trip_id, sequence: l.sequence, routeId: l.route_id,
                entryStationId: l.entry_station_id, exitStationId: l.exit_station_id,
            })),
        },
        tripDates: Object.fromEntries(trips.map((t) => [t.trip_id, t.started_at])),
    };
}

export type QuestSummary = QuestProgress & { title: string; description: string };

/** Progress on every quest, WITH title/description (description already has
 *  {count} substituted) -- feeds the achievements list page,
 *  StationQuestsList, and ProfileQuestsSummary. Enriched here (not in
 *  quests_logic.ts) since title/description are static content, not a
 *  progress fact -- the pure module stays progress-only. */
export async function getAllQuestProgress(
    db: SQLite.SQLiteDatabase,
    userId: string
): Promise<QuestSummary[]> {
    const { history } = await loadRiderHistory(db, userId);
    const progress = getAllQuestProgressPure(QUESTS, history, COMPLEX_LOOKUP, ALL_REAL_ROUTES, FULL_ROUTE_SPANS);
    return progress.map((p) => ({ ...p, title: QUESTS[p.questId].title, description: formatDescription(QUESTS[p.questId]) }));
}

export type QuestDetail = QuestSummary & {
    breakdown: EnrichedQuestBreakdown;
    // tripId -> started_at, for the detail page to show "visited on ..." next
    // to each breakdown item that has one or more tripIds attached.
    tripDates: Record<string, string>;
};

// Same shapes as quests_logic.ts's QuestBreakdown, with real station names
// substituted for bare complex_ids -- built here, not in the pure module,
// since names are display content (mirrors the title/description pattern).
export type EnrichedStationBreakdownItem = { complexId: number; name: string; visited: boolean; tripIds: string[] };
export type EnrichedGroupBreakdownItem = {
    groupIndex: number;
    complexIds: number[]; // parallel to names -- complexIds[i] is the id for names[i]
    names: string[];
    minRequired: number;
    visitedComplexIds: number[];
    visited: boolean;
    tripIds: string[];
};
export type EnrichedPairBreakdownItem = { station: number; stationName: string; route: string; visited: boolean; tripIds: string[] };
export type EnrichedRouteBreakdownItem = { route: string; visited: boolean; tripIds: string[] };

export type EnrichedQuestBreakdown =
    | { kind: 'stations'; items: EnrichedStationBreakdownItem[] }
    | { kind: 'groups'; items: EnrichedGroupBreakdownItem[] }
    | { kind: 'pairs'; items: EnrichedPairBreakdownItem[] }
    | { kind: 'routes'; items: EnrichedRouteBreakdownItem[] }
    | { kind: 'per_trip'; qualifyingTripIds: string[] }
    | { kind: 'counting'; current: number; target: number; contributingTripIds: string[] };

function enrichBreakdown(breakdown: QuestBreakdown): EnrichedQuestBreakdown {
    const nameOf = (cid: number) => COMPLEX_NAMES[cid] ?? `Unknown station (${cid})`;
    switch (breakdown.kind) {
        case 'stations':
            return {
                kind: 'stations',
                items: breakdown.items.map((i) => ({ complexId: i.complexId, name: nameOf(i.complexId), visited: i.visited, tripIds: i.tripIds })),
            };
        case 'groups':
            return {
                kind: 'groups',
                items: breakdown.items.map((i) => ({
                    groupIndex: i.groupIndex,
                    complexIds: i.complexIds,
                    names: i.complexIds.map(nameOf),
                    minRequired: i.minRequired,
                    visitedComplexIds: i.visitedComplexIds,
                    visited: i.visited,
                    tripIds: i.tripIds,
                })),
            };
        case 'pairs':
            return {
                kind: 'pairs',
                items: breakdown.items.map((i) => ({ station: i.station, stationName: nameOf(i.station), route: i.route, visited: i.visited, tripIds: i.tripIds })),
            };
        case 'routes':
        case 'per_trip':
        case 'counting':
            return breakdown; // no complex_ids in these shapes -- nothing to enrich
    }
}

/** Progress on a single quest, PLUS the itemized breakdown (which specific
 *  stations/groups/pairs/routes are done vs. not, and which trip did each
 *  one) and a tripId -> date lookup so the detail page can show exactly when
 *  -- feeds the challenge-detail page's "which parts are done, which remain,
 *  and the trips associated with the ones you have done." */
export async function getQuestDetail(
    db: SQLite.SQLiteDatabase,
    userId: string,
    questId: string
): Promise<QuestDetail | null> {
    const quest = QUESTS[questId];
    if (!quest) return null;

    const { history, tripDates } = await loadRiderHistory(db, userId);
    const progress = evaluateQuestProgress(quest, history, COMPLEX_LOOKUP, ALL_REAL_ROUTES, FULL_ROUTE_SPANS);
    const breakdown = enrichBreakdown(getQuestBreakdownPure(quest, history, COMPLEX_LOOKUP, ALL_REAL_ROUTES, FULL_ROUTE_SPANS));

    return {
        questId, ...progress,
        title: quest.title, description: formatDescription(quest),
        breakdown, tripDates,
    };
}

/**
 * Every quest THIS specific trip made progress on -- not just ones it fully
 * completed. Feeds the Trip Detail/Summary page's "which quest(s) that trip
 * contributed progress toward" (see ui-spec.md) -- shown always, right after
 * logging, so partial progress (e.g. Beachy going from 1/6 to 2/6) is just as
 * visible as a full completion, per the "always show the dopamine hit"
 * requirement.
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
export async function computeTripQuestProgress(
    db: SQLite.SQLiteDatabase,
    userId: string,
    tripId: string
): Promise<QuestTripProgress[]> {
    const { history: historyAfter } = await loadRiderHistory(db, userId); // trip is already committed by the time this is called
    const historyBefore: RiderHistory = {
        trips: historyAfter.trips.filter((t) => t.tripId !== tripId),
        legs: historyAfter.legs.filter((l) => l.tripId !== tripId),
    };
    const thisTripLegs = historyAfter.legs.filter((l) => l.tripId === tripId);

    return computeTripQuestProgressPure(
        QUESTS, historyBefore, historyAfter, thisTripLegs, COMPLEX_LOOKUP, ALL_REAL_ROUTES, FULL_ROUTE_SPANS
    );
}

/** Every quest that references this specific station (complex_id), with the
 *  user's current progress on each -- feeds StationQuestsList, which mounts
 *  wherever a station is shown (canonical Station page, milestone 9). */
export async function getQuestsForStation(
    db: SQLite.SQLiteDatabase,
    userId: string,
    complexId: number
): Promise<QuestSummary[]> {
    const relevantIds = questIdsForStation(QUESTS, complexId);
    if (relevantIds.length === 0) return [];

    const { history } = await loadRiderHistory(db, userId);
    return relevantIds.map((questId) => {
        const quest = QUESTS[questId];
        const progress = evaluateQuestProgress(quest, history, COMPLEX_LOOKUP, ALL_REAL_ROUTES, FULL_ROUTE_SPANS);
        return { questId, ...progress, title: quest.title, description: formatDescription(quest) };
    });
}
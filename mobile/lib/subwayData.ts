// mobile/lib/subwayData.ts
//
// Small helpers over the bundled static GTFS-derived data (mobile/data/*.json).
// Kept in one place so trip-logging screens share the same lookups.

import routeStops from '../data/route_stops.json';
import stations from '../data/stations.json';
import transfers from '../data/transfers.json';
import { LINE_ICONS } from '../constants/lineIcons';
import { LINE_COLORS, sortRouteIds } from '../constants/lineColors';

type Branch = { branch_id: string; stops: string[] };
type RouteStops = Record<string, Record<string, Branch[]>>;
export type Station = {
    stop_id: string;
    station_id: string;
    complex_id: string;
    name: string;
    line: string;
    borough: string;
    lat: number;
    lon: number;
    daytime_routes: string[];
    structure: string;
    ada: boolean;
};
type Stations = Record<string, Station>;
type TransferComplex = { complex_id: string; routes: string[] };
type Transfers = Record<string, TransferComplex>;

const BOROUGH_NAMES: Record<string, string> = {
    M: 'Manhattan',
    Bk: 'Brooklyn',
    Bx: 'Bronx',
    Q: 'Queens',
    SI: 'Staten Island',
};

// The station data's daytime_routes uses raw GTFS-ish display labels that
// don't always match route_stops.json's/LINE_ICONS'/LINE_COLORS' keys —
// specifically 'SIR' (station data) vs 'SI' (everywhere else). Normalizing
// here, not fixing the underlying inconsistency (see status.md's "Shuttle
// grouping" item — a separately-tracked, pre-existing bug, not this
// milestone's job). Bare 'S' (generic shuttle) has no real routable
// route_id and is deliberately left unmapped — isNavigableRoute() below is
// what keeps a bare 'S' icon from being treated as tappable.
const DISPLAY_ROUTE_ALIASES: Record<string, string> = { SIR: 'SI' };

const ROUTE_STOPS = routeStops as unknown as RouteStops;
const STATIONS = stations as unknown as Stations;
const TRANSFERS = transfers as unknown as Transfers;

// The three real, separately-completable shuttle routes 'S' groups for display.
// route_stops.json has no 'S' key at all — only these three real route_ids.
// Never write 'S' itself to a leg/event; it's a pure display grouping, resolved
// to one of these the moment a real entry station is picked (see log-trip.tsx).
const SHUTTLE_ROUTE_IDS = ['FS', 'GS', 'H'];

// Every route with either a custom icon or a color fallback — this is the single
// definition of "a route we actually show anywhere in the logging flow," shared
// by the line grid and transfer suggestions so they can never disagree about
// which GTFS route codes (6X, GS, etc.) are real, rider-facing lines. 'S' is
// added explicitly — it's a synthetic grouping id, never a route_stops.json key,
// so the filter below can't discover it on its own.
const DISPLAYABLE_ROUTES = new Set([
    ...Object.keys(routeStops).filter((id) => id in LINE_ICONS || id in LINE_COLORS),
    'S',
]);

// The line grid shows one 'S' tile, not three — the raw shuttle route_ids are
// real for resolution/rendering purposes (DISPLAYABLE_ROUTES, LINE_ICONS) but
// never tap targets of their own.
export function getDisplayableRoutes(): string[] {
    return sortRouteIds([...DISPLAYABLE_ROUTES].filter((id) => !SHUTTLE_ROUTE_IDS.includes(id)));
}

export function getStationName(stopId: string): string {
    return STATIONS[stopId]?.name ?? stopId;
}

export function getComplexId(stopId: string): string | undefined {
    return STATIONS[stopId]?.complex_id;
}

export function getStation(stopId: string): Station | undefined {
    return STATIONS[stopId];
}

export function getBoroughName(code: string): string {
    return BOROUGH_NAMES[code] ?? code;
}

// ---- Search tab: name lookup over the full bundled station list ----
//
// One row per stop_id, deliberately not deduped by name/complex — 76 of the
// 496 stations share a name with at least one other stop_id (e.g.
// "14 St-Union Sq" is 3 separate stop_ids, one per platform group), and
// this keeps the same stop_id grain used everywhere else (Map markers,
// Station page's "This platform"). Whichever duplicate gets tapped, that
// platform's Station page already surfaces the complex's other lines via
// "Transfer here" — no dead end from picking the "wrong" one of a
// same-named group.

export type StationSearchResult = {
    stopId: string;
    name: string;
    borough: string;
    daytimeRoutes: string[];
};

export function searchStations(query: string): StationSearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const startsWith: StationSearchResult[] = [];
    const contains: StationSearchResult[] = [];

    for (const [stopId, station] of Object.entries(STATIONS)) {
        const nameLower = station.name.toLowerCase();
        const index = nameLower.indexOf(q);
        if (index === -1) continue;
        const result: StationSearchResult = {
            stopId,
            name: station.name,
            borough: station.borough,
            daytimeRoutes: station.daytime_routes,
        };
        (index === 0 ? startsWith : contains).push(result);
    }

    const byName = (a: StationSearchResult, b: StationSearchResult) => a.name.localeCompare(b.name);
    return [...startsWith.sort(byName), ...contains.sort(byName)];
}

// Maps a raw display route label (as seen in stations.json's daytime_routes)
// to the key used everywhere else (route_stops.json, LINE_ICONS, LINE_COLORS)
// — currently just SIR -> SI. Anything with no alias passes through
// unchanged (including bare 'S', deliberately left unmapped).
export function normalizeRouteIdForIcon(routeId: string): string {
    return DISPLAY_ROUTE_ALIASES[routeId] ?? routeId;
}

// Whether a route_id has real branch/station data behind it — i.e. whether
// pushing the Line page for it would actually show something. 'S' is a
// special case: it's not a route_stops.json key (never will be — it's a
// pure display grouping, see SHUTTLE_ROUTE_IDS), but it IS navigable to the
// combined shuttle overview page (see getShuttleGroups()/line/[lineId].tsx),
// so it's listed explicitly rather than derived from ROUTE_STOPS membership.
export function isNavigableRoute(routeId: string): boolean {
    return routeId === 'S' || routeId in ROUTE_STOPS;
}

// 'S' resolves to the union of all three real shuttles' branches — this one
// case is what makes getStationIdsForRoute('S')/getValidExitStations('S', ...)
// return the combined FS+GS+H stop list for free, everywhere in this file
// that's already built on branchesForRoute.
function branchesForRoute(routeId: string): Branch[] {
    if (routeId === 'S') return SHUTTLE_ROUTE_IDS.flatMap((r) => ROUTE_STOPS[r]?.['0'] ?? []);
    return ROUTE_STOPS[routeId]?.['0'] ?? [];
}

// Given a picked entry stop, which real shuttle actually serves it — the
// resolution step that turns a transient 'S' selection into the real route_id
// that gets committed to a leg. Never returns 'S' itself.
export function resolveShuttleRouteId(stopId: string): string | null {
    return SHUTTLE_ROUTE_IDS.find((r) => getStationIdsForRoute(r).includes(stopId)) ?? null;
}

// Human-friendly names for the three real shuttles — route_stops.json/
// stations.json carry no display-name data of their own (only route codes).
const SHUTTLE_NAMES: Record<string, string> = {
    FS: 'Franklin Ave Shuttle',
    GS: '42 St Shuttle',
    H: 'Rockaway Park Shuttle',
};

export type ShuttleGroup = { routeId: string; label: string; stops: string[] };

// The three real shuttles, each as its own labeled group with its own real
// stations — the combined 'S' overview page's data (see line/[lineId].tsx's
// special case for lineId === 'S'). Deliberately separate from
// getLineStationLayout()'s generic trunk/tail logic: S isn't a branching
// route with a shared trunk, it's three unrelated routes sharing one display
// icon, so labeling by real shuttle name (not by shared-segment geometry)
// is the correct grouping here.
export function getShuttleGroups(): ShuttleGroup[] {
    return SHUTTLE_ROUTE_IDS.map((routeId) => ({
        routeId,
        label: SHUTTLE_NAMES[routeId],
        stops: getStationIdsForRoute(routeId),
    }));
}

export function getStationIdsForRoute(routeId: string): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const branch of branchesForRoute(routeId)) {
        for (const stopId of branch.stops) {
            if (!seen.has(stopId)) {
                seen.add(stopId);
                ordered.push(stopId);
            }
        }
    }
    return ordered;
}

export function getValidExitStations(routeId: string, entryStopId: string): string[] {
    const branches = branchesForRoute(routeId).filter((b) => b.stops.includes(entryStopId));
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const branch of branches) {
        for (const stopId of branch.stops) {
            if (stopId !== entryStopId && !seen.has(stopId)) {
                seen.add(stopId);
                ordered.push(stopId);
            }
        }
    }
    return ordered;
}

export function getDefaultExitStation(routeId: string, entryStopId: string): string | null {
    const branches = branchesForRoute(routeId).filter((b) => b.stops.includes(entryStopId));
    if (branches.length === 0) return null;

    const branch = branches[0];
    const index = branch.stops.indexOf(entryStopId);
    const successor = branch.stops[index + 1];
    const predecessor = branch.stops[index - 1];

    return successor ?? predecessor ?? null;
}

// Every displayable route at a given transfer complex, unfiltered — the
// shared lookup both getTransferRoutes (trip-logging's transfer step) and
// getOtherComplexRoutes (Station/Line pages' "other lines here" display)
// build on, so there's exactly one place that reads transfers.json.
function routesAtComplex(complexId: string): string[] {
    const complex = TRANSFERS[complexId];
    if (!complex) return [];
    return complex.routes.filter((r) => DISPLAYABLE_ROUTES.has(r));
}

// Every displayable route reachable from wherever this leg ended, excluding the
// line just ridden (transferring to the same line makes no sense). Driven by
// transfers.json's complex-level rollup — same complex_id the exit station
// belongs to, not the individual stop_id, since a "transfer" in this app means
// "anywhere reachable within the same station complex."
export function getTransferRoutes(currentRouteId: string, exitStopId: string): string[] {
    const complexId = getComplexId(exitStopId);
    if (!complexId) return [];
    return sortRouteIds(routesAtComplex(complexId).filter((r) => r !== currentRouteId));
}

// Every displayable route at this stop's transfer complex OTHER than the
// stop's own daytime_routes — e.g. Union Sq's 4/5/6 platform's "other
// routes here" is N/Q/R/W/L, not 4/5/6 again. Feeds the canonical Station
// page's "Transfer here" group and the Line page's lightweight per-row
// transfer indicator — a display-only use of the same underlying transfer
// data getTransferRoutes already reads, not a new grain concept (saved/
// visited status stays scoped to the tapped stop_id regardless of what
// this returns; see data-layer.md's grain note).
export function getOtherComplexRoutes(stopId: string): string[] {
    const complexId = getComplexId(stopId);
    if (!complexId) return [];
    const ownRoutes = new Set(
        (STATIONS[stopId]?.daytime_routes ?? []).map(normalizeRouteIdForIcon)
    );
    return sortRouteIds(routesAtComplex(complexId).filter((r) => !ownRoutes.has(r)));
}

// Once a transfer line is picked, this finds the correct platform to auto-set as
// the next leg's entry — the specific stop_id, at the same complex, that actually
// serves the chosen route. Per ui-spec.md: "the user only picks the end" for a
// transfer leg, since they're already standing at this complex.
export function getEntryStopForTransfer(complexId: string, routeId: string): string | null {
    const match = Object.entries(STATIONS).find(
        ([, station]) => station.complex_id === complexId && station.daytime_routes?.includes(routeId)
    );
    return match ? match[0] : null;
}

// ---- Branch-aware station layout, for the canonical Line page ----
//
// PROJECT.md's station-picker UX decision: one scrollable, correctly-ordered
// stop list per line — trunk first, branch tails grouped/labeled further
// down — never a branch-selection step. Direction '0' only, matching every
// other function in this file that reads branchesForRoute().

// routeId is optional and only ever set for a group that IS itself a
// separately-navigable line (currently: the S overview page's three shuttle
// groups, via getShuttleGroups()) — a real geographic branch tail (e.g. one
// of the 5 train's forks) isn't its own line, so getLineStationLayout()
// never sets it. line/[lineId].tsx uses its presence to decide whether a
// group's header is itself tappable.
export type LineStationGroup = { label: string; stops: string[]; routeId?: string };
export type LineStationLayout = { trunk: string[]; tails: LineStationGroup[] };

function commonPrefixLen(lists: string[][]): number {
    const minLen = Math.min(...lists.map((l) => l.length));
    let i = 0;
    while (i < minLen && lists.every((l) => l[i] === lists[0][i])) i++;
    return i;
}

function commonSuffixLen(lists: string[][]): number {
    const minLen = Math.min(...lists.map((l) => l.length));
    let i = 0;
    while (i < minLen && lists.every((l) => l[l.length - 1 - i] === lists[0][lists[0].length - 1 - i])) i++;
    return i;
}

export function getLineStationLayout(routeId: string): LineStationLayout {
    const branches = branchesForRoute(routeId);
    if (branches.length === 0) return { trunk: [], tails: [] };
    if (branches.length === 1) return { trunk: branches[0].stops, tails: [] };

    const stopLists = branches.map((b) => b.stops);
    const minLen = Math.min(...stopLists.map((l) => l.length));
    const prefixLen = commonPrefixLen(stopLists);
    // Cap suffixLen so it can never overlap prefixLen within the shortest
    // branch — without this, a very short branch could make the two
    // shared regions double-count part of itself.
    const suffixLen = Math.min(commonSuffixLen(stopLists), minLen - prefixLen);

    // Real fork at both ends (route "5": 4 branches, distinct origins AND
    // distinct termini, no shared segment at all) — don't force a trunk
    // that doesn't exist. Every branch becomes its own top-level tail,
    // labeled by both its termini since there's no shared anchor to
    // describe it relative to.
    if (prefixLen === 0 && suffixLen === 0) {
        return {
            trunk: [],
            tails: branches.map((b) => ({
                label: `${getStationName(b.stops[0])} ↔ ${getStationName(b.stops[b.stops.length - 1])}`,
                stops: b.stops,
            })),
        };
    }

    if (prefixLen >= suffixLen) {
        // Prefix-trunk (e.g. N, R, E): shared start, diverging ends.
        const trunk = stopLists[0].slice(0, prefixLen);
        const tails: LineStationGroup[] = branches.map((b) => {
            const tailStops = b.stops.slice(prefixLen, b.stops.length - suffixLen);
            return { label: getStationName(tailStops[tailStops.length - 1] ?? trunk[trunk.length - 1]), stops: tailStops };
        });
        // A secondary shared trailing segment (route F: both branches
        // share the same start AND end, differing only in a middle
        // stopping-pattern variant — a data-pipeline nuance, not a real
        // geographic fork, per PROJECT.md's branch-dedup design). Shown
        // once, after every tail, instead of duplicated inside each one.
        if (suffixLen > 0) {
            tails.push({ label: 'Shared', stops: stopLists[0].slice(stopLists[0].length - suffixLen) });
        }
        return { trunk, tails };
    }

    // Suffix-trunk (e.g. A, 2): diverging starts, shared end. Trunk is
    // shown FIRST regardless — this is a display-order choice, not a
    // physical-direction requirement; "trunk first" just means "the
    // shared part first," wherever it happens to sit in the raw array.
    const trunk = stopLists[0].slice(stopLists[0].length - suffixLen);
    const tails: LineStationGroup[] = branches.map((b) => {
        const tailStops = b.stops.slice(prefixLen, b.stops.length - suffixLen);
        return { label: getStationName(tailStops[0] ?? trunk[0]), stops: tailStops };
    });
    if (prefixLen > 0) {
        tails.push({ label: 'Shared', stops: stopLists[0].slice(0, prefixLen) });
    }
    return { trunk, tails };
}
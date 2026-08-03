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

// Every route with either a custom icon or a color fallback — this is the single
// definition of "a route we actually show anywhere in the logging flow," shared
// by the line grid and transfer suggestions so they can never disagree about
// which GTFS route codes (6X, GS, etc.) are real, rider-facing lines.
const DISPLAYABLE_ROUTES = new Set(
    Object.keys(routeStops).filter((id) => id in LINE_ICONS || id in LINE_COLORS)
);

export function getDisplayableRoutes(): string[] {
    return sortRouteIds([...DISPLAYABLE_ROUTES]);
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

// Maps a raw display route label (as seen in stations.json's daytime_routes)
// to the key used everywhere else (route_stops.json, LINE_ICONS, LINE_COLORS)
// — currently just SIR -> SI. Anything with no alias passes through
// unchanged (including bare 'S', deliberately left unmapped).
export function normalizeRouteIdForIcon(routeId: string): string {
    return DISPLAY_ROUTE_ALIASES[routeId] ?? routeId;
}

// Whether a route_id has real branch/station data behind it — i.e. whether
// pushing the Line page for it would actually show something. Bare 'S'
// (generic shuttle grouping) fails this; 'SI' (after normalizing 'SIR')
// passes. Deliberately NOT fixing the underlying shuttle-grouping gap (see
// status.md) — this just keeps a non-navigable route's icon from being
// wired up as tappable, rather than pushing a broken/empty Line page.
export function isNavigableRoute(routeId: string): boolean {
    return routeId in ROUTE_STOPS;
}

function branchesForRoute(routeId: string): Branch[] {
    return ROUTE_STOPS[routeId]?.['0'] ?? [];
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

export type LineStationGroup = { label: string; stops: string[] };
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
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
type Station = { name: string; complex_id: string; daytime_routes: string[] };
type Stations = Record<string, Station>;
type TransferComplex = { complex_id: string; routes: string[] };
type Transfers = Record<string, TransferComplex>;

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

// Every displayable route reachable from wherever this leg ended, excluding the
// line just ridden (transferring to the same line makes no sense). Driven by
// transfers.json's complex-level rollup — same complex_id the exit station
// belongs to, not the individual stop_id, since a "transfer" in this app means
// "anywhere reachable within the same station complex."
export function getTransferRoutes(currentRouteId: string, exitStopId: string): string[] {
    const complexId = getComplexId(exitStopId);
    if (!complexId) return [];
    const complex = TRANSFERS[complexId];
    if (!complex) return [];
    return sortRouteIds(
        complex.routes.filter((r) => r !== currentRouteId && DISPLAYABLE_ROUTES.has(r))
    );
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
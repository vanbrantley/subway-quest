// Types matching the JSON output of data/scripts/build_static_data.py.
// If the pipeline's output shape ever changes, update these to match.

export interface Station {
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
}

// stations.json: keyed by GTFS stop_id
export type StationsData = Record<string, Station>;

export interface RouteBranchStops {
    branch_id: string;
    stops: string[]; // ordered list of GTFS stop_ids
}

// route_stops.json: route_id -> direction_id (as string, "0" | "1") -> branches
export type RouteStopsData = Record<string, Record<string, RouteBranchStops[]>>;

export interface RouteShapeBranch {
    branch_id: string;
    direction_id: number;
    color: string; // hex, e.g. "#EE352E"
    points: number[][]; // each inner array is [lat, lon]
}

// route_shapes.json: route_id -> array of branches
export type RouteShapesData = Record<string, RouteShapeBranch[]>;

export interface TransferComplex {
    complex_id: string;
    display_name: string;
    gtfs_stop_ids: string[];
    routes: string[]; // union of all routes serving this complex
    is_complex: boolean;
    borough: string;
}

// transfers.json: keyed by complex_id
export type TransfersData = Record<string, TransferComplex>;
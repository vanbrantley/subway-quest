import stationsJson from "../data/stations.json";
import routeStopsJson from "../data/route_stops.json";
import routeShapesJson from "../data/route_shapes.json";
import transfersJson from "../data/transfers.json";

import type {
    StationsData,
    RouteStopsData,
    RouteShapesData,
    TransfersData,
} from "../types/subwayData";

export const stations = stationsJson as StationsData;
export const routeStops = routeStopsJson as RouteStopsData;
export const routeShapes = routeShapesJson as RouteShapesData;
export const transfers = transfersJson as TransfersData;
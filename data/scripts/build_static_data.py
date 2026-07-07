"""
SubwayQuest static data precompute script.

Inputs (raw MTA / GTFS files):
  - stations.csv
  - complexes.csv
  - shapes.txt
  - trips.txt
  - routes.txt
  - stop_times.txt

Outputs (JSON, ready for the app to bundle):
  - stations.json       station-level info, keyed by GTFS stop_id
  - route_shapes.json   deduped polylines per route, grouped by branch
  - route_stops.json    ordered stop sequence per route, grouped by branch
  - transfers.json      complex_id -> routes available at that complex
"""

import json
import pandas as pd
from pathlib import Path
from collections import defaultdict

# Resolve paths relative to this script's location, assuming the structure:
#   data/
#     raw/          <- input files
#     processed/    <- output files land here
#     scripts/
#       build_static_data.py   <- this file
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent
RAW = DATA_DIR / "raw"
OUT = DATA_DIR / "processed"
OUT.mkdir(parents=True, exist_ok=True)


def strip_direction_suffix(stop_id: str) -> str:
    """Convert a platform-level stop_id (e.g. '101N') to its parent station id ('101')."""
    return stop_id.rstrip("NS")


def load_raw():
    stations = pd.read_csv(RAW / "stations.csv")
    complexes = pd.read_csv(RAW / "complexes.csv")
    shapes = pd.read_csv(RAW / "shapes.txt")
    trips = pd.read_csv(RAW / "trips.txt")
    routes = pd.read_csv(RAW / "routes.txt")
    stop_times = pd.read_csv(RAW / "stop_times.txt", dtype={"stop_id": str})
    return stations, complexes, shapes, trips, routes, stop_times


def build_stations_json(stations: pd.DataFrame) -> dict:
    out = {}
    for _, row in stations.iterrows():
        stop_id = str(row["GTFS Stop ID"])
        out[stop_id] = {
            "stop_id": stop_id,
            "station_id": str(row["Station ID"]),
            "complex_id": str(row["Complex ID"]),
            "name": row["Stop Name"],
            "line": row["Line"],
            "borough": row["Borough"],
            "lat": float(row["GTFS Latitude"]),
            "lon": float(row["GTFS Longitude"]),
            "daytime_routes": str(row["Daytime Routes"]).split(),
            "structure": row["Structure"],
            "ada": bool(int(row["ADA"])) if not pd.isna(row["ADA"]) else False,
        }
    return out


def build_transfers_json(complexes: pd.DataFrame) -> dict:
    """complex_id -> { routes: [...], gtfs_stop_ids: [...], stop_name } """
    out = {}
    for _, row in complexes.iterrows():
        complex_id = str(row["Complex ID"])
        gtfs_ids = [s.strip() for s in str(row["GTFS Stop IDs"]).split(";")]
        routes = str(row["Daytime Routes"]).split()
        out[complex_id] = {
            "complex_id": complex_id,
            "display_name": row["Display Name"],
            "gtfs_stop_ids": gtfs_ids,
            "routes": routes,
            "is_complex": bool(row["Is Complex"]),
            "borough": row["Borough"],
        }
    return out


def build_route_branches(trips: pd.DataFrame, stop_times: pd.DataFrame, shapes: pd.DataFrame, routes: pd.DataFrame):
    """
    Returns:
      route_stops: { route_id: { direction_id: [ { branch_id, stops: [stop_id,...] }, ... ] } }
      route_shapes: { route_id: [ { branch_id, direction_id, color, points: [[lat,lon],...] }, ... ] }
    """
    stop_times = stop_times.copy()
    stop_times["parent_stop_id"] = stop_times["stop_id"].map(strip_direction_suffix)
    stop_times = stop_times.sort_values(["trip_id", "stop_sequence"])

    # trip_id -> ordered tuple of parent stop ids
    trip_stop_seq = stop_times.groupby("trip_id")["parent_stop_id"].apply(tuple)

    trips_idx = trips.set_index("trip_id")
    route_color = dict(zip(routes["route_id"], routes["route_color"]))

    # shapes indexed for fast lookup, sorted by point sequence
    shapes_sorted = shapes.sort_values(["shape_id", "shape_pt_sequence"])
    shape_points = shapes_sorted.groupby("shape_id").apply(
        lambda g: list(zip(g["shape_pt_lat"], g["shape_pt_lon"]))
    )
    shape_npts = shapes_sorted.groupby("shape_id").size()

    # Build a dataframe: trip_id, route_id, direction_id, shape_id, stop_seq
    trip_info = trips[["trip_id", "route_id", "direction_id", "shape_id"]].copy()
    trip_info = trip_info[trip_info["trip_id"].isin(trip_stop_seq.index)]
    trip_info["stop_seq"] = trip_info["trip_id"].map(trip_stop_seq)

    route_stops = {}
    route_shapes = {}

    def is_subsequence(short, long_seq):
        it = iter(long_seq)
        return all(s in it for s in short)

    for route_id, route_group in trip_info.groupby("route_id"):
        route_stops[route_id] = {}
        route_shapes[route_id] = []

        for direction_id, dir_group in route_group.groupby("direction_id"):
            seq_to_shapes = dir_group.groupby("stop_seq")["shape_id"].unique()

            patterns = []
            for stop_seq, shape_ids in seq_to_shapes.items():
                if len(stop_seq) < 2:
                    continue
                best_shape = max(shape_ids, key=lambda sid: shape_npts.get(sid, 0))
                patterns.append({"stops": stop_seq, "shape_id": best_shape})

            endpoint_groups = defaultdict(list)
            for p in patterns:
                key = (p["stops"][0], p["stops"][-1])
                endpoint_groups[key].append(p)

            same_endpoint_survivors = []
            for (start, end), group in endpoint_groups.items():
                group_sorted = sorted(group, key=lambda p: -len(p["stops"]))
                kept = []
                for p in group_sorted:
                    if any(is_subsequence(p["stops"], k["stops"]) for k in kept):
                        continue
                    kept.append(p)
                same_endpoint_survivors.extend(kept)

            # Final pass: drop partial/short-turn trips whose full sequence is a
            # subsequence of a longer branch, even if endpoints differ (e.g. a
            # short-turn trip ending mid-route is already covered by the full one).
            all_sorted = sorted(same_endpoint_survivors, key=lambda p: -len(p["stops"]))
            merged_branches = []
            for p in all_sorted:
                if any(is_subsequence(p["stops"], k["stops"]) for k in merged_branches):
                    continue
                merged_branches.append(p)

            branches = []
            for i, p in enumerate(merged_branches):
                branch_id = f"{route_id}-{direction_id}-{i}"
                branches.append({
                    "branch_id": branch_id,
                    "direction_id": int(direction_id),
                    "stops": list(p["stops"]),
                    "shape_id": p["shape_id"],
                })

            route_stops[route_id][str(direction_id)] = [
                {"branch_id": b["branch_id"], "stops": b["stops"]} for b in branches
            ]

            for b in branches:
                pts = shape_points.get(b["shape_id"], [])
                route_shapes[route_id].append({
                    "branch_id": b["branch_id"],
                    "direction_id": b["direction_id"],
                    "color": f"#{route_color.get(route_id, '888888')}",
                    "points": [[round(lat, 6), round(lon, 6)] for lat, lon in pts],
                })

    return route_stops, route_shapes


def main():
    stations, complexes, shapes, trips, routes, stop_times = load_raw()

    print("Building stations.json...")
    stations_json = build_stations_json(stations)

    print("Building transfers.json...")
    transfers_json = build_transfers_json(complexes)

    print("Building route_stops.json and route_shapes.json...")
    route_stops_json, route_shapes_json = build_route_branches(trips, stop_times, shapes, routes)

    (OUT / "stations.json").write_text(json.dumps(stations_json, indent=2))
    (OUT / "transfers.json").write_text(json.dumps(transfers_json, indent=2))
    (OUT / "route_stops.json").write_text(json.dumps(route_stops_json, indent=2))
    (OUT / "route_shapes.json").write_text(json.dumps(route_shapes_json, indent=2))

    print("\nDone. Summary:")
    print(f"  stations.json: {len(stations_json)} stations")
    print(f"  transfers.json: {len(transfers_json)} complexes")
    print(f"  route_stops.json: {len(route_stops_json)} routes")
    total_branches = sum(len(v) for r in route_shapes_json.values() for v in [r])
    total_branch_count = sum(len(branches) for branches in route_shapes_json.values())
    print(f"  route_shapes.json: {len(route_shapes_json)} routes, {total_branch_count} total branches")


if __name__ == "__main__":
    main()
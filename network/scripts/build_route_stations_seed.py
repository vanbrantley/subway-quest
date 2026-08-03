"""
Resolves network/processed/route_stops.json into dbt/seeds/route_stations.csv
-- one row per (route_id, station_id) in that route's full flattened station
span (union across all branches).

Needed specifically for full_line_ride criteria (currently only
im_not_leaving), which checks whether a trip's legs on one route cover
every station on that route's full span. Mirrors quests.ts's
FULL_ROUTE_SPANS exactly -- same union-across-branches computation, same
documented simplification (checks station-SET coverage, not strict
end-to-end ordering -- see quests_logic.ts's evaluatePerTrip() comment on
full_line_ride for the full reasoning, unchanged here).
"""
import csv
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # network/
ROUTE_STOPS_PATH = BASE_DIR / "processed" / "route_stops.json"
OUTPUT_PATH = BASE_DIR.parent / "dbt" / "seeds" / "route_stations.csv"


def main():
    with open(ROUTE_STOPS_PATH) as f:
        route_stops = json.load(f)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["route_id", "station_id"])
        for route_id, directions in sorted(route_stops.items()):
            stops = set()
            for branches in directions.values():
                for branch in branches:
                    stops.update(branch["stops"])
            for stop_id in sorted(stops):
                writer.writerow([route_id, stop_id])

    print(f"Wrote route-station pairs for {len(route_stops)} routes -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
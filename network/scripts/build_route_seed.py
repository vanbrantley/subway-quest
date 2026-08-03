"""
Resolves network/processed/route_stops.json into dbt/seeds/route_definitions.csv
-- one row per real route_id.

Needed specifically for quest criteria meaning "every real route" with no
explicit list (all_routes with no 'routes' field -- currently only
all_lines_rider). The warehouse has no other correct source for the true
real-route set: station_coordinates.routes (comma-joined daytime_routes)
looks like a plausible substitute but isn't -- daytime_routes still uses the
placeholder 'S' label for all three shuttles instead of the real FS/GS/H
route_ids (same gap already found and worked around in
build_quests.py/validate_quests.py this milestone). route_stops.json's own
keys are the single source of truth for "what's a real route" everywhere
else in this project; this just makes that same list available in the
warehouse too, instead of quietly disagreeing with what the mobile app
resolves against.
"""
import csv
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # network/
ROUTE_STOPS_PATH = BASE_DIR / "processed" / "route_stops.json"
OUTPUT_PATH = BASE_DIR.parent / "dbt" / "seeds" / "route_definitions.csv"


def main():
    with open(ROUTE_STOPS_PATH) as f:
        route_stops = json.load(f)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["route_id"])
        for route_id in sorted(route_stops.keys()):
            writer.writerow([route_id])

    print(f"Wrote {len(route_stops)} route definitions -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
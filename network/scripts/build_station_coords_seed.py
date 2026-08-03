# network/scripts/build_station_coords_seed.py
import json
import csv
from pathlib import Path

STATIONS_JSON = Path(__file__).parent.parent / "processed" / "stations.json"
OUTPUT_CSV = Path(__file__).parent.parent.parent / "dbt" / "seeds" / "station_coordinates.csv"

def main():
    with open(STATIONS_JSON) as f:
        stations = json.load(f)

    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["station_id", "complex_id", "lat", "lon", "name", "routes"])
        for stop_id, station in stations.items():
            routes_str = ", ".join(station["daytime_routes"])
            writer.writerow([stop_id, station["complex_id"], station["lat"], station["lon"], station["name"], routes_str])

if __name__ == "__main__":
    main()
"""
Join MTA station coordinates to NYC Neighborhood Tabulation Area (NTA) polygons.

Inputs:
  - stations.json          MTA station data (stop_id -> {name, lat, lon, complex_id, borough, ...})
  - nynta2020.shp/.dbf/.shx/.prj   2020 NTA boundaries from NYC DCP
    Source: https://hub.arcgis.com/datasets/DCP::nyc-neighborhood-tabulation-areas-2020

Outputs:
  - complex_to_neighborhood.json   flat lookup, one row per unique station complex
  - neighborhoods_grouped.json     same data grouped borough -> neighborhood -> [stations]

Requires: pyshp, shapely, pyproj  (pip install pyshp shapely pyproj)
"""

import json
from collections import defaultdict

import shapefile
from shapely.geometry import shape, Point
from pyproj import Transformer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # network/

STATIONS_PATH = BASE_DIR / "processed" / "stations.json"
SHAPEFILE_PATH = BASE_DIR / "raw" / "nta" / "nynta2020.shp"
FLAT_OUTPUT_PATH = BASE_DIR / "processed" / "complex_to_neighborhood.json"
GROUPED_OUTPUT_PATH = BASE_DIR / "processed" / "neighborhoods_grouped.json"

BORO_MAP = {"M": "Manhattan", "Bk": "Brooklyn", "Q": "Queens", "Bx": "Bronx", "SI": "Staten Island"}


def load_nta_polygons(shp_path):
    """Load NTA polygons with their attributes. Shapefile is in EPSG:2263 (NY State Plane, feet)."""
    sf = shapefile.Reader(shp_path, encoding="latin1")
    fields = [f[0] for f in sf.fields[1:]]  # skip DeletionFlag
    polygons = []
    for sr in sf.iterShapeRecords():
        record = dict(zip(fields, sr.record))
        geom = shape(sr.shape.__geo_interface__)
        polygons.append((record, geom))
    return polygons


def assign_neighborhood(lat, lon, polygons, transformer):
    """Point-in-polygon lookup. Falls back to nearest polygon if no exact match
    (can happen for points that fall exactly on a boundary line)."""
    x, y = transformer.transform(lon, lat)
    pt = Point(x, y)
    for record, geom in polygons:
        if geom.contains(pt):
            return record, False  # exact match
    # fallback: nearest polygon by distance
    best_record, best_dist = None, None
    for record, geom in polygons:
        d = geom.distance(pt)
        if best_dist is None or d < best_dist:
            best_dist, best_record = d, record
    return best_record, True  # fallback match, flag for manual review


def main():
    with open(STATIONS_PATH) as f:
        stations = json.load(f)

    polygons = load_nta_polygons(SHAPEFILE_PATH)
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:2263", always_xy=True)

    fallback_count = 0
    complexes = {}
    for stop_id, s in stations.items():
        nta_record, used_fallback = assign_neighborhood(s["lat"], s["lon"], polygons, transformer)
        if used_fallback:
            fallback_count += 1
            print(f"  [fallback match] {s['name']} ({stop_id}) -> {nta_record['NTAName']}")

        cid = s["complex_id"]
        if cid not in complexes:
            complexes[cid] = {
                "complex_id": cid,
                "name": s["name"],
                "borough": BORO_MAP.get(s["borough"], s["borough"]),
                "nta_code": nta_record["NTA2020"],
                "neighborhood": nta_record["NTAName"],
                "neighborhood_borough": nta_record["BoroName"],
                "lat": s["lat"],
                "lon": s["lon"],
            }

    if fallback_count:
        print(f"\n{fallback_count} station(s) needed nearest-polygon fallback — review the lines above.")
    else:
        print("All stations matched a polygon directly. No fallbacks needed.")

    # sanity check: declared borough vs polygon-assigned borough
    mismatches = [c for c in complexes.values() if c["borough"] != c["neighborhood_borough"]]
    if mismatches:
        print(f"\n{len(mismatches)} station(s) where declared borough != NTA borough (expected for border cases like Marble Hill):")
        for c in mismatches:
            print(f"  {c['name']}: declared={c['borough']}, NTA={c['neighborhood_borough']}")

    flat = dict(sorted(complexes.items(), key=lambda kv: int(kv[0])))
    with open(FLAT_OUTPUT_PATH, "w") as f:
        json.dump(flat, f, indent=2)

    grouped = defaultdict(lambda: defaultdict(list))
    for c in complexes.values():
        grouped[c["neighborhood_borough"]][c["neighborhood"]].append(
            {"name": c["name"], "lat": c["lat"], "lon": c["lon"]}
        )
    grouped_sorted = {
        boro: {nta: sorted(stns, key=lambda s: s["name"]) for nta, stns in sorted(ntas.items())}
        for boro, ntas in sorted(grouped.items())
    }
    with open(GROUPED_OUTPUT_PATH, "w") as f:
        json.dump(grouped_sorted, f, indent=2)

    print(f"\nWrote {len(flat)} station complexes to {FLAT_OUTPUT_PATH}")
    print(f"Wrote grouped view to {GROUPED_OUTPUT_PATH}")


if __name__ == "__main__":
    main()

# Raw data (not tracked in git)

This folder is gitignored — these files are large (40MB+ combined) and fully regenerable from public sources. `data/processed/` (the actual pipeline output) IS tracked in git, so you only need these raw files if you want to re-run `build_static_data.py` yourself.

## Where to get each file

**GTFS static feed** (`shapes.txt`, `trips.txt`, `routes.txt`, `stop_times.txt`):
Download the regular static subway GTFS feed directly from MTA:
https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip
Unzip it and copy those four files into this folder.

**Station and complex data** (`stations.csv`, `complexes.csv`):
These come from MTA's separate open data portal, not the GTFS zip above. Search "MTA Subway Stations" and "MTA Subway Complexes" on `data.ny.gov` (or `new.mta.info/developers`) and download the CSVs into this folder.

## Regenerating processed output

Once all six files are in this folder, run from `data/scripts/`:

```bash
python3 build_static_data.py
```

This overwrites `data/processed/*.json` with fresh output.

## Note

MTA's GTFS feed is updated periodically (a few times a year for the regular feed). If station names, route colors, or branch structure ever look off compared to what's in this repo, re-downloading a fresh copy of these files and re-running the script is the fix.
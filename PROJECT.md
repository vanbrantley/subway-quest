# Subway Quest — Project Context

## What this is

A mobile app that logs your NYC subway rides and shows your progress exploring the system — checking off stations you've boarded or departed from. Mission: inspire city exploration by making it visible (and a little game-like) how much of the system you've actually seen.

Secondary goal: this is also a data portfolio piece. The app is framed as a first-party data generator — it produces both **domain events** (subway trip activity: legs started, transfers made, stations visited) and **product events** (app usage: what screens get used, what features get ignored). That framing supports a pipeline + dashboard layer on top of the app itself, aimed at Data Analyst / Analytics Engineer / Data Engineer roles.

**Important context for whoever's picking this up:** the person building this has a known pattern of using project work to avoid the discomfort of job-search application volume. This project is legitimate and wanted for its own sake, but if a session starts sprawling into speculative scope rather than shipping working pieces, it's worth naming that directly rather than just going along with it.

## Tech stack (decided)

- **Frontend:** React Native via Expo — chosen because it's a known quantity (used before to ship to TestFlight) and speeds up getting a working build on-device
- **Map rendering:** `react-native-maps`, with GTFS shapes rendered as `Polyline` components and stations as markers — not a webview, to keep it native-feeling
- **Local persistence:** `expo-sqlite` — local-first source of truth for trips and events, since the subway is underground and offline is the common case, not the edge case
- **Backend:** Supabase (Postgres) — used now for data storage, **auth deliberately deferred** (see Design Decisions)
- **Sync pattern:** transactional outbox — local writes happen immediately and are marked pending; a sync worker flushes to Supabase when connectivity returns

## Design decisions and why

### Auth is deferred, but the schema isn't
We are NOT implementing Supabase auth in this first build phase. All trips are written with a hardcoded `user_id` for the one real user. This was a deliberate call: standing up auth/RLS/session handling before validating the map + trip-logging UX would be exactly the kind of "necessary-sounding" work that delays getting something real and usable. However, every table is designed with a `user_id` column from day one so that turning on real auth later is additive (wire up login, populate the column for real) rather than a migration.

### Offline-first is core to the product, not an add-on
Because the subway is underground and connectivity is unreliable, two categories of data are handled differently:
1. **Static reference data** (stations, routes, transfer graph) — precomputed once from MTA/GTFS source files into bundled JSON. The app never needs connectivity to know what stations exist or what transfers are possible.
2. **User-generated data** (trips, events) — written to local SQLite first as the source of truth for the UI, with a `sync_status` flag and an outbox worker to flush to Supabase opportunistically.

### Trip state supports mid-trip undo
A trip is a stack of legs, not a flat "current state." Each leg has `route`, `entry_stop_id`, `exit_stop_id`, and `status` (complete/in_progress). Undo pops the last leg (or clears the in-progress leg's exit stop) and recomputes transfer options from the prior leg's exit point. This keeps undo cheap — it's not recomputing the whole trip, just re-deriving one lookup.

### Transfers are driven by MTA's complexes.csv, not GTFS transfers.txt
`complexes.csv` (MTA's official station-grouping file) already provides the union of routes serving each physical station complex via its `Daytime Routes` column. Using `transfers.txt` instead would require reconstructing that same grouping via extra joins. Known limitation: `Daytime Routes` reflects typical daytime service, not late-night reroutes — considered an acceptable simplification for v1, revisit later via `transfers.txt`'s `transfer_type` field if time-of-day-aware transfers ever matter.

### Route "branches" are geographic, not service-pattern-based
Raw GTFS data has far more `shape_id`s per route than real branches — most of the extra ones are express/local stopping-pattern variants or short-turn/partial trips on the same physical track, not different routes. The precompute pipeline collapses these:
- Two patterns with identical stop sequences → dedupe, keep the one with richer geometry
- A pattern that's a strict subsequence of a longer pattern (regardless of endpoints — covers both express-skips-stops and short-turn-ends-early cases) → drop it, it's covered by the longer one

What survives is only genuine geographic branching (e.g. the A train's 3 real termini, the 5 train's 4 endpoint combinations). This matters for two reasons: the map should draw one line per real physical branch, and the trip-logging station picker should never force the user to disambiguate between express/local or long/short-turn service — that's friction that doesn't serve the app's purpose.

### Station picker UX: no branch selection step
For lines with real branches (the A, the 5, etc.), the plan is to show one scrollable, correctly-ordered stop list per line with the shared trunk first and branch-specific tails grouped/labeled further down — not a radio button or upfront branch choice. Most riders never touch a branch and shouldn't have to think about it; the few who do get correct stops without an extra decision. This also serves the exploration mission — someone scrolling past an unfamiliar branch is a moment of discovery, not friction.

## Data pipeline (built)

Raw MTA/GTFS source files (all in `data/raw/`):
- `stations.csv` — MTA's official station list (GTFS stop_id, complex_id, name, coords, routes, ADA info)
- `complexes.csv` — MTA's station-complex groupings (which physically-close stations count as one transfer point, with union of serving routes)
- `shapes.txt` (GTFS) — raw polyline point traces per `shape_id`
- `routes.txt` (GTFS) — route metadata including official hex colors
- `trips.txt` (GTFS) — maps `shape_id` → `route_id` and `direction_id`
- `stop_times.txt` (GTFS) — maps `trip_id` → ordered `stop_id` sequence (the authoritative source for "what stations does this route serve, in what order")

Known GTFS quirk handled in the pipeline: `stop_times.txt` uses platform-level stop_ids (e.g. `101N`/`101S`), which must be stripped of their direction suffix to join back to the parent station ids used in `stations.csv`. Verified clean 1:1 join, no mismatches.

`data/scripts/build_static_data.py` reads all raw files and outputs four JSON files to `data/processed/`:
- `stations.json` — station-level info keyed by GTFS stop_id
- `route_stops.json` — ordered stop sequence per route, grouped by real branch
- `route_shapes.json` — deduped polylines per branch, with official route color (currently ~3.5MB, full GPS-point resolution — flagged for a simplification pass, e.g. Douglas-Peucker, once we're actually building the map screen)
- `transfers.json` — complex_id → routes available at that complex

Verified output: 496 stations, 445 transfer complexes, 83 real route branches across 29 routes. Spot-checked against known geography (A train's 3 branches, 5 train's 4 endpoint combos, Times Sq's 12 routes) — all correct.

## Folder structure

```
root/
  data/
    raw/          # source MTA/GTFS files, not committed if large/licensed
    processed/    # generated JSON output, consumed by the app
    notebooks/    # exploratory Jupyter work
    scripts/
      build_static_data.py
  (app code goes here — not yet scaffolded)
```

## Status / order of operations

1. ✅ **Data precompute** — done, verified, described above
2. ⬜ **Scaffold Expo project** — bare app, navigation shell, nothing functional yet
3. ⬜ **Map screen** — render stations + route polylines from static JSON, pan/zoom, nothing tappable yet
4. ⬜ **Station tap → station info view** — static JSON only, no trip logic
5. ⬜ **Trip logging flow** — start trip → pick line → pick start/end via station picker → add transfer (intelligently filtered by complex) → undo → complete trip, written to local SQLite
6. ⬜ **Supabase wiring + outbox sync** — flush local trips to Supabase when online

Each step should be independently testable on-device via TestFlight, not just at the very end.

## Open questions / not yet decided

- Exact UI for the branch-aware station picker (trunk + grouped branch tails) — described conceptually above, not yet designed in detail
- Product/domain event taxonomy — naming convention and exact schema for events like `trip_leg_started`, `map_station_tapped`, etc. not yet defined
- Snowflake vs. Redshift for the eventual analytics warehouse
- Power BI vs. Streamlit for the eventual BI/dashboard layer
- Whether/how to simplify `route_shapes.json` polyline precision before bundling into the app
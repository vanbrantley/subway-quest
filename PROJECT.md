# SubwayQuest

## What this is

A mobile app that logs your NYC subway rides and shows your progress exploring the system — checking off stations you've boarded or departed from. Mission: inspire city exploration by making it visible (and a little game-like) how much of the system you've actually seen.

Secondary goal: this is also a data portfolio piece. The app is framed as a first-party data generator — it produces both **domain events** (subway trip activity: legs started, transfers made, stations visited) and **product events** (app usage: what screens get used, what features get ignored). That framing supports a pipeline + dashboard layer on top of the app itself, aimed at Data Analyst / Analytics Engineer / Data Engineer roles.

**Important context for whoever's picking this up:** the person building this has a known pattern of using project work to avoid the discomfort of job-search application volume. This project is legitimate and wanted for its own sake, but if a session starts sprawling into speculative scope rather than shipping working pieces, it's worth naming that directly rather than just going along with it.

**Also important:** the person has identified their own working pattern — long hours early/mid-project connecting the full stack into an MVP, then losing motivation to deepen individual layers once the "finished" vision is visible. This is specifically why the data layer (schema, event taxonomy) was deliberately front-loaded this time instead of left for the end — see "Data layer" below, now complete.

## Where things stand right now (as of this handover)

The data pipeline, a working map screen, **and the full data layer** are done and verified. The data layer — event taxonomy, SQLite schema, the app-side commit/delete functions, sync policy, and a data dictionary/ERD — was deliberately built and tested before any trip-logging UI, specifically to counter the person's known pattern of losing rigor once a full-stack MVP is visible. See `docs/data-layer/event-taxonomy.md` and `docs/data-layer/erd.md` for the full design record — worth reading before touching `mobile/db/`, since several early ideas in that history (mid-trip undo, a hardcoded `user_id`, per-row `status` flags) were deliberately overturned during that design pass and no longer reflect the real schema.

The next session's job is **UI implementation + Supabase wiring** — turning the already-designed and already-tested data layer into working screens, not more schema design. See "Order of operations" below.

## UI/UX design philosophy

**Model app: Fotmob** (soccer stats app). What specifically works about it, per the person's own description:
- Everything is clickable and drills into its own dedicated detail page
- Easy, natural back-navigation to wherever you came from
- UI elements are collapsible/expandable rather than everything shown at once
- Strong at surfacing insights/stats contextually, everywhere, not just on one dashboard screen

This is the reference point for SubwayQuest's UI — e.g. tapping a station, a route, a past trip, or a stat should each drill into its own page with relevant insights, not just show a static label. The full UI is intentionally not being built yet (see "Where things stand" above) — the vision exists and can be picked up once the data layer is solid.

## Tech stack & architecture

```
Expo app (client)
  └── local SQLite: operational trip/leg state (mutable) + immutable event log
        │
        │  outbox sync, client-generated idempotency keys (UUIDs per event)
        ▼
Supabase Postgres (operational layer)
  ├── operational schema   — trips, legs (mutable; powers the app directly)
  └── raw_events schema    — append-only, immutable event log (source of truth for analytics)
        │
        │  Python EL job, scheduled via GitHub Actions (batch, not streaming)
        ▼
BigQuery (analytics warehouse — raw dataset)
        │
        │  dbt: staging → intermediate → mart
        ▼
BigQuery (analytics warehouse — mart layer)
        │
        │  native BigQuery connector — genuine scheduled auto-refresh, no gateway
        ▼
Power BI  →  Publish to Web (free, public link)
```

- **Frontend:** React Native via Expo — known quantity, ships to TestFlight, fast iteration
- **Map rendering:** `react-native-maps`, `PROVIDER_DEFAULT` (Apple Maps, no API key needed — iOS-only for now, no Android support configured). GTFS shapes rendered as `Polyline`, stations as `Marker`, `tracksViewChanges={false}` + `useMemo` applied for performance with ~496 markers / ~83 polylines
- **Local persistence:** `expo-sqlite` — local-first source of truth for trips and events, since the subway is underground and offline is the common case, not the edge case
- **Operational backend:** Supabase Postgres — auth deliberately deferred (see Design Decisions), kept because it's a solid, standard offline-sync target with a real auth path available later at no migration cost
- **Sync pattern:** transactional outbox — local writes happen immediately and are marked pending; a sync worker flushes to Supabase when connectivity returns
- **EL job:** Python, scheduled via GitHub Actions — reuses the exact pattern already proven on the NYC Data Job Market Tracker project. Batch loads only (not streaming inserts) from Supabase into BigQuery
- **Analytics warehouse:** BigQuery — chosen specifically because it's one of the few connectors Power BI can auto-refresh on its free tier without an on-premises gateway (Azure SQL, Snowflake, BigQuery are on that short list; generic Postgres, including Supabase, is not — confirmed via direct research, not assumption). Free tier (1 TiB query processing + 10 GB storage/month, no card required, no expiration) comfortably covers this project's scale indefinitely. Also deliberately different from NYC Tracker's Snowflake, avoiding a repeated tool across portfolio projects
- **Transformation:** dbt, staging → intermediate → mart, inside BigQuery — same pattern already proven on NYC Tracker
- **BI / dashboard:** Power BI, published via the free "Publish to Web" feature (public link, no viewer login) — chosen over repeating Tableau (already used on the NHL project) partly for resume tool-breadth, and decisively because BigQuery's native connector is what makes genuine live auto-refresh possible for free; Tableau Public, by contrast, is confirmed extract-only at every tier without Tableau Bridge

**Why a separate analytics warehouse instead of querying Supabase directly (the honest version):** this is a direct revision of an earlier, more elaborate architecture (originally: S3 Parquet lake + a second parallel AWS RDS Postgres instance) that was rejected as disproportionate to this project's real data volume — reaching for infrastructure that looks advanced rather than infrastructure that's warranted. Adding BigQuery now is a different kind of decision: it's driven by one concrete, checkable requirement (Power BI's free-tier connector list), not a general instinct toward more infrastructure. Revising a decision once a real new requirement surfaced — rather than defending the original simpler plan for its own sake — is itself worth being able to explain if asked.

## Folder structure (repo root)

```
root/
  network/
    raw/          # gitignored — see network/raw/README.md to regenerate
    processed/    # generated JSON output, tracked in git, consumed by the app
    notebooks/    # exploratory Jupyter work
    scripts/
      build_static_data.py
  docs/
    data-layer/
      event-taxonomy.md    # full event taxonomy — read before touching mobile/db/
      erd.md                # data dictionary / ERD, full pipeline diagram
  mobile/          # Expo app
    app/                  # Expo Router screens (file-based routing)
    components/
      map/                  # empty, reserved
      trip/                  # empty, reserved
    db/
      schema.sql            # local SQLite schema — events, sync_status, trips, legs
      projection.ts          # commitTrip + deleteTrip — the only two projection operations
    data/                    # gitignored; populated by scripts/sync-data.js
    types/
    utils/
    scripts/
      sync-data.js
    assets/images/           # real icon/splash assets in place
    app.json
  PROJECT.md
  .gitignore
```

Single monorepo, one GitHub repo covering `network/`, `docs/`, and `mobile/` — deliberate choice, no reason to split repos at this scale/team size (team of one).

Renamed from `data/` to `network/` partway through this project (it holds subway *network* reference data — stations, routes, geometry — as distinct from the event/trip data the data layer produces; `data/` was ambiguous once both existed side by side).

## Design decisions and why

### Auth is deferred, but the schema isn't
We are NOT implementing Supabase auth in this first build phase. **Revised during the data-layer design pass:** rather than a hardcoded `user_id`, `device_id` (client-generated, stable per-install) is the actual pre-auth tenant key on every row, and `user_id` is a nullable column present from day one but unpopulated until real auth ships — along with a stated migration path (a `device_to_user` mapping table backfills it once someone signs in). This was a deliberate correction, not just a rename: a single hardcoded `user_id` assumed one real user forever, but this app is headed to TestFlight and the App Store, so the schema needed to be genuinely multi-tenant (`device_id`-scoped) even before auth exists, not just multi-row. See `docs/data-layer/event-taxonomy.md`'s "Envelope" section for the full reasoning.

### Offline-first is core to the product, not an add-on
Because the subway is underground and connectivity is unreliable, two categories of data are handled differently:
1. **Static reference data** (stations, routes, transfer graph) — precomputed once from MTA/GTFS source files into bundled JSON. The app never needs connectivity to know what stations exist or what transfers are possible.
2. **User-generated data** (trips, events) — written to local SQLite first as the source of truth for the UI, with a `sync_status` flag and an outbox worker to flush to Supabase opportunistically.

### Trip logging is a two-stage flow: fast drafting, then one atomic commit
**Superseded during the data-layer design pass — this replaces an earlier "mid-trip undo, stack of legs" model that assumed live, incremental logging.** The actual flow: a trip is built as a local draft (add/remove legs freely, no data-layer writes yet), then committed as a single atomic transaction the moment "Log Trip" is tapped — `trip_started`, every leg, and `trip_ended` all written together. There is no edit mode and no partial post-commit correction; the only way to fix an already-logged trip is `trip_deleted` (full removal) followed by re-drafting it correctly, which is fine given logging is designed to take ~20 seconds. Fixing an earlier leg mid-draft (tapping "back") removes every leg from that point onward and re-adds them, rather than editing in place — avoids a dangling transfer point where one leg's exit no longer matches the next leg's entry. Full reasoning and the draft-stage product events that make drafting friction measurable are in `docs/data-layer/event-taxonomy.md`.

### Transfers are driven by MTA's complexes.csv, not GTFS transfers.txt
`complexes.csv` (MTA's official station-grouping file) already provides the union of routes serving each physical station complex via its `Daytime Routes` column. Using `transfers.txt` instead would require reconstructing that same grouping via extra joins. Known limitation: `Daytime Routes` reflects typical daytime service, not late-night reroutes — considered an acceptable simplification for v1, revisit later via `transfers.txt`'s `transfer_type` field if time-of-day-aware transfers ever matter.

### Route "branches" are geographic, not service-pattern-based
Raw GTFS data has far more `shape_id`s per route than real branches — most of the extra ones are express/local stopping-pattern variants or short-turn/partial trips on the same physical track, not different routes. The precompute pipeline collapses these:
- Two patterns with identical stop sequences → dedupe, keep the one with richer geometry
- A pattern that's a strict subsequence of a longer pattern (regardless of endpoints — covers both express-skips-stops and short-turn-ends-early cases) → drop it, it's covered by the longer one

What survives is only genuine geographic branching (e.g. the A train's 3 real termini, the 5 train's 4 endpoint combinations). This matters for two reasons: the map should draw one line per real physical branch, and the trip-logging station picker should never force the user to disambiguate between express/local or long/short-turn service — that's friction that doesn't serve the app's purpose. Verified visually in the running app: the A train correctly forks near Rockaway Blvd into its 3 real branches.

### Station picker UX: no branch selection step
For lines with real branches (the A, the 5, etc.), the plan is to show one scrollable, correctly-ordered stop list per line with the shared trunk first and branch-specific tails grouped/labeled further down — not a radio button or upfront branch choice. Most riders never touch a branch and shouldn't have to think about it; the few who do get correct stops without an extra decision. This also serves the exploration mission — someone scrolling past an unfamiliar branch is a moment of discovery, not friction. Not yet implemented — still just the design plan.

## Data layer (done)

Fully designed, built, and tested — see `docs/data-layer/event-taxonomy.md` (event taxonomy, commit
model, sync policy, every design decision with reasoning) and `docs/data-layer/erd.md` (schema diagram,
full pipeline diagram, final rigor-checklist status). `mobile/db/schema.sql` and
`mobile/db/projection.ts` are the real, tested artifacts — `projection.ts` exposes exactly two
operations, `commitTrip` and `deleteTrip`, which is all the data layer ever needs to be driven by.

**The single highest-leverage idea, still true:** the event log (`events` locally, `raw_events` schema
in Supabase) is genuinely immutable and append-only; the operational tables (`trips`, `legs`) are a
mutable projection built from it, never written independently. What changed since this was first
written: trips commit as one atomic bundle when "Log Trip" is tapped (not incrementally), there's no
edit mode, and correction is `trip_deleted` + re-log rather than a stack-based undo — see the taxonomy
doc for the full reasoning trail, since several early ideas here were deliberately revised, not just
extended.

**A few things worth knowing before touching this code:** `trip_id`/`leg_id` must be client-generated
UUIDs (collision-safe across independent phones — this ships to many users, not one); `occurred_at`
supports date-only backdating but no time-of-day input; product events (`draft_leg_added`,
`screen_viewed`, etc.) share the same `events` table as trip events, distinguished by `event_domain`.

Achievements/quests (a set of pre-made station-based challenges, with progress tracking) were scoped
during this design pass and confirmed to need **no new tables or event types** — fully derivable
downstream by joining committed trip history against a static quest-definitions table once the
warehouse layer exists. Correctly out of scope for the data layer itself.

### Data pipeline (built and verified)

Raw MTA/GTFS source files (all in `network/raw/`, gitignored — see `network/raw/README.md` for where to download them):
- `stations.csv` — MTA's official station list (GTFS stop_id, complex_id, name, coords, routes, ADA info)
- `complexes.csv` — MTA's station-complex groupings (which physically-close stations count as one transfer point, with union of serving routes)
- `shapes.txt` (GTFS) — raw polyline point traces per `shape_id`
- `routes.txt` (GTFS) — route metadata including official hex colors
- `trips.txt` (GTFS) — maps `shape_id` → `route_id` and `direction_id`
- `stop_times.txt` (GTFS) — maps `trip_id` → ordered `stop_id` sequence (the authoritative source for "what stations does this route serve, in what order")

Known GTFS quirk handled in the pipeline: `stop_times.txt` uses platform-level stop_ids (e.g. `101N`/`101S`), which must be stripped of their direction suffix to join back to the parent station ids used in `stations.csv`. Verified clean 1:1 join, no mismatches.

`network/scripts/build_static_data.py` reads all raw files and outputs four JSON files to `network/processed/`:
- `stations.json` — station-level info keyed by GTFS stop_id
- `route_stops.json` — ordered stop sequence per route, grouped by real branch
- `route_shapes.json` — deduped polylines per branch, with official route color (~3.4MB, full GPS-point resolution — flagged for a simplification pass, e.g. Douglas-Peucker, not yet done)
- `transfers.json` — complex_id → routes available at that complex

Verified output: 496 stations, 445 transfer complexes, 83 real route branches across 29 routes. Spot-checked against known geography (A train's 3 branches, 5 train's 4 endpoint combos, Times Sq's 12 routes) — all correct.

`mobile/scripts/sync-data.js` copies the 4 processed JSON files from `network/processed/` into `mobile/data/` so the app can bundle them. Run manually (`node scripts/sync-data.js` from inside `mobile/`) any time the pipeline is re-run with fresh source data. The copies in `mobile/data/` are gitignored — `network/processed/` is the tracked source of truth.

### Mobile app (built and verified on-device)

**Scaffolded with:** `npx create-expo-app@latest mobile --template default@sdk-54` — SDK pinned deliberately (Expo Go's App Store build only supports one SDK version at a time, and `@latest` can outpace it). Default demo/tutorial content was stripped via Expo's own `npm run reset-project` script (full delete, not move-to-`app-example`).

**Structure is flat at the `mobile/` root** — no `src/` wrapper (see Folder structure above).

**What's working right now:** `app/index.tsx` renders a full-screen `MapView` showing all 496 stations as markers and all 83 route branches as colored polylines pulled from the real MTA color values. Tapping a station shows the native callout with name + serving routes. Confirmed working live in Expo Go on a physical iPhone.

**Known, deliberately deferred:** default red pin markers haven't been restyled yet; routes that share physical track fully overlap rather than rendering as parallel offset lines the way Google Maps does at high zoom (real rendering-engine limitation — `react-native-maps`' `Polyline` draws raw lat/lon with no concept of nearby-line offset; a real fix would need a vector-tile renderer like Mapbox GL/MapLibre).

**`app.json` decisions:** iOS-only for now. Display name "Subway Quest" (two words); `slug`/`scheme` stay `subwayquest` (internal identifiers, not user-facing). No Apple Icon Composer bundle — plain PNG icon via the top-level `icon` field.

**One global-environment gotcha worth knowing:** `npx expo start` can fail with a generic `UnexpectedServerData: Unexpected server error: No returned query result` error across *every* Expo project on a machine, not just this one — caused by a stale/corrupted cached login session in `~/.expo/state.json` (global, shared across all projects). Fix: `rm ~/.expo/state.json`. Worth checking first if this resurfaces, since the error message gives no hint of the real cause.

## Open questions / not yet decided

- Exact UI for the branch-aware station picker (trunk + grouped branch tails) — described conceptually above, not yet designed in detail
- Full UI/screen map beyond the current single map screen — to be templated out per the Fotmob-inspired approach
- Whether/how to simplify `route_shapes.json` polyline precision before bundling into the app
- Parallel-offset rendering for routes that share physical track — deferred, not blocking
- Custom marker styling (current default red pins not final — deliberately deferred, easy to swap later)
- `device_to_user` mapping table shape, Supabase RLS policy design, and shared-table indexing/clustering plan — all deferred from the data-layer pass, all real, all blocked on Supabase actually being wired up (see `docs/data-layer/event-taxonomy.md`'s "Not yet decided" for the full list)

## Order of operations

1. ✅ **Data precompute** — done, verified
2. ✅ **Scaffold Expo project** — done, verified
3. ✅ **Map screen** — done, verified on-device
4. ✅ **Architecture decided** — operational Postgres → BigQuery warehouse → Power BI, with reasoning (see Tech stack & architecture above)
5. ✅ **Data layer: event taxonomy + SQLite schema + projection code + ERD** — done and tested, see "Data layer" above
6. ⬜ **Next session:** station tap → station info view, the trip-logging draft/commit UI (wired to `mobile/db/projection.ts`'s `commitTrip`/`deleteTrip`, already built), Supabase wiring (`raw_events`/operational schemas, outbox sync worker), then EL job + dbt + Power BI
# SubwayQuest

## What this is

A mobile app that logs your NYC subway rides and shows your progress exploring the system — checking off stations you've boarded or departed from. Mission: inspire city exploration by making it visible (and a little game-like) how much of the system you've actually seen.

Secondary goal: this is also a data portfolio piece. The app is framed as a first-party data generator — it produces both **domain events** (subway trip activity) and **product events** (app usage). That framing supports a pipeline + dashboard layer on top, aimed at Data Analyst / Analytics Engineer / Data Engineer roles.

**Important context for whoever's picking this up:** the person building this has a known pattern of using project work to avoid the discomfort of job-search application volume. This project is legitimate and wanted for its own sake, but if a session starts sprawling into speculative scope rather than shipping working pieces, it's worth naming that directly.

**Also important:** the person's known working pattern is long hours early/mid-project connecting the full stack into an MVP, then losing motivation to deepen individual layers once the "finished" vision is visible. This is why the data layer was deliberately front-loaded, and why `docs/status.md` exists as a living, honest tracker rather than letting "there's a working build" substitute for "it's done."

**Current status, file map, and what's left:** see `docs/status.md` — kept separate from this doc and updated continuously, so this doc can stay a stable reference instead of going stale.

## Documentation organization — three kinds of doc, three lifecycles

Worth stating explicitly once this stopped being a couple of files and became a real docs folder,
so it doesn't quietly turn into either duplication or an unmaintained pile:

1. **Domain reference docs** (`data-layer.md`, `ui-spec.md`, `dashboard-spec.md`, `dbt-coverage.md`,
   `bigquery-min-n-coverage.md`) — one per domain, living forever, never archived. Edited by
   whichever milestone happens to touch that domain next. `dbt-coverage.md` and
   `bigquery-min-n-coverage.md` in particular are *not* "the milestone 5/6 docs" despite being born
   during those milestones — they're the dbt schema reference and the suppression runbook
   respectively, and both get extended by every later milestone that touches dbt or adds a
   suppressed mart (milestone 8 did both).
2. **The top-level index** (`status.md`) — always current, thin on detail, thick on pointers to
   where the real detail lives. The one doc to read first when resuming work.
3. **Milestone chronicles** (`milestone-8-achievements.md`, and one per milestone going forward,
   e.g. `milestone-9-ui.md`) — the story of one bounded unit of work: scope, decisions, bugs found,
   completion status. Genuinely fine to keep accumulating one per milestone, since each becomes a
   closed chapter once its milestone ships — nobody needs to re-read milestone 8's chronicle during
   milestone 10.

**The discipline that keeps #3 from turning into duplication:** when a milestone closes, do a
port-out pass. Anything reusable (a cut decision, a schema addition, a design pattern, current
status) moves into the category-1/2 docs; what's left in the milestone doc is pure narrative —
useful for portfolio write-up material later, not something a later milestone needs to consult.
Treat this the same as any other milestone-closing step, not an optional cleanup.

**Checklists and scratch docs** (e.g. the old `powerbi-polish-checklist.md`/
`powerbi-layout-final.md`) don't fit any of the three categories above and don't need to persist
once executed — fold anything durable into `status.md`, then delete the source file. A fully
checked-off TODO list sitting in the repo is just noise.

## UI/UX design philosophy

**Model app: Fotmob** (soccer stats app):
- Everything is clickable and drills into its own dedicated detail page
- Easy, natural back-navigation to wherever you came from
- UI elements are collapsible/expandable rather than everything shown at once
- Strong at surfacing insights/stats contextually, everywhere, not just on one dashboard screen

Tapping a station, a route, a past trip, or a stat should each drill into its own page with relevant insights, not just show a static label.

## Tech stack & architecture

```
Expo app (client)
  └── local SQLite: trips/legs projection (mutable, built from local events) + immutable event log
        │
        │  outbox sync, client-generated idempotency keys (UUIDs per event)
        ▼
Supabase Postgres
  └── raw_events schema    — append-only, immutable event log (source of truth for analytics AND
                              for rehydration-on-sign-in — the only path data ever flows back to a
                              device, a one-time recovery replay, never an ongoing sync-back path;
                              see docs/data-layer.md)
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

- **Frontend:** React Native via Expo
- **Map rendering:** `react-native-maps`, `PROVIDER_DEFAULT` (Apple Maps — iOS-only)
- **Local persistence:** `expo-sqlite` — local-first, since the subway is underground and offline is the common case
- **Operational backend:** Supabase Postgres — real auth from day one (see `docs/data-layer.md`)
- **Sync pattern:** transactional outbox — local writes happen immediately; a sync worker flushes to Supabase when connectivity returns
- **EL job:** Python, scheduled via GitHub Actions — same pattern proven on the NYC Data Job Market Tracker project. Batch, not streaming
- **Analytics warehouse:** BigQuery — one of the few connectors Power BI can auto-refresh on its free tier without an on-premises gateway (Azure SQL, Snowflake, BigQuery; generic Postgres including Supabase is not). Free tier comfortably covers this project's scale indefinitely. Also deliberately different from NYC Tracker's Snowflake, avoiding a repeated tool across portfolio projects
- **Transformation:** dbt, staging → intermediate → mart, inside BigQuery
- **BI / dashboard:** Power BI, "Publish to Web" — chosen over repeating Tableau (used on the NHL project) partly for tool-breadth, decisively because BigQuery's native connector enables genuine free live auto-refresh; Tableau Public is extract-only at every tier without Tableau Bridge. Power BI Desktop has no native Mac version — authoring happens on a separate Windows machine already owned for this purpose; app/EL development continues on Mac (see `docs/status.md`'s Dashboard section)

**Why a separate warehouse instead of querying Supabase directly:** a direct revision of an earlier, more elaborate architecture (S3 Parquet lake + a second parallel RDS instance) rejected as disproportionate to this project's real data volume. Adding BigQuery is a different kind of decision — driven by one concrete, checkable requirement (Power BI's free-tier connector list), not a general instinct toward more infrastructure.

## Folder structure (repo root)

```
root/
  network/
    raw/          # gitignored — see network/raw/README.md to regenerate
    processed/    # generated JSON output, tracked in git, consumed by the app
    notebooks/    # neighborhood_explorer.ipynb — tweaks the NTA-derived neighborhood mapping
    scripts/
      build_static_data.py
      build_quest_seed.py          # quests.json -> dbt/seeds/quest_definitions.csv
      build_quests.py              # quests_source.json -> processed/quests.json (the resolver)
      build_neighborhood_mapping.py
      build_route_seed.py          # route_stops.json -> dbt/seeds/route_definitions.csv
      build_route_stations_seed.py # route_stops.json -> dbt/seeds/route_stations.csv
      build_station_coords_seed.py # stations.json -> dbt/seeds/station_coordinates.csv
      validate_quests.py           # structural/regression checks on processed/quests.json
    quests_source.json    # hand-authored quest content, single source of truth
  docs/
    data-layer.md
    ui-spec.md
    dashboard-spec.md
    status.md
    dbt-coverage.md
    bigquery-min-n-coverage.md
    quests-integration.md          # milestone 8 -> 9 handoff: exact component insertion points
    milestone-8-achievements.md    # milestone chronicle — see "Documentation organization" above
  mobile/          # Expo app — see docs/status.md for the current file-by-file map
  supabase/
    schema.sql
  el/              # Python EL job (Supabase → BigQuery) — see docs/data-layer.md
    sync_to_bigquery.py
    requirements.txt
  .github/
    workflows/
      pipeline.yml
  PROJECT.md
  .gitignore
```

Single monorepo — deliberate, no reason to split repos at this scale/team size (team of one).

## Design decisions and why

### Real auth from day one, offline-first, the trip-logging commit model
Full reasoning for all three lives in `docs/data-layer.md` — not restated here to avoid two copies
of the same reasoning drifting apart. Short version: real Supabase Auth (Sign in with Apple) exists
from day one, not deferred; static reference data is bundled JSON requiring no connectivity, while
user-generated data is local-first with an outbox sync; a trip drafts locally and commits as one
atomic transaction, no edit mode, no partial correction.

### Transfers are driven by MTA's `complexes.csv`, not GTFS `transfers.txt`
`complexes.csv` already provides the union of routes serving each physical station complex via its
`Daytime Routes` column — using `transfers.txt` would require reconstructing that same grouping via
extra joins. Known limitation: reflects typical daytime service, not late-night reroutes — acceptable
for v1, revisit via `transfers.txt`'s `transfer_type` field if time-of-day-aware transfers ever matter.

### Route "branches" are geographic, not service-pattern-based
Raw GTFS has far more `shape_id`s per route than real branches — most are express/local variants or
short-turn/partial trips on the same track. The precompute pipeline collapses these: identical stop
sequences dedupe (keep richer geometry); a pattern that's a strict subsequence of a longer one drops
(covered by the longer one). What survives is genuine geographic branching. Verified visually: the A
train correctly forks near Rockaway Blvd into its 3 real branches.

### Station picker UX: no branch selection step
One scrollable, correctly-ordered stop list per line — trunk first, branch tails grouped/labeled
further down — not a radio button or upfront branch choice. Most riders never touch a branch and
shouldn't have to think about it. Also serves the exploration mission — scrolling past an unfamiliar
branch is a moment of discovery, not friction. The trip-logging flow currently
uses a simpler flat list; this remains the plan for the canonical Line page (see `docs/status.md`).

## Data pipeline (built and verified)

Raw MTA/GTFS source files (`network/raw/`, gitignored — see `network/raw/README.md`): `stations.csv`,
`complexes.csv`, `shapes.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`.

Known GTFS quirk handled: `stop_times.txt` uses platform-level stop_ids (e.g. `101N`/`101S`), stripped
of direction suffix to join back to parent station ids. Verified clean 1:1 join.

`network/scripts/build_static_data.py` outputs four JSON files to `network/processed/`:
`stations.json`, `route_stops.json`, `route_shapes.json` (~3.4MB, full GPS-point resolution — flagged
for a simplification pass, not yet done), `transfers.json`.

Verified output: 496 stations, 445 transfer complexes, 83 real route branches across 29 routes.
Spot-checked against known geography — all correct.

`mobile/scripts/sync-data.js` copies the processed files into `mobile/data/` for bundling — now 5
files (added `quests.json`, milestone 8). Run manually any time the pipeline re-runs with fresh source
data. `mobile/data/` copies are gitignored — `network/processed/` is the tracked source of truth.
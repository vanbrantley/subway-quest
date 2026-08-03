# SubwayQuest — dbt Layer: Complete Reference

Full reference for the staging → intermediate → mart chain, organized by layer. Supersedes
piecemeal descriptions scattered across data-layer.md/status.md — read this for "what dbt models
exist and what each one does." Design reasoning for *why* the layer is shaped this way (grain,
materialization, the NYC-project comparison) still lives in data-layer.md's "dbt transformation
layer" section — not duplicated here. Milestone 8's quest-completion tables follow the same
convention — reasoning/process lives in milestone-8-achievements.md, this doc is the schema
reference.

---

## Staging

| Model | Grain | Description |
|---|---|---|
| `stg_events` | one row per `event_id` | Dedupes raw `subwayquest_raw.events` on the `received_at` watermark boundary, applies the launch-date dev/test cutoff (currently a no-op placeholder), passes everything else through untouched. Payload deliberately left as raw JSON — parsing is intermediate's job. |
| `station_totals` | single value | Total real stations. **496** — verified directly against `network/processed/stations.json`, not assumed from `PROJECT.md`'s stated figure. Static; no expected-change note like `route_totals`, since the physical station count isn't expected to shift the way line-selectability is. |

## Seeds

| Seed | Shape | Description |
|---|---|---|
| `route_totals` | single value | Total real, displayable subway lines. **Currently 23** — verified against `route_stops.json` ∩ `LINE_ICONS`/`LINE_COLORS`, not hand-counted. Expected to become 26 once shuttle grouping (`FS`/`GS`/`H`) ships — see status.md's "Mobile UI — remaining." Must be bumped manually in the same session that ships; does not update itself. |
| `station_totals` | single value | Total real stations — **496**, per `PROJECT.md`'s verified pipeline output. Feeds `mart_global_summary`'s collective %-explored calculation (distinct stations visited ÷ this total) as well as the original per-user % explored logic. Static, matching `route_totals`' pattern — bump manually if the underlying station count ever changes (e.g. a real-world station closure/addition), does not update itself. |
| `station_coordinates` | one row per `station_id` | Generated from `network/processed/stations.json` via `network/scripts/build_station_coords_seed.py` — `station_id` (GTFS stop_id, e.g. `R01` — confirmed as the same key `int_legs.entry_station_id`/`exit_station_id` actually store), **`complex_id`** (added milestone 8 — quest criteria reference `complex_id`, not `station_id`; the seed only carried `station_id` before, a real gap found and fixed while building the quest-completion models), `lat`, `lon`, `name`, `routes` (comma-joined `daytime_routes` — known-stale for shuttles, still shows `"S"` rather than the real `FS`/`GS`/`H`; don't use this column as a source of "real routes," see `route_definitions` below instead). Same never-hand-duplicated pattern as `quest_definitions.csv`. |
| `quest_definitions` *(milestone 8)* | one row per quest | Generated from `network/processed/quests.json` via `network/scripts/build_quest_seed.py` — `quest_id`, `title`, `description`, `mechanism`, `criteria_json` (the quest's full criteria object, serialized as a JSON string), `source` (`hand_authored` or `auto_generated` — stamped by `build_quests.py` at the exact point each quest is created, not inferred here from a naming pattern; see `build_quests.py`'s module docstring). Added for the achievements dashboard page, which shows hand-authored quests individually but collapses the auto-generated `line_completion_*`/`branching_out_*` families into a single count instead. Deliberately a single JSON-column seed, not a normalized-relational split across multiple tables — mirrors exactly what `quests_logic.ts` reads on the mobile side, one data shape end to end, nothing to keep in sync by hand. Intermediate models parse `criteria_json` via BigQuery's native `JSON_VALUE`/`JSON_VALUE_ARRAY`/`JSON_QUERY_ARRAY` functions. |
| `route_definitions` *(milestone 8)* | one row per real route | Generated from `network/processed/route_stops.json` via `network/scripts/build_route_seed.py` — just `route_id`. Exists specifically because `all_routes` criteria with no explicit list (e.g. `all_lines_rider`) means "every real route, dynamically," and `station_coordinates.routes` can't be trusted for this (stale `"S"` shuttle label — see above). `route_stops.json`'s own keys are the single source of truth for "what's a real route" everywhere else in this project; this seed just makes that list available in the warehouse too. |
| `route_stations` *(milestone 8)* | one row per `(route_id, station_id)` | Generated from `network/processed/route_stops.json` via `network/scripts/build_route_stations_seed.py` — each route's full flattened station span (union across all branches, deduped). Needed for `full_line_ride` criteria (`im_not_leaving`), which checks whether a trip's legs on one route cover every station on that route's full span. Same union-across-branches computation as mobile's `FULL_ROUTE_SPANS` in `quests.ts`, same documented simplification (station-set coverage, not strict end-to-end ordering). |

## Intermediate

| Model | Grain | Description |
|---|---|---|
| `int_committed_trips` | one row per `trip_id` | Every trip ever committed, deletion-inclusive. Owns the `trip_started`/`trip_ended` join logic in one place. |
| `int_trips` | one row per `trip_id` | Thin filter on `int_committed_trips`, excluding any trip with a `trip_deleted` event. Every downstream model reads this, not `int_committed_trips`, except the deletion-rate metric, which specifically wants the deletion-inclusive version. |
| `int_legs` | one row per `leg_id` | Reconstructed from `leg_boarded`/`leg_alighted`. Inner-joins to `int_trips` purely to inherit deleted-trip exclusion — trip-level columns deliberately not selected, to keep this leg-grain only. `sequence` is `NULL` for pre-`event_version-2` rows, a known accepted gap. |
| `int_transfers` | one row per detected transfer | `LAG()` window over `int_legs`, partitioned by `trip_id`, ordered by `sequence` — a transfer exists where one leg's exit matches the next leg's entry. Deleted-trip exclusion inherited from `int_legs`, not re-derived. Ordering has the same `sequence`-nullness caveat as `int_legs`. Reused by `int_quest_completion_counting`'s `transfer_count` logic rather than re-derived — **assumption flagged, not confirmed this session:** that reuse assumes this model carries a `trip_id` column to join against `int_trips` for `user_id`; if it only carries `leg_id` references, that join needs adjusting to go through `int_legs` instead. |
| `int_draft_sessions` | one row per `draft_id` | Every draft outcome — committed, abandoned, or neither yet. `committed_at`/`abandoned_at` nullable; `had_correction` (any `draft_leg_removed`); `leg_count` via join to `int_trips`, populated only for committed drafts whose trip wasn't later deleted. Serves the timing metric, correction-rate, and abandonment-rate from one model. |
| `int_user_visited_complexes` *(milestone 8)* | one row per `(user_id, complex_id)` | Foundational for quest evaluation — every `complex_id` a user has ever visited, via leg entry/exit stations AND trip origin/destination (mirrors `quests_logic.ts`'s `complexIdsVisited()` exactly, same two sources). Every station-set/group/pair check in `int_quest_completion_lifetime_set` reads this, not `int_legs`/`int_trips` directly. |
| `int_quest_completion_lifetime_set` *(milestone 8)* | one row per `(user_id, quest_id)`, lifetime-set-mechanism quests only | SQL equivalent of `quests_logic.ts`'s `evaluateLifetimeSet()` — all six criteria sub-shapes (`all_stations`, `min_count_stations`, `all_groups`, `min_count_groups`, `all_station_route_pairs`, `all_routes`), each its own CTE set, unioned. Cross-joins every user against every quest of that shape, left-joins against actual achieved counts, so a user with zero progress still gets an explicit `completed = false` row. |
| `int_quest_completion_per_trip` *(milestone 8)* | one row per `(user_id, quest_id)`, per-trip-mechanism quests only | SQL equivalent of `evaluatePerTrip()` — `leg_count_min`, `route_letters_spell_word`, `geographic_endpoints`, and `full_line_ride` (all four now implemented; `full_line_ride` was shipped as a deliberate zero-row stub first, then implemented for real via `route_stations` once judged worth closing — see milestone-8-achievements.md's Warehouse detail section for the reasoning). "Completed" = at least one of the user's trips satisfied the criteria — no fractional/cumulative concept, same as the mobile evaluator. |
| `int_quest_completion_counting` *(milestone 8)* | one row per `(user_id, quest_id)`, counting-mechanism quests only | SQL equivalent of `evaluateCounting()` — `ride_count_route` (both explicit-route and `'any'`-route cases) and `transfer_count` (reuses `int_transfers`, see that row's flagged assumption above). |

## Marts

| Model | Grain | Description |
|---|---|---|
| `mart_global_summary` | single row | Avg trips/user, lines ridden ÷ `route_totals`, draft correction/abandonment rates, trip deletion rate, **collective % of system explored** (`pct_system_explored_collective` — distinct stations visited by anyone ÷ total, exempt from suppression), plus *(milestone 8)* `total_quest_completions`, `users_with_any_quest_completion`, `lines_fully_completed` — same exempt category, all magnitudes/headcounts, never disclosing which quest, station, or user. Reads the same `int_quest_completion_*` models `mart_quest_completion` does, via a self-contained CTE cross-joined onto the existing single row. No suppression — global aggregates, not segments. |
| `mart_growth_daily` | one row per date | New signups, new activations, trips started per day. No suppression — time series of totals, not per-user segments. |
| `mart_station_stats` | one row per `station_id` | Visit count, plus `lat`/`lon`/`station_name`/`station_routes` joined in from the `station_coordinates` seed (inner join — a station missing coordinates fails loudly via a singular test, rather than silently dropping off the heatmap). Feeds the Exploration heatmap and Growth's "Top stations." Suppressed (N=5). |
| `mart_line_stats` | one row per `route_id` | Ride count. Feeds "Top lines." Suppressed (N=5) — shuttle rows especially, since low ridership on `FS`/`GS`/`H` individually is more disclosure-risky than a numbered line. |
| `mart_station_pairs` | one row per `(entry_station_id, exit_station_id)` | Ride count per station-to-station hop. Feeds the station-pair network graph. Suppressed (N=5). Composite grain — checked via a singular test, not dbt's built-in `unique` (which only covers single columns). |
| `mart_lines_ridden_histogram` | one row per lines-ridden bucket | Per-user distinct lines ridden ÷ total lines, bucketed. Same shape as the removed stations histogram, at route grain. Exempt — magnitude only, no location content. |
| `mart_trips_per_user_histogram` | one row per trip-count bucket | Same reasoning as above. |
| `mart_time_to_log` | one row per leg-count bucket | Median/p95 seconds to log, by leg count. Same reasoning as above. |
| `mart_sync_health` | one row per date | p50/p95 sync latency (`received_at − recorded_at`), % synced within 60 min. No suppression — event-level aggregate, not per-user. |
| `mart_quest_completion` *(milestone 8)* | one row per quest | Unions all three `int_quest_completion_*` models, `count(distinct user_id where completed)` as `completion_count`. **Raw count, not a percentage** — decided in `dashboard-spec.md`: a % reads as inflated significance when the real denominator is 5 people. `segment_user_count` equals `completion_count` here (unlike `mart_station_stats`, where the two can differ) — for quest completion, "how many people completed this" is both the metric and the privacy-relevant count, so they coincide by construction. Suppressed (N=5), verified. Also carries `source` (`hand_authored`/`auto_generated`, from `quest_definitions`) so Power BI can filter the achievements-page bar chart to hand-authored quests only — added to `quest_definitions` first, then briefly missing from this mart's own `SELECT` until caught and fixed (the seed had the column, the mart's query didn't ask for it). |
| `mart_quest_completion_histogram` *(milestone 8)* | one row per completion-count bucket (`0`/`1`/`2`/`3-5`/`6+`) | Reads the same three `int_quest_completion_*` models as `mart_quest_completion`, grouped by `user_id` instead of `quest_id` — same underlying fact, sliced a different way (see `data-layer.md`'s "Reusable pattern" section). Exempt from suppression — magnitude of activity per user, no location content, same reasoning as `mart_trips_per_user_histogram`/`mart_lines_ridden_histogram`. Feeds the Achievements page's "is completion broad or concentrated in one person" question directly. |

---

## Min-N suppression status — milestone 6 and milestone 8 both done and verified

Full reasoning: `dashboard-spec.md`'s "Privacy: minimum-N suppression." Full setup/testing runbook:
`docs/bigquery-min-n.md`. This section is just the model-level status.

| Mart (`subwayquest_dbt_mart`) | `segment_user_count`? | Row access policy (N=5)? | Status |
|---|---|---|---|
| `mart_station_stats` | ✅ | ✅ `min_n_suppression` | Live, verified via impersonated `bq` queries against synthetic boundary data |
| `mart_station_pairs` | ✅ | ✅ `min_n_suppression` | Same |
| `mart_line_stats` | ✅ | ✅ `min_n_suppression` | Same — added after initially being scoped out; shuttle rows can disclose a specific rider at low N, same as a station |
| `mart_trips_per_user_histogram`, `mart_time_to_log`, `mart_lines_ridden_histogram`, `mart_quest_completion_histogram` *(milestone 8)* | ❌ never had it | — | Magnitude-only, no location content |
| `mart_global_summary`, `mart_growth_daily`, `mart_sync_health` | ❌ never had it | — | Single aggregates / non-location time series |
| `mart_quest_completion` | ✅ | ✅ `min_n_suppression`, added to `reapply_min_n_suppression.sql`'s table list | Live, verified via impersonated `bq` queries against synthetic boundary data, same as the other three |

`powerbi-reader` (dedicated GCP service account, read-only, dataset-scoped to `subwayquest_dbt_mart`
only) is the only granted identity on all four live policies. Verification for the original three
(seeded rows at N=3/4/5/9/20, checked via impersonated `bq query` outside Power BI entirely) passed
cleanly on first run — see `docs/bigquery-min-n.md` for exact commands. Same runbook applied to
`mart_quest_completion` this session, same clean result — below-threshold rows empty, at/above
unmodified, boundary correct at `>=5`.

---

## Outstanding, not yet resolved

1. **Shuttle grouping (`S` → `FS`/`GS`/`H`)** — designed, not built. See status.md's "Mobile UI —
   remaining." `route_totals` moves 23 → 26 once shipped. Also blocks `s_tier` (milestone 8's
   quest), which resolves against real `FS`/`GS`/`H` data already but is explicitly gated by a
   `blocked: true` flag in `quests_source.json` until the app can actually let a user select/log a
   ride on an individual shuttle.
2. **"Top lines" normalization** — open until shuttle grouping resolves whether stored `route_id`
   values ever diverge from the 23-line set.
3. **Achievements/quests** — milestone 8. Data layer, resolver, mobile evaluation logic, UI pages,
   and the warehouse layer (seeds, intermediate models, mart) are all built and verified —
   `dbt run`/`dbt test` clean, N=5 suppression confirmed via impersonated `bq` at 3/4/5/9/20.
   `int_transfers`' assumed `trip_id` column (used by `int_quest_completion_counting`) was never
   directly confirmed by reading the file, but a wrong column reference would have failed `dbt run`
   outright rather than passing silently — the clean run is itself reasonably strong indirect
   evidence the join is correct, even without having seen the file. Dashboard tile and docs handoff
   are what's left — see `milestone-8-achievements.md` for the full status and reasoning trail.
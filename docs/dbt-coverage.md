# SubwayQuest — dbt Layer: Complete Reference

Full reference for the staging → intermediate → mart chain, organized by layer. Supersedes
piecemeal descriptions scattered across data-layer.md/status.md — read this for "what dbt models
exist and what each one does." Design reasoning for *why* the layer is shaped this way (grain,
materialization, the NYC-project comparison) still lives in data-layer.md's "dbt transformation
layer" section — not duplicated here.

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

## Intermediate

| Model | Grain | Description |
|---|---|---|
| `int_committed_trips` | one row per `trip_id` | Every trip ever committed, deletion-inclusive. Owns the `trip_started`/`trip_ended` join logic in one place. |
| `int_trips` | one row per `trip_id` | Thin filter on `int_committed_trips`, excluding any trip with a `trip_deleted` event. Every downstream model reads this, not `int_committed_trips`, except the deletion-rate metric, which specifically wants the deletion-inclusive version. |
| `int_legs` | one row per `leg_id` | Reconstructed from `leg_boarded`/`leg_alighted`. Inner-joins to `int_trips` purely to inherit deleted-trip exclusion — trip-level columns deliberately not selected, to keep this leg-grain only. `sequence` is `NULL` for pre-`event_version-2` rows, a known accepted gap. |
| `int_transfers` | one row per detected transfer | `LAG()` window over `int_legs`, partitioned by `trip_id`, ordered by `sequence` — a transfer exists where one leg's exit matches the next leg's entry. Deleted-trip exclusion inherited from `int_legs`, not re-derived. Ordering has the same `sequence`-nullness caveat as `int_legs`. |
| `int_draft_sessions` | one row per `draft_id` | Every draft outcome — committed, abandoned, or neither yet. `committed_at`/`abandoned_at` nullable; `had_correction` (any `draft_leg_removed`); `leg_count` via join to `int_trips`, populated only for committed drafts whose trip wasn't later deleted. Serves the timing metric, correction-rate, and abandonment-rate from one model. |

## Marts

| Model | Grain | Description |
|---|---|---|
| `mart_global_summary` | single row | Avg trips/user, lines ridden ÷ `route_totals`, draft correction/abandonment rates, trip deletion rate, **collective %-system-explored ÷ `station_totals`** (added milestone 7). No suppression — global aggregates, not segments. |
| `mart_growth_daily` | one row per date | New signups, new activations, trips started per day. No suppression — time series of totals, not per-user segments. |
| `mart_station_stats` | one row per `station_id` | Visit count. Feeds the Exploration heatmap and Growth's "Top stations." Suppressed (N=5). |
| `mart_line_stats` | one row per `route_id` | Ride count. Feeds "Top lines." Suppressed (N=5) — shuttle rows especially, since low ridership on `FS`/`GS`/`H` individually is more disclosure-risky than a numbered line. |
| `mart_station_pairs` | one row per `(entry_station_id, exit_station_id)` | Ride count per station-to-station hop. Feeds the station-pair network graph. Suppressed (N=5). Composite grain — checked via a singular test, not dbt's built-in `unique` (which only covers single columns). |
| `mart_lines_ridden_histogram` | one row per whole-number bucket of per-user distinct lines ridden | Built milestone 7. Whole-number buckets (0-23, soon 0-26), not percentage deciles — deliberately different bucketing scheme than the removed stations histogram, since 23 is too small a scale for percentage buckets to read well. No suppression — magnitude-only, same reasoning as the other unsuppressed histograms. |
| `mart_trips_per_user_histogram` | one row per trip-count bucket | Same reasoning as above. |
| `mart_time_to_log` | one row per leg-count bucket | Median/p95 seconds to log, by leg count. Same reasoning as above. |
| `mart_sync_health` | one row per date | p50/p95 sync latency (`received_at − recorded_at`), % synced within 60 min. No suppression — event-level aggregate, not per-user. |
| `mart_quest_completion` | one row per quest (planned) | **Blocked on milestone 8** — quest content doesn't exist yet. Will need suppression (N=5) once built — a quest names real stations, same disclosure risk as station-level stats. |

---

## Min-N suppression status — milestone 6, done and verified

Full reasoning: `dashboard-spec.md`'s "Privacy: minimum-N suppression." Full setup/testing runbook:
`docs/bigquery-min-n.md`. This section is just the model-level status.

| Mart (`subwayquest_dbt_mart`) | `segment_user_count`? | Row access policy (N=5)? | Status |
|---|---|---|---|
| `mart_station_stats` | ✅ | ✅ `min_n_suppression` | Live, verified via impersonated `bq` queries against synthetic boundary data |
| `mart_station_pairs` | ✅ | ✅ `min_n_suppression` | Same |
| `mart_line_stats` | ✅ | ✅ `min_n_suppression` | Same — added after initially being scoped out; shuttle rows can disclose a specific rider at low N, same as a station |
| `mart_trips_per_user_histogram`, `mart_time_to_log`, `mart_lines_ridden_histogram` | ❌ removed/never had it | — | Magnitude-only, no location content |
| `mart_global_summary`, `mart_growth_daily`, `mart_sync_health` | ❌ never had it | — | Single aggregates / non-location time series |
| `mart_quest_completion` | not built | planned, N=5 | Blocked on milestone 8 content — same disclosure reasoning as station/line |

`powerbi-reader` (dedicated GCP service account, read-only, dataset-scoped to `subwayquest_dbt_mart`
only) is the only granted identity on all three live policies. Verification (seeded rows at
N=3/4/5/9/20, checked via impersonated `bq query` outside Power BI entirely) passed cleanly on first
run — see `docs/bigquery-min-n.md` for exact commands.

---

## Outstanding, not yet resolved

1. **Shuttle grouping (`S` → `FS`/`GS`/`H`)** — designed, not built. See status.md's "Mobile UI —
   remaining." `route_totals` moves 23 → 26 once shipped.
2. **"Top lines" normalization** — open until shuttle grouping resolves whether stored `route_id`
   values ever diverge from the 23-line set.
3. **Achievements/quests** — milestone 8. See `docs/quests-parking.md`.
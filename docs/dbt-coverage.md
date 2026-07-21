### dbt metric coverage map

Every metric dashboard-spec.md defines, and what covers it. Kept here (not data-layer.md) since
this tracks in-progress status, not settled design. Update as models get built.

**Models — built:**
| Model | Grain | Status |
|---|---|---|
| `stg_events` | one row per `event_id` | ✅ built, tested |
| `int_trips` | one row per `trip_id`, deleted trips excluded | ✅ built, tested — now a thin filter on `int_committed_trips` |
| `int_legs` | one row per `leg_id`, deleted-trip legs excluded | ✅ built, tested |
| `int_committed_trips` | one row per `trip_id`, deletion-inclusive | ✅ built, tested — owns the `trip_started`/`trip_ended` join logic; `int_trips` filters this rather than re-deriving it |
| `route_totals` (seed) | single value, total ridable lines | Value TBD — see open decision below, not yet finalized/seeded |

**Models — designed, not yet built:**
| Model | Grain | Status |
|---|---|---|
| `int_transfers` | one row per detected transfer (leg pair) | Fully speced, no open questions |
| `int_draft_sessions` | one row per `draft_id`, every outcome (committed/abandoned) | **Scope widened, decided:** originally designed for committed-only timing; now one row per draft regardless of outcome — `started_at`, nullable `committed_at`/`abandoned_at`, `had_correction` (bool, any `draft_leg_removed`), `leg_count` (populated only when committed, via inner join to `int_trips`). One model serves timing, correction-rate, and abandonment-rate — not built yet |

**Metric → coverage:**
| Metric | Covered by | Status |
|---|---|---|
| Station visit heatmap | `int_legs` | Ready for mart |
| % of system explored per user | `int_legs` + `int_trips` | Ready for mart — needs static 496-station total, not yet sourced in BigQuery |
| Lines ridden vs. total | `int_legs` (`route_id`) ÷ `route_totals` seed | **Renamed from "Lines/branches ridden vs. total."** Branch-level tracking cut — would need `route_stops.json` in the warehouse for the first time, same cost/payoff tradeoff as the already-cut "average ride length" metric, for detail this metric doesn't need. Seed value itself still open — see below. |
| % of users completing each quest | — | **Blocked** on milestone 8 (quest content + `quest_definitions.csv`) — see `docs/quests-parking.md` |
| Total signups, over time | `stg_events`, first-ever event per `user_id` | **Decided, not yet built.** Split into two metrics instead of one — see below. |
| Total activated users, over time | `int_trips`, first row per `user_id` | **Decided, not yet built.** Paired with signups above; the gap between the two lines is the never-activated signal. |
| Trips logged per day | `int_trips` | Ready for mart |
| Average trips per user | `int_trips` | Ready for mart |
| Histogram: trips per user | `int_trips` | Ready for mart |
| Top stations | `int_legs` | Ready for mart |
| Top lines | `int_legs` | Ready for mart — **possible open issue flagged, not yet resolved:** need to confirm whether `route_id` as stored can ever contain express/shuttle variants (`6X`, `7X`, `FX`, `FS`, `GS`, `H`, `SI`) not in the app's 23-icon `LINE_ICONS` set; if so, may need normalizing so e.g. both shuttles don't split what the UI presents as one line |
| Station-pair network graph | `int_transfers` | Blocked on that model being built |
| % requiring correction before logging | `int_draft_sessions` (widened) | Blocked — model not built yet, scope now decided |
| % drafts abandoned | `int_draft_sessions` (widened) | Same blocker |
| % trips deleted | `stg_events` (numerator) + `int_committed_trips` (denominator) | **Decided, ready for mart** — `int_committed_trips` now exists |
| Median time to log, by leg count | `int_draft_sessions` (widened) | Blocked — model not built yet |
| Sync health (p50/p95 latency) | `stg_events` directly | No intermediate model needed — decided, straight to mart |

**Open decisions, not yet made:**
1. **`route_totals` seed value — resolved and current.**

**Today's real, verified value: 23.** Confirmed directly against `route_stops.json` and the actual
`LINE_ICONS`/`LINE_COLORS` keys, not hand-counted (hand-counting got this wrong twice earlier the
same session — worth trusting the verification script over arithmetic if this ever needs
re-checking).

History, kept for context: the number originally assumed here was "23," but that was wrong at the
time — it silently assumed `S` matched a real route, when neither `S` nor the (also-broken) `SIR`
key ever matched anything in the real GTFS data. True working count before any fixes was 22. The
SIR fix (session of [today's build]) corrected `SIR` → `SI`, bringing the real total to today's 23.

**Next expected change: 23 → 26**, once shuttle grouping ships (see `status.md`'s "Mobile UI —
remaining"). `FS`/`GS`/`H` will each become independently selectable and stored as real, distinct
route_ids — three genuine additions to the count, even though they'll continue sharing one `S` icon
in the UI. **Don't forget to bump this seed in the same session shuttle grouping ships** — it will
not update itself, and every mart model reading `route_totals` (`mart_global_summary`,
`mart_line_stats`) will silently understate the denominator until it's bumped.
2. **Achievements/quests** — genuinely milestone 8, not milestone 5. Flagged, not solved here — see
   `docs/quests-parking.md`.

**Resolved this pass (kept above, removed from open list):**
- "Total users" — split into signup count + activation count, both needed, neither replaces the other.
- Deletion-rate's denominator — `int_committed_trips` built.
- Draft-outcomes scope — widened `int_draft_sessions`, not split.
- Branch-count — branches dropped entirely; question narrowed to just the lines/routes seed value.
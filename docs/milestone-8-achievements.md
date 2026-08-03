# SubwayQuest — Milestone 8: Achievements

Single living doc for this milestone — scope, criteria schema, file layout, and current status all
in one place, updated as work happens. Supersedes the earlier separate scope doc and checkpoint doc;
this is the only one to keep going forward.

## Milestone status: functionally closed, two items deliberately left open

Everything in the "Completion criteria" section is done except two, both intentional, not
forgotten:
1. **On-device per-mechanism verification** — lifetime_set confirmed directly (Roosevelt Island);
   per_trip and counting mechanisms were never explicitly triggered and confirmed on-device the same
   way. Real gap, not blocking, worth closing before treating the mobile quest system as fully
   airtight.
2. **Power BI dashboard polish** — the achievements page's chart foundations are built and working;
   remaining visual polish is deliberately deferred. Decision, not oversight: moving to milestone 9
   (finishing the mobile app's remaining UI) first, coming back to dashboard styling after.

Everything else — content, resolver, mobile logic (32 tests passing), UI (`trip.tsx`, achievements
list/detail, both quest components), the full warehouse layer (4 new seeds, 4 new intermediate
models, 2 marts, suppression verified via impersonated `bq`), and the docs handoff
(`quests-integration.md`, `data-layer.md`'s cut-list) — is done and verified.

## Rebuild workflow — run in this order whenever quest content or resolver logic changes

Any edit to `quests_source.json`, `final_neighborhoods.json`, beach stations, or the resolver itself
(`build_quests.py`) needs the full chain re-run, in order — skipping a step leaves stale data
somewhere downstream:

```
1. python network/scripts/build_quests.py        # regenerates network/processed/quests.json
2. python network/scripts/validate_quests.py      # structural + regression checks against real data
3. node mobile/scripts/sync-data.js               # copies quests.json into mobile/data/, what the app actually bundles
4. npx tsx mobile/db/quests_logic_tests.ts         # pure-logic unit tests (run from mobile/, or adjust the path)
```

Steps 1–3 only matter when *content* changed (new/edited quests, new neighborhood/beach data).
Step 4 only matters when the *evaluation logic itself* changed (`quests_logic.ts`/`quests.ts`) —
but since it's cheap and fast (no device, no SQLite), running it every time is the safe default
rather than trying to remember which category a given change falls into.

None of these four steps require a native rebuild (`eas build`) — a plain `expo start -c` reload
picks up the result of step 3. A fresh native build is only needed if a change adds a new native
dependency, which nothing in the quest system does.

**Warehouse side — run after step 1 above, whenever quest content changes and the dashboard needs
to reflect it:**

```
5. python network/scripts/build_quest_seed.py          # quests.json -> dbt/seeds/quest_definitions.csv
6. python network/scripts/build_station_coords_seed.py  # re-run if stations.json ever changes -- now includes complex_id
7. python network/scripts/build_route_seed.py           # re-run if route_stops.json ever changes
8. python network/scripts/build_route_stations_seed.py  # re-run if route_stops.json ever changes
9. dbt seed
10. dbt run
11. dbt test
```

Steps 6–8 only need re-running if their respective source files change (rare) — step 5 is the one
that matters after every quest-content edit. The N=5 row access policy (`create_quest_completion_policy.sql`)
is a one-time manual step in BigQuery's SQL editor, not part of this regenerate-on-every-change loop —
`reapply_min_n_suppression`'s `on-run-end` hook keeps it alive across `dbt run`s automatically, same
as the other three suppressed marts.

## Status at a glance

| Layer | Status |
|---|---|
| Scope & criteria design | ✅ Done |
| Neighborhood/beach tagging data | ✅ Done (neighborhoods: regenerable pipeline, not "locked" — see below) |
| `quests_source.json` | ✅ Done (18 quests; `s_tier` correctly excluded, not missing) |
| `build_quests.py` resolver | ✅ Done, fully verified against real repo data |
| `network/processed/quests.json` | ✅ Generated and validated — all checks passing |
| `validate_quests.py` | ✅ Done — structural/cross-reference test suite, all checks passing |
| `mobile/db/quests_logic.ts` / `quests.ts` | ✅ Done — 32 unit tests, all passing |
| `app/trip.tsx` (extended) | ✅ Done |
| `app/achievements/[questId].tsx`, `app/(tabs)/profile/achievements/index.tsx` | ✅ Done |
| `StationQuestsList` / `ProfileQuestsSummary` (unmounted components) | ✅ Done — built, tested via temp debug route |
| dbt intermediate + `mart_quest_completion` | ✅ Built and verified — `dbt run`/`dbt test` clean, N=5 suppression confirmed via impersonated `bq` |
| N=5 suppression on the new mart | ✅ Macro updated — policy applies automatically via `on-run-end`, no manual step needed |
| Power BI quest dashboard page | 🟡 Basic chart foundations built; polish deliberately deferred — see Completion criteria |
| `docs/quests-integration.md` handoff doc | ✅ Done |
| `data-layer.md` cut-list additions | ✅ Done |

## Scope decision (resolved)

v1 grew from "one lifetime-set mechanism" to three distinct criteria mechanisms, deliberately,
because the quest system is judged to be a primary driver of first-impression app adoption once
testing opens up, not a lightweight bonus feature.

1. **Lifetime set-membership** — has the user's lifetime station/route history satisfied a set
   condition, ever, in any combination of trips
2. **Per-trip property check** — did one specific trip satisfy a self-contained condition
3. **Lifetime counting** — has some tally crossed a threshold

All three are self-contained checks — none require matching an ordered path/subsegment against trip
legs (see "Considered and cut" below).

All achievement logic builds fully, end to end, this milestone. Two of the four UI touchpoints
(Station page, Profile dashboard) depend on pages milestone 9 hasn't built yet — those get a
fully-built, fully-tested, un-mounted presentational component instead of being skipped. Milestone
9's job becomes exactly one import + one JSX line per page. See `docs/quests-integration.md`
(written once components exist) for the literal insertion points.

The other two touchpoints — trip-complete delta screen, achievements list/detail pages — already
have routes in the tree (`trip.tsx`, `profile/achievements/index.tsx`, `[questId].tsx`) and get
wired fully end-to-end this milestone.

---

## Criteria schema — the three mechanisms, and which quest ideas map to each

### Mechanism 1: Lifetime set-membership
Evaluated against the user's full station/route history, any trips, any order.

| Shape | Meaning | Quest examples |
|---|---|---|
| `all_stations` | Every station in a flat list, ever visited | Roosevelt Island, The Middle (Middle Village), Park Fence |
| `min_count_stations` | At least N stations from a flat list | Beachy (N beach stops) |
| `all_groups` | At least one station from *each* named group | Visit a station in every borough (5 groups); Branching Out (one group per branch tail, per line) |
| `min_count_groups` | At least one station from at least N of the named groups | Same-name stations (Canal, 23 St, 96 St, etc. — each name is a group) |
| `all_station_route_pairs` | Every listed (station, route) pair has a matching leg | Ride every line from a hub (Times Sq — pairs = every route servable there) |
| `all_routes` | Every real route in the system ridden at least once | Ride every subway line (route-grain, not station-grain); S Tier (explicit route list) |

`line_completion` (auto-expanding "ride every stop on line X") and `branching_out` (auto-expanding
"visit every branch tail of line X") are both special, auto-generated cases — never hand-authored in
`quests_source.json`, regenerated fresh every resolver run.

### Mechanism 2: Per-trip property check
Evaluated against one trip's ordered legs in isolation — no cross-trip history involved.

| Shape | Meaning | Quest examples |
|---|---|---|
| `leg_count_min` | Trip has ≥ N legs | N-legger |
| `full_line_ride` | Trip's legs on one route span that route's full station list, start to end | I'm Not Leaving |
| `route_letters_spell_word` | Concatenated route IDs ridden, in order, spell a target word | Wordsmith |
| `geographic_endpoints` | Trip's first entry / last exit satisfy a directional rule | Top-to-bottom, Bottom-to-top, Side-to-side |

### Mechanism 3: Lifetime counting
A simple tally against a threshold — no set membership involved.

| Shape | Meaning | Quest examples |
|---|---|---|
| `ride_count_route` | Ridden a specific route ≥ N times | Line Loyalist |
| `transfer_count` | Made ≥ N transfers, lifetime | Transfer Master |

---

## Considered and cut

- **Conquistador** (ride through every Manhattan tunnel/bridge crossing) and the generalized
  "trip contains this ordered sub-segment" tally it would unlock — **cut**. A fourth, genuinely
  different mechanism (ordered path/sub-segment matching), which `data-layer.md`'s quest-definitions
  section already deliberately cut for v1 — would need building twice (dbt SQL and TypeScript) and
  keeping in sync forever, and nothing else on the list needs it. Same instinct already correctly
  applied elsewhere on this project (the S3/RDS lake, a live Supabase-side rehydration projection).
- **First user to visit a station — cut entirely**, not deferred. Architecturally can't be an
  in-app badge: the quest engine deliberately reads local SQLite only, no other user's data ever
  reaches a device, by design. A dashboard-only version was considered and also dropped as not
  compelling enough alone.

**Still needs porting into `data-layer.md`'s own cut-list**, alongside the existing ordered-quest
cut — not done yet.

---

## File layout

### 1. Data / content layer

| File | What it does | Status |
|---|---|---|
| `network/quests_source.json` | Hand-authored: id, title, description, criteria per the schema above | ✅ Done — 17 quests |
| `network/scripts/build_neighborhood_mapping.py` | Point-in-polygon join, `stations.json` against NYC DCP's 2020 NTA polygons → `complex_to_neighborhood.json` / `neighborhoods_grouped.json` | ✅ Done |
| `network/notebooks/neighborhood_explorer.ipynb` | Manual tweaking of groupings, exports final call | ✅ Done → `final_neighborhoods.json` |
| `network/processed/final_neighborhoods.json` | Regenerable, not "locked" — see Known Open Items | ✅ Done (v1) |
| Beach station list (inline in `quests_source.json`'s `beachy` quest) | Hand-curated, NTA-name matching tried and rejected (see Known Decisions) | ✅ Done — 12 stations |
| `network/scripts/build_quests.py` | Resolves source → `network/processed/quests.json` | ✅ Done — see Resolver Detail below |
| `network/scripts/validate_quests.py` | Structural/cross-reference test for generated `quests.json`, same required-test pattern as `schema_tests.py`/`rehydrate_tests.ts` | ✅ Done — all checks passing against real repo data |
| `network/processed/quests.json` | Generated, tracked in git | ✅ Done — generated and validated against real `route_stops.json`/`stations.json` |
| `mobile/scripts/sync-data.js` | Updated to copy 5 files instead of 4 | ✅ Done |
| `mobile/data/quests.json` | Bundled copy, gitignored | ✅ Done |

### 2. Warehouse / dashboard layer

| File | What it does | Status |
|---|---|---|
| `network/scripts/build_quest_seed.py` | `quests.json` → `dbt/seeds/quest_definitions.csv` | ✅ Done, tested (round-trip verified including commas/quotes in JSON) |
| `dbt/seeds/quest_definitions.csv` | Generated seed — one row per quest, `criteria_json` as a JSON string column (JSON-column approach, not normalized relational — decided to avoid multiple seeds drifting out of sync) | ✅ Generated by the script above |
| `network/scripts/build_route_seed.py` (new, not originally planned) | `route_stops.json` → `dbt/seeds/route_definitions.csv` — the real route list, needed for `all_routes` criteria with no explicit list. `station_coordinates.routes` looked like a substitute but isn't (stale `"S"` label, same shuttle-grouping gap as elsewhere) | ✅ Done, tested |
| `network/scripts/build_route_stations_seed.py` (new, not originally planned) | `route_stops.json` → `dbt/seeds/route_stations.csv` — one row per `(route_id, station_id)` in that route's full flattened span, needed for `full_line_ride` (`im_not_leaving`) | ✅ Done, tested (branch-dedup confirmed) |
| `network/scripts/build_station_coords_seed.py` (updated) | Added a `complex_id` column — quest criteria reference `complex_id`, but the seed only had `station_id` (stop_id) before this | ✅ Done, tested |
| `int_user_visited_complexes.sql` (new, not originally planned) | One row per `(user_id, complex_id)` ever visited — foundational, every lifetime_set check reads this | ✅ Built |
| Intermediate model(s) — one per mechanism (lifetime set/group, per-trip, counting) | Mirrors the three evaluation shapes exactly | ✅ Built — all shapes implemented including `full_line_ride` (see Warehouse detail below); `int_transfers`' join shape assumed, not confirmed |
| `mart_quest_completion` | One row per quest, raw completion count + `segment_user_count` | ✅ Built |
| `dbt/macros/reapply_min_n_suppression.sql` | Add `mart_quest_completion` to the table list | ✅ Done — `mart_quest_completion` added to `suppressed_tables` |
| BigQuery row access policy | N=5, granted to `powerbi-reader`, verified via impersonated `bq` at 3/4/5/9/20 | ✅ Fully verified — applies automatically via the macro's `on-run-end` hook, and confirmed via impersonated `bq` at N=3/4/5/9/20 (below-threshold empty, at/above unmodified) |
| Power BI | Fill the reserved stub on the Exploration page | ⬜ Not started |

### 3. Mobile app layer

| File | What it does | Status |
|---|---|---|
| `mobile/db/quests_logic.ts`, `quests.ts` | Pure evaluators (`quests_logic.ts`, zero RN imports, mirrors `rehydrate_logic.ts`'s split) + I/O wrapper (`getAllQuestProgress`, `getQuestDetail` with itemized breakdown, `computeTripQuestProgress`, `getQuestsForStation`) | ✅ Done — 32 unit tests in `quests_logic_tests.ts`, all passing |
| `app/trip.tsx` (existing, extended) | Trip-complete screen shows which quest(s) this trip newly contributed to | ✅ Done — not yet on-device verified |
| `app/achievements/[questId].tsx` (root-level -- see Known open items), `app/(tabs)/profile/achievements/index.tsx` (didn't exist -- created) | Completed/ongoing list + per-quest detail page | ✅ Done — not yet on-device verified |
| `components/quests/StationQuestsList.tsx` | Fully built, tested, **not mounted** — no Station page exists yet | ✅ Done |
| `components/quests/ProfileQuestsSummary.tsx` | Fully built, tested, **not mounted** — no Profile dashboard exists yet | ✅ Done |
| Temporary debug route(s) (`__DEV__`-gated) | Mounts the two orphaned components against real data for testing | ✅ Done — `app/debug-quest-components.tsx` |
| `docs/quests-integration.md` | Handoff doc: exact import + JSX line for each pending component | ⬜ Not started |

---

## Resolver detail (`build_quests.py`)

Real, non-stub logic for:
- **`boroughs`** group — verified against real data (5 groups, 445 complexes total)
- **`same_name_station_clusters`** — verified (54 clusters after excluding 34 St-Penn Station and
  Chambers St as "same place split across complexes," not real twins — a real, editable
  `exclude_names` list in the source data, not a judgment call buried in a comment)
- **`manhattan_neighborhoods`** — reads `final_neighborhoods.json`; shape was initially guessed
  wrong (assumed nested borough→neighborhood→list) and corrected against the real flat,
  complex_id-keyed export (`{"<complex_id>": {"name", "borough", "neighborhood", "lat", "lon"}}`)
- **`line_completion`** — auto-generates one quest per real route (pre-existing pattern)
- **`branching_out`** — auto-generates one quest per route with 2+ real branches. Reuses
  `mobile/lib/subwayData.ts`'s exact `branchesForRoute()` logic (direction `'0'` only) rather than
  re-deriving branches a second way. Computes each branch's true divergent **tail** (stations not
  shared across all the route's branches) rather than using the raw full-branch station list, which
  would otherwise make the quest trivially completable via any shared trunk station.

**Verified against real repo data** — `validate_quests.py` (52 quests, 2,500+ structural/
cross-reference checks) passes clean. Confirms the trunk/tail computation works correctly on the
A train's real 3-way fork, among everything else.

**`s_tier` is intentionally unresolvable right now**, not a bug — `FS`/`GS`/`H` already exist as
real routes in `route_stops.json`, but the trip-logging UI can't select/log any individual shuttle
yet (`status.md`: "no shuttle is currently selectable anywhere in the trip-logging flow"). Since
the resolver has no way to detect an app-UI fact from data, this is gated by an explicit `blocked`
flag in `quests_source.json` rather than route-validity checking — the earlier version relied on
route validity, which was checking the wrong signal (see Bugs below) and would have let it resolve.

### Bugs found and fixed, via `validate_quests.py`
Same discipline as `bigquery-min-n-coverage.md`'s own "bug found and fixed" — worth keeping the
trail, not just the fix:
1. **`resolve_line_completion_quests()`** assumed `route_stops.json` was a flat per-route station
   list; the real shape is nested by direction/branch (confirmed against `subwayData.ts`). Fixed to
   flatten across branches via `branches_for_route()` and translate `stop_id` → `complex_id`, same
   as `branching_out` already did.
2. **`crossroads`** used the display-only route label `'S'` instead of the real GTFS route_id
   `'GS'` for the Times Sq/Grand Central shuttle.
3. **`s_tier`** was resolving when it shouldn't — `FS`/`GS`/`H` already exist as real routes, so
   route-validity checking wasn't a valid signal for "is this actually completable yet." Fixed via
   the explicit `blocked` flag described above.
4. **`branching_out`'s trunk/tail computation** was wrong for tree-shaped forks. The A train splits
   into Lefferts Blvd first, then splits again at Broad Channel into Far Rockaway vs. Rockaway
   Park — a secondary segment shared by exactly 2 of the 3 branches (not all 3) was leaking into
   both of their tails. Fixed by excluding any station shared by 2+ branches, not only ones shared
   by all of them.
5. **`validate_quests.py`'s own `routes_at_complex` cross-check** was built from `stations.json`'s
   `daytime_routes` field, which still lists shuttle stops as `"S"` rather than the real route_ids
   — a real inconsistency between `stations.json` and `route_stops.json` (same underlying
   shuttle-grouping gap `status.md` tracks, surfacing a third way). Fixed by deriving the check from
   `route_stops.json` instead, the same authoritative source the resolver itself uses.
6. **Found on-device, not by the validator** — `resolve_line_completion_quests()` used
   `all_stations` criteria (route-agnostic: "was this physical place ever visited"), so visiting any
   station in a shared multi-line transfer complex (e.g. Atlantic Av-Barclays Ctr, complex 617,
   served by B/D/N/Q/2/3/4/5 all at once) gave false completion credit toward *every* line sharing
   that platform, not just the one actually ridden. Fixed by switching to `all_station_route_pairs`
   — the same mechanism `crossroads` already used correctly — pairing each required station with
   the specific route being completed. No new evaluator logic needed, isolated entirely to
   `build_quests.py`. Worth noting `validate_quests.py` didn't catch this — it checks structural
   correctness (do referenced complex_ids/routes exist, does a route actually serve a complex), not
   semantic correctness (is this the *right* criteria type for what the quest means). A real
   reminder that structural validation and correctness aren't the same thing. **A regression check
   for this exact bug class was added to `validate_quests.py`** — every `line_completion_*` quest
   is now checked for `all_station_route_pairs` criteria with pairs matching its own route only.
7. **Déjà Vu semantic fix, not a bug in the original build but a real gap in the design** — a
   same-name cluster (e.g. the two Wall Sts) counted as "found" the moment *either* station was
   visited, which doesn't actually prove a duplicate was discovered. Added an optional
   `min_per_group` field to `all_groups`/`min_count_groups` criteria (defaults to 1, preserving
   existing OR-semantics quests like `borough_completionist`/`branching_out` unaffected); Déjà Vu's
   `quests_source.json` entry now sets `min_per_group: 2`, requiring both members of a cluster to
   be genuinely visited before it counts.
8. **Found immediately after #7 shipped** — the detail page's group checklist matched visited
   members by *name string*, but every member of a same-name cluster shares the literal same name
   ("Wall St", "Wall St") by definition, so `visitedNames.includes(name)` matched both rows the
   moment either one was visited — every entry showed checked after visiting just one. Fixed by
   keeping `complexId` through the enrichment layer (`quests.ts`'s `EnrichedGroupBreakdownItem` had
   dropped it in favor of names-only) and matching by id in the UI, not by name.

### Real correctness requirement, documented but not yet implemented anywhere
Quest station references are `complex_id` (e.g. 611 for Times Sq), but legs actually store GTFS
`stop_id` (per `dbt-coverage.md`'s `station_coordinates` seed). **Both `quests.ts` and the dbt mart
must translate a leg's `stop_id` → `complex_id`** via the bundled `stations.json` before checking
any quest's station-set membership, or nothing will ever match. Documented in `build_quests.py`'s
module docstring — needs to actually get implemented when those two pieces get built.

---

## Warehouse detail (dbt intermediate + `mart_quest_completion`)

Architecture decided: JSON-column seed (`quest_definitions.csv` has one `criteria_json` string
column, parsed via BigQuery's native `JSON_VALUE`/`JSON_VALUE_ARRAY`/`JSON_QUERY_ARRAY` functions),
not a normalized-relational seed split across multiple tables — fewer things to keep in sync, and
it mirrors exactly what `quests_logic.ts` reads on the mobile side, same data shape end to end.

Three intermediate models, one per mechanism, each producing `(user_id, quest_id, completed)` —
the SQL equivalent of `evaluateLifetimeSet`/`evaluatePerTrip`/`evaluateCounting`. Common pattern
across all three: cross join every user against every quest of that mechanism, left join against
actual achieved counts, so a user who did nothing toward a quest still gets an explicit
`completed = false` row rather than a missing one (`mart_quest_completion` needs every quest × every
user represented to count correctly).

**Three real data gaps found while writing this, all fixed the same way as everything else in this
project — a small regenerable script, not a workaround:**
- `station_coordinates` seed had no `complex_id` column — quest criteria reference `complex_id`,
  but the seed only carried `station_id` (GTFS stop_id). One-line fix to
  `build_station_coords_seed.py`.
- No warehouse-side source existed for "every real route" (needed for `all_routes` criteria with no
  explicit list, e.g. `all_lines_rider`). `station_coordinates.routes` looked like a substitute but
  isn't — it's derived from `daytime_routes`, which still uses the stale `"S"` shuttle label instead
  of real `FS`/`GS`/`H` (same gap `validate_quests.py` already worked around on the resolver side).
  New `build_route_seed.py` → `route_definitions.csv`, sourced from `route_stops.json` directly,
  same source of truth used everywhere else.
- No warehouse-side source existed for a route's full station span (needed for `full_line_ride`,
  i.e. `im_not_leaving`) — mobile has this bundled locally via `route_stops.json`'s
  `FULL_ROUTE_SPANS`. Originally shipped as a deliberate zero-row stub (same discipline as
  `build_quests.py`'s original `resolve_route_branches()` before the real branch schema was
  confirmed), then implemented for real once the gap was discussed and judged worth closing rather
  than leaving permanently stubbed — `im_not_leaving` already works correctly in the app, so a
  dashboard that could only ever show 0 completions for it was a real, visible inconsistency, not
  just an unfinished nice-to-have. New `build_route_stations_seed.py` → `route_stations.csv`
  (one row per `route_id`/`station_id` in that route's flattened span), same union-across-branches
  computation as the mobile side, same documented simplification (station-set coverage, not strict
  ordering).

**One assumption, indirectly confirmed rather than directly verified:** `transfer_count`'s model
reuses `{{ ref('int_transfers') }}` rather than re-deriving transfer detection (same "one place owns
this" principle as everywhere else) — this assumed `int_transfers` has a `trip_id` column to join
against `int_trips` for `user_id`, without ever having seen the file directly. `dbt run`/`dbt test`
came back clean, though, and a wrong column reference would have failed the build outright rather
than passing silently — reasonably strong indirect evidence the join is correct, even without a
direct read of the file.

**Real gotcha hit bootstrapping this mart, worth remembering for the next new suppressed table:**
`dbt_project.yml`'s `on-run-end` hook (`reapply_min_n_suppression()`) is a top-level hook, so it
fires on `dbt seed` too, not just `dbt run` — and it tries to apply a row access policy to all four
suppressed tables on every invocation. The very first `dbt seed` after adding `mart_quest_completion`
to the macro's table list failed with `Table ... mart_quest_completion was not found` — the seed data
itself loaded fine, but the hook ran before `dbt run` had ever created the mart table for the first
time, so there was nothing to attach a policy to yet. Fix was just running `dbt run` right after —
once the table exists, every subsequent `dbt seed`/`dbt run` succeeds normally (`CREATE OR REPLACE`
just updates the existing policy). Purely a one-time bootstrap thing for a brand-new suppressed
table, not a permanent ordering problem with the documented pipeline — but worth remembering
whenever milestone 9 or later introduces another new suppressed mart.

**Note on how this got verified:** unlike the Python/TypeScript work this milestone, none of this SQL
could be executed directly in this session — no BigQuery access here. `dbt run`/`dbt test` both came
back clean when Van ran them, and N=5 suppression was confirmed via the same impersonated-`bq`
boundary test (N=3/4/5/9/20) used for the other three marts. One real gotcha hit along the way,
already logged above: the very first `dbt seed` after wiring in `mart_quest_completion` failed
because `on-run-end` fired before `dbt run` had ever created the table — resolved by running `dbt run`
once, after which it's been clean since. Also found and cleaned up: stale mart table(s) left behind in `subwayquest_dbt` (the un-suffixed
dataset) — same root cause as milestone 6's originally-documented schema-relocation bug (dbt doesn't
relocate existing tables when a `+schema` config changes), apparently never fully cleaned up back
then. Worth a periodic check of `subwayquest_dbt` for orphans if this project's schema config ever
changes again.



- Achievement pages have correct data and logic but rough grouping/display — station names only
  (no line/route info per row), plain layout, no richer clickable drill-down. Explicitly deferred to
  milestone 9's broader UI pass, not an oversight — milestone 8's bar was always full logic
  correctness, not visual polish (see this doc's own opening scope note). Revisit once milestone 9's
  UI work is underway.

- File naming: the pure-logic/I/O-wrapper split (originally named `*-plan.ts`, borrowed from
  `rehydrate-plan.ts`) was renamed to `*_logic.ts` across both quests and rehydration —
  `rehydrate-plan.ts` → `rehydrate_logic.ts`, and the new quest files are `quests_logic.ts` /
  `quests.ts` / `quests_logic_tests.ts`. "Plan" wrongly implied these modules were staging/proposal
  code rather than the actual evaluation logic running on every screen visit. Underscores, not
  hyphens, per your actual implementation.
- Achievement detail page now shows the full itemized breakdown -- which specific stations/groups/
  pairs/routes are done vs. remaining, and which trip(s) satisfied each one (with dates), via
  `getQuestBreakdown` in `quests_logic.ts` and its name/date enrichment in `quests.ts`'s
  `getQuestDetail`. Resolves the earlier gap where only an aggregate count was shown.
- `trip.tsx` now shows progress on EVERY quest the trip touched, not just full completions --
  `computeTripQuestDelta` was renamed `computeTripQuestProgress` and its return type extended
  (`completedBefore`/`completedAfter`/`currentBefore`/`currentAfter`) so partial progress (e.g.
  Beachy going 1/6 -> 2/6) shows up right after every trip, not just the rare one that finishes
  something. Per-trip quests (leg_count_min, etc.) now also reappear on every trip that satisfies
  them again, not just the first time.
- Fixed a real bug: quest descriptions with a `{count}` placeholder (Beachy, Déjà Vu, etc.) were
  never having it substituted -- `quests.ts`'s `formatDescription()` now replaces it with the
  criteria's actual count wherever a description is surfaced.
- Achievement detail page (`[questId].tsx`) moved from `(tabs)/profile/achievements/` to root-level
  `app/achievements/[questId].tsx` after on-device testing surfaced a real Expo Router bug: linking
  into a tab-nested route from the root-level `trip.tsx` created a duplicate parallel tabs navigator,
  breaking both back-navigation and the tab bar. Now matches `ui-spec.md`'s own established pattern
  for Station/Line pages (root-level, "shared routes pushed onto whichever tab's stack you were
  already in"). `achievements/index.tsx` (the list) stays nested under `profile/` for now, since it
  currently has only one entry point (Profile) — revisit if a second context ever links to the full
  list rather than a specific quest (e.g. milestone 9's `StationQuestsList` would hit the same bug
  if it ever links to the list directly). The move also surfaced a second, smaller bug: the first
  version used `trip.tsx`'s import depth (`../contexts/...`), but `app/achievements/[questId].tsx`
  sits one folder deeper (inside `achievements/`) than `app/trip.tsx` does — fixed to `../../contexts/...`,
  verified against actual path resolution rather than re-asserted by reasoning alone.
- `profile/achievements/index.tsx` and `achievements/[questId].tsx` were built with a self-contained
  header (back chevron, matching `trip.tsx`'s visual style) rather than relying on the navigator's
  default Stack header, since `(tabs)/_layout.tsx`/`profile/_layout.tsx` weren't in hand to confirm
  whether one already exists. Worth checking for a doubled-up header once this is actually mounted.

## Achievements dashboard page (scope expansion beyond the original stub)

Originally scoped as a single reserved panel on the Exploration page (see `powerbi-polish-checklist.md`).
Grew into its own dedicated 4th page once the real content shape became clear — worth documenting the
"why," since it's a real scope change mid-milestone, not the original plan quietly executed.

**Why it outgrew a single panel:** there are 52 quests, not a handful — 17 hand-authored plus ~35
auto-generated (`line_completion_*`/`branching_out_*`, one per route/branch family). 52 bars doesn't
fit on an already-dense page, and the two groups aren't equally interesting to a viewer anyway — the
auto-generated ones are the same story told repeatedly per line, the hand-authored ones are each a
distinct idea. Splitting on that line (`source` field, see below) is what made the page tractable.

**Also decided along the way:** a raw completion-count bar shouldn't claim to show "which quests are
well-tuned" — quests vary wildly in real difficulty (one trip vs. dozens), so completion count alone
can't distinguish "well-tuned" from "just easier." Reframed as "completed so far," a factual claim
the data can actually support, not a calibration judgment it can't.

**Final design, 3 parts:**
1. **KPI row** (exempt, real numbers from day one, unlike everything else quest-related on this
   dashboard) — `total_quest_completions`, `users_with_any_quest_completion`, `lines_fully_completed`.
   All three are new columns on `mart_global_summary`, computed the same way
   `pct_system_explored_collective` already is — a pre-suppression global aggregate, not a `SUM()`
   over the suppressed `mart_quest_completion` (which would silently undercount, since suppressed
   rows are invisible to `powerbi-reader` at the query level, not filtered client-side).
2. **Bar chart** (suppressed, N=5, same mart as before) — `mart_quest_completion` filtered to
   `source = 'hand_authored'` in Power BI. No SQL change to the mart itself.
3. **Histogram** (exempt) — `mart_quest_completion_histogram`, new mart, quests-completed-per-user
   bucketed (`0`/`1`/`2`/`3-5`/`6+`). Directly answers "is completion broad or concentrated in one
   person" — same exempt category as `mart_trips_per_user_histogram`/`mart_lines_ridden_histogram`.

**Privacy audit done before building any of this** (not after): every new metric was checked against
`dashboard-spec.md`'s existing "magnitude, not location" exemption boundary before writing any SQL —
none of it introduces a new exemption category or weakens the existing suppressed
`mart_quest_completion`. `lines_fully_completed` got the closest scrutiny (adjacent to the suppressed
`mart_line_stats`) — it's safe specifically because it's a bare count ("6 of 23"), never *which* 6
lines; that's what the suppressed chart is for.

**Files:**

| File | What changed | Status |
|---|---|---|
| `build_quests.py` | **Real fragility caught and fixed**: `source` was originally going to be inferred in `build_quest_seed.py` by pattern-matching quest_id prefixes (`line_completion_`/`branching_out_`) — fragile, and a duplicated fact besides, since `build_quests.py` is the only code that actually *knows* whether a quest is auto-generated. Fixed by stamping `source` directly at the three points quests are created: both auto-generator functions set it explicitly, hand-authored quests get it centrally at the `main()` call site (one line, not touching every `resolve_quest()` branch). | ✅ Done, tested (all three paths verified) |
| `build_quest_seed.py` | `source` field on `quest_definitions.csv` — now a straight read of `quest["source"]`, no inference | ✅ Done, tested |
| `validate_quests.py` | New check: every quest must have a valid `source` (`hand_authored`/`auto_generated`) — catches any future regression (e.g. a new auto-generator function that forgets to stamp it) immediately instead of silently breaking the dashboard's filter | ✅ Done, tested against both failure modes |
| `mart_quest_completion.sql` | **Bug found and fixed**: the seed's new `source` field never got added to this mart's `SELECT` — the seed had it, the mart's query never asked for it, so it never reached Power BI. One-line fix (`qd.source` added to the final `SELECT`). | ✅ Fixed |
| `mart_global_summary.sql` | 3 new columns via a self-contained CTE + `CROSS JOIN` | ✅ Done — real file provided, spliced in directly |
| `mart_quest_completion_histogram.sql` | New mart, exempt | ✅ Done |
| `assert_quest_histogram_totals_match_users.sql` | New dbt test — histogram bucket totals must reconcile with real user count | ✅ Done |
| Power BI — new 4th page | KPI row + filtered bar chart + histogram | ⬜ Not started |

## Known open items (not blockers, just undecided)

- Whether to keep the NTA's directional splits (Harlem North/South, East Harlem North/South,
  Washington Heights North/South, Upper West Side split 3 ways) or merge each pair back into one
  colloquial name. Doesn't block anything — the resolver just reads whatever's in the field.
- Marble Hill stays filed under Manhattan (matches the app's own borough field) despite the NTA
  join geometrically placing it in the Bronx — decided, not open, restated here for the record.
- Every quest in `quests_source.json` carries a `_note` field flagging any number/word/pair picked
  rather than derived (Beachy's threshold, Wordsmith's word, geographic-endpoint station pairs,
  etc.) — cheap to tweak, none load-bearing. Strip `_note` fields before this ships for real.

---

## Completion criteria

- [x] `quests_source.json` written, covers the full finalized list
- [x] Neighborhood and beach-station tagging data authored (neighborhood mapping remains
      regenerable/tweakable, not frozen)
- [x] Build script resolves cleanly, verified against real repo data
      (`validate_quests.py`, 52 quests, all checks passing)
- [x] `build_quests.py`'s branch trunk/tail logic verified against a real known branching route
      (the A train's 3-way fork) — caught and fixed a real tree-fork bug in the process
- [x] `quests.json` bundles into the app; `quest_definitions.csv` seed builds via `dbt seed`
- [x] All three dbt evaluation shapes built, `dbt test` green — one real number hand-checked for
      lifetime_set (Roosevelt Island) directly against `int_quest_completion_lifetime_set`; per_trip
      and counting weren't separately hand-checked the same explicit way, worth a quick pass if it
      matters later, not blocking
- [x] `mart_quest_completion` built, correct
- [x] N=5 row access policy live, verified via impersonated `bq` at 3/4/5/9/20
- [x] `reapply_min_n_suppression` confirmed to survive a real pipeline run with the new table
      included (including recovering from the `dbt seed`-before-`dbt run` bootstrap gotcha)
- [x] `quests.ts`'s evaluators correct — pure-logic split (`quests_logic.ts`, à la `rehydrate_logic.ts`) so
      each is unit-testable without a device (32 tests passing, compiled clean under strict TS)
- [ ] **On-device: trigger at least one quest completion per mechanism** — lifetime_set confirmed
      (Roosevelt Island), the line_completion route-specificity bug and the Déjà Vu checklist bug
      were both found via real on-device testing. per_trip (e.g. 5-Legger) and counting (e.g. Line
      Loyalist) were never explicitly confirmed on-device the same way — genuinely still open, not
      just unchecked bureaucratically. Worth doing before calling the mobile side airtight.
- [x] Achievements list + detail pages fully wired and correct on-device
- [x] `StationQuestsList` and `ProfileQuestsSummary` built, verified correct via temporary debug
      routes, confirmed to agree with a hand-count
- [x] `docs/quests-integration.md` written — precise, unambiguous insertion instructions for
      milestone 9
- [ ] **Power BI quest dashboard page** — basic chart foundations built (KPI row, filtered bar chart,
      histogram all present); explicit remaining polish deferred by choice — Van's moving to
      milestone 9 mobile work now, coming back to dashboard styling later
- [x] Temporary debug-route scaffolding flagged for removal — documented in
      `docs/quests-integration.md`'s cleanup checklist, actual removal is milestone 9's job
- [x] Conquistador and "first visitor" exclusions ported into `data-layer.md`'s cut-list
- [x] `_note` fields stripped from `quests_source.json`
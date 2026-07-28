# SubwayQuest — Milestone 8: Achievements

Single living doc for this milestone — scope, criteria schema, file layout, and current status all
in one place, updated as work happens. Supersedes the earlier separate scope doc and checkpoint doc;
this is the only one to keep going forward.

## Status at a glance

| Layer | Status |
|---|---|
| Scope & criteria design | ✅ Done |
| Neighborhood/beach tagging data | ✅ Done (neighborhoods: regenerable pipeline, not "locked" — see below) |
| `quests_source.json` | ✅ Done (17 quests; `s_tier` correctly excluded, not missing) |
| `build_quests.py` resolver | ✅ Done, fully verified against real repo data |
| `network/processed/quests.json` | ✅ Generated and validated — all checks passing |
| `validate_quests.py` | ✅ Done — structural/cross-reference test suite, all checks passing |
| `mobile/db/quests_logic.ts` / `quests.ts` | ✅ Done — tested (21 unit tests, compiled clean under strict TS, runtime-smoke-tested) |
| Trip-complete / achievements pages wiring | ⬜ Not started |
| `StationQuestsList` / `ProfileQuestsSummary` (unmounted components) | ⬜ Not started |
| dbt intermediate + `mart_quest_completion` | ⬜ Not started |
| N=5 suppression on the new mart | ⬜ Not started |
| Power BI quest tile/chart | ⬜ Not started |
| `docs/quests-integration.md` handoff doc | ⬜ Not started |
| `data-layer.md` cut-list additions | ⬜ Not started |

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
| `mobile/data/quests.json` | Bundled copy | ✅ Done |

### 2. Warehouse / dashboard layer

| File | What it does | Status |
|---|---|---|
| `network/scripts/build_quest_seed.py` | `quests.json` → `dbt/seeds/quest_definitions.csv` | ⬜ Not started |
| `dbt/seeds/quest_definitions.csv` | Generated seed | ⬜ Not started |
| Intermediate model(s) — one per mechanism (lifetime set/group, per-trip, counting) | Mirrors the three evaluation shapes | ⬜ Not started |
| `mart_quest_completion` | One row per quest, raw completion count + `segment_user_count` | ⬜ Not started |
| `dbt/macros/reapply_min_n_suppression.sql` | Add `mart_quest_completion` to the table list | ⬜ Not started |
| BigQuery row access policy | N=5, granted to `powerbi-reader`, verified via impersonated `bq` at 3/4/5/9/20 | ⬜ Not started |
| Power BI | Fill the reserved stub on the Exploration page | ⬜ Not started |

### 3. Mobile app layer

| File | What it does | Status |
|---|---|---|
| `mobile/db/quests_logic.ts`, `quests.ts` | Pure evaluators (`quests_logic.ts`, zero RN imports, mirrors `rehydrate_logic.ts`'s split) + I/O wrapper (`getAllQuestProgress`, `getQuestDetail`, `computeTripQuestDelta`) | ✅ Done — 21 unit tests in `quests_logic_tests.ts`, all passing |
| `app/trip.tsx` (existing, extended) | Trip-complete screen shows which quest(s) this trip newly contributed to | ⬜ Not started |
| `app/(tabs)/profile/achievements/index.tsx`, `[questId].tsx` (existing stubs) | Completed/ongoing list + per-quest detail page | ⬜ Not started |
| `components/quests/StationQuestsList.tsx` | Fully built, tested, **not mounted** — no Station page exists yet | ⬜ Not started |
| `components/quests/ProfileQuestsSummary.tsx` | Fully built, tested, **not mounted** — no Profile dashboard exists yet | ⬜ Not started |
| Temporary debug route(s) (`__DEV__`-gated) | Mounts the two orphaned components against real data for testing | ⬜ Not started |
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

### Real correctness requirement, documented but not yet implemented anywhere
Quest station references are `complex_id` (e.g. 611 for Times Sq), but legs actually store GTFS
`stop_id` (per `dbt-coverage.md`'s `station_coordinates` seed). **Both `quests.ts` and the dbt mart
must translate a leg's `stop_id` → `complex_id`** via the bundled `stations.json` before checking
any quest's station-set membership, or nothing will ever match. Documented in `build_quests.py`'s
module docstring — needs to actually get implemented when those two pieces get built.

---

## Known open items (not blockers, just undecided)

- File naming: the pure-logic/I/O-wrapper split (originally named `*-plan.ts`, borrowed from
  `rehydrate-plan.ts`) was renamed to `*_logic.ts` across both quests and rehydration —
  `rehydrate-plan.ts` → `rehydrate_logic.ts`, and the new quest files are `quests_logic.ts` /
  `quests.ts` / `quests_logic_tests.ts`. "Plan" wrongly implied these modules were staging/proposal
  code rather than the actual evaluation logic running on every screen visit. Underscores, not
  hyphens, per your actual implementation.

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
- [ ] `quests.json` bundles into the app; `quest_definitions.csv` seed builds via `dbt seed`
- [ ] All three dbt evaluation shapes built, `dbt test` green, one real number hand-checked per
      mechanism
- [ ] `mart_quest_completion` built, correct
- [ ] N=5 row access policy live, verified via impersonated `bq` at 3/4/5/9/20
- [ ] `reapply_min_n_suppression` confirmed to survive a real pipeline run with the new table
      included
- [x] `quests.ts`'s evaluators correct — pure-logic split (`quests_logic.ts`, à la `rehydrate_logic.ts`) so
      each is unit-testable without a device (21 tests passing, compiled clean under strict TS)
- [ ] On-device: trigger at least one quest completion per mechanism, confirm the trip-complete
      delta screen shows it correctly; confirm a non-completing trip shows no false positive
- [ ] Achievements list + detail pages fully wired and correct on-device
- [ ] `StationQuestsList` and `ProfileQuestsSummary` built, verified correct via temporary debug
      routes, confirmed to agree with a hand-count
- [ ] `docs/quests-integration.md` written — precise, unambiguous insertion instructions for
      milestone 9
- [ ] Power BI quest tile/chart live, pulling real suppressed data
- [ ] Temporary debug-route scaffolding flagged for removal once milestone 9 mounts the real pages
- [ ] Conquistador and "first visitor" exclusions ported into `data-layer.md`'s cut-list
- [ ] `_note` fields stripped from `quests_source.json` once values are confirmed
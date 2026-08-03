# SubwayQuest — Status & Architecture

Single living doc: what's done, what's in progress, what's left, and — for the mobile app
specifically, where most of the accumulated complexity lives — the current file-by-file shape and why
it's built that way. Update this doc as work happens; it's meant to be read before resuming work in a
new session, not reconstructed from git history.

## Build sequence — how we know each stage actually works

| # | Milestone | Verification | Status |
|---|---|---|---|
| 1 | Supabase schema live | Insert as one auth user, confirm a second session can't read it | ✅ Done — verified with two impersonated test users |
| 2 | Auth + local trip logging | Real Sign-in-with-Apple on-device; log a trip, kill/reopen, it persists | ✅ Done — full commit/discard wiring verified on-device via a six-point check: clean multi-leg trip with transfer, correction path (completeness-based `draft_leg_added`/`draft_leg_removed`), discard path, cold launch (no splash/blank flash), and kill/full-relaunch persistence, all cross-checked against raw `events`/`trips`/`legs`/`sync_status` rows via a dev-only `/debug` dump screen rather than eyeballing the UI. |
| 3 | Sync worker | Log a trip on-device, confirm `raw_events` rows land under the right `auth.uid()` | ✅ Done — verified via a six-point on-device check: backlog sync on mount (24 pre-existing local events flushed in one pass), product + trip domain both land correctly, idempotency (forced re-sync of all 24 rows produced zero duplicates), RLS/`user_id` correctness, offline write → sync failure → automatic recovery on reconnect with no app interaction (NetInfo-driven), and a foreground re-trigger as fallback. |
| 4 | EL job → BigQuery | Trigger the workflow, confirm real data lands in BigQuery | ✅ Done — manually triggered via `workflow_dispatch`, verified against the real table: schema/column types correct, row count matches Supabase, `payload` genuinely parses as JSON (caught and fixed a double-encoding bug where `json.dumps()` was called on an already-parsed dict), partitioning (`received_at`) and clustering (`user_id`) both applied. `operational` schema removed from the data model as part of this milestone's cleanup (see `data-layer.md`'s "Removed: operational schema"); rehydration-on-sign-in built and verified on-device as its replacement for data continuity. |
| 5 | dbt mart | `dbt run`/`dbt test` green, hand-check one number | ✅ Done — full staging → intermediate → mart chain built and tested (stg_events; int_trips/int_committed_trips/int_legs/int_transfers/int_draft_sessions; nine mart models). Hand-checked real numbers in mart_global_summary and mart_growth_daily against known usage — sane. Pipeline's dbt step verified end-to-end in CI via pipeline.yml. One open thread carried forward, not blocking: shuttle grouping (S/FS/GS/H) — see "Mobile UI — remaining". |
| 6 | Min-N enforced | Query as Power BI's service account, confirm suppression | ✅ Done — N=5, scoped to `mart_station_stats`, `mart_station_pairs`, `mart_line_stats` (the three marts that name actual stations/routes at small-group grain; reasoning in `docs/dashboard-spec.md`, full setup/testing runbook in `docs/bigquery-min-n.md`). Dedicated `powerbi-reader` GCP service account created, read-only, scoped to the `subwayquest_dbt_mart` dataset only. Verified via impersonated `bq` queries against synthetic seed data at N=3/4/5/9/20 — below-threshold segments absent, at/above-threshold unmodified, boundary correct at `>=5`, enforcement confirmed independent of client (direct `bq` calls, not through Power BI). |
| 7 | Power BI live | Three pages, Publish to Web page-nav works | ✅ Done — all 3 original pages built (Growth & Engagement, Product/Instrumentation, Exploration & Usage), connected to `subwayquest_dbt_mart` via `powerbi-reader`, scheduled refresh live (4x/day, offset 30 min after each pipeline cron run), published and confirmed live on the public Publish to Web link. A 4th page (Achievements) was added during milestone 8, once quest content existed — see milestone 8's row below. Remaining polish on the original 3 pages (axis titles, tooltips, layout, cross-filter behavior, suppression explainer) tracked separately, not blocking. |
| 8 | Achievements — full app integration | Quest content resolved, progress logic wired into all 4 touchpoints (trip-complete delta, station page, profile page, challenge-detail page), dashboard mart built and suppressed | ✅ **Functionally complete.** Full detail, reasoning, and bug-fix history in `docs/milestone-8-achievements.md` (the primary reference for this milestone) and `docs/dbt-coverage.md` (schema reference). Content (18 hand-authored quests + auto-generated line-completion/branching-out families, 52 total), resolver + validator, mobile logic (`quests_logic.ts`, 32 tests) + full mobile UI, warehouse layer (4 new seeds, one intermediate model per mechanism, 2 marts, suppression verified via impersonated `bq`), and docs handoff (`quests-integration.md`, `data-layer.md`'s cut-list) — all done and verified. Two items intentionally left open, not forgotten: per_trip/counting mechanism on-device verification (only lifetime_set was explicitly confirmed), and Power BI achievements page visual polish (foundations built and working, styling deliberately deferred — Van prioritizing milestone 9 mobile work first). `StationQuestsList`/`ProfileQuestsSummary` components are built and tested but **not yet mounted** — that's milestone 9's job; exact insertion points in `docs/quests-integration.md`. |
| 9 | Remaining plain UI pages | Station drill-down, branch-aware picker, profile dashboard (now scoped down — quest UI is milestone 8's job, not this one) | ⬜ Not started — **note:** the Station and Profile pages built here also need to mount `StationQuestsList`/`ProfileQuestsSummary` respectively as part of this work, per `docs/quests-integration.md` |
| 10 | Release readiness | App Store Connect, privacy policy, testers | Apple Developer membership ✅; rest ⬜ |
| 11 | Portfolio narrative | README, case study | ⬜ Not started |

## Mobile trip-logging flow — current state

Built as a single continuous chip-strip editor, not discrete full-screen steps. A fixed-height,
vertically-scrolling strip (capped, scrolls within itself, never grows the modal) sits under the date
control — one row per leg, each showing line/entry/exit as pills, a transfer icon capping off every
row but the last. Below it, one fixed-height "active area" always shows exactly one in-progress
decision. The modal itself never scrolls. Header padding is safe-area-aware
(`useSafeAreaInsets`), not a hardcoded constant — matters since the modal presentation changed from
full-screen to page-sheet mid-build and a fixed value silently became wrong.

**Every leg write goes through one function, `commitLeg`** — truncates to the edited leg's index
before appending, always. This is what makes the cascade rule a structural guarantee rather than
something each of `selectLine`/`selectEntry`/`selectExit`/`selectTransfer` has to individually
remember to do correctly. (Worth knowing why this exists: an earlier version had each function
truncate by hand, and `selectExit` was written without it — editing an earlier leg's exit silently
failed to clear legs after it. Consolidating into one write path is the fix, not a patched special case.)

**Editing — chip-tap-to-reopen, transfer-aware:**
- Leg 0's line/entry chips behave freely — full line grid, full station picker, exactly as before.
- A transfer leg's **line** chip reopens scoped to `getTransferRoutes()` against the *prior* leg's
  exit, not the full grid — re-picking it correctly re-derives that leg's entry too.
- A transfer leg's **entry** chip is locked — not tappable, shown at reduced opacity (`0.6`) as the
  only visual cue. Deliberate: a transfer leg's entry is fully determined the moment its line is
  picked (one complex, one platform for that route), so there's nothing valid to reopen. A mixup is
  corrected via the line chip instead, which is the actual degree of freedom that exists.
- Viewing a chip never destroys data; confirming a genuinely new value clears that field and
  everything downstream, per `commitLeg`.
- Each `StationPickerStep` instance is given an explicit `key` (`entry-${legIndex}` /
  `exit-${legIndex}`) — without it, React reused the same component instance across different legs'
  pickers (same type, same tree position), so its internal scroll-state could carry over stale from
  whichever leg you'd last touched, landing the wrong leg's picked value onto the wrong leg.

**Transfer detection:** unchanged from before — collapsed by default after an exit is confirmed (most
rides are one leg), "+ Add Transfer" reveals the scoped grid, "Log Trip" is the default/primary action
either way now (visually — bigger, centered, own row).

**Commit/discard wiring:** "Log Trip" calls `commitTrip`, then navigates to `/trip` (root-level, not
a `trip/[tripId]` folder — no deep-linking need, so a search-param screen was simpler). X calls
`writeProductEvent('trip_draft_abandoned')` and discards — there's no `deleteTrip` call here, since
nothing was ever committed to correct; `deleteTrip` is only for a trip already logged. Both go through
`AuthContext`/`DatabaseContext` (see "App-wide providers" below) for `userId`/the shared SQLite
handle, rather than each screen opening its own.

## App-wide providers

Three React contexts sit above the whole app, in `app/_layout.tsx`:

- **`AuthContext`** — deliberately holds no fetch logic of its own. `_layout.tsx`'s root auth gate was
  already the one place session state gets checked (`getSession()` + `onAuthStateChange`); the context
  just exposes that same state to any screen needing `userId`, instead of a second competing
  subscription. `useUserId()` throws if called with no session — correct, since every screen that can
  reach it is already behind `Stack.Protected`'s auth guard; a thrown error there means a routing bug,
  not a state to render around.
- **`DatabaseContext`** — opens SQLite once (`db/schema.sql`, imported as a static asset the same way
  SVGs are, not `require()`'d — needed a `declare module '*.sql'` block in `svg.d.ts` alongside the
  existing `*.svg` one) and exposes the handle via `useDb()`, instead of each screen managing its own
  connection. Splash-hiding now waits on **both** session load and DB-open (`sessionLoaded && dbLoaded`)
  — a real gap caught: gating splash on session alone left a brief blank-screen
  window while SQLite was still opening underneath.
- **`SyncContext`** — see "Sync worker" below.

## Sync worker

`lib/sync.ts` flushes local `sync_status`-pending events to Supabase's `raw_events.events`.
Trip-domain events grouped by `trip_id` and sent as one multi-row `upsert` per trip (a single
Postgres statement is atomic — matches `data-layer.md`'s "one remote transaction per committed
trip"); product events sync one row at a time. Idempotency via `upsert(..., { onConflict:
'event_id', ignoreDuplicates: true })` → `ON CONFLICT DO NOTHING`, needing only the `INSERT` grant
`raw_events.events` already has. `received_at` deliberately omitted from the outgoing payload —
server-stamped by `raw_events.stamp_received_at()`, never client-set.

`contexts/SyncContext.tsx` triggers `runSync()` on mount, on `NetInfo` reporting connectivity
restored, and on app foreground (belt-and-suspenders, since OS-level background network reporting
isn't always reliable); exposes `triggerSync()` (called right after commit/discard in `log-trip.tsx`
for lower sync latency) plus live `isSyncing`/`lastSyncAt`/`lastSyncError` state, surfaced on
`/debug`. Coalesces overlapping trigger calls — a sync already in flight queues one more pass after,
rather than starting a second overlapping request. Requires `@react-native-community/netinfo` — a
real native module, **not available in Expo Go**; needed a fresh `eas build --profile development`
before it could be tested at all.

**Verified on-device**, six checks: backlog sync on mount, product + trip domain both landing
correctly, idempotency (forced re-sync of all rows produced zero duplicates), RLS/`user_id`
correctness, offline write → sync failure → automatic recovery on reconnect with no app interaction,
and a foreground re-trigger as fallback.

## Product-event instrumentation

`draft_leg_added`/`draft_leg_removed` are wired, scoped to **leg completeness**, not individual field
writes — deliberate, since the chip-strip editor's `commitLeg` fires on every field pick (line, then
entry, then exit), and naively firing an event per call would count normal fill-in progress as
corrections. Actual rule:
- `draft_leg_added` fires once, only when a leg's `exitStationId` is set (the moment it becomes a
  complete unit).
- `draft_leg_removed` fires once per *previously-complete* leg a cascade truncation discards — a leg
  still mid-pick (no exit yet) being cut is normal editing, not a correction, and fires nothing.

Verified on-device: a single line-chip correction after a leg was already complete produced exactly
2× `draft_leg_added` / 1× `draft_leg_removed` for that leg — not one event per intermediate write.

**Bug caught: draft abandonment asymmetry.** `discardDraft()` originally only fired
`trip_draft_abandoned` if `legs.length > 0` — leftover logic from before `trip_draft_started` fired
unconditionally on mount. Once `started` became unconditional, that guard created orphaned drafts:
opening the FAB and exiting before picking a line fired `started` with no matching `abandoned` ever
recorded. Fixed by removing the guard — every draft now unconditionally resolves to exactly one of
`committed` or `abandoned`. One real orphaned `trip_draft_started` row from before the fix was left
in place rather than hand-deleted (`events` is append-only by design, no delete path exists or
should exist) — acceptable single stray row; milestone 5's dbt layer is the right place to decide how
unresolved starts get handled in aggregate, not something to patch by hand now.

## Dev-only debug tooling (strip before release)

`app/debug.tsx` — dumps `events`/`trips`/`legs`/`sync_status` as raw JSON (and to console) via
`useDb()`, gated on `__DEV__`. Reached right now via a **temporary button on the Profile tab stub**
("Open Debug Dump") — that button is scaffolding for this testing pass, not a real feature, and needs
to come out before this ever ships. Also shows live sync status (`isSyncing`/`lastSyncAt`/
`lastSyncError`) and two testing-only buttons: **Trigger Sync** (manual pass) and **Force Re-sync
All** (flips every locally-`synced` row back to `pending` and re-triggers — the only practical way to
exercise idempotency without a second device).

**`app/debug-quest-components.tsx`** (milestone 8, also temporary) — same category, mounts
`StationQuestsList`/`ProfileQuestsSummary` against real data for verification before milestone 9's
real Station/Profile pages exist. Reached via a second temporary Profile button ("Open Debug Quest
Components"). Both temporary buttons and this whole file should come out once milestone 9 mounts the
two components for real — see `docs/quests-integration.md`'s cleanup checklist.

## Mobile app — file-by-file

**Router rules learned the hard way, worth stating plainly:**
- A route group (parenthesized folder) is only addressable by its bare name in a `Stack.Screen`/
  `Tabs.Screen` `name` prop if it has its own `_layout.tsx`. Without one, Router silently flattens it
  to the full inner path, and any reference to the bare group name fails with a blank screen.
- `Stack.Protected` needs a real `index.tsx` inside a group as its fallback anchor for when that
  group's guard is false — without one, a cold launch can render nothing at all. This is why the
  sign-in screen is named `index.tsx`, not `sign-in.tsx` — load-bearing, not cosmetic.
- Native modules (date picker, `react-native-svg`, `@react-native-picker/picker`,
  `@react-native-community/netinfo`) each require a fresh `eas build` — a plain `expo start -c`
  restart only picks up JS changes. NetInfo specifically also does not work in Expo Go at all — needs
  a dev-client build regardless of build freshness.
- `Stack.Protected`'s children must be literal `Stack.Screen` elements — Router statically parses
  that JSX, so a wrapped/HOC'd component can't sit directly under it. This is why `RehydrationGate`
  wraps inside `(tabs)/_layout.tsx` (a normal component past that point) rather than around
  `Stack.Screen name="(tabs)"` in the root layout.
- Deleting and reinstalling an app does **not** clear iOS Keychain — `SecureStore`-backed data (the
  Supabase session, via `lib/supabase.ts`) survives app deletion. Only local SQLite/AsyncStorage are
  actually cleared by a delete+reinstall. Relevant for testing rehydration: reinstalling alone won't
  force a fresh sign-in, only a fresh local database.
- **(Milestone 8) Pushing from a root-level screen into a route nested inside a tab's own stack
  creates a duplicate, parallel tabs navigator** — breaks both back-navigation and the tab bar,
  since the app ends up with two independent `(tabs)` instances on the root stack. Found when
  `trip.tsx` (root-level) linked into what was originally `(tabs)/profile/achievements/[questId].tsx`.
  Fix: any page reached from more than one context (not just from within one tab) needs to be
  root-level itself, matching `station/[stationId].tsx`/`line/[lineId].tsx`'s existing pattern — not
  a `router.push` vs `router.navigate` fix, an actual file-location fix. `achievements/[questId].tsx`
  moved to `app/achievements/[questId].tsx` accordingly; `achievements/index.tsx` (the list) stayed
  nested under `profile/` since it currently has only one entry point.
- **(Milestone 8) Import depth for a nested route needs to be verified, not assumed by pattern-matching
  a sibling file.** Got this wrong once moving `achievements/[questId].tsx` to root level — copied
  `trip.tsx`'s `../contexts/...` depth, but `app/achievements/[questId].tsx` sits one folder deeper
  (inside `achievements/`) than `app/trip.tsx` does, needing `../../contexts/...` instead. Caught by
  actually resolving the path, not by re-checking the reasoning.

**Top-level config:** `app.json` (`bundleIdentifier: com.transitapps.subwayquest`,
`usesAppleSignIn: true`), `metro.config.js` + `svg.d.ts` (SVG-as-component support), `.env`
(`EXPO_PUBLIC_SUPABASE_URL`/`PUBLISHABLE_KEY` — safe to ship client-side; RLS is what actually
protects data), `eas.json`. `metro.config.js`'s `assetExts` now also includes `'sql'` (alongside the
existing SVG-removal line) so `db/schema.sql` can be statically imported as an asset module, same
mechanism as SVGs. `svg.d.ts` now carries a second `declare module` block, for `'*.sql'` — a plain
`number` export (Metro's asset module ID), not string content; `DatabaseContext.tsx` turns that ID
into actual text via `Asset.fromModule()` + `File`.

**`app/`:**
- `_layout.tsx` — root auth gate. Checks session on launch, keeps splash up until resolved, renders
  `(tabs)` or `(auth)` via `Stack.Protected`. Wraps the whole `Stack` in
  `AuthContext.Provider`/`DatabaseProvider`/`SyncProvider` — splash-hiding waits on both
  `sessionLoaded` and `dbLoaded`, not session alone.
- `(auth)/_layout.tsx`, `(auth)/index.tsx` — sign-in screen. Apple button → `signInAsync` (hashed
  nonce to Apple, raw nonce to Supabase) → `signInWithIdToken`. Captures `fullName` into user
  metadata on first authorization only — Apple never sends it again after that.
- `(tabs)/_layout.tsx` — `<Tabs>` navigator + `<LogTripFAB>` as a sibling, visible from all tabs. Now
  wrapped in `<RehydrationGate>` — runs the rehydration check/replay once per session before any tab
  content renders, so the FAB can't be tapped (and a trip logged) before local `trips`/`legs` has
  finished restoring, if it needed to.
- `(tabs)/map.tsx`, `(tabs)/search.tsx` — stubs.
- `(tabs)/profile/_layout.tsx`, `index.tsx` — stub + working Sign Out. **Currently also has two
  temporary buttons** — "Open Debug Dump" (→ `/debug`) and "Open Debug Quest Components" (→
  `/debug-quest-components`, milestone 8) — both scaffolding, need to come out before release (the
  quest-components one specifically comes out once milestone 9 mounts the real components, per
  `docs/quests-integration.md`).
- `log-trip.tsx` — the trip-logging modal (see above). Fully wired: `finishTrip` calls `commitTrip`
  and navigates to `/trip`; discard calls `writeProductEvent('trip_draft_abandoned')`.
- `trip.tsx` — Trip Detail/Summary screen. Root-level, not a `trip/[tripId]` folder — reached only
  via in-app navigation (`router.replace({ pathname: '/trip', params: { tripId } })`), no
  deep-linking need, so a search-param screen (`useLocalSearchParams`) was simpler than a dynamic
  route segment. Reads `trips`/`legs` live via `useDb()`. **(Milestone 8)** also calls
  `computeTripQuestProgress()` and shows every quest the trip moved the needle on — not just full
  completions, partial progress too (e.g. a min-count quest going 1/6 → 2/6) — since the point is a
  dopamine hit and quest awareness on every trip, not just the rare one that finishes something.
- `achievements/[questId].tsx` — **(Milestone 8)** root-level (not nested under `profile/` — see
  Router rules above for why), the canonical achievement detail page. Full itemized breakdown —
  which specific stations/groups/pairs/routes are done vs. remaining, with which trip(s) and dates.
- `(tabs)/profile/achievements/index.tsx` — **(Milestone 8)** the achievements list, completed/ongoing
  sections. Stayed nested under `profile/` since it currently has only one entry point.
- `debug.tsx` — dev-only (`__DEV__`-gated), dumps `events`/`trips`/`legs`/`sync_status` as JSON, both
  on-screen and to console. Not linked from any tab; reached via the temporary Profile button. Includes
  a back button (`router.back()`), live sync status, and **Trigger Sync**/**Force Re-sync All**
  buttons.
- `debug-quest-components.tsx` — **(Milestone 8)**, see "Dev-only debug tooling" above.

**`components/`:** `LogTripFAB.tsx`; `trip-logging/types.ts` (`DraftLeg`, `ActiveField`),
`TripChipStrip.tsx`, `StationPickerStep.tsx` (wraps `@react-native-picker/picker` with an explicit
"Next" — a wheel's `onValueChange` fires on every resting value while scrolling, not just the final
pick, so auto-advancing on it would yank the user forward mid-scroll); `RehydrationGate.tsx` — wraps
the authenticated tab area, runs `needsRehydration`/`rehydrateFromRemote` once per mount, brief
loading state while it runs, fails open (renders children even if rehydration throws, rather than
blocking the app on a rehydration bug).

**`components/quests/`** (milestone 8): `StationQuestsList.tsx` — "quests this station contributes
to," self-contained (fetches its own data given just a `complexId` prop), renders nothing if the
station isn't part of any quest. `ProfileQuestsSummary.tsx` — completed/ongoing counts + link into
the full achievements list, self-contained, no props. Both fully built and tested, **not yet
mounted** — no Station or Profile dashboard page exists yet to host them (that's milestone 9). Exact
insertion points in `docs/quests-integration.md`.

**`contexts/`:** `AuthContext.tsx` — plain context, no fetch logic of its own; `_layout.tsx` remains
the one place session state is actually checked, this just exposes it (`useAuth()`, `useUserId()` —
the latter throws outside an authed session, which should never happen given `Stack.Protected`).
`DatabaseContext.tsx` — opens SQLite once via `SQLite.openDatabaseAsync`, runs `schema.sql` on first
launch (keyed off `PRAGMA user_version`), exposes the handle via `useDb()` instead of each screen
managing its own connection. `SyncContext.tsx` — see "Sync worker" above.

**`lib/`:** `supabase.ts` (chunked SecureStore adapter — a full session routinely exceeds
SecureStore's ~2048-byte per-item ceiling; `AppState`-driven auto-refresh); `subwayData.ts` (all
logic over the bundled GTFS data — station lookups, per-route station lists, valid-exit/default-exit
logic, transfer routes + correct transfer-platform lookup; confirmed directly against the data that
both directions of a route share the same stop set per branch, just reversed; `getComplexId()` is
also the shared stop_id → complex_id lookup milestone 8's quest system reuses rather than
re-implementing — see `db/quests.ts` below); `device.ts` — client-generated `device_id`, generated
once per install and persisted via `SecureStore`, cached in-memory after first read; `sync.ts` — see
"Sync worker" above.

**`constants/`:** `lineColors.ts` (official MTA colors + display ordering — the SIR icon fallback,
and the intended future source for Map tab polylines); `lineIcons.tsx` (custom SVG icons, one static
import per route — Metro requires statically analyzable import paths, no dynamic `require`).

**`data/`:** `stations.json`, `route_stops.json`, `transfers.json`, `quests.json` (milestone 8)
bundled and actively used; `route_shapes.json` bundled but unused so far (reserved for the Map tab).
All five genuinely bundled via plain `import` — no runtime fetch, matching the offline-first design.

**`assets/subway-icons/`:** user-authored SVGs, one per route ID.

**`db/`:** `schema.sql`, `schema_tests.py` — untouched since original build. `projection.ts` —
`commitTrip`/`deleteTrip` logic core unchanged; `writeProjectionRows()` factored out of `commitTrip`
and exported, shared with `rehydrate.ts`'s replay path — one implementation of "what a trip's
projection rows look like," not two. `leg_boarded`'s payload gained `sequence` (`event_version: 2`)
— needed to reconstruct leg order during rehydration, not derivable from timestamps alone.
`rehydrate_logic.ts` — pure `planRehydration()` (trip grouping, `trip_deleted` exclusion,
leg-sequence ordering), deliberately zero React Native/Expo/Supabase imports so it's testable via
plain `tsx` without a device (importing `rehydrate.ts` directly pulls in `expo-sqlite`, which
transitively pulls in Flow-syntax RN source a plain Node run can't parse — this split is what makes
the logic testable at all; renamed from `rehydrate-plan.ts` during milestone 8 — "plan" wrongly
implied staging/proposal code rather than the actual running logic, same rename applied to quests
below). `rehydrate.ts` — thin I/O wrapper (`needsRehydration`, `rehydrateFromRemote`) that imports
the pure logic from `rehydrate_logic.ts`. `rehydrate_tests.ts` — the required test (10 checks, all
passing): a deleted trip never materializes, a live trip restores with correct leg order even from
out-of-order remote rows, a mixed batch only restores the live trip, an incomplete event set is
skipped rather than crashing.

**`db/quests_logic.ts`** (milestone 8) — pure quest-evaluation logic, same zero-RN-imports split as
`rehydrate_logic.ts` and for the identical reason (importing `subwayData.ts` directly would pull in
`react-native-svg` via `lineIcons.tsx`). Three evaluators (one per mechanism: lifetime set-membership,
per-trip property check, lifetime counting), a single-quest dispatch (`evaluateQuestProgress`), the
richer trip-progress function (`computeTripQuestProgressPure` — reports every quest a trip moved the
needle on, not just full completions), and the itemized breakdown function (`getQuestBreakdown` —
exactly which stations/groups/pairs/routes are done vs. remaining). 32 unit tests in
`quests_logic_tests.ts`, all passing, run via `npx tsx db/quests_logic_tests.ts`. **`db/quests.ts`**
— the I/O wrapper: queries `trips`/`legs`, builds the `stop_id → complex_id` translation (a real
correctness requirement — quest criteria reference `complex_id`, legs store GTFS `stop_id`), enriches
pure results with title/description/station names for display, and exposes `getAllQuestProgress`,
`getQuestDetail`, `computeTripQuestProgress`, `getQuestsForStation`.

**`scratch/old-map-screen.tsx`:** pre-session map screen, moved out of the router tree (anything
under `app/`, at any depth, is live-scanned by Router). Kept for the future Map tab, not deleted.

**Outside `mobile/`:** `supabase/schema.sql` — run manually via the SQL Editor, not part of the app
build. **`el/`** (new): `sync_to_bigquery.py`, `requirements.txt` — the Python EL job, see
`data-layer.md`'s "Python EL job" section for the full design. **`.github/workflows/pipeline.yml`** — runs the full
pipeline: EL job, then `dbt seed`/`dbt run`/`dbt test` back to back, cron every 6h + `workflow_dispatch`.
`dbt test` failing fails the whole run.

## Mobile UI — remaining

- [ ] **Shuttle grouping (S) — three real, separately countable routes under one shared icon.**
      Currently a real bug, not just a gap: `S` in `LINE_ICONS`/`LINE_COLORS` matches no real GTFS
      route_id (only `FS`/`GS`/`H` — Franklin Ave, 42nd St, and Rockaway Park shuttles — actually
      exist), so no shuttle is currently selectable anywhere in the trip-logging flow.
      **Design, decided:**
      - Tapping the `S` icon shows a combined stop list across all three shuttles for the initial
        entry pick; once a real entry station is chosen, resolve which of the three routes it
        belongs to, then exit/transfer logic operates on that real route_id — same pattern
        `branchesForRoute()`/`getValidExitStations()` already use for branch filtering within one
        route, applied here across three routes sharing one icon.
      - Store the real `route_id` (`FS`/`GS`/`H`) in every event, never a normalized `'S'` —
        matches this project's standing "never destroy non-derivable information" principle (same
        reasoning behind `leg_boarded` gaining `sequence`). `S` stays a pure display grouping,
        applied downstream, never written to data.
      - **Deliberate:** counting the three shuttles as three separately-completable lines (not one
        merged "S" credit) is the right incentive for encouraging exploration of all three — someone
        riding just the easiest one shouldn't get full credit for "the S line." A "S Tier" quest for
        this already exists in `network/quests_source.json` (`s_tier`), explicitly gated with a
        `blocked: true` flag — the underlying route data is already real, it's specifically this
        UI gap keeping it from being completable. Flip `blocked` once this ships.
      - **Resolved:** the dashboard's "Top lines" chart shows all three shuttles as individual bars —
        `mart_line_stats` is one row per real `route_id`, no combined "S ridership" rollup added. Also
        now the same reasoning applies here as the min-N decision below: a shuttle row at low N is a
        real disclosure risk, one grain coarser than a station — see milestone 6.
      - **Possibly related, not scoped yet:** the canonical Line page (`ui-spec.md`) may need
        its own thinking for a route with 3 fully independent branches/routes under one icon —
        worth a look once this work starts, not a separate open item until then.
- [ ] Station tap → station info drill-down — **also needs to mount `StationQuestsList`** as part of
      this work, per `docs/quests-integration.md`
- [ ] **Profile page mini-dashboard** — personal-scope stats, `docs/dashboard-spec.md`'s "In-app
      profile page" section — **also needs to mount `ProfileQuestsSummary`** as part of this work,
      per `docs/quests-integration.md`, and needs to remove the two temporary debug buttons currently
      standing in for it
- [ ] Branch-aware station picker (trunk + grouped branch tails) — Line page
- [x] ~~Achievements/quests UI~~ — done, milestone 8 (see build sequence table above)
- [ ] Compact date picker requires tapping outside to confirm — no Done button, no auto-close on
      selection. Confirmed real iOS/library limitation (two open, unresolved upstream issues), not
      fixable with a different prop. Revisit only if still a real friction point once used for real.
- [ ] Delete-trip UI affordance — `deleteTrip()` in `projection.ts` exists and is unit-tested, but no
      screen currently exposes it (not on Trip Detail, not in Profile's trip history). Backend-ready,
      not user-reachable yet.

**Non-blocking polish, don't let these hold up v1:** default marker restyling, parallel-offset
rendering for overlapping track, `route_shapes.json` polyline precision.

## Backend

- [x] `raw_events` schema (with `received_at`, server-stamped) — live, RLS verified. `operational`
      schema (trips/legs mirror) removed — RLS existed but nothing ever populated it;
      never actually a complete deliverable. See `data-layer.md`'s "Removed: operational schema" and
      "Rehydration-on-sign-in" for the replacement.
- [x] Outbox sync worker — flushes local `events` → `raw_events`, idempotent insert, atomic per-trip
      flush, verified on-device (see "Sync worker" above)
- [x] Supabase Auth — Sign in with Apple, native flow
- [x] RLS policies — written, live, verified with two impersonated test users
- [x] `service_role` granted read-only access to `raw_events.events` for the EL job — see
      `data-layer.md`'s "Supabase RLS design"

## Rehydration-on-sign-in (replaces `operational` for data continuity)

- [x] `mobile/db/rehydrate_logic.ts` — pure `planRehydration()` (trip grouping, `trip_deleted`
      exclusion, leg-sequence ordering), zero RN/Expo/Supabase imports by design — testable via
      plain `tsx`, no device needed. `mobile/db/rehydrate.ts` is the thin I/O wrapper
      (`needsRehydration`/`rehydrateFromRemote`) that imports from it.
- [x] Required test written and passing: `mobile/db/rehydrate_tests.ts` — a deleted trip never
      materializes; a live trip restores with correct leg order even from out-of-order remote rows; a
      mixed batch only restores the live trip; an incomplete event set is skipped, not crashed
- [x] `components/RehydrationGate.tsx` — wraps the authenticated tab area, runs the check/replay once
      per session, brief loading state while it runs (decided: no live Supabase-side projection needed
      to avoid this — out of proportion to this project's real scale). **Verified on-device:** deleted
      and reinstalled the app (Keychain session survives deletion — this exercised the "reinstall"
      trigger case directly), signed back in, confirmed all 3 previously-synced trips restored
      correctly to `trips`/`legs`, including correct leg order for a 2-leg trip from out-of-order
      remote rows. Local `events`/`sync_status` correctly stay empty post-rehydration — `raw_events`
      in Supabase remains the durable copy; rebuilding the local append-only log too would be
      redundant, since nothing screen-facing ever reads `events` directly (see `data-layer.md`'s
      "Data-flow architecture" — every in-app screen reads `trips`/`legs` only).
- [x] Decided: `leg_boarded` payload gains `sequence` (`event_version: 2`) — required for correct leg
      ordering during replay, not derivable from timestamps alone (see `data-layer.md`)

**Milestone 4/rehydration cleanup, fully closed:** `operational` schema removed from both the live
database and all docs; quest-definitions source decided (`quests.json` canonical, dbt seed generated
from it, never hand-duplicated); `dashboard-spec.md`'s profile-page data path corrected to reflect
local-only reads. See `data-layer.md`'s "Data-flow architecture" section for the general principle
this all falls out of.

## Python EL job / BigQuery / dbt

- [x] Batch load `raw_events` → BigQuery raw dataset, GitHub Actions scheduled (`el/sync_to_bigquery.py`,
`.github/workflows/pipeline.yml` — cron every 6h + manual `workflow_dispatch`). Same workflow now also
runs dbt (seed/run/test) immediately after — see data-layer.md.
- [x] GCP project + `subwayquest_raw` dataset created, service account + `GCP_SA_KEY` secret set
- [x] dbt staging → intermediate → mart, with tests
- [x] Partitioning (`received_at`) + clustering (`user_id`) — both applied on table creation,
      confirmed via BigQuery's `INFORMATION_SCHEMA.TABLES` DDL output
- [x] Pipeline's dbt step (seed/run/test, appended to `pipeline.yml`) — verified end-to-end via a
      manual `workflow_dispatch` run in GitHub Actions; EL job + full dbt chain all ran clean in CI.
- [x] **Min-N (=5) suppression — done, now 4 marts.** Row access policies live on `mart_station_stats`,
      `mart_station_pairs`, `mart_line_stats`, and (milestone 8) `mart_quest_completion` in
      `subwayquest_dbt_mart`, `FILTER USING (segment_user_count >= 5)`, granted to a dedicated
      `powerbi-reader` service account, reapplied automatically via `dbt/macros/reapply_min_n_suppression.sql`'s
      `on-run-end` hook on every `dbt run`/`dbt seed`. Scope narrowed from an initial broader draft
      (originally N=10, every bucketed stat) down to only the metrics that disclose actual places at
      small-group grain — reasoning in `docs/dashboard-spec.md`; GCP setup, the mart split into its
      own dataset (`subwayquest_dbt_mart`, via a `+schema: mart` dbt config), and the full
      verification runbook (impersonated `bq` queries against seeded boundary data) in
      `docs/bigquery-min-n.md`. `mart_quest_completion_histogram` and 3 new `mart_global_summary`
      columns (milestone 8) are exempt — magnitudes/headcounts, same category as the existing
      exempt histograms and total-signups metrics, no location content.

**Dev/test data exclusion (decided, not yet implemented):** Dev/testing happens signed in with the
same Apple ID that'll be used for real post-launch — so `user_id` can't separate test rows from real
ones. **Decided:** exclude by launch-date cutoff, not row identity — `stg_events.sql` (milestone 5)
filters `occurred_at >= <launch date>`, hardcoded once the actual launch date is known. Don't pick
the date now; picking too early risks excluding a real trip, too late risks leaking test data in. No
new column, no `is_test` flag, no app-side plumbing — same reasoning as the `user_id NOT IN (...)`
dev-account filter this replaced (`user_id` was ruled out once dev/test sessions started using the
same real Apple ID that'll be used post-launch — see conversation history if the "why not user_id"
reasoning is ever needed in full): computed once, upstream, in the staging layer that already needs
a filter like this.

## Dashboard

- [x] Four Power BI pages: Growth & Engagement, Product/Instrumentation, Exploration & Usage,
      Achievements (milestone 8 — full design/reasoning in `milestone-8-achievements.md`'s
      "Achievements dashboard page" section)
- [x] Publish to Web page-navigation — confirmed via current Power BI documentation as a genuinely
      supported feature (multi-page reports with a default-page setting); no free-tier limitation
      found.
- [ ] Sync-health chart — p50/p95 latency trend
- [ ] Achievements page visual polish — chart foundations built and working (KPI row, filtered bar
      chart, exempt histogram), styling deliberately deferred, Van prioritizing milestone 9 mobile
      work first. A combined mock-data seeding script exists for that later session
      (`seed_all_dashboard_mock_data.sql`) — note it gets wiped by the next automatic 6h pipeline
      cron run, doesn't persist across sessions without re-running it or temporarily disabling the
      scheduled GitHub Actions workflow.
- **Note on authoring environment:** Power BI Desktop has no native Mac version (confirmed current,
  not a legacy gap). Resolved for this project — author on the Windows Dell already owned for
  Windows-only analysis tools; develop/EL job work continues on Mac as before. No VM/Parallels setup
  needed.
- **Note on data source:** Power BI's BigQuery connector authenticates with the `powerbi-reader`
  service account key from milestone 6 (`docs/bigquery-min-n.md`), pointed at `subwayquest_dbt_mart`
  — not `subwayquest_dbt`, which also holds staging/intermediate models and should never be exposed
  to Power BI. **Adding a brand-new table to an already-connected dataset needs Get Data, not just
  Refresh** — refresh only updates rows in tables already in the model, it doesn't discover new ones
  (hit this directly adding `mart_quest_completion`/`mart_quest_completion_histogram`).

## Achievements / quests

**Done — milestone 8.** Full detail, full bug-fix history, and the complete design reasoning live in
`docs/milestone-8-achievements.md` (the primary reference for this milestone, not duplicated here)
and `docs/dbt-coverage.md` (schema reference for every new seed/model). Summary:

- [x] Content: 18 hand-authored quests (`network/quests_source.json`) across the three mechanisms
      (lifetime set-membership, per-trip property check, lifetime counting), plus auto-generated
      line-completion/branching-out families — 52 quests total
- [x] Resolver (`network/scripts/build_quests.py`) + validator (`network/scripts/validate_quests.py`)
      — both real, tested tools; caught and fixed a dozen-plus genuine bugs during development, full
      list in the milestone doc (the biggest: line-completion criteria were originally
      route-agnostic, giving false credit across shared multi-line transfer complexes)
- [x] Mobile: `mobile/db/quests_logic.ts` (pure evaluators, 32 tests) + `quests.ts` (I/O wrapper) —
      see "db/" file-by-file section above
- [x] Mobile UI: `trip.tsx`'s quest-progress display, achievements list/detail pages — all live and
      on-device verified
- [x] `StationQuestsList`/`ProfileQuestsSummary` components — built, tested, **not yet mounted**;
      exact insertion points for milestone 9 in `docs/quests-integration.md`
- [x] Warehouse: `quest_definitions`/`route_definitions`/`route_stations` seeds (plus `complex_id`
      added to the existing `station_coordinates` seed), `int_user_visited_complexes` + one
      `int_quest_completion_*` model per mechanism, `mart_quest_completion` (suppressed, N=5) +
      `mart_quest_completion_histogram` (exempt) + 3 new `mart_global_summary` columns (exempt)
- [x] Power BI achievements page — chart foundations built and working; visual polish deliberately
      deferred (see "Dashboard" section above)
- [x] Docs handoff: `docs/quests-integration.md` (milestone 9 insertion points),
      `data-layer.md`'s cut-list (Conquistador and "first user to visit a station," both considered
      and cut, reasoning documented)
- [ ] **Genuinely still open, not just unchecked bureaucratically:** on-device verification of
      per_trip and counting mechanism quest completions specifically — only a lifetime_set quest
      (Roosevelt Island) was explicitly triggered and confirmed on-device this milestone

## Release

- [x] Apple Developer Program membership renewed
- [ ] App Store Connect app record, build signing
- [ ] Privacy policy / App Privacy disclosure
- [ ] Recruit real testers

## Portfolio

- [ ] GitHub README
- [ ] Portfolio write-up / case study

## Considered and explicitly rejected — don't re-litigate

- **BQML forecasting** — growth here is manual-outreach-driven, nothing organic to extrapolate.
- **Geospatial convex-hull "explored territory"** — new plumbing, measures spread not ground covered,
  and the compelling version is per-user geometry, which conflicts with the public dashboard never
  exposing individually identifiable data.
- **Average ride length (stops)** — needs `route_stops.json` in the warehouse for the first time, low
  payoff relative to the product/instrumentation metrics.
- **Denormalizing `user_id` onto `legs`** — see `docs/data-layer.md`'s RLS section.
- **Authorized views for min-N suppression** — see `docs/dashboard-spec.md`.
- **A blanket "suppress every bucketed stat" min-N policy at N=10** — considered and narrowed during
  milestone 6; re-identification risk in mobility data comes from space+time together, this app never
  stores time-of-day, so the policy only applies where a metric names actual places at small-group
  grain. See `docs/dashboard-spec.md` and `docs/bigquery-min-n.md`.
- **A live Supabase-side projection to avoid a rehydration loading spinner** — considered and
  rejected when building rehydration-on-sign-in; disproportionate to this project's real scale (brief
  local replay is well under a second), same category of over-infrastructure mistake as the original
  S3/RDS design and `direction_id` storage. See `data-layer.md`'s "Rehydration-on-sign-in".
- **A dedicated `is_test` flag/column for dev-data exclusion** — see "Dev/test data exclusion" above;
  launch-date cutoff in dbt staging does the same job with no new schema surface.
- **(Milestone 8) Ordered/sequence-based quests** ("Conquistador," ride through every tunnel/bridge
  crossing) — a genuinely different, fourth criteria mechanism; would need building twice (dbt SQL
  and TypeScript) and kept in sync forever, and nothing else on the quest list needs it. Full
  reasoning in `data-layer.md`'s cut-list.
- **(Milestone 8) "First user to visit a station"** — can't be an in-app badge at all,
  architecturally, not just as a scoping choice: the quest engine deliberately reads local SQLite
  only, no other user's data ever reaches a device. A dashboard-only version was also considered and
  dropped as not compelling enough alone. Full reasoning in `data-layer.md`'s cut-list.

## Out of scope for v1 — deferred on purpose

- Multi-device support for one account
- Shared-table indexing/clustering at real multi-tenant scale
- CI on every change (sequenced after dbt exists)

## Known operational constraints

- **EAS free tier: 15 iOS builds/month**, resets monthly, no rollover. Batch native-dependency
  additions where foreseeable.
- **LAN dev-server connection fails on networks with client/AP isolation** (common on corporate
  WiFi) — tunnel mode (`--tunnel`, needs `@expo/ngrok` installed globally) or a personal hotspot are
  the workarounds.
- **A stale/corrupted `~/.expo/state.json` (global, shared across all Expo projects on a machine)**
can cause a generic `UnexpectedServerData: Unexpected server error: No returned query result` on
`npx expo start`, unrelated to this specific project. Fix: `rm ~/.expo/state.json`. Worth checking
first if this resurfaces — the error message gives no hint of the real cause.
- **`app.json` naming:** display name "Subway Quest" (two words); `slug`/`scheme` stay `subwayquest`
  (internal identifiers, not user-facing).
- **Reinstalling the app does not force a fresh sign-in** — iOS Keychain (`SecureStore`) survives
  app deletion, unlike local SQLite/AsyncStorage. Relevant when testing anything that assumes a
  "fresh install" state includes a cleared session — it doesn't, only local data is actually cleared.
- **Dropping a Postgres schema in Supabase needs a two-step cleanup**, not just the `DROP SCHEMA`
  itself — see `data-layer.md`'s EL job section for the full PostgREST schema-cache gotcha
  encountered and resolved.
- **A dbt model's `+schema` config suffixes the target dataset, it doesn't relocate existing tables**
  — switching `marts` to `+schema: mart` mid-project (milestone 6) left the old mart tables orphaned
  in the original `subwayquest_dbt` dataset; `dbt run` created the new ones in `subwayquest_dbt_mart`
  without cleaning up the old location. Had to `DROP TABLE` the nine stale tables by hand. **Recurred
  during milestone 8** — the same orphaned tables were still sitting in `subwayquest_dbt`, apparently
  never fully cleaned up the first time; cleaned up again. Worth an actual periodic check of
  `subwayquest_dbt` for orphans, not just a one-time fix, if this dataset/schema config ever changes
  again.
- **BigQuery row access policies restrict every principal by default, including the resource owner**
  — there's no automatic exemption for the project owner once any policy exists on a table (also
  disables table preview entirely: "Table preview is not supported for tables using row-level
  security"). Testing as yourself needs a second, temporary, permissive policy unioned onto the same
  table (see `docs/bigquery-min-n.md`'s `owner_test_access` pattern) — don't assume owner access is
  implicit when debugging a suppressed mart.
- **(Milestone 8) `dbt_project.yml`'s top-level `on-run-end` hook fires on `dbt seed`, not just
  `dbt run`.** The very first `dbt seed` after adding a brand-new suppressed table
  (`mart_quest_completion`) to `reapply_min_n_suppression`'s table list failed — the hook tried to
  apply a row access policy to a table `dbt run` hadn't created yet. One-time bootstrap issue for a
  new suppressed table specifically; running `dbt run` once afterward resolves it permanently. Worth
  remembering whenever a future milestone introduces another new suppressed mart.
- **Station visit map (Exploration page) uses the classic Power BI Map visual, not Azure Maps** —
  deliberate: Azure Maps (the newer replacement Microsoft is actively steering users toward) does
  not support Publish to Web as of this writing, confirmed via multiple current reports of it
  breaking published dashboards. The classic Map visual does support Publish to Web. If Microsoft
  ever fully retires the classic visual, **fallback plan already validated:** a Scatter Chart with
  `lon` on X and `lat` on Y, sized by `visit_count` — confirmed during this same build session as a
  zero-dependency, guaranteed-compatible alternative that still reads as a recognizable NYC station
  layout. Don't accept any in-app "upgrade to Azure Maps" prompt on this visual.
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
| 5 | dbt mart | dbt run/dbt test green, hand-check one number | ✅ Done — full staging → intermediate → mart chain built and tested (stg_events; int_trips/int_committed_trips/int_legs/int_transfers/int_draft_sessions; nine mart models). Hand-checked real numbers in mart_global_summary and mart_growth_daily against known usage — sane. One open thread carried forward, not blocking: confirming subwayData.ts's stored route_id always matches the 23-value LINE_ICONS set (see dbt-coverage.md). |
| 6 | Min-N enforced | Query as Power BI's service account, confirm suppression | ⬜ Not started (mechanism decided — see `docs/dashboard-spec.md`) |
| 7 | Power BI live | Three pages, Publish to Web page-nav works | ⬜ Not started (Publish to Web's multi-page navigation confirmed as a genuinely supported feature via current documentation, resolving the doc's earlier "unverified" flag; the actual pages/report aren't built yet) |
| 8 | Achievements | Content designed, join logic working | ⬜ Not started (source-of-truth mechanism for quest content is decided — see `data-layer.md`'s "Quest-definitions, single source of truth" — content itself not written) |
| 9 | Remaining mobile UI | Station drill-down, branch-aware picker, profile dashboard | ⬜ Not started |
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
- `(tabs)/profile/_layout.tsx`, `index.tsx` — stub + working Sign Out. **Currently also has a
  temporary "Open Debug Dump" button** (→ `/debug`) added for testing — scaffolding,
  needs to come out before release.
- `log-trip.tsx` — the trip-logging modal (see above). Fully wired: `finishTrip` calls `commitTrip`
  and navigates to `/trip`; discard calls `writeProductEvent('trip_draft_abandoned')`.
- `trip.tsx` — Trip Detail/Summary screen. Root-level, not a `trip/[tripId]` folder — reached only
  via in-app navigation (`router.replace({ pathname: '/trip', params: { tripId } })`), no
  deep-linking need, so a search-param screen (`useLocalSearchParams`) was simpler than a dynamic
  route segment. Reads `trips`/`legs` live via `useDb()`.
- `debug.tsx` — dev-only (`__DEV__`-gated), dumps `events`/`trips`/`legs`/`sync_status` as JSON, both
  on-screen and to console. Not linked from any tab; reached via the temporary Profile button. Includes
  a back button (`router.back()`), live sync status, and **Trigger Sync**/**Force Re-sync All**
  buttons.

**`components/`:** `LogTripFAB.tsx`; `trip-logging/types.ts` (`DraftLeg`, `ActiveField`),
`TripChipStrip.tsx`, `StationPickerStep.tsx` (wraps `@react-native-picker/picker` with an explicit
"Next" — a wheel's `onValueChange` fires on every resting value while scrolling, not just the final
pick, so auto-advancing on it would yank the user forward mid-scroll); `RehydrationGate.tsx` — wraps
the authenticated tab area, runs `needsRehydration`/`rehydrateFromRemote` once per mount, brief
loading state while it runs, fails open (renders children even if rehydration throws, rather than
blocking the app on a rehydration bug).

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
both directions of a route share the same stop set per branch, just reversed); `device.ts` —
client-generated `device_id`, generated once per install and persisted via `SecureStore`, cached
in-memory after first read; `sync.ts` — see "Sync worker" above.

**`constants/`:** `lineColors.ts` (official MTA colors + display ordering — the SIR icon fallback,
and the intended future source for Map tab polylines); `lineIcons.tsx` (custom SVG icons, one static
import per route — Metro requires statically analyzable import paths, no dynamic `require`).

**`data/`:** `stations.json`, `route_stops.json`, `transfers.json` bundled and actively used;
`route_shapes.json` bundled but unused so far (reserved for the Map tab). All four genuinely bundled
via plain `import` — no runtime fetch, matching the offline-first design.

**`assets/subway-icons/`:** user-authored SVGs, one per route ID.

**`db/`:** `schema.sql`, `schema_tests.py` — untouched since original build. `projection.ts` —
`commitTrip`/`deleteTrip` logic core unchanged; `writeProjectionRows()` factored out of `commitTrip`
and exported, shared with `rehydrate.ts`'s replay path — one implementation of "what a trip's
projection rows look like," not two. `leg_boarded`'s payload gained `sequence` (`event_version: 2`)
— needed to reconstruct leg order during rehydration, not derivable from timestamps alone.
`rehydrate-plan.ts` — pure `planRehydration()` (trip grouping, `trip_deleted` exclusion,
leg-sequence ordering), deliberately zero React Native/Expo/Supabase imports so it's testable via
plain `tsx` without a device (importing `rehydrate.ts` directly pulls in `expo-sqlite`, which
transitively pulls in Flow-syntax RN source a plain Node run can't parse — this split is what makes
the logic testable at all). `rehydrate.ts` — thin I/O wrapper (`needsRehydration`,
`rehydrateFromRemote`) that imports the pure logic from `rehydrate-plan.ts`. `rehydrate_tests.ts` —
the required test (10 checks, all passing): a deleted trip never materializes, a live trip restores
with correct leg order even from out-of-order remote rows, a mixed batch only restores the live trip,
an incomplete event set is skipped rather than crashing.

**`scratch/old-map-screen.tsx`:** pre-session map screen, moved out of the router tree (anything
under `app/`, at any depth, is live-scanned by Router). Kept for the future Map tab, not deleted.

**Outside `mobile/`:** `supabase/schema.sql` — run manually via the SQL Editor, not part of the app
build. **`el/`** (new): `sync_to_bigquery.py`, `requirements.txt` — the Python EL job, see
`data-layer.md`'s "Python EL job" section for the full design. **`.github/workflows/el-job.yml`**
(new) — the GitHub Actions workflow running that job, cron + `workflow_dispatch`.

## Mobile UI — remaining

- [ ] Station tap → station info drill-down
- [ ] **Profile page mini-dashboard** — personal-scope stats, `docs/dashboard-spec.md`'s "In-app
      profile page" section
- [ ] Branch-aware station picker (trunk + grouped branch tails) — Line page
- [ ] Achievements/quests UI
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

- [x] `mobile/db/rehydrate-plan.ts` — pure `planRehydration()` (trip grouping, `trip_deleted`
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
      `.github/workflows/el-job.yml` — cron every 6h + manual `workflow_dispatch`). Verified: triggered
      manually, confirmed real rows landed with correct schema/types, `payload` genuinely parsing as
      JSON (caught and fixed a double-encoding bug — see build sequence table). See `data-layer.md`'s
      "Python EL job — Supabase to BigQuery" for the full design: watermark-based incremental sync,
      dedup deliberately deferred to dbt staging, required secrets.
- [x] GCP project + `subwayquest_raw` dataset created, service account + `GCP_SA_KEY` secret set
- [x] dbt staging → intermediate → mart, with tests
- [x] Partitioning (`received_at`) + clustering (`user_id`) — both applied on table creation,
      confirmed via BigQuery's `INFORMATION_SCHEMA.TABLES` DDL output
- [ ] Min-N (=10) suppression — row access policies on a dbt-computed `segment_user_count` column,
      dbt computes/exposes only, BigQuery enforces the cutoff (see `docs/dashboard-spec.md`)

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

- [ ] Three Power BI pages: Exploration, Growth & Behavior, Product/Instrumentation
- [x] Publish to Web page-navigation — confirmed via current Power BI documentation as a genuinely
      supported feature (multi-page reports with a default-page setting); no free-tier limitation
      found. Building the actual report/pages is still milestone 7's remaining work.
- [ ] Sync-health chart — p50/p95 latency trend
- **Note on authoring environment:** Power BI Desktop has no native Mac version (confirmed current,
  not a legacy gap). Resolved for this project — author on the Windows Dell already owned for
  Windows-only analysis tools; develop/EL job work continues on Mac as before. No VM/Parallels setup
  needed.

## Achievements / quests

- [ ] Content design — the actual quest list
- [ ] Static quest-definitions table + join logic (confirmed: no new event types needed). **Source
      mechanism decided:** `network/processed/quests.json` is canonical (bundled, same pattern as
      `stations.json`/`route_stops.json`/`transfers.json`); the dbt seed
      (`dbt/seeds/quest_definitions.csv`) is a generated build artifact from that same file via a
      new `network/scripts/build_quest_seed.py`, never hand-authored separately — see
      `data-layer.md`'s "Quest-definitions, single source of truth" for the full reasoning.

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
- **A live Supabase-side projection to avoid a rehydration loading spinner** — considered and
  rejected when building rehydration-on-sign-in; disproportionate to this project's real scale (brief
  local replay is well under a second), same category of over-infrastructure mistake as the original
  S3/RDS design and `direction_id` storage. See `data-layer.md`'s "Rehydration-on-sign-in".
- **A dedicated `is_test` flag/column for dev-data exclusion** — see "Dev/test data exclusion" above;
  launch-date cutoff in dbt staging does the same job with no new schema surface.

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
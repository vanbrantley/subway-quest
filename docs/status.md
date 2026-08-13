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
| 7 | Power BI live | Three pages, Publish to Web page-nav works | ✅ Done — all 4 pages built (Growth & Engagement, Product/Instrumentation, Exploration & Usage, Achievements), connected to `subwayquest_dbt_mart` via `powerbi-reader`, scheduled refresh live (4x/day, offset 30 min after each pipeline cron run), published and confirmed live on the public Publish to Web link. **Dashboard polish pass — done.** KPI styling, intro page, axis labels/tooltips, conditional subtitles for min-N suppressed charts, across all 4 pages. Sync-health chart (p50/p95 latency trend) also done — see "Dashboard" section below. |
| 8 | Achievements — full app integration | Quest content resolved, progress logic wired into all 4 touchpoints (trip-complete delta, station page, profile page, challenge-detail page), dashboard mart built and suppressed | ✅ **Functionally complete.** Full detail, reasoning, and bug-fix history in `docs/milestone-8-achievements.md` (the primary reference for this milestone) and `docs/dbt-coverage.md` (schema reference). Content (18 hand-authored quests + auto-generated line-completion/branching-out families, 53 total), resolver + validator, mobile logic (`quests_logic.ts`, 32 tests) + full mobile UI, warehouse layer (4 new seeds, one intermediate model per mechanism, 2 marts, suppression verified via impersonated `bq`), and docs handoff (`mobile-quests-integration.md`, `data-layer.md`'s cut-list) — all done and verified. **Power BI achievements page visual polish — done** (was deliberately deferred, now complete as part of the full dashboard polish pass). One item still genuinely open, not forgotten: per_trip/counting mechanism on-device verification (only lifetime_set was explicitly confirmed) — see "Achievements / quests" section below. `StationQuestsList`/`ProfileQuestsSummary` components mounted for real in milestone 9. |
| 9 | Remaining plain UI pages | Station drill-down, branch-aware picker, profile dashboard (now scoped down — quest UI is milestone 8's job, not this one) | ✅ **Done, on-device verified.** Map tab, canonical Station page, canonical Line page (branch-aware), and Profile mini-dashboard all built and verified; `StationQuestsList`/`ProfileQuestsSummary` mounted per `docs/mobile-quests-integration.md`; saved-stations feature (new event types, `saved_stations` table, versioned local migration, rehydration folding) built end-to-end. The Supabase `ALTER TABLE` migration ran successfully (confirmed live via `pg_get_constraintdef`); the local schema migration bug it surfaced (see `db/` file-by-file below) was fixed same-day via migration 3 and confirmed working on-device on re-test. Search tab (out of milestone 9's original scope, done as a follow-on pass) also complete — see "Mobile app — file-by-file" below. |
| 10 | Release readiness | App Store Connect, privacy policy, testers | Apple Developer membership ✅; rest ⬜ |
| 11 | Portfolio narrative | README, case study | 🔄 GitHub README done (with screenshots) and live on the repo. Case study / longer write-up — ⬜ not started. |

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

**`route_detail_opened`/`station_detail_opened`** — pre-existing, previously-unused event types,
wired up for real in milestone 9 (fire on Line/Station page mount, respectively).

**`screen_viewed` — still unwired.** Defined in `data-layer.md`'s product-events table
(`{ screen_name, source_screen }`), but as of this doc's last update, no screen actually fires it —
unlike `route_detail_opened`/`station_detail_opened`, which milestone 9 activated. Not a blocker for
anything; flagged here so it doesn't get assumed-done by proximity to the other two.

## Dev-only debug tooling (strip before release)

`app/debug.tsx` — dumps `events`/`trips`/`legs`/`sync_status` as raw JSON (and to console) via
`useDb()`, gated on `__DEV__`. Also shows live sync status (`isSyncing`/`lastSyncAt`/
`lastSyncError`) and two testing-only buttons: **Trigger Sync** (manual pass) and **Force Re-sync
All** (flips every locally-`synced` row back to `pending` and re-triggers — the only practical way to
exercise idempotency without a second device).

`app/debug-quest-components.tsx` — **deleted, milestone 9**, per `docs/mobile-quests-integration.md`'s
cleanup checklist: its whole purpose was pre-verifying `StationQuestsList`/`ProfileQuestsSummary`
before the real Station/Profile pages existed to host them. All three temporary Profile buttons
("Open Debug Dump", "Open Debug Quest Components", "Open Achievements (temp)") are gone; `app/debug.tsx`
itself stays (per the same checklist) — just unreached from any button now.

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
  `sessionLoaded` and `dbLoaded`, not session alone. **(UI polish pass)** root `Stack`'s
  `screenOptions` now also sets `contentStyle: { backgroundColor: '#fff' }` — the app previously had
  no explicit background anywhere (every screen was a bare `{ flex: 1 }`), so it rendered whatever the
  OS/platform default was; this is the one centralized place that now pins it to pure white instead of
  touching every screen file individually.
- `(auth)/_layout.tsx`, `(auth)/index.tsx` — sign-in screen. Apple button → `signInAsync` (hashed
  nonce to Apple, raw nonce to Supabase) → `signInWithIdToken`. Captures `fullName` into user
  metadata on first authorization only — Apple never sends it again after that.
- `(tabs)/_layout.tsx` — `<Tabs>` navigator + `<LogTripFAB>` as a sibling, visible from all tabs. Now
  wrapped in `<RehydrationGate>` — runs the rehydration check/replay once per session before any tab
  content renders, so the FAB can't be tapped (and a trip logged) before local `trips`/`legs` has
  finished restoring, if it needed to. **(UI polish pass)** `<Tabs>`'s `screenOptions` now also sets
  `sceneStyle: { backgroundColor: '#fff' }` — the tab-screen-area equivalent of the root `Stack`'s
  `contentStyle` above. Worth noting for future upgrades: bottom-tabs v7 renamed the old v6
  `sceneContainerStyle` prop to `sceneStyle`; the old name would silently no-op on this version
  (`@react-navigation/bottom-tabs ^7.4.0`).
- `(tabs)/map.tsx` — **(Milestone 9)** real Map tab. `MapView`/`Marker`/`Polyline` (`PROVIDER_DEFAULT`),
  polylines from `route_shapes.json` (unused until now), stations as small colored circle markers
  (gray/darker-gray/green — see `ui-spec.md`'s marker-priority rule), refetched via
  `getAllStationStatuses()` on every focus (not just mount), each `Marker` keyed on its own status so
  a flip forces a clean remount rather than a stale bitmap under `tracksViewChanges={false}`. Tapping
  a marker opens `components/map/StationPreviewModal.tsx`. **(UI polish pass) Marker size now scales
  with zoom** — a `markerSizeForDelta()` helper buckets the settled region's `latitudeDelta` into 5
  discrete sizes (9px zoomed out to 19px zoomed in — bumped up from an initial 6-16px range per
  follow-up feedback that the smallest size was hard to hit precisely), tracked via
  `onRegionChangeComplete` only
  (deliberately not `onRegionChange`, which fires continuously mid-gesture — a real cost across 496
  markers). The bucketed size is folded into each `Marker`'s existing cache-busting `key` alongside
  visited/saved, same reasoning as above: `tracksViewChanges={false}` caches the rendered bitmap, so
  a size change needs a forced remount to actually redraw. **(Follow-up UI pass) Tappable area is now
  bigger than the visible dot** — `markerTouchSizeForDelta()` derives an invisible padded touch region
  from the marker size (floored at 28pt), rendered as a transparent wrapper `View` centered on the
  dot inside each `Marker`. Chosen over just enlarging the visible dot further, which would clutter a
  wide zoomed-out view with 496 large circles.
- `(tabs)/search.tsx` — **(Search tab pass, post-milestone-9)** real Search tab. Search bar over a grid
  of `getDisplayableRoutes()` line icons (empty query) or a results list (non-empty query), via
  `subwayData.ts`'s new `searchStations()` — case-insensitive substring match over all 496 bundled
  stations, `startsWith` matches ranked before other substring matches, alphabetical within each group.
  **One row per stop_id, deliberately not deduped by name/complex** — 76 of the 496 stations share a
  name with at least one other stop_id (e.g. "14 St-Union Sq" is 3 separate stop_ids, one per platform
  group); matches the stop_id grain used everywhere else (Map markers, Station page's "This platform"),
  and whichever duplicate gets tapped, that platform's Station page already surfaces the complex's other
  lines via "Transfer here" — no dead end. Tapping a grid icon → Line page; tapping a result row →
  Station page.
- `(tabs)/profile/_layout.tsx`, `index.tsx` — **(Milestone 9)** real Profile mini-dashboard, replacing
  the stub + three temporary debug buttons. Rides logged, stations visited, % of network overall + by
  borough (now via the shared `ProgressBar` component, see `components/ui/` below), favorite
  station/line, least-travelled line(s), trip history, Saved Stations list, mounts
  `ProfileQuestsSummary`. Refetches on focus, same reasoning as the Map tab. See "Dev-only
  debug tooling" above for what happened to the three temporary buttons. **(Follow-up UI pass) Trip
  history now uses the shared `TripHistoryRow` component** (see `components/ui/` below) instead of a
  bare date row — same date + origin + exit layout as the Station page's visit history, driven by the
  new `db/trips.ts`'s `getTripHistory()` instead of an inline `SELECT ... FROM trips` query. **(UI polish pass) The gear
  icon no longer signs out directly** — it previously called `supabase.auth.signOut()` inline (the
  app's only `signOut()` call), which meant tapping it immediately unmounted the whole `(tabs)` stack
  via the root `Stack.Protected` guard, dropping straight onto the headerless Apple sign-in screen with
  no way back. It now navigates to the new `settings.tsx` screen instead; that screen holds the literal
  same `signOut()` call, reached with a real back control first. **(Follow-up UI pass, round 1c)**
  Favorites redesigned: favorite station/line now show a single pick (first of the already-sorted tie
  list — `ProfileStats` still computes every tie, the screen just renders one) instead of every tied
  entry as comma-separated text. Favorite station renders as a tappable row (`FavoriteStationRow`,
  local to this file) — the station's own line icons (`getStation(id)?.daytime_routes`, same convention
  as Search results rows) + name → Station page. Favorite line renders as a single tappable icon
  (`LineIconLink`, local to this file, guarded by `isNavigableRoute()` the same way
  `station/[stationId].tsx`'s/`trip.tsx`'s `goToLine()` are) → Line page. Least-travelled still shows
  every tied line (unlike favorite station/line, a genuine multi-way tie is the actual point there),
  now as a row of the same tappable `LineIconLink` icons instead of comma-separated text. All three
  (favorite station, favorite line, least-travelled) share one `FAVORITES_ICON_SIZE` (32px) constant
  rather than each picking its own size, so they read as one consistent unit. Saved Stations rows also
  gained each station's line icons next to the name, same `getStation()` lookup.
- `(tabs)/profile/settings.tsx` — **(UI polish pass, new)** nested under `profile/` (reached only from
  the gear icon — a single entry point, same reasoning that keeps `achievements/index.tsx` nested
  rather than root-level, per the router rules above). Back chevron to Profile, one Sign Out button
  calling `supabase.auth.signOut()` — no second implementation of sign-out, just moved to a screen
  with an actual way back.
- `log-trip.tsx` — the trip-logging modal (see above). Fully wired: `finishTrip` calls `commitTrip`
  and navigates to `/trip`; discard calls `writeProductEvent('trip_draft_abandoned')`.
- `trip.tsx` — Trip Detail/Summary screen. Root-level, not a `trip/[tripId]` folder — reached only
  via in-app navigation (`router.replace({ pathname: '/trip', params: { tripId } })`), no
  deep-linking need, so a search-param screen (`useLocalSearchParams`) was simpler than a dynamic
  route segment. Reads `trips`/`legs` live via `useDb()`. **(Milestone 8)** also calls
  `computeTripQuestProgress()` and shows every quest the trip moved the needle on — not just full
  completions, partial progress too (e.g. a min-count quest going 1/6 → 2/6) — since the point is a
  dopamine hit and quest awareness on every trip, not just the rare one that finishes something.
  **Does not yet expose delete-trip** — see "Mobile UI — remaining" below. **(Follow-up UI pass)**
  every leg's line icon (shared `RouteIcon`) and entry/exit station name, plus the summary line's
  origin/destination station names, are now individually tappable — icons push the Line page (guarded
  by `isNavigableRoute()`, same as the Station page's `goToLine()`), station names push the Station
  page. Previously nothing on this screen but the quest rows and the header's close button was
  interactive, inconsistent with the "everything drills into its own page" model used everywhere else.
- `achievements/[questId].tsx` — **(Milestone 8)** root-level (not nested under `profile/` — see
  Router rules above for why), the canonical achievement detail page. Full itemized breakdown —
  which specific stations/groups/pairs/routes are done vs. remaining, with which trip(s) and dates.
- `(tabs)/profile/achievements/index.tsx` — **(Milestone 8)** the achievements list, completed/ongoing
  sections. Stayed nested under `profile/` since it currently has only one entry point.
- `line/[lineId].tsx` — **(Milestone 9)** root-level canonical Line page. Trunk-first/tails-grouped
  station list via `getLineStationLayout()`, lightweight transfer icons per row
  (`getOtherComplexRoutes()`), tap a station → Station page. Fires `route_detail_opened` on mount.
  **(UI polish pass)** header row now holds only the back chevron — the line's icon + route code (no
  bundled long-form line name exists in this app's data) moved into the body as a large centered
  heading, first content element, with the progress bar directly beneath it via the shared
  `ProgressBar` component (replacing the old plain-text "X of Y visited" line).
- `station/[stationId].tsx` — **(Milestone 9)** root-level canonical Station page. "This platform"
  (own `daytime_routes`, visited badge + save/unsave attached here specifically) and "Transfer here"
  (`getOtherComplexRoutes()`, purely navigational, no visited state of its own) shown as two separate
  groups — a display-only choice, see `ui-spec.md`. Both groups' icons render via the shared
  `RouteIcon` (**follow-up UI pass**, moved out of this file into `components/ui/` once
  `TripHistoryRow` needed the identical icon-rendering logic too). Mounts `StationQuestsList`. Fires
  `station_detail_opened` on mount. **(UI polish pass)** header row now holds only the back chevron —
  the station name moved into the body as a large centered heading, first content element, above the
  borough line. **Visit history rows redesigned**, and **(follow-up UI pass) extracted into the shared
  `TripHistoryRow` component** once Profile's trip history needed the identical layout — see
  `components/ui/` below. Each row: date, then the trip's overall origin (first leg's line icon +
  station name) and overall destination (last leg's line icon + station name) — not just a bare date.
  Each station name gets `numberOfLines={1}` **and** `flexShrink: 1` directly on the `Text` (a
  fixed-width wrapper `View` alone doesn't truncate inside a flex row); date and both icons are pinned
  `flexShrink: 0` so only the two names ever compete for row width. Backed by `db/stations.ts`'s extended
  `getStationVisitHistory()` — see below.
- `debug.tsx` — dev-only (`__DEV__`-gated), dumps `events`/`trips`/`legs`/`sync_status` as JSON, both
  on-screen and to console. Not linked from any tab (its Profile button was removed in milestone 9);
  still reachable by direct navigation during dev. Includes a back button (`router.back()`), live
  sync status, and **Trigger Sync**/**Force Re-sync All** buttons.

**`components/`:** `LogTripFAB.tsx`; `trip-logging/types.ts` (`DraftLeg`, `ActiveField`),
`TripChipStrip.tsx`, `StationPickerStep.tsx` (wraps `@react-native-picker/picker` with an explicit
"Next" — a wheel's `onValueChange` fires on every resting value while scrolling, not just the final
pick, so auto-advancing on it would yank the user forward mid-scroll); `RehydrationGate.tsx` — wraps
the authenticated tab area, runs `needsRehydration`/`rehydrateFromRemote` once per mount, brief
loading state while it runs, fails open (renders children even if rehydration throws, rather than
blocking the app on a rehydration bug).

**`components/ui/`** (UI polish pass, new) — the first generic/cross-cutting component location;
everything else in `components/` is feature-grouped (`quests/`, `map/`, `trip-logging/`).
`ProgressBar.tsx` — `{ current, target, label?, completed?, size? }`, a green filled horizontal bar
plus a small numeric-fraction label (or "Completed!" when `completed`), replacing 9 separate plain-text
"N of M"/"N / M" displays across the app: Profile's per-borough stats, `ProfileQuestsSummary`, the
achievements list's per-quest rows, `StationQuestsList`'s per-quest rows, the achievement detail page's
group-breakdown/counting-breakdown/hero sections, the Line page's overall progress, and Trip Detail's
per-quest rows. (Two nearby counts — the achievements list's "Completed (N)"/"Ongoing (N)" section
headers — stayed plain text; those are counts, not fractions.) **(Follow-up UI pass, new)**
`RouteIcon.tsx` — `{ routeId, onPress, size? }`, custom SVG falling back to a colored bubble, extracted
from `station/[stationId].tsx`'s former local copy once `TripHistoryRow` needed the same
icon-rendering logic; `trip.tsx`'s per-leg icon also switched to it, replacing its own inline
`LINE_ICONS`/`LINE_COLORS` lookup. `TripHistoryRow.tsx` — `{ tripId, startedAt, entryRouteId,
entryStationId, exitRouteId, exitStationId }` (matches `db/trips.ts`'s `TripEndpoints` shape), the
date/origin/exit row used by both the Station page's visit history and Profile's trip history — one
row implementation instead of two copies once Profile needed the same layout.

**`components/quests/`** (milestone 8): `StationQuestsList.tsx` — "quests this station contributes
to," self-contained (fetches its own data given just a `complexId` prop), renders nothing if the
station isn't part of any quest. `ProfileQuestsSummary.tsx` — completed/ongoing counts + link into
the full achievements list, self-contained, no props. Both built in milestone 8, **mounted for real in
milestone 9** — `StationQuestsList` on `station/[stationId].tsx`, `ProfileQuestsSummary` on
`(tabs)/profile/index.tsx` — per `docs/mobile-quests-integration.md`'s (now-executed) insertion points.

**`components/map/`** (milestone 9): `StationPreviewModal.tsx` — the Map tab's marker-tap preview, a
centered modal card with a dimmed backdrop (RN's own `<Modal>`, no new native dependency — deviates
from `ui-spec.md`'s original "bottom sheet" wording, documented there). Station name/borough, line
icons (tap → Line page), visited/saved status, Save/Unsave, "View station" (→ Station page).

**`contexts/`:** `AuthContext.tsx` — plain context, no fetch logic of its own; `_layout.tsx` remains
the one place session state is actually checked, this just exposes it (`useAuth()`, `useUserId()` —
the latter throws outside an authed session, which should never happen given `Stack.Protected`).
`DatabaseContext.tsx` — opens SQLite once via `SQLite.openDatabaseAsync`. **(Milestone 9)** schema
init is now a real versioned mechanism, not "runs once ever": a `SCHEMA_VERSION` constant + ordered
`MIGRATIONS` list (`{ toVersion, run }`) — a fresh install runs the current `schema.sql` once and
lands directly on `SCHEMA_VERSION`; an existing device below that version runs every migration it's
owed, in order, inside one transaction. Added because editing `schema.sql` alone does nothing for a
device that already ran it (see `data-layer.md`'s "Local schema versioning"). **Caught live, on
Van's own phone, right after this shipped:** migration 2 (`saved_stations`) never widened `events`'
grain CHECK, so any device that had already run it hit a raw SQLite `CHECK constraint failed` the
moment `saveStation()` tried to insert — SQLite has no `ALTER TABLE` for an existing CHECK constraint,
and a migration a device already completed can't be silently redefined. Fixed via migration 3
(`SCHEMA_VERSION` → 3), SQLite's own rename/recreate/copy recipe for changing a CHECK — which itself
had a second bug on the first attempt (renaming `events` aside silently rewrote `sync_status`'s FK
text to the scratch name, breaking every future insert once that scratch table was dropped; fixed by
only ever renaming *into* `events`, never away from it). Both caught and fixed same-day, confirmed
working on-device on re-test; full reasoning and the required regression test
(`mobile/db/migration_v3_tests.py`) in `data-layer.md`'s "Local schema versioning." Exposes the
handle via `useDb()` instead of each screen managing its own connection. `SyncContext.tsx` — see
"Sync worker" above.

**`lib/`:** `supabase.ts` (chunked SecureStore adapter — a full session routinely exceeds
SecureStore's ~2048-byte per-item ceiling; `AppState`-driven auto-refresh); `subwayData.ts` (all
logic over the bundled GTFS data — station lookups, per-route station lists, valid-exit/default-exit
logic, transfer routes + correct transfer-platform lookup; confirmed directly against the data that
both directions of a route share the same stop set per branch, just reversed; `getComplexId()` is
also the shared stop_id → complex_id lookup milestone 8's quest system reuses rather than
re-implementing — see `db/quests.ts` below). **(Milestone 9)** widened `Station` type to the real
bundled shape (`lat`/`lon`/`borough`/`structure`/`ada`, not just the three fields the trip-logging
flow needed); added `getStation()`, `getBoroughName()`, `isNavigableRoute()`/`normalizeRouteIdForIcon()`
(handles the pre-existing `SIR`→`SI` display-label mismatch and bare-`S`-has-no-route-data gracefully,
without touching the separately-tracked shuttle-grouping bug), `getOtherComplexRoutes()` (refactored
`getTransferRoutes()` to share a new private `routesAtComplex()` helper rather than duplicate the
`transfers.json` lookup), and `getLineStationLayout()` (the branch-aware trunk/tail split — see
"Mobile UI — remaining" above for the two real edge cases it handles). `device.ts` — client-generated
`device_id`, generated once per install and persisted via `SecureStore`, cached in-memory after first
read; `sync.ts` — see "Sync worker" above.

**`constants/`:** `lineColors.ts` (official MTA colors + display ordering — the SIR icon fallback,
and, as of milestone 9, the actual source for Map tab polyline colors via `route_shapes.json`);
`lineIcons.tsx` (custom SVG icons, one static import per route — Metro requires statically analyzable
import paths, no dynamic `require`).

**`data/`:** `stations.json`, `route_stops.json`, `transfers.json`, `quests.json` (milestone 8),
`route_shapes.json` — all five bundled and actively used as of milestone 9 (`route_shapes.json` was
bundled but unused until the real Map tab landed). All genuinely bundled via plain `import` — no
runtime fetch, matching the offline-first design.

**`assets/subway-icons/`:** user-authored SVGs, one per route ID.

**`db/`:** `schema.sql` — untouched from milestone 1 through 8; **(milestone 9)** gained the
`saved_stations` table and `station_saved`/`station_unsaved` in the grain CHECK. `schema_tests.py` —
**(milestone 9)** gained checks for both. **`migration_v3_tests.py`** (milestone 9, new) — the
required regression test for `DatabaseContext.tsx`'s version-3 migration specifically (the events-table
rebuild), run the same way as `schema_tests.py` (plain Python `sqlite3` against the exact SQL the TS
migration runs) since `DatabaseContext.tsx` itself needs `expo-sqlite`'s native binding and can't be
exercised via plain `tsx`/`node` the way the rest of this project's pure logic is. Simulates a device
already stuck at `user_version = 2` (the real state this test exists because of) and asserts data
survives, the new event types are accepted, and `sync_status`'s FK still resolves correctly — see
`data-layer.md`'s "Local schema versioning" for the two real bugs this caught. `projection.ts` —
`commitTrip`/`deleteTrip` logic core unchanged; `writeProjectionRows()` factored out of `commitTrip`
and exported, shared with `rehydrate.ts`'s replay path — one implementation of "what a trip's
projection rows look like," not two. `leg_boarded`'s payload gained `sequence` (`event_version: 2`)
— needed to reconstruct leg order during rehydration, not derivable from timestamps alone.
**(Milestone 9)** gained `saveStation()`/`unsaveStation()`, parallel to `deleteTrip` — each wraps an
event write + the `saved_stations` projection write in one transaction. **`deleteTrip()` itself
remains unit-tested and functional but has no UI affordance anywhere yet** — see "Mobile UI —
remaining" below.
`rehydrate_logic.ts` — pure `planRehydration()` (trip grouping, `trip_deleted` exclusion,
leg-sequence ordering), deliberately zero React Native/Expo/Supabase imports so it's testable via
plain `tsx` without a device (importing `rehydrate.ts` directly pulls in `expo-sqlite`, which
transitively pulls in Flow-syntax RN source a plain Node run can't parse — this split is what makes
the logic testable at all; renamed from `rehydrate-plan.ts` during milestone 8 — "plan" wrongly
implied staging/proposal code rather than the actual running logic, same rename applied to quests
below). **(Milestone 9)** gained `planSavedStations()` — same "replay the event log into a final
projection" shape, folding `station_saved`/`station_unsaved` into a last-write-wins saved-set
(ordered by `recorded_at`). `rehydrate.ts` — thin I/O wrapper (`needsRehydration`, `rehydrateFromRemote`)
that imports the pure logic from `rehydrate_logic.ts`. **(Milestone 9)** `rehydrateFromRemote` now
also fetches `station_saved`/`station_unsaved` events and writes `planSavedStations()`'s result into
`saved_stations` inside the **same** transaction that replays trips — one all-or-nothing replay
covering both concerns, same single trigger (`needsRehydration`). `rehydrate_tests.ts` — the required
test (10 trip-rehydration checks + 4 new saved-station-folding checks, all passing): a deleted trip
never materializes, a live trip restores with correct leg order even from out-of-order remote rows, a
mixed batch only restores the live trip, an incomplete event set is skipped rather than crashing;
saved-station folding is last-write-wins by `recorded_at` regardless of array order, and ignores
unrelated event types.

**`db/trips.ts`** (**follow-up UI pass, new**) — trip-level reads that aren't specific to any one
station, split out once the same "get each trip's first/last leg" logic was needed by both the
Station page (trips through one station) and the Profile page (every trip). `getTripEndpoints(db,
tripIds)` — the batched-`legs`-query/reduce-in-JS logic originally written inline in
`getStationVisitHistory` (see below), returning a `Map<tripId, TripEndpoints>`. `getTripHistory(db,
userId)` — every trip the user has logged, most recent first, built on `getTripEndpoints`; replaces
the inline `SELECT ... FROM trips` query `(tabs)/profile/index.tsx` used to run itself.

**`db/stations.ts`/`stations_logic.ts`** (milestone 9) — same pure-logic/I-O-wrapper split as
`quests.ts`/`quests_logic.ts`, and for the identical reason (`stations_logic.ts` has zero RN imports,
testable via plain `tsx`; `stations.ts` queries SQLite + bundled `stations.json`). `stations.ts`
exposes `getStationStatus`/`getAllStationStatuses` (visited+saved, the latter batched — one query for
all 496 stations' visited set, one for saved, merged in JS, for the Map tab), `getStationVisitHistory`,
`getSavedStations`, `getProfileStats`. Reuses `quests.ts`'s `loadRiderHistory` (now exported) rather
than a second trips/legs query. **(UI polish pass)** `getStationVisitHistory` extended: `trips` carries
`origin_station_id`/`destination_station_id` but not `route_id`, so a second query over `legs` is
needed to get the line actually ridden. **(Follow-up UI pass)** that second query now lives in
`db/trips.ts`'s shared `getTripEndpoints()` rather than duplicated inline, once Profile needed the
identical "each trip's first/last leg" lookup too. `stations_logic_tests.ts` — 15 checks, all passing, run via
`npx tsx db/stations_logic_tests.ts`: visited-set computation, rides/stations/% overall, favorite
station/line (with tie handling), least-travelled line (never an unridden line, only among lines
actually ridden), % by borough, and an empty-history case that doesn't crash.

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
under `app/`, at any depth, is live-scanned by Router). Its `MapView`/`Marker`/`Polyline` shape was
reused for the real milestone 9 Map tab — its import of the now-dead `utils/subwayData.ts` was not
(the real `(tabs)/map.tsx` imports `lib/subwayData.ts` and the bundled JSON directly, matching every
other screen). Left in place, still out of the router tree, not deleted.

**Outside `mobile/`:** `supabase/schema.sql` — run manually via the SQL Editor, not part of the app
build. **`el/`** (new): `sync_to_bigquery.py`, `requirements.txt` — the Python EL job, see
`data-layer.md`'s "Python EL job" section for the full design. **`.github/workflows/pipeline.yml`** — runs the full
pipeline: EL job, then `dbt seed`/`dbt run`/`dbt test` back to back, cron every 6h + `workflow_dispatch`.
`dbt test` failing fails the whole run.

## Mobile UI — remaining

- [x] **Shuttle grouping (S) — three real, separately countable routes under one shared icon.**
      Tapping `S` shows a combined FS/GS/H stop list for the entry pick (`branchesForRoute('S')`
      in `subwayData.ts` returns the union of all three shuttles' branches — one change that makes
      `getStationIdsForRoute`/`getValidExitStations` work for free, no changes needed there); once
      a real entry station is picked, `resolveShuttleRouteId()` determines which of the three it
      belongs to. Three resolution points needed it: `selectEntry` (leg 0), `selectLine`'s
      `legIndex > 0` branch (re-editing a transfer leg's line chip), and `selectTransfer` (a new
      transfer leg) — all in `log-trip.tsx`. The real `route_id` (`FS`/`GS`/`H`) is what gets
      committed to every leg/event, never `'S'` itself — matches "never destroy non-derivable
      information." `FS`/`GS`/`H` reuse `S`'s icon/color (`lineIcons.tsx`/`lineColors.ts`) — no new
      assets, matching "S stays a pure display grouping" and MTA's own signage (which doesn't
      visually distinguish the three either). Shuttles count as three separately-completable lines,
      not one merged credit, as designed. `s_tier`'s `blocked` flag removed from
      `network/quests_source.json` as part of this same change — `network/processed/quests.json`
      now resolves 53 quests (was 52), `s_tier` present with `{FS, GS, H}` criteria, validator
      passing. On-device verification (all three shuttles ride correctly, transfer-into and
      re-edit-transfer-line paths, `s_tier` progress) still to be done for real usage, not just
      TypeScript/validator checks.
      **Follow-up, same day:** the bare `S` icon (shown on a station's own platform list, the map
      preview, and Search's line grid — anywhere before a specific shuttle has been resolved) was
      found inconsistently navigable: `isNavigableRoute('S')` was `false` everywhere (correct
      pre-shuttle-work, when `S` genuinely led nowhere), so Station/Map's `isNavigableRoute`-gated
      icons correctly stayed inert — except Search's grid, which pushes `/line/${routeId}`
      unconditionally with no gate, so `S` was tappable there by omission, landing on `/line/S`
      where `getLineStationLayout`'s generic trunk/tail split (now running against
      `branchesForRoute('S')`'s FS/GS/H union) happened to produce three plausible-looking groups,
      but labeled by station termini, not by which real shuttle each one was. **Decided:** made
      this consistent and deliberate rather than accidental-only-via-Search. `isNavigableRoute()`
      now special-cases `'S'` as navigable; `subwayData.ts` gained `getShuttleGroups()` (three
      groups, one per real shuttle, each labeled by name — "Franklin Ave Shuttle"/"42 St
      Shuttle"/"Rockaway Park Shuttle" — using `getStationIdsForRoute()` for real stops, not
      `getLineStationLayout`'s termini-based labels, since `S` isn't a geographic branch-fork, it's
      three unrelated routes sharing one icon); `line/[lineId].tsx` special-cases `lineId === 'S'`
      to build its `layout` from `getShuttleGroups()` instead of `getLineStationLayout`, reusing
      every other bit of that page's rendering/progress-bar logic unchanged. A committed trip leg's
      icon still navigates to that leg's own specific shuttle page (`FS`/`GS`/`H`, e.g. "2 of 4"),
      unaffected and unchanged — the combined `/line/S` page is specifically the pre-resolution
      overview, reached from anywhere the generic `S` grouping icon is shown.
      **Second follow-up, same day:** each of the three group headers on the combined `S` page
      ("Franklin Ave Shuttle" etc.) is now itself tappable, drilling into that specific shuttle's
      own page — same "everything drills into its own page" model used everywhere else.
      `LineStationGroup` gained an optional `routeId?: string` (set only by `getShuttleGroups()`;
      `getLineStationLayout()`'s real geographic branch tails never set it, since a branch tail
      isn't itself a separately-navigable line). `line/[lineId].tsx`'s `GroupSection` renders a
      tappable header (with a chevron) only when `group.routeId` is present, so every other line's
      branch-tail rendering is unaffected — the behavior is driven entirely by the data, not a
      lineId-based special case at the call site.
      **Warehouse gap caught and closed:** the `s_tier` unblock only regenerated
      `network/processed/quests.json` at the time; `dbt/seeds/quest_definitions.csv` (built by
      `network/scripts/build_quest_seed.py`, the actual last step before `dbt seed`) was left stale
      and missing `s_tier` until caught in conversation and regenerated — now 53 rows, `s_tier`
      present with its `{FS, GS, H}` criteria. Picked up by BigQuery via the same `pipeline.yml`
      manual trigger that verified the deletion metric (below) — `dbt seed` ran clean as part of
      that same green run, so `s_tier` is now a real seeded quest in the warehouse too.
- [x] Station tap → station info drill-down — `app/station/[stationId].tsx`, milestone 9. Mounts
      `StationQuestsList` per `docs/mobile-quests-integration.md`. Shows lines as two groups
      ("This platform" / "Transfer here" — see `ui-spec.md`'s Canonical Station page section), visit
      history, save/unsave.
- [x] **Profile page mini-dashboard** — `app/(tabs)/profile/index.tsx`, milestone 9. Rides logged,
      stations visited, % of network overall + by borough, favorite station/line, least-travelled
      line(s), trip history, Saved Stations list, mounts `ProfileQuestsSummary` per
      `docs/mobile-quests-integration.md`. All three temporary debug buttons removed;
      `app/debug-quest-components.tsx` deleted entirely; `app/debug.tsx` itself kept (per the existing
      cleanup checklist) but no longer reachable from any button.
- [x] Branch-aware station picker (trunk + grouped branch tails) — `app/line/[lineId].tsx`, milestone 9.
      `getLineStationLayout()` in `subwayData.ts` — common-prefix/suffix split of `route_stops.json`'s
      branches, with two real edge cases found and handled: route `F` (both ends shared, differs only
      in a middle stopping-pattern variant — a data-pipeline nuance, not a real fork, resolved by
      showing the shared trailing segment once instead of duplicated per tail) and route `5` (a genuine
      fork at both ends, no shared segment at all — falls back to one top-level tail per branch,
      labeled by both termini). Also found, not fixed (same "don't fix pipeline data in the app"
      posture as F): route `N` direction 0 has two tails whose real termini happen to share the same
      station name ("Astoria-Ditmars Blvd"), a cosmetic quirk from the underlying branch-dedup
      pipeline, not a bug in the splitting algorithm itself.
- [x] ~~Achievements/quests UI~~ — done, milestone 8 (see build sequence table above)
- [x] Search tab — `app/(tabs)/search.tsx`, follow-on pass after milestone 9. See "Mobile app —
      file-by-file" above.
- [ ] Compact date picker requires tapping outside to confirm — no Done button, no auto-close on
      selection. Confirmed real iOS/library limitation (two open, unresolved upstream issues), not
      fixable with a different prop. Revisit only if still a real friction point once used for real.
- [x] **Delete-trip UI affordance** — Trip Detail (`app/trip.tsx`) now has a trash icon in the header
      (mirroring the close button's position/size), gated behind a two-button confirm
      (`Alert.alert`, "Delete this trip? / This can't be undone.") — the app's first two-button
      alert; the only prior precedent was a single-button error alert. On confirm, writes
      `trip_deleted` via the existing `deleteTrip()` (now covered by a new unit test,
      `mobile/db/projection_tests.py` — the previous gap: it had no test of its own, only indirect
      coverage via `rehydrate_tests.ts`'s replay path and `schema-tests.py`'s CHECK validation) and
      navigates back via the screen's existing `router.back()` idiom. Deliberately **not** added as
      a second surface on Profile's `TripHistoryRow` — that component is a single full-row
      `Pressable` with no secondary tap target, shared with the Station page's visit history;
      squeezing in inline delete there wasn't the easy win the brief allowed for. **Real gap found
      while wiring this up, fixed as part of the same change:** `station/[stationId].tsx` fetched
      its visit-history data on mount only, unlike Profile's `useFocusEffect`-based refetch — since
      Trip Detail (and now delete) is also reachable from a station's visit history, deleting a
      trip that way and tapping back would have left a stale, already-deleted trip listed. Split
      into two effects: `station_detail_opened` stays a plain mount-only `useEffect` (it's "once per
      open" per `data-layer.md`, and refocusing an already-mounted screen isn't a new open), while
      `getStationStatus`/`getStationVisitHistory` moved to a `useFocusEffect`, matching Profile's
      established pattern exactly. See also "% of trips deleted" under Dashboard below, which this
      unblocks.
- [x] **UI polish pass, round 1** — a concrete, scoped set of six fixes rather than open-ended feel:
      pure-white app background (centralized via `Stack`'s `contentStyle`/`Tabs`' `sceneStyle`, not
      per-screen); shared `ProgressBar` component replacing 9 plain-text "N of M" displays app-wide;
      Profile's gear icon fixed to route through a real Settings screen (with a back control) instead
      of signing out directly with no way back; Station/Line page headers now hold only the back
      control, with the name/icon moved into centered body content; map markers now resize by zoom
      level via `onRegionChangeComplete`; Station page visit-history rows redesigned to show each
      trip's overall origin/destination (line + station), not just a bare date. See the file-by-file
      bullets above for each.
- [x] **UI polish pass, round 1b** — real usage feedback on round 1's build, addressed same-day:
      Profile's trip history now uses the same date/origin/exit row as Station's visit history (shared
      `TripHistoryRow`/`RouteIcon` components, `db/trips.ts`'s new `getTripEndpoints()`/`getTripHistory()`,
      extracted so the "first/last leg per trip" query isn't duplicated); Trip Detail's line icons and
      station names are now individually tappable (→ Line/Station pages), matching the "everything
      drills into its own page" model used everywhere else in the app — previously only the quest rows
      and close button were interactive; map markers' tappable area is now bigger than the visible dot
      (an invisible padded touch region, not just a bigger dot) since the round-1 dots were genuinely
      hard to hit precisely. See the file-by-file bullets above for each.
- [x] **UI polish pass, round 1c** — more real usage feedback, addressed same-day: Profile's Favorites
      section redesigned (favorite station/line now show a single pick instead of every tied entry as
      text, with tappable icons — station shows all its own line icons + name → Station page, line
      shows its single icon → Line page; least-travelled kept as every tied line, now tappable icons
      instead of comma-separated text); Saved Stations rows gained each station's line icons next to
      the name. Icon sizes across favorite station/favorite line/least-travelled standardized to one
      shared `FAVORITES_ICON_SIZE` (32px) after initial per-context sizing looked visually inconsistent
      as a group. See the Profile file-by-file bullet above for detail.
- [ ] **UI polish pass, round 2** — no fixed spec; further general visual/interaction refinement across
      the four milestone-9 pages plus Search, judged by feel rather than a checklist. Worth scoping to
      a concrete list of specific complaints before starting, so it has a real finish line rather than
      staying open-ended.

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
- [x] **`raw_events.events`'s grain CHECK constraint widened** (milestone 9) to accept
      `station_saved`/`station_unsaved` — live migration confirmed via `pg_get_constraintdef`.

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
- [x] **(Milestone 9)** extended to fold `station_saved`/`station_unsaved` into `saved_stations`,
      inside the same all-or-nothing transaction as trip replay — see "Mobile app — file-by-file"
      above.

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
- [x] **"% of trips deleted after being logged" — built and now verified live, end to end.**
      `int_committed_trips.sql` (deletion-inclusive trip reconstruction, exists specifically as this
      metric's denominator), `mart_global_summary.sql`'s `deletion_rate` CTE → `pct_trips_deleted`
      column, and three tests (`assert_deleted_trips_excluded_from_int_trips.sql`, the inverse
      `assert_deleted_trips_present_in_int_committed_trips.sql`, and a range check in
      `assert_global_summary_rates_valid.sql`) all exist and match `data-layer.md`'s design.
      **Verified for real by Van**, not just by inspection: deleted a test trip on-device, manually
      triggered `pipeline.yml` (EL job → `dbt seed` → `dbt run` → `dbt test`, all green, no failures),
      refreshed Power BI — the existing KPI card correctly showed **13% trips deleted**, matching
      expectations. Full chain (mobile delete → Supabase sync → EL job → dbt → Power BI refresh)
      confirmed working end to end.

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
      found. **Default landing page fixed** — Power BI's default is "whichever page was last active
      on save/publish," not literally page 1; corrected by publishing with the intro page active and
      leftmost in the page order.
- [x] **Sync-health chart — done.** p50/p95 latency trend, on Product/Instrumentation page.
- [x] **Achievements page visual polish — done.** Along with the rest of the full dashboard polish
      pass: KPI styling, intro page, axis labels/tooltips, conditional subtitles for min-N suppressed
      charts, across all 4 pages.
- [x] **"% of trips deleted" visual — live-verified.** KPI card confirmed showing real data
      (13% on first real test) after a full pipeline run + Power BI refresh — see the Python EL job
      / BigQuery / dbt section for the verification detail.
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
- [x] **GitHub README, with screenshots** — live on the repo, links to this dashboard. See
      "Portfolio" below.

## Achievements / quests

**Done — milestone 8, dashboard polish done as part of the full pass above.** Full detail, full
bug-fix history, and the complete design reasoning live in `docs/milestone-8-achievements.md` (the
primary reference for this milestone, not duplicated here) and `docs/dbt-coverage.md` (schema
reference for every new seed/model). Summary:

- [x] Content: 18 hand-authored quests (`network/quests_source.json`) across the three mechanisms
      (lifetime set-membership, per-trip property check, lifetime counting), plus auto-generated
      line-completion/branching-out families — 53 quests total (`s_tier` unblocked once shuttle
      grouping shipped, see "Mobile UI — remaining")
- [x] Resolver (`network/scripts/build_quests.py`) + validator (`network/scripts/validate_quests.py`)
      — both real, tested tools; caught and fixed a dozen-plus genuine bugs during development, full
      list in the milestone doc (the biggest: line-completion criteria were originally
      route-agnostic, giving false credit across shared multi-line transfer complexes)
- [x] Mobile: `mobile/db/quests_logic.ts` (pure evaluators, 32 tests) + `quests.ts` (I/O wrapper) —
      see "db/" file-by-file section above
- [x] Mobile UI: `trip.tsx`'s quest-progress display, achievements list/detail pages — all live and
      on-device verified
- [x] `StationQuestsList`/`ProfileQuestsSummary` components — built, tested, **mounted for real in
      milestone 9**; see `docs/mobile-quests-integration.md`
- [x] Warehouse: `quest_definitions`/`route_definitions`/`route_stations` seeds (plus `complex_id`
      added to the existing `station_coordinates` seed), `int_user_visited_complexes` + one
      `int_quest_completion_*` model per mechanism, `mart_quest_completion` (suppressed, N=5) +
      `mart_quest_completion_histogram` (exempt) + 3 new `mart_global_summary` columns (exempt)
- [x] Power BI achievements page — done, full visual polish complete.
- [x] Docs handoff: `docs/mobile-quests-integration.md` (milestone 9 insertion points, executed),
      `data-layer.md`'s cut-list (Conquistador and "first user to visit a station," both considered
      and cut, reasoning documented)
- [ ] **Genuinely still open, not just unchecked bureaucratically:** on-device verification of
      per_trip and counting mechanism quest completions specifically — only a lifetime_set quest
      (Roosevelt Island) was explicitly triggered and confirmed on-device this milestone. Not blocked
      on anything, just hasn't happened yet.

**Achievements detail page rework, plus four real bugs found and fixed along the way:**

- [x] `achievements/[questId].tsx` brought in line with Station/Line pages' established visual
      language — back-only header (title moved into the body as a heading, matching
      `stationNameHeading`/`lineNameHeading`), a new shared `components/ui/SectionHeader.tsx`
      (previously reimplemented per-page as `groupLabel`/`sectionHeader`/`sectionTitle`), and the
      `'routes'` breakdown case now uses the shared `RouteIcon` component instead of a local
      icon-with-fallback reimplementation. Station/pairs/routes rows are now tappable, drilling into
      that station's/route's own page, per the app's Fotmob-style "everything drills into its own
      page" model — previously only `per_trip` rows navigated anywhere.
- [x] **OR-semantics group breakdown bug fixed** — a group where nothing's visited yet used to
      collapse into one row with every member's name joined by `" or "` (unreadable for large groups
      like Five Boroughs/Neighborhood Native). Now matches the AND-semantics branch's treatment
      exactly: group header, progress bar, one row per member. All three OR-group families (boroughs,
      Manhattan neighborhoods, and the auto-generated `branching_out_*` quests) now carry a real
      `group_labels` array plumbed from `build_quests.py` through `quest_definitions.csv`/
      `mobile/data/quests.json` — boroughs use their real name, neighborhoods use the
      `final_neighborhoods.json` name (previously discarded the moment it was grouped by), and
      branching-out groups use their branch's terminal station name (the one real, always-available
      fact — no branch-name data exists anywhere in the pipeline).
- [x] **Transfer Master undercounting, fixed at the definition level.** The mobile evaluator and
      `int_transfers.sql` already agreed with each other and with the *documented* definition
      (exact `station_id` match between adjacent legs) — but that definition itself was wrong. A
      transfer's entry is auto-set to "the correct platform at that complex" (`ui-spec.md`), often a
      *different* `station_id` than the prior leg's exit (confirmed on real data: Union Sq, complex
      602, has 3 distinct station_ids for its 4/5/6, N/Q/R/W, and L platforms). Redefined as "every
      leg after a trip's first" — guaranteed a real transfer by construction, since the trip-logging
      flow's transfer step only ever offers a different route than the one just ridden. Fixed
      identically in `quests_logic.ts` (deduped two copies of the counting loop into one
      `transferCountPerTrip()` helper) and `int_transfers.sql`. Confirmed `int_transfers`'s only
      other consumer, `mart_station_pairs`, derives independently from `int_legs` and needed no
      change. See `data-layer.md`'s "Leg-grain events" for the full writeup.
- [x] **Wordsmith no longer pinned to one hardcoded word.** The mobile evaluator and resolver were
      already fully data-driven (`criteria.word`); only the *data* pinned it to "JAM." Changed the
      criteria shape to a curated `words: string[]` list (still an exact ordered-letter match, not an
      open dictionary check) — `JAM, CAB, BAG, LAB, CRAB, GRAB, DRAG, FLAG, BAND, HAND, FARM, WARM`,
      all real words spellable from real single-letter route_ids. Description text no longer
      enumerates the list.
- [x] **Express routes (6X/7X/FX) folded into their local counterpart, not a separate identity.**
      These are real GTFS route_ids (confirmed via `routes.txt`: 6X = Pelham Bay Park Express, 7X =
      Flushing Express, FX = Brooklyn F Express) that `build_quests.py` was auto-generating
      `line_completion_*` quests for — but the trip-logging route picker has no icon/color for them,
      so a leg could never actually be logged with one of these route_ids, making those three quests
      (and the unrestricted "Every Line" quest, which fell back to the same unfiltered route list)
      permanently uncompletable. Excluded from quest generation (`build_quests.py`'s
      `EXPRESS_ROUTE_IDS`) and from the mobile fallback route list (`quests.ts`'s `ALL_REAL_ROUTES`);
      added `6X→6`/`7X→7`/`FX→F` to `subwayData.ts`'s `DISPLAY_ROUTE_ALIASES` (same pattern as the
      existing `SIR→SI` entry) so icon/color/navigation resolve to the local line everywhere, with no
      new assets.

**Real bug found on-device: 4 Av-9 St (served only by F/G/R) was showing up in the D/N/W
line_completion quests** — traced to `route_stops.json`'s own generation, not a mobile/quest-layer bug.
`build_static_data.py` used to take the raw union of every distinct GTFS trip pattern per
route+direction as that route's station list (`stop_times.txt` has no `pickup_type`/`drop_off_type`
columns to distinguish "really stops here" from "passes through"). That union silently included two
different real problems: a genuine raw-data mislabeling (5 trips with `route_id='W'` in `trips.txt`
whose `trip_id`, `shape_id`, and headsign all say "N" throughout — real N destinations like "Bay Pkwy,"
never a W one) and real-but-rare weekend/GO reroute patterns baked into the feed (2 via 1's tracks, 4/5
via 6's, N/Q/W via R's, etc.). Auditing the whole system the same way found 293 (route, stop) pairs like
this, not just the one station — same root cause throughout.

- [x] **Fixed at the source, not patched downstream.** `build_route_branches()` now cross-validates
      every (route, stop) pair against MTA's own "Daytime Routes" station reference
      (`stations.json`'s `daytime_routes`, sourced from `stations.csv` — independent of schedule data
      entirely) before a trip's stops ever reach branch/pattern detection. Seven route_ids are recorded
      under a different letter in that reference than their real route_id (shuttles all as generic "S",
      Staten Island Railway as "SIR", express variants under their local counterpart) — confirmed
      empirically (100% mismatch for exactly these seven vs. a partial mismatch for every real
      irregularity elsewhere) and handled via a small `DAYTIME_ROUTES_ALIAS` map, mirrored in
      `validate_quests.py`. Verified safe before shipping: checked the reverse direction first (zero
      cases where Daytime Routes claims a route serves a station but the raw trip data disagreed), so
      the filter can only trim, never drop something legitimate — confirmed after, too (W's station list
      now correctly ends at Whitehall St/Astoria-Ditmars Blvd with zero Brooklyn stations, matching real
      service; route_shapes.json's polylines stayed single, continuous branches per direction, no
      fragmentation from the fix).
- [x] **Regression check added to `validate_quests.py`**, deliberately independent of
      `route_stops.json`'s own correctness — cross-checks every `all_station_route_pairs` pair (
      `line_completion_*`, `crossroads`) against `daytime_routes_at_complex` directly, so a future
      regression in `build_static_data.py`'s fix (or a raw-data refresh reintroducing a similar
      mislabeling) gets caught even if the source-level fix itself is ever reverted or incomplete.
- **Side effect worth knowing about, not a regression:** the `branching_out_*` auto-generated quest set
  changed (`2`/`E`/`F`/`N`/`R` → `5` only, alongside `A` which was already there and still is) — the
  underlying branch-detection logic is unchanged, but it now runs on the corrected station data, and
  several of the previously-detected "branches" turn out to have been the same reroute-pattern
  contamination as the main bug, not real, everyday branch structure.

## Release

- [x] Apple Developer Program membership renewed
- [ ] App Store Connect app record, build signing
- [ ] Privacy policy / App Privacy disclosure
- [ ] Recruit real testers

## Portfolio

- [x] **GitHub README** — live on the repo, with real screenshots and a live dashboard link.
- [ ] Portfolio write-up / case study — separate, longer-form piece, not started.

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
- **`screen_viewed` warehouse/dashboard consumer** — the event type exists in `data-layer.md`'s
  schema but is currently unwired on the mobile side (see "Product-event instrumentation" above) and
  has no dbt model or dashboard visual. Not rejected outright — just: no dbt/mart/dashboard work
  should happen for this until a real product question needs it, matching `data-layer.md`'s own
  "extend as real usage questions come up, not ahead of the UI that would need them" principle for
  product events generally.

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
- **(Milestone 9) SQLite has no `ALTER TABLE` for changing an existing CHECK constraint** — widening
  `events`' grain CHECK required the full rename/recreate/copy-data recipe, not a simple `ALTER`. See
  `data-layer.md`'s "Local schema versioning" for the two real bugs this surfaced and how they were
  fixed. Worth remembering for any future CHECK-constraint change on an already-migrated table.
- **GitHub renders image filename case-sensitively even though most local filesystems don't** — a
  `.PNG` extension referenced as `.png` in markdown (or vice versa) renders fine locally/in editor
  previews but silently 404s on GitHub. Caught once already with the README's screenshots.
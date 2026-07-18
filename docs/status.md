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
| 3 | Sync worker | Log a trip on-device, confirm `raw_events` rows land under the right `auth.uid()` | ⬜ Not started |
| 4 | EL job → BigQuery | Trigger the workflow, confirm real data lands in BigQuery | ⬜ Not started |
| 5 | dbt mart | `dbt run`/`dbt test` green, hand-check one number | ⬜ Not started |
| 6 | Min-N enforced | Query as Power BI's service account, confirm suppression | ⬜ Not started (mechanism decided — see `docs/dashboard-spec.md`) |
| 7 | Power BI live | Three pages, Publish to Web page-nav works | ⬜ Not started |
| 8 | Achievements | Content designed, join logic working | ⬜ Not started |
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

**Commit/discard wiring:** "Log Trip" calls `commitTrip`, then navigates to `/trip` (root-level, not a `trip/[tripId]` folder — no deep-linking need, so a search-param screen was simpler). X calls `deleteTrip`-adjacent logic — actually just fires `trip_draft_abandoned` and discards, since nothing was ever committed to correct. Both go through `AuthContext`/`DatabaseContext` (see "App-wide providers" below) for `userId`/the shared SQLite handle, rather than each screen opening its own.

## App-wide providers

Two React contexts now sit above the whole app, in `app/_layout.tsx`:

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
  — a real gap caught during this session: gating splash on session alone left a brief blank-screen
  window while SQLite was still opening underneath.

## Product-event instrumentation (new this session)

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

## Dev-only debug tooling (new this session, strip before release)

`app/debug.tsx` — dumps `events`/`trips`/`legs`/`sync_status` as raw JSON (and to console) via
`useDb()`, gated on `__DEV__`. Reached right now via a **temporary button on the Profile tab stub**
("Open Debug Dump") — that button is scaffolding for this testing pass, not a real feature, and needs
to come out before this ever ships.

## Dev/test data exclusion (decided, not yet implemented)

Dev/testing happens signed in with the same Apple ID that'll be used for real post-launch — so
`user_id` can't separate test rows from real ones. **Decided:** exclude by launch-date cutoff, not
row identity — `stg_events.sql` (milestone 5) filters `occurred_at >= <launch date>`, hardcoded once
the actual launch date is known. Don't pick the date now; picking too early risks excluding a real
trip, too late risks leaking test data in. No new column, no `is_test` flag, no app-side plumbing.

## Mobile app — file-by-file

**Router rules learned the hard way, worth stating plainly:**
- A route group (parenthesized folder) is only addressable by its bare name in a `Stack.Screen`/
  `Tabs.Screen` `name` prop if it has its own `_layout.tsx`. Without one, Router silently flattens it
  to the full inner path, and any reference to the bare group name fails with a blank screen.
- `Stack.Protected` needs a real `index.tsx` inside a group as its fallback anchor for when that
  group's guard is false — without one, a cold launch can render nothing at all. This is why the
  sign-in screen is named `index.tsx`, not `sign-in.tsx` — load-bearing, not cosmetic.
- Native modules (date picker, `react-native-svg`, `@react-native-picker/picker`) each require a
  fresh `eas build` — a plain `expo start -c` restart only picks up JS changes.

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
  `(tabs)` or `(auth)` via `Stack.Protected`. Also now wraps the whole `Stack` in
  `AuthContext.Provider`/`DatabaseProvider` (see below) — splash-hiding waits on both `sessionLoaded`
  and `dbLoaded` now, not session alone.
- `(auth)/_layout.tsx`, `(auth)/index.tsx` — sign-in screen. Apple button → `signInAsync` (hashed
  nonce to Apple, raw nonce to Supabase) → `signInWithIdToken`. Captures `fullName` into user
  metadata on first authorization only — Apple never sends it again after that.
- `(tabs)/_layout.tsx` — `<Tabs>` navigator + `<LogTripFAB>` as a sibling, visible from all tabs.
- `(tabs)/map.tsx`, `(tabs)/search.tsx` — stubs.
- `(tabs)/profile/_layout.tsx`, `index.tsx` — stub + working Sign Out. **Currently also has a
  temporary "Open Debug Dump" button** (→ `/debug`) added for this session's testing — scaffolding,
  needs to come out before release.
- `log-trip.tsx` — the trip-logging modal (see above). Now fully wired: `finishTrip` calls
  `commitTrip` and navigates to `/trip`; discard calls `writeProductEvent('trip_draft_abandoned')`.
- `trip.tsx` — Trip Detail/Summary screen. Root-level, not a `trip/[tripId]` folder — reached only
  via in-app navigation (`router.replace({ pathname: '/trip', params: { tripId } })`), no
  deep-linking need, so a search-param screen (`useLocalSearchParams`) was simpler than a dynamic
  route segment. Reads `trips`/`legs` live via `useDb()`.
- `debug.tsx` — dev-only (`__DEV__`-gated), dumps `events`/`trips`/`legs`/`sync_status` as JSON, both
  on-screen and to console. Not linked from any tab; reached via the temporary Profile button above.
  Includes a back button (`router.back()`) since nothing else in the router tree points at it.

**`components/`:** `LogTripFAB.tsx`; `trip-logging/types.ts` (`DraftLeg`, `ActiveField`),
`TripChipStrip.tsx`, `StationPickerStep.tsx` (wraps `@react-native-picker/picker` with an explicit
"Next" — a wheel's `onValueChange` fires on every resting value while scrolling, not just the final
pick, so auto-advancing on it would yank the user forward mid-scroll).

**`contexts/`** (new this session): `AuthContext.tsx` — plain context, no fetch logic of its own;
`_layout.tsx` remains the one place session state is actually checked, this just exposes it
(`useAuth()`, `useUserId()` — the latter throws outside an authed session, which should never happen
given `Stack.Protected`). `DatabaseContext.tsx` — opens SQLite once via `SQLite.openDatabaseAsync`,
runs `schema.sql` on first launch (keyed off `PRAGMA user_version`), exposes the handle via `useDb()`
instead of each screen managing its own connection.

**`lib/`:** `supabase.ts` (chunked SecureStore adapter — a full session routinely exceeds
SecureStore's ~2048-byte per-item ceiling; `AppState`-driven auto-refresh); `subwayData.ts` (all
logic over the bundled GTFS data — station lookups, per-route station lists, valid-exit/default-exit
logic, transfer routes + correct transfer-platform lookup; confirmed directly against the data that
both directions of a route share the same stop set per branch, just reversed). `device.ts` (new this
session) — client-generated `device_id`, generated once per install and persisted via `SecureStore`,
cached in-memory after first read.

**`constants/`:** `lineColors.ts` (official MTA colors + display ordering — the SIR icon fallback,
and the intended future source for Map tab polylines); `lineIcons.tsx` (custom SVG icons, one static
import per route — Metro requires statically analyzable import paths, no dynamic `require`).

**`data/`:** `stations.json`, `route_stops.json`, `transfers.json` bundled and actively used;
`route_shapes.json` bundled but unused so far (reserved for the Map tab). All four genuinely bundled
via plain `import` — no runtime fetch, matching the offline-first design.

**`assets/subway-icons/`:** user-authored SVGs, one per route ID.

**`db/`:** `schema.sql`, `schema_tests.py` — untouched this session. `projection.ts` —
`commitTrip`/`deleteTrip` untouched (already built/tested prior session); **new this session:**
`writeProductEvent()`, a thin wrapper around the same `insertEvent` internals for product-domain
events — used by `log-trip.tsx` for all five draft-session event types.

**`scratch/old-map-screen.tsx`:** pre-session map screen, moved out of the router tree (anything
under `app/`, at any depth, is live-scanned by Router). Kept for the future Map tab, not deleted.

**Outside `mobile/`:** `supabase/schema.sql` — run manually via the SQL Editor, not part of the app build.

## Mobile UI — remaining

- [ ] Station tap → station info drill-down
- [ ] **Profile page mini-dashboard** — personal-scope stats, `docs/dashboard-spec.md`'s "In-app
      profile page" section
- [ ] Branch-aware station picker (trunk + grouped branch tails) — Line page
- [ ] Achievements/quests UI
- [ ] Compact date picker requires tapping outside to confirm — no Done button, no auto-close on
      selection. Confirmed real iOS/library limitation (two open, unresolved upstream issues), not
      fixable with a different prop. Revisit only if still a real friction point once used for real.

**Non-blocking polish, don't let these hold up v1:** default marker restyling, parallel-offset
rendering for overlapping track, `route_shapes.json` polyline precision.

## Backend

- [x] `raw_events` schema (with `received_at`, server-stamped) + `operational` schema — live, RLS
      verified
- [ ] Outbox sync worker — flushes local `events` → `raw_events`, idempotent insert, atomic per-trip flush
- [x] Supabase Auth — Sign in with Apple, native flow
- [x] RLS policies — written, live, verified with two impersonated test users

## Python EL job / BigQuery / dbt

- [ ] Batch load `raw_events` → BigQuery raw dataset, GitHub Actions scheduled
- [x] GCP project + `subwayquest_raw` dataset created, service account + `GCP_SA_KEY` secret set
- [ ] dbt staging → intermediate → mart, with tests
- [ ] Partitioning (ingestion date) + clustering (`user_id`)
- [ ] Min-N (=10) suppression — row access policies on a dbt-computed `segment_user_count` column,
      dbt computes/exposes only, BigQuery enforces the cutoff (see `docs/dashboard-spec.md`)

## Dev/test data exclusion (decided, not yet implemented)

Dev/testing happens signed in with the same Apple ID that'll be used for real post-launch — so
`user_id` can't separate test rows from real ones. **Decided:** exclude by launch-date cutoff, not
row identity — `stg_events.sql` (milestone 5) filters `occurred_at >= <launch date>`, hardcoded once
the actual launch date is known. Don't pick the date now; picking too early risks excluding a real
trip, too late risks leaking test data in. No new column, no `is_test` flag, no app-side plumbing —
same reasoning as the `user_id NOT IN (...)` dev-account filter this replaced: computed once, upstream,
in the staging layer that already needs a filter like this.

## Dashboard

- [ ] Three Power BI pages: Exploration, Growth & Behavior, Product/Instrumentation
- [ ] Publish to Web — verify page-navigation on the free tier (unverified risk)
- [ ] Sync-health chart — p50/p95 latency trend

## Achievements / quests

- [ ] Content design — the actual quest list
- [ ] Static quest-definitions table + join logic (confirmed: no new event types needed)

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
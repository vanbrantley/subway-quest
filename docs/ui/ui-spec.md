# SubwayQuest — UI/UX Spec v1

Companion to `docs/data-layer/` and `docs/dashboard/spec.md`. Written before implementation, same
reasoning as the rest of this project's docs: a real spec beats reconstructing intent from a working
build later. Model app throughout: **Fotmob** — everything drills into its own dedicated page, easy
back-navigation, insights surfaced contextually rather than on one static dashboard.

## Navigation model

- **3 bottom tabs:** Map (left), Search (middle), Profile (right).
- **Floating action button (FAB), visible from any tab**, opens the trip-logging flow as a full-screen modal — fast, reachable
  from anywhere, since speed is the whole point of that flow.
- **One canonical full page per entity (Station, Line).** Reached from anywhere that entity appears —
  a map preview, a search result, a line's station list — always the same page, never a separate
  "mini" variant. Resolves an earlier open question: expanding a station preview doesn't move you into
  a specific tab's ownership: the Station and Line pages are shared routes, pushed onto whichever tab's
  stack you were already in, so back-navigation returns you exactly where you came from.
- **The map is the only place that gets a lightweight preview** (a bottom sheet), precisely because
  panning/exploring the map benefits from not fully leaving it — everywhere else navigates directly to
  the real page.

## Auth

- **Sign in with Apple only for v1** — no email/password. Fast, private, Face ID comes free at the OS
  level. Matches this session's earlier decision: real auth from day one, `user_id` = Supabase
  `auth.users.id`, generated automatically at sign-in. No custom user-ID scheme needed — already the
  simplest path, and already what the schema was built for.
- **Session persists as long as Supabase's default refresh-token behavior allows** — deliberately
  minimizing re-auth friction; signing in repeatedly isn't part of the intended experience.
- **Sign out:** Profile tab → menu → Sign Out button.

## Tab: Map

- Existing: Apple Maps background, stations as markers, GTFS-derived colored polylines.
- **Marker redesign** — small circle, not the default pin:
  - Gray = not visited, not saved
  - Darker gray = saved ("want to visit"), not yet visited
  - Green = visited — **overrides saved status.** "Saved" represents a want-to-visit intent; once
    that's fulfilled, showing it as visited is more meaningful than a neutral "still on the list"
    gray. Green wins for any station that's been visited, saved or not.
- **Tap a marker** → bottom sheet preview: line icon(s), station name, borough, visited status, a save
  button.
- **Tap the sheet** (or an explicit "view station" affordance on it) → pushes the canonical Station
  page. Tapping a line icon *within* the sheet → pushes the canonical Line page directly — no separate
  "mini line view," per the one-canonical-page rule above.

## Tab: Search

- Search bar at top; below it, a grid of all subway line icons.
- **Typing a station name** → results list, one row per match: line icon (left ~1/4 of the row),
  station name (remaining width). Tap a row → canonical Station page.
- **Tapping a line icon in the grid** → canonical Line page directly (decided over filtering search
  results in place — from the Line page, the station list is already there and clickable, so this
  isn't a lost capability, just reached one tap later and with more context shown).

## Tab: Profile

Personal mini-dashboard — mirrors `docs/dashboard/spec.md`'s "In-app profile page" section; **fold
this fuller list back into that doc once this spec is locked**, since it's more detailed than what's
currently written there:

- Rides logged, stations visited, % of network visited (overall, and split by borough)
- Favorite station, favorite line — both **computed** (most-visited/most-ridden), never manually set
- Least-travelled line(s)
- Trip history (list; tapping an entry opens that trip's detail page)
- **Saved Stations list** — visiting a saved station does not auto-remove it from this list; it stays,
  now shown as visited (green, per the marker priority above), until the user manually unsaves it.
  Consistent with a pattern already used elsewhere in this project (e.g. `trip_deleted` requiring an
  explicit action rather than silent auto-cleanup) — nothing gets removed on the user's behalf without
  them asking. Also the simpler build: no auto-unsave logic needed. A visited station remaining in this
  list also has real value as a record ("wanted to go, and did"), not just clutter to prune.
- Achievements summary (completed / ongoing counts), with a link into the full Achievements page
- Menu (settings icon) → Sign Out

### Achievements page (reached from Profile)

- Two sections: completed, and ongoing/in-progress (with progress shown per item).
- Tapping any achievement → its detail page: full criteria, which parts are done, which remain.

## Canonical Station page

Reached from: the map's preview sheet, search results, or a line page's station list — always the same
page regardless of entry point.

- Station name, the line(s) it belongs to, borough, visited status, a save/unsave button
- Visit history (dates ridden through this station, if any)
- Achievements/quests this station contributes to

## Canonical Line page

Reached from: the Search tab's line grid, or tapping a line icon anywhere else (map sheet, station
page).

- Line info, the user's progress through it (X of Y stations visited)
- Full ordered station list — trunk first, branch tails grouped below, per the branch-aware design
  already in PROJECT.md — each station showing a checkmark if visited
- Tapping a station in the list → canonical Station page

## Trip-logging flow (FAB → full-screen modal)

1. Date picker — defaults to today; calendar picker to backdate. Date-only, no time-of-day input, per
   the data layer's "Date-only backdating" design.
2. Tap a line icon (same grid style as elsewhere) to start leg 1.
3. iOS native picker wheel — leg 1's start station, from that line's full station list.
4. iOS native picker wheel — leg 1's end station.
5. **Optional transfer:** the system looks up real transfer options at leg 1's end station (via the
   same `complexes.csv`-derived transfer data already in the pipeline — no new backend work) and shows
   only those lines as choices for leg 2. Once a transfer line is picked, leg 2's start station is
   auto-set to the correct station at that transfer point — the user only picks the end.
   **End-station options are validated against the start** — incompatible stations (a different,
   disconnected branch) are grayed out/disabled, not just trusted to the user. Repeat for further
   transfers as needed.
6. **Removing a leg cascades** — removes that leg and every leg after it, never a single leg in
   isolation, avoiding a dangling transfer point (same design as the earlier trip-editing discussion).
7. **X button** discards the whole draft — no trip is created; a `trip_draft_abandoned` product event
   fires, per the existing taxonomy.
8. **"Log Trip"** commits the whole trip atomically — `trip_started` + every leg + `trip_ended` written
   together, exactly as `mobile/db/projection.ts`'s `commitTrip` already implements and tests confirm.
9. **On success →** navigates to the new trip's Trip Detail/Summary page.

## Trip Detail/Summary page

Reached after logging a trip, or from Profile's trip history.

- What was logged — stations, legs, transfers
- **Which quest(s) that trip contributed progress toward**, if any — this is the "reward" moment
  discussed earlier in this project, shown here rather than live during logging (see below)
- X button returns to wherever navigation originated — the map (now showing that station green) if
  just logged, or Profile if opened from history

## Deliberately deferred to a later version

- **Real-time quest-progress display *during* trip logging** — discussed, explicitly not v1. Progress
  is shown after commit, on the Trip Detail page, not live as legs are added.

## Open items still needing a decision

None remaining from this pass — both prior open items (marker color priority, syncing the Profile stat
list to `dashboard-spec.md`) resolved together; see below.

## Proposed route structure (Expo Router) — implementation detail, adjust freely

```
app/
  (auth)/
    sign-in.tsx
  (tabs)/
    map.tsx
    search.tsx
    profile/
      index.tsx
      achievements/
        index.tsx
        [questId].tsx
  station/[stationId].tsx     # shared canonical page, pushed from any tab
  line/[lineId].tsx            # shared canonical page, pushed from any tab
  log-trip.tsx                 # FAB modal
  trip/[tripId].tsx            # trip detail/summary
```

Not locked to the same rigor as the data layer — this is a reasonable starting structure for whoever
implements it, not a decision requiring the same level of scrutiny as the schema did.
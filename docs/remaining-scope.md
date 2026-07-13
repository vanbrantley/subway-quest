# SubwayQuest — Remaining Scope (v1 definition of done)

Written deliberately before UI implementation begins, as the anchor against "I have a working app on
my phone, I must be done" — see PROJECT.md's opening note on the avoidance pattern this project exists
partly to counter. When something on this list is genuinely done, check it. When the whole list is
checked, *that's* done — not the moment a build first runs on-device.

## Build sequence — how we know each stage actually works

Dependency order, not the section order above — each milestone has a concrete check, not "it compiled"
or "it's on my phone" (see this doc's own opening note on that trap).

| # | Milestone | Verification |
|---|---|---|
| 1 | Supabase schema live | Schema SQL run in SQL Editor. Insert a test row as one auth user; confirm a second test session genuinely can't read it — a real RLS test, not just "no error." |
| 2 | Auth + local trip logging | Real Sign-in-with-Apple on-device. Log a trip through the full flow, kill/reopen the app, trip persists. No sync yet — outbox rows stay `pending` on purpose. |
| 3 | Sync worker | Log a trip on-device; confirm the `raw_events` rows land in Supabase under your own `auth.uid()`, and that a second test session still can't read them. |
| 4 | EL job → BigQuery | Manually trigger the GitHub Actions workflow; query the BigQuery raw dataset, see real trip data land. |
| 5 | dbt mart | `dbt run` + `dbt test` green. Hand-check one mart number against something known true (e.g. total trips logged). |
| 6 | Min-N enforced | Query as if you were Power BI's service account; confirm small segments show suppressed/placeholder. At one real user, everything correctly showing "not enough data yet" is success, not a gap. |
| 7 | Power BI live | Three pages built, Publish to Web working, page navigation functioning — resolves the unverified risk flagged in dashboard-spec.md. |
| 8 | Achievements | Content designed, join logic working, achievements page shows real progress against real logged trips. |
| 9 | Remaining mobile UI | Profile mini-dashboard, station drill-down, branch-aware picker — the rest of ui-spec.md. |
| 10 | Release readiness | App Store Connect record, privacy policy, real testers recruited. |
| 11 | Portfolio narrative | README, case study. |

## 1. Mobile UI

- [ ] Trip-logging draft/commit flow — wired to `mobile/db/projection.ts`'s `commitTrip`/`deleteTrip`
      (already built and tested)
- [ ] Station tap → station info drill-down view
- [ ] **In-app profile page mini-dashboard** — personal-scope stats (see `docs/dashboard/spec.md`'s
      "In-app profile page" section) — easy to miss since it's a distinct deliverable, not a side
      effect of the trip-logging UI
- [ ] Branch-aware station picker (trunk + grouped branch tails) — design exists in PROJECT.md, not
      yet built
- [ ] Achievements/quests UI — progress display, tied to the content + join logic in section 6

**Deliberately non-blocking polish, don't let these hold up v1:** default marker restyling, parallel-
offset rendering for overlapping track, `route_shapes.json` polyline precision — all pre-existing,
explicitly deferred items from PROJECT.md, still true.

## 2. Supabase (operational backend)

- [ ] `raw_events` schema — mirrors local `events`, plus **`received_at`** (server-stamped,
      `DEFAULT now()`) — required for dashboard sync-latency reporting, not present locally, flagged
      in `event-taxonomy.md`'s deferred list so it isn't lost
- [ ] `operational` schema — mirrors local `trips`/`legs`
- [ ] Outbox sync worker — flushes local `events` to `raw_events`, per the sync policy already written
      (idempotent insert, atomic per-trip-bundle flush)
- [ ] Supabase Auth set up — Sign in with Apple (recommended for an iOS-only app; confirm current App
      Store requirements when actually implementing)
- [ ] RLS policies written: `auth.uid() = user_id`, per table — pattern decided, real SQL not written

**Resolved, no longer an open decision:** real auth from day one (see PROJECT.md's "Real auth from day
one") means RLS keyed on `auth.uid() = user_id` is genuine row-level security, not just an
organizational convention. The `device_id`-based security gap flagged earlier in this project is fixed
by this decision, not just documented as a known limitation.

## 3. Python EL job

- [ ] Batch load `raw_events` (Supabase) → BigQuery raw dataset, scheduled via GitHub Actions — same
      pattern already proven on the NYC Data Job Market Tracker project

## 4. BigQuery + dbt

- [ ] BigQuery raw dataset set up
- [ ] dbt: staging → intermediate → mart structure, with tests (`not_null`, `unique`, `relationships`,
      `accepted_values`) — this is its own real body of work, not a side effect of BigQuery existing
- [ ] Partitioning (by ingestion date) and clustering (by `user_id`) on the raw/mart tables — baseline
      correct practice given how the dashboard filters by date range, not optional
- [ ] **Min-N (=10) suppression implemented using BigQuery-native mechanisms (authorized views / policy
      tags), not generic dbt filtering logic** — resolves the earlier open "what justifies BigQuery
      specifically" question: this is genuinely load-bearing, not decorative, since the suppression
      requirement already exists regardless — doing it with BigQuery's own tools instead of a
      database-agnostic approach is what makes the choice of BigQuery specifically matter here

**Considered and explicitly rejected, recorded so they don't get silently re-litigated later:**
- **BQML forecasting** (`ARIMA_PLUS` on user growth/trip volume) — rejected because growth here is
  driven by manual outreach (recruiting testers directly), not organic usage. A forecast model would
  just be extrapolating from the shape of manual promotion effort, not a real underlying trend —
  nothing meaningful to predict.
- **Geospatial convex-hull "explored territory"** (`ST_CONVEXHULL`/`ST_AREA` over visited stations) —
  rejected after scoping it out: required new plumbing (`stations.json` didn't exist in the warehouse),
  measures spread-of-points rather than actual ground covered (a real framing risk), and — the
  disqualifying issue — the compelling version is inherently per-user geometry, which conflicts
  structurally with the public dashboard never exposing individually identifiable data. Would need to
  live on the profile page instead, as a smaller, less visually compelling aggregate-only feature to
  appear publicly — not worth the plumbing cost for what's left after that constraint.

## 5. Dashboard (Power BI)

- [ ] Build the three pages from `docs/dashboard/spec.md`: Exploration, Growth & Behavior,
      Product/Instrumentation
- [ ] Publish to Web, verify page-navigation actually works on the free tier (flagged as unverified
      in the spec)
- [ ] Sync-health chart specifically: p50/p95 latency trend, not a single fixed threshold

## 6. Achievements / quests

- [ ] **Content design** — decide the actual quest list (which stations, what the challenge is per
      quest) — a real creative/product step, separate from the mechanism below
- [ ] Static quest-definitions table + join logic against committed trip history — mechanism already
      scoped this session, confirmed to need no new event types

## 7. Release

- [ ] Apple Developer Program membership, App Store Connect app record, build signing
- [ ] Privacy policy / App Privacy disclosure — likely required given location-pattern data collection
      and now real auth (Sign in with Apple); confirm current requirements against Apple's docs when
      you're actually there
- [ ] Recruit real testers

## 8. Portfolio narrative

- [ ] GitHub README
- [ ] Portfolio write-up / case study

## Explicitly out of scope for v1 — deferred on purpose, not forgotten

- Multi-device support for one account (one `user_id`, several `device_id`s) — real auth makes this
  possible later, not needed for v1
- Shared-table indexing/clustering plan for Supabase/BigQuery at real multi-tenant scale — matters once
  there's real volume, not before
- CI running pipeline tests on every change — deliberately sequenced after dbt exists, not before
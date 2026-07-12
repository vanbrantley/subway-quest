# SubwayQuest — Dashboard Spec v1

Locks in what gets built once Supabase/BigQuery/dbt exist — written now, ahead of the UI, deliberately
(see PROJECT.md's handover note on why: avoiding the moment a working UI on-device gets mistaken for
"done"). Every metric below is checked against what the event taxonomy actually captures — nothing
here requires new event types or schema changes, with one exception noted explicitly.

## Two separate deliverables — different data paths, never crossing

| | Public dashboard | In-app profile page |
|---|---|---|
| Audience | Anyone with the link — no login | The signed-in user, about themselves |
| Data path | Supabase → EL job → BigQuery → dbt mart → Power BI | Local SQLite / Supabase, live, scoped to one `device_id`/`user_id` |
| Scope | Aggregated across all users | One user's own data only |
| Privacy posture | Must never expose individually identifiable rows — see below | Naturally single-user, no aggregation-privacy concern |

**These must stay architecturally separate.** The public dashboard's mart is pre-aggregated at the dbt
layer — no drill-down to an individual `device_id`/`user_id` should ever be queryable from what feeds
Power BI. The profile page is the opposite: it's *supposed* to show one person their own detail, and
pulls from a completely different path (not the BigQuery mart) precisely so no aggregation/anonymity
concern ever applies to it.

## Privacy: minimum-N suppression

**Resolved: N = 10.** Any segment/bucket-level stat (a histogram bar, "% of users who completed quest
X," any per-group breakdown) is suppressed or grouped into "not enough data yet" below 10 users in that
segment. Reasoning: this is behavioral/location data (ride patterns, station visits) — a category that
warrants more caution than generic app-usage counts, since it can be quasi-identifying even without a
name attached. 10 sits toward the higher end of common small-count suppression conventions (roughly
3–10 depending on data sensitivity), chosen deliberately high given the data type. Applies to
segment-level stats only — an overall total (e.g. "total users," a single aggregate number) isn't a
segment and doesn't need suppression.

**Implementation: BigQuery-native (authorized views / policy tags), not generic dbt filtering logic** —
see `docs/remaining-scope.md` section 4. Chosen deliberately over a database-agnostic approach, since
this requirement exists regardless of warehouse choice; doing it with BigQuery's own mechanisms is part
of what makes BigQuery specifically load-bearing to this project, not just a pass-through choice.

**Real practical consequence, not just a policy on paper:** at current/early TestFlight scale, total
users will likely sit under 10 for a real stretch of time — meaning most segment-level charts (the
per-user histogram, per-quest completion %) should render a "not enough users yet" placeholder rather
than real data until that threshold is crossed. Expected and fine, not a flaw in the plan.

## Public dashboard — Exploration & mission

*What SubwayQuest is actually for, made visible at aggregate scale.*

| Metric | Answers | Derivation |
|---|---|---|
| Station visit heatmap (map, colored by visit frequency) | Which parts of the system get explored, in aggregate | `leg_boarded`/`leg_alighted` `station_id`s, grouped |
| % of system explored, distribution across users | How thoroughly do people explore, and how does that vary | Distinct stations visited ÷ 496, per user, then aggregated — subject to min-N suppression |
| Lines/branches ridden vs. total | Same idea, at route-branch grain | `legs.route_id`, joined against the known branch count |
| % of users completing each quest | Which quests are well-tuned vs. too hard/easy | Quest-definitions table (static) joined against committed trip history — no new schema |

## Public dashboard — Growth & riding behavior

| Metric | Answers | Derivation |
|---|---|---|
| Total users, over time (line graph) | Is this growing | Distinct `device_id`/`user_id` count by signup/first-event date |
| Trips logged per day (line graph) | Overall usage volume over time | `trip_started` count by date |
| Average trips logged per user | Typical engagement depth | `trips` count ÷ distinct users |
| Histogram: trips logged per user | Engagement distribution, not just the average | Same, bucketed — subject to min-N suppression |
| Top N most popular stations | Real aggregate ridership patterns | `station_id` frequency across all legs |
| Top lines | Same, at route grain | `route_id` frequency |
| Station-pair network graph (edges = transfer/ride frequency between adjacent stations) | Real system usage patterns, visually | Adjacent-leg station pairs, same derivation logic as transfer detection in the schema — no new event type |

## Public dashboard — Product/instrumentation (the layer most worth leading with in a portfolio pitch)

*Distinct from the sections above — this isn't "what riders do," it's "how well the logging flow and
instrumentation work." Deliberately kept separate so it's clear who each section is for.*

| Metric | Answers | Derivation |
|---|---|---|
| % of committed trips that required at least one correction before logging | How much friction exists in the drafting flow | Distinct `draft_id`s with a `draft_leg_removed`, joined via `trip_draft_committed`, ÷ total committed trips |
| % of drafts abandoned (never committed) | Where people bail before finishing | `trip_draft_abandoned` count ÷ (`trip_draft_abandoned` + `trip_draft_committed`) |
| % of trips deleted after being logged | How often "log it, then realize it's wrong" happens | `trip_deleted` count ÷ total ever-committed trips |
| Sync health — median/p95 sync latency, trending over time (plus a supplementary "% synced within 60 min") | Is the outbox pattern actually keeping up in the real world | **Resolved:** not `sync_status` directly (correctly stays local-only, per taxonomy doc). Add one new column, `received_at`, to Supabase's `raw_events` schema — a server-stamped timestamp (`DEFAULT now()`) set the instant a row actually lands. `received_at − recorded_at` (already-synced field) gives real latency per event — reported as a **percentile distribution (p50/p95), not a single fixed threshold**, since a single "% within N minutes" number conflates genuine offline time (expected — underground commuting) with actual sync-worker degradation, and can't distinguish them. A shift in the distribution's shape is a clearer health signal than any one cutoff. No changes to local `schema.sql` or the tested schema. |

## In-app profile page (personal, not public)

A smaller, personal-scope mirror of the exploration section above — same underlying logic, one user's
data only, pulled live rather than from the batch/warehouse path:

- % of system explored (this user only), likely with the same station-colored map at personal scale
- Lines/branches ridden
- Quest/achievement progress — which are complete, which are closest
- Trips logged over time (personal), a smaller version of the public growth chart

## Scrapped, with reasoning

- **Average ride length (stops)** — considered and cut. Real cost (requires `route_stops.json` in the
  warehouse for the first time — new dbt seed, plus a branch-disambiguation fallback for rides that
  cross a fork) against low payoff (a plain descriptive stat that doesn't showcase distinctive work,
  unlike the product/instrumentation metrics above). Cutting it also removes the only reason anything
  on this list needed `route_stops.json` in BigQuery at all — no partial plumbing left behind.
- **"% of trips edited"** — reframed, not cut. Corrected to "% requiring at least one correction before
  logging" (see Product/instrumentation above) — a defensible rate claim about a real behavior, not an
  ambiguous label.

## Layout: three Power BI pages, mapped directly to the three sections above

Multi-page reports (tabbed, like Excel sheets) are standard Power BI practice for anything beyond a
single trivial view, and Publish to Web supports page navigation. The three-way split above already
exists for a different reason (different audiences), and that split maps directly onto three pages
rather than one crowded view: **Exploration**, **Growth & Behavior**, **Product/Instrumentation**. Worth
a quick check against current Power BI docs when actually building this, to confirm no free-tier
Publish to Web quirks around page navigation — not verified against current documentation this session.

## Open, not yet resolved

- Exact chart types within each page — this doc locks *what* gets measured, why, and now which page it
  lives on; visual/chart-type design is a separate, later pass.
# SubwayQuest — Dashboard Spec v1

Locks in what gets built once Supabase/BigQuery/dbt exist — written now, ahead of the UI, deliberately
(see PROJECT.md's handover note on why: avoiding the moment a working UI on-device gets mistaken for
"done"). Every metric below is checked against what the event taxonomy actually captures — nothing
here requires new event types or schema changes, with one exception noted explicitly.

## Two separate deliverables — different data paths, never crossing

| | Public dashboard | In-app profile page |
|---|---|---|
| Audience | Anyone with the link — no login | The signed-in user, about themselves |
| Data path | Supabase → EL job → BigQuery → dbt mart → Power BI | Local SQLite only, scoped to one `user_id` — never queries Supabase directly. Rehydration-on-sign-in (see `data-layer.md`) is the only path anything ever arrives from Supabase, and it's a one-time recovery replay, not an ongoing read path. |
| Scope | Aggregated across all users | One user's own data only |
| Privacy posture | Must never expose individually identifiable rows — see below | Naturally single-user, no aggregation-privacy concern |

**These must stay architecturally separate.** The public dashboard's mart is pre-aggregated at the dbt
layer — no drill-down to an individual `device_id`/`user_id` should ever be queryable from what feeds
Power BI. The profile page is the opposite: it's *supposed* to show one person their own detail, and
pulls from a completely different path (local SQLite, not the BigQuery mart, not Supabase at request
time — see `data-layer.md`'s "Data-flow architecture") precisely so no aggregation/anonymity concern
ever applies to it.

## Privacy: minimum-N suppression

**Resolved and verified — N = 5, scoped to metrics that disclose actual places, not to "any bucketed
stat."** Implementation details, GCP setup, and the verification runbook live in
`docs/bigquery-min-n.md`; this section is the reasoning only.

**The threat model, precisely — this replaced an earlier, broader draft of this section.** The
original version of this doc suppressed any segment/bucket-level stat on the reasoning that this
project touches "behavioral/location data" as an undifferentiated risky category. That was too broad
and, worked through properly, too blunt an instrument. The actual re-identification risk in mobility
data comes from **space + time together** — a handful of space-time points is enough to re-identify
most people in a mobility dataset, because "this person, at this specific time, at this specific
place" combinatorially narrows down to almost nobody else. This project deliberately never stores or
displays time-of-day (see `data-layer.md`'s "Date-only backdating" — only a date is ever captured,
never a clock time), so that compounding factor doesn't exist here at all.

What's left, once time-of-day is off the table, is a weaker but still real risk: **a metric that
names which actual stations/routes a small group of people touched.** In a small, early, likely
socially-connected tester population, "one person transferred at this specific stop" or "one person
completed this specific quest" can be identifiable by social elimination alone ("only Alex would ever
go there"), with no timestamp or cross-referencing required. A metric that only discloses a
*magnitude* of behavior — how much someone rode, how fast they logged a trip, how much of the system
they've covered — carries none of that risk, because it never says *where*.

Applying that distinction, suppression applies to exactly three metrics — the ones that name actual
places at small-group grain:

- Station visit heatmap
- Station-pair network graph (the transfer graph)
- % of users completing each quest (a quest is a named set of stations; completing a rare one at
  low N discloses that a specific person visited those specific stations)

**Top lines was reconsidered and added to this list too, after initial scoping missed it.** A ranked
top-N chart is safe by construction — but "Top lines" and the underlying per-route mart aren't the
same thing: the mart holds every route, not just the top N, and ranking is only a display choice on
top of it. The shuttles (`FS`/`GS`/`H`) are exactly the routes likely to have very few riders in an
early tester population — "one specific person rode the Rockaway Park shuttle" is the same disclosure
as a low-visitor station, one grain coarser. So the per-route mart is in scope too, N=5.

**Everything else on this dashboard is exempt, and it's worth stating why explicitly so this doesn't
get "corrected" back to over-broad later:**

- % of system explored, lines ridden vs. total (distribution across users) — a magnitude of
  coverage, never which stations
- Histogram of trips per user, average trips per user — a magnitude of activity, no location content
- % requiring correction / % drafts abandoned / % trips deleted, median time to log by leg count —
  UI/instrumentation behavior, no location content at all
- Total signups / total activated users over time — a running count of *how many* people did
  something, never *where*; a daily delta genuinely doesn't identify anyone either, since knowing
  someone's signup date says nothing else about them the way a station or route does

**N = 5, not the originally-drafted 10.** 10 was chosen when the category being protected was "all
behavioral/location data" broadly. Now that the scope is narrowed to genuine place-disclosure only,
and the time-of-day compounding factor is absent by design, a more moderate N is defensible — while
still staying above the very bottom of the common 3–10 small-count-suppression convention, because a
small, socially-closed tester population is exactly the scenario where even 3–4 could still be
narrowed down by someone who knows the group. 5 is the point where "which of these five people did
this" stops being a reasonable guess for an outsider without inside knowledge.

**Implementation: BigQuery-native, not generic dbt filtering logic.** Chosen deliberately over a
database-agnostic approach, since this requirement exists regardless of warehouse choice; doing it
with BigQuery's own mechanisms is part of what makes BigQuery specifically load-bearing to this
project, not just a pass-through choice. Full mechanism below.

**Real practical consequence, not just a policy on paper:** at current/early TestFlight scale, the
four in-scope charts (heatmap, transfer graph, quest completion %, top lines) will likely render a "not enough
data yet" placeholder for a real stretch of time. Expected and fine — everything else on the
dashboard (growth, engagement, instrumentation health) is unaffected and will show real numbers from
day one, since none of it is in scope for suppression.

**Why this is worth explaining plainly in an interview, not glossing over:** a fully-populated public
dashboard was never really the deliverable being evaluated here — the reasoning is. Anyone hiring for
Data Analyst / Analytics Engineer / Data Engineer roles is going to care more about "did this person
think correctly about privacy under a real constraint, and can they explain the tradeoff" than
whether a public chart happens to have bars in it yet. A dashboard that's fully populated *because*
suppression was skipped is the weaker artifact, not the stronger one. The stronger story is specific
and falsifiable: *"I started with a blanket rule, worked through what re-identification in mobility
data actually requires — space plus time — noticed this app never stores time-of-day by design, and
narrowed the policy to the three metrics that genuinely disclose location at small-group grain,
choosing N=5 with reasoning tied to the size of a socially-connected test population rather than
picking a round number."* That's a concrete demonstration of reasoning about a real privacy tradeoff,
independent of whether the live dashboard ever has enough users to show it — the row access policy's
own verification test (suppressing/revealing synthetic seed data at the N boundary, enforced
regardless of client) proves the mechanism works on demand, without needing real traffic to prove it.

**Mechanism decided: BigQuery row access policies, referencing a count column dbt computes but does
not filter on.** Two real BigQuery-native options existed:

- **Authorized views** — mart tables live in a dataset Power BI never gets IAM access to; a layer of
  views on top embeds the suppression logic directly in view SQL (e.g. `HAVING COUNT(DISTINCT
  user_id) >= 10`), and only the *view's* dataset is granted to Power BI.
- **Row access policies on a dbt-exposed column** — dbt's mart already has to compute each segment's
  size to produce the metric at all (a "% of users in bucket X" needs bucket X's `n` regardless), so
  dbt exposes that count as a real column (`segment_user_count`), and a native
  `CREATE ROW ACCESS POLICY ... FILTER USING (segment_user_count >= 10)` enforces the cutoff.

Went with row access policies. dbt's role is upstream data prep only — it computes and exposes
`segment_user_count` because the mart already needs that count to produce the underlying metric, but
dbt applies no `WHERE` based on it and does no filtering itself. The actual suppression is the row
access policy, a native BigQuery control enforced on every query against the table regardless of
client — Power BI, an ad hoc SQL Editor session, anyone — which is what keeps this a real BigQuery-
native mechanism rather than an optional step inside one pipeline. The deciding factor over authorized
views: it keeps "what counts as a segment" as a single, dbt-owned transform decision computed once, in
one place, rather than duplicating that same segment-definition logic a second time inside view SQL,
disconnected from the dbt models that actually define what a segment is. The tradeoff going the other
way: authorized views can also hide entire tables/columns beyond row-level suppression, which row
access policies can't do — but nothing on this dashboard currently needs that broader kind of hiding,
so it's not a capability being given up for anything concrete.

## Public dashboard — Exploration & mission

*What SubwayQuest is actually for, made visible at aggregate scale.*

| Metric | Answers | Derivation |
|---|---|---|
| Station visit heatmap (map, colored by visit frequency) | Which parts of the system get explored, in aggregate | `leg_boarded`/`leg_alighted` `station_id`s, grouped — subject to min-N suppression (N=5): names actual stations at small-group grain |
| Collective % of system explored | How much of the system has the community collectively covered | Distinct stations visited by *anyone* ÷ 496, a single global figure — not a per-user distribution. Revised during milestone 7's Power BI layout design: the original per-user histogram version is exempt from suppression here (magnitude only, no individual station or user identifiable), whereas the original per-user spread would have needed it. `mart_global_summary.pct_system_explored_collective`. |
Lines ridden vs. total | Same idea, at route grain | int_legs.route_id, distinct count ÷ a static total-lines seed. Exact seed value still open — see docs/dbt-coverage.md.
| % of users completing each quest | Which quests are well-tuned vs. too hard/easy | Quest-definitions table (static, see `data-layer.md`'s "Quest-definitions, single source of truth") joined against committed trip history — no new schema. Subject to min-N suppression (N=5): a quest is a named set of stations, so completing a rare one at low N discloses which stations a specific person visited |

## Public dashboard — Growth & riding behavior

| Metric | Answers | Derivation |
|---|---|---|
| Total signups, over time (line graph) | Is this growing | Distinct user_id count by first-ever event date (any event type)
| Total activated users, over time (line graph) | How many signups actually do anything | Distinct user_id count by first |committed-trip date. Deliberately kept as a second line rather than replacing signups outright — the gap between the two is the only "accounts that never activate" signal on the dashboard. |
| Trips logged per day (line graph) | Overall usage volume over time | `trip_started` count by date |
| Average trips logged per user | Typical engagement depth | `trips` count ÷ distinct users |
| Histogram: trips logged per user | Engagement distribution, not just the average | Same, bucketed — exempt: a magnitude of activity, no location content |
| Top N most popular stations | Real aggregate ridership patterns | `station_id` frequency across all legs — subject to min-N suppression (N=5), inherited from the same table backing the heatmap |
| Top lines | Same, at route grain | `route_id` frequency — subject to min-N suppression (N=5): shuttle rows can disclose a specific rider at low N |
| Station-pair network graph (edges = transfer/ride frequency between adjacent stations) | Real system usage patterns, visually | Adjacent-leg station pairs, same derivation logic as transfer detection in the schema — no new event type. Subject to min-N suppression (N=5): an edge at low N names a specific person's specific transfer |

## Public dashboard — Product/instrumentation (the layer most worth leading with in a portfolio pitch)

*Distinct from the sections above — this isn't "what riders do," it's "how well the logging flow and
instrumentation work." Deliberately kept separate so it's clear who each section is for.*

| Metric | Answers | Derivation |
|---|---|---|
| % of committed trips that required at least one correction before logging | How much friction exists in the drafting flow | Distinct `draft_id`s with a `draft_leg_removed`, joined via `trip_draft_committed`, ÷ total committed trips |
| % of drafts abandoned (never committed) | Where people bail before finishing | `trip_draft_abandoned` count ÷ (`trip_draft_abandoned` + `trip_draft_committed`) |
| % of trips deleted after being logged | How often "log it, then realize it's wrong" happens | trip_deleted count ÷ total ever-committed trips (deletion-inclusive — a deleted trip still counts as having been committed once) | 
| Median time to log a trip, split by leg count (1 leg / 2 legs / 3+ legs) | Is the logging flow actually fast — and does complexity (transfers) slow it down | `trip_draft_committed.recorded_at − trip_draft_started.recorded_at`, joined on `draft_id`; bucketed by count of `leg_boarded` events for that trip (joined via `trip_draft_committed.payload.trip_id`). Median, not mean — a few long-idle drafts (interrupted mid-log) would skew a mean upward; median better reflects typical experience. Exempt from suppression: UI/timing behavior, no location content. **Known limitation:** measures wall-clock time from draft-open to commit, not active engagement — can't distinguish real UI friction from the user simply getting distracted mid-draft. |
| Sync health — median/p95 sync latency, trending over time (plus a supplementary "% synced within 60 min") | Is the outbox pattern actually keeping up in the real world | **Resolved:** not `sync_status` directly (correctly stays local-only, per taxonomy doc). Added `received_at` to Supabase's `raw_events` schema — a server-stamped timestamp (`DEFAULT now()`, enforced via trigger, never client-set) set the instant a row actually lands. `received_at − recorded_at` (already-synced field) gives real latency per event — reported as a **percentile distribution (p50/p95), not a single fixed threshold**, since a single "% within N minutes" number conflates genuine offline time (expected — underground commuting) with actual sync-worker degradation, and can't distinguish them. A shift in the distribution's shape is a clearer health signal than any one cutoff. No changes to local `schema.sql` or the tested schema. |

## In-app profile page (personal, not public)

A smaller, personal-scope mirror of the exploration section above — same underlying logic, one user's
data only, pulled live rather than from the batch/warehouse path.

**Synced from `docs/ui-spec.md`'s Profile tab section — the fuller, authoritative list:**

- Rides logged, stations visited
- % of network visited — overall, and split by borough
- Favorite station, favorite line — both computed (most-visited/most-ridden), never manually set
- Least-travelled line(s)
- Trip history (list, tapping an entry opens that trip's detail page)
- Saved Stations list
- Achievements — completed/ongoing summary, linking to the full Achievements page

Also, per the UI spec's map design: the same visited/saved distinction used on the map's markers
(green for visited overrides saved status — "saved" means want-to-visit, which visiting fulfills — see
`docs/ui-spec.md`) should stay visually consistent if this page shows any mini-map or station-list
treatment of its own.

## Scrapped, with reasoning

- **Average ride length (stops)** — considered and cut. Real cost (requires `route_stops.json` in the
  warehouse for the first time — new dbt seed, plus a branch-disambiguation fallback for rides that
  cross a fork) against low payoff (a plain descriptive stat that doesn't showcase distinctive work,
  unlike the product/instrumentation metrics above). Cutting it also removes the only reason anything
  on this list needed `route_stops.json` in BigQuery at all — no partial plumbing left behind.
- **"% of trips edited"** — reframed, not cut. Corrected to "% requiring at least one correction before
  logging" (see Product/instrumentation above) — a defensible rate claim about a real behavior, not an
  ambiguous label.
- Branch-level tracking — considered and cut, same reasoning as "Average ride length": would need route_stops.json in the warehouse for the first time, for detail this metric doesn't actually need. Metric narrowed to line-level (route_id) only.
- **Per-user %-explored distribution/histogram** — replaced, not purely cut. `mart_pct_explored_histogram`
  (built in milestone 5) was dropped during milestone 7's Power BI layout design in favor of a single
  collective %-explored figure on `mart_global_summary`. Reasoning: a per-user spread needs min-N
  suppression and a dedicated histogram visual; the collective figure is exempt, simpler, and reads
  better as a headline tile leading the Exploration page. The underlying per-user data isn't lost —
  it's just no longer materialized as its own mart.

## Layout: three Power BI pages, mapped directly to the three sections above

Multi-page reports (tabbed, like Excel sheets) are standard Power BI practice for anything beyond a
single trivial view, and Publish to Web supports page navigation — **confirmed against current
documentation**, including a default-page setting for the published embed; no free-tier limitation on
multi-page navigation found. The three-way split above already exists for a different reason
(different audiences), and that split maps directly onto three pages rather than one crowded view:
**Exploration**, **Growth & Behavior**, **Product/Instrumentation**.

**Authoring environment note:** Power BI Desktop has no native Mac version (confirmed current, no
native release planned). Resolved for this project — reports are authored on a separate Windows
machine already owned for Windows-only analysis tools; no VM/Parallels setup needed. See
`docs/status.md`'s Dashboard section.

## Open, not yet resolved

- Exact chart types within each page — this doc locks *what* gets measured, why, and now which page it
  lives on; visual/chart-type design is a separate, later pass.
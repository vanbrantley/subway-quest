# SubwayQuest — Power BI Page Layouts (Milestone 7)

Page order: **Growth & Engagement → Product/Instrumentation → Exploration & Usage**

Regrouped from the original Exploration/Growth&Behavior/Product-Instrumentation split in
`dashboard-spec.md` — place-revealing metrics (heatmap, top stations/lines, network graph, quests)
consolidated into one page instead of split across two. Growth leads (establishes scale, guaranteed
real numbers from day one), Instrumentation second (technical depth, also guaranteed real regardless
of user count — spec already flags this as "the layer most worth leading with in a portfolio pitch"),
Exploration last (most likely to be sparse at real scale, framed as the mission/bonus layer rather
than the page the dashboard rests on).

---

## Page 1 — Growth & Engagement

**KPI tile row:**
- Total Signups
- Total Activated Users
- Total Trips Logged
- Avg Trips per User

**Grid below:**
- Signups vs. Activated Users over time — combo line chart, two series, shared axis. The gap between
  the lines is the "signed up but never activated" signal — worth shading/annotating if easy in Power BI.
- Trips logged per day — column chart (not line — at expected scale, most days are legitimately zero
  and a line would misleadingly imply trend between sparse points)
- Trips-per-user histogram — column chart, bucketed

---

## Page 2 — Product/Instrumentation

**KPI tile row (native KPI visuals, not plain cards — value + built-in trend line each):**
- % of Trips Requiring Correction
- % of Drafts Abandoned
- % of Trips Deleted
- % Synced Within 60 Min

**Grid below:**
- Time to log, by leg count — grouped/clustered column chart. X-axis: 1 leg / 2 legs / 3+ legs.
  Two bars per group (median, p95) — grouped not stacked, since they're two separate statistics
  about the same bucket, not parts of a whole.
- Sync latency, p50/p95 over time — dual-line trend chart

---

## Page 3 — Exploration & Usage

No KPI-tile theme carried over — this page's data is mostly per-user distributions and suppressed
lists rather than clean global aggregates, so it's laid out as its own thing: a headline tile, then
rows of charts.

1. **Collective % of System Explored** — headline tile, top of page. Distinct stations visited by
   *anyone* ÷ 496. Exempt from suppression (magnitude only, not which stations). New field, not yet
   built — lands on `mart_global_summary`.
2. **Station visit heatmap** — point/bubble map (not choropleth — stations are points), color + size
   both mapped to visit count. Hero visual, full width. 🔒 N=5 — a station only renders once ≥5
   distinct people have visited it; the number shown once visible is total visits, uncapped.
3. **Lines ridden vs. total** — histogram, per-user distinct lines ridden ÷ 23 (26 post-shuttle-grouping),
   bucketed. Its own row. Exempt. New mart needed: `mart_lines_ridden_histogram` (doesn't exist yet —
   only the stations version, `mart_pct_explored_histogram`, was built, and that one's being removed).
4. **Top stations** (horizontal bar, ranked) + **Top lines** (horizontal bar, ranked) — side by side.
   Both 🔒 N=5.
5. **Station-pair matrix** — native Power BI Matrix visual, rows = entry station, columns = exit
   station, cell shaded by ride count. Full width. 🔒 N=5. Build this first (zero-dependency, native)
   before deciding whether a true node-link network graph (via a non-Microsoft AppSource visual like
   Network Navigator — confirmed to work in Publish to Web) is worth the extra dependency. Decide
   from a side-by-side look at real/synthetic data, not from spec alone.
6. **Quest stub** (blocked on milestone 8 content, placeholder position only):
   - Total achievement completions across all quests — single global sum tile. Exempt (no quest/
     station named, just a total tally).
   - Most-completed achievements — ranked horizontal bar, same grammar as top stations/lines. 🔒 N=5
     per quest (a specific quest's completion count still names a set of stations at small-group grain).
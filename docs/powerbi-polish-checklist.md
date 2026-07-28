# SubwayQuest — Power BI Polish List (post-vacation)

All charts across all 3 pages are built and functional as of this session. This list is cosmetic/
refinement work only — nothing here blocks the dashboard from working, it's what's left to make it
look and feel finished.

## From today's session

- [ ] **Axis titles** — none of the charts have them yet (X/Y axis labels)
- [ ] **Layout/sizing/arrangement** — every page has the right charts in roughly the right places,
      but sizing, spacing, and alignment across all 3 pages needs a real pass
- [ ] **Tooltip customization, page-wide** — only the Station Visit Map has a custom sentence-format
      tooltip (station name, pluralized visit count, pluralized line count). Every other chart is
      still on Power BI's default tooltip (raw field names, no narrative framing)
- [ ] **Cross-filter/click-interaction behavior** — decide per-page whether KPI tiles should be
      immune to being filtered when a user clicks a bar/point elsewhere on the page (came up when
      clicking a Sync Latency bar silently changed the % Synced Within 60 Min tile — confusing if
      unintentional, could be a nice interactive touch if deliberate). Format ribbon → Edit
      interactions, per visual
- [ ] **Min-N suppression note on Exploration & Usage page** — a visible, plain-language note
      (something like: "Station, line, and connection data only appears once at least 5 different
      people have contributed to it, to protect individual privacy") — the reasoning already lives
      in `dashboard-spec.md` but nothing on the actual dashboard explains to a public viewer why
      some charts might look sparse or empty

## Other things flagged mid-build, worth revisiting

- [ ] **KPI tile font sizing** — number is huge, title is tiny, looks unbalanced (first noticed on
      the Growth page tiles, likely applies to Instrumentation's and Exploration's headline tile too)
- [ ] **Sync Latency chart — confirm minutes formatting** — check whether the Y-axis is showing
      awkward decimals (e.g. `254.83`) and round display to whole numbers or 1 decimal if so
- [ ] **Time to Log chart — confirm seconds vs. minutes still reads well** — kept in seconds
      deliberately (values expected to be small), but worth eyeballing the real rendered numbers to
      confirm that was the right call
- [ ] **Time to Log chart — confirm bar ordering** — "1 leg / 2 legs / 3+ legs" should sort left to
      right in that order; if Power BI sorted it differently, fix via Sort axis → By category name
- [ ] **Consistent visual theme across all 3 pages** — colors, fonts, general styling — nothing
      applied yet, everything's on Power BI defaults

## Blocked on other milestones, not this dashboard's fault

- [ ] **Quest completion stub** (page 3, deferred entirely this session) — total completions tile +
      most-completed-achievements ranked bar — blocked on milestone 8's quest content existing at all
- [ ] **Classic Map visual retirement risk** — already documented in `status.md`'s known operational
      constraints, with a validated fallback (Scatter Chart, lon/lat as X/Y) if Microsoft pulls it.
      Nothing to do here unless it actually breaks — just a standing risk to keep in mind
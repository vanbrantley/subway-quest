# SubwayQuest — portfolio write-up draft

Working draft of the full write-up page. First-pass content for every section, written to be revised —
not final copy. Placeholders for assets (screenshots, video embeds) are marked `[ASSET: ...]`.

---

## 1. Hero

**Title:** SubwayQuest

**Tagline:** A subway-exploration game for NYC riders, built on top of a real production data platform.

**Buttons:**
- `View on GitHub` → repo link
- `Live Dashboard` → public Power BI link
- `Try it on TestFlight` → public TestFlight link
- `Watch the Data Story` → anchors down to section 4

`[ASSET: logo]`

---

## 2. App walkthrough

Riding the subway becomes a running list of things left to discover: stations you haven't stood on yet,
lines you haven't finished end to end, neighborhoods you haven't set foot in. SubwayQuest logs your rides
automatically-ish (you log a leg, it tracks the rest), checks things off a real map of the system, and
turns "I've never been to that part of Brooklyn" into a quest with a name.

`[ASSET: short walkthrough video, or in its absence, the 5 screenshots below]`

Suggested screenshot captions:
1. **Map tab** — every station colored by status: not yet visited, saved for later, or checked off.
2. **Line detail page** — a full line's stops in real travel order, branches grouped and labeled below
   the shared trunk instead of forcing a branch choice up front.
3. **Trip logging** — log a leg in a couple taps; the rest of the trip gets reconstructed from it.
4. **Quests** — auto-generated goals like "ride every branch of the A" alongside hand-authored ones like
   neighborhood clusters.
5. **Profile / progress** — lifetime stats: stations visited, lines completed, percentage of the system
   explored.

---

## 3. The pitch

SubwayQuest is a React Native app, but it isn't just a client app with some data behind it — it's built
end-to-end as a full data product. There are two real, separate data systems running underneath the
game: a static reference pipeline that transforms public MTA/GTFS data into the offline map the app runs
on, and a live analytics pipeline that takes real user-generated ride events all the way to a public,
BigQuery-connected Power BI dashboard. The mobile app is the front door; the data engineering is the
point.

---

## 4. The data story

`[ASSET: Claude Design motion graphic video, embedded here]`
`[ASSET: two companion architecture diagrams]`

Two data systems live side by side in this project, and they barely talk to each other. One answers
**"how does the app know the subway?"** — public transit data, transformed once, compiled directly into
the app, working fully offline. The other answers **"how does the app know you?"** — every ride you log,
flowing continuously through a scheduled pipeline into a warehouse and a public dashboard, whether anyone
is watching or not. The video above walks through both, side by side, including a couple of real bugs
this data hit and how they got caught.

---

## 5. Engineering decisions

**Events are the source of truth — not trips.** Every ride is logged locally as an append-only sequence
of raw events. The trip/leg records shown in the app aren't stored directly; they're rebuilt from that
event log every time. If the projection logic ever needs to change, the history to rebuild it from is
already there.

**The subway map is offline by design.** Public MTA/GTFS data is transformed once into JSON and compiled
directly into the app binary at build time. Nothing about browsing the map, viewing a line, or checking
a station's status requires a network connection — connectivity is only needed to sync your own ride
history.

**Physical stations and platforms are modeled separately, on purpose.** A "station complex" (the physical
place a rider would call a station) and an individual platform (`stop_id`) are different grains in the
data, and the app uses each deliberately: whether you've personally visited a platform is tracked at the
finer grain, but which routes you can transfer to from a given spot — and whether a quest counts as
complete — is evaluated at the complex level, because that's the grain that actually matches how a rider
experiences the place.

**Dev and test data never reach the public dashboard.** Every event generated in a development build is
stamped at creation time and filtered out before it reaches the warehouse's aggregate models — so testing
the app never pollutes the real, public-facing numbers.

**Live data loads incrementally, not by full reload.** The pipeline that moves ride events into the
warehouse runs as a stateless scheduled job with no persistent memory between runs — so instead of
re-pulling everything each time, it asks the warehouse what the newest record it already has is, and only
pulls what's newer.

**Aggregate metrics are privacy-protected by design.** The public dashboard enforces a minimum-count
threshold on every metric it shows, so no chart can ever be read back down to reveal a single user's
individual activity.

---

## 6. Bugs found & fixed

**Trains labeled as the wrong line.** A handful of scheduled train trips in the raw MTA data were tagged
with one line's identifier but everything else about them — their route shape, their final stop, their
destination name — clearly belonged to a different line. Left alone, this would have made at least one
real station (4 Av-9 St) falsely appear reachable by trains that never actually stop there. The fix:
cross-check every trip against an independently-sourced list of which lines actually serve which
stations, and only trust trips both sources agree on.

**One visit, credit for every line.** Big transfer hubs — stations where five, six, sometimes eight
different lines share a platform — were initially granting "you've ridden this line" credit for every
line at the hub from a single visit via just one of them. The fix treats "visited" as a (station, specific
line) pair rather than just a station, so credit only applies to the line you actually rode.

**A required field that couldn't be required.** Adding a new column to an existing, already-populated
table in the analytics warehouse initially failed outright — the warehouse won't let you declare a brand
new column "required" on a table that already has rows, because there's no value to backfill those
existing rows with. The fix was making the new column optional at the warehouse layer even though it's
guaranteed present everywhere upstream, and treating "missing" as an intentional, well-understood state
rather than an error.

**Dividing by zero, quietly.** An average-per-user metric on the dashboard was returning a blank instead
of zero whenever there was no data yet to average — a division by zero silently propagating into a
missing number rather than a meaningful one. The fix makes that case explicit: no data means the metric
reads zero, not blank.

---

## 7. How I built this

I built SubwayQuest working closely with Claude throughout — not as autocomplete, but as a technical
collaborator I directed the way I'd work with a strong pair. I wrote living design docs as I went
(architecture, data model, a running build log broken into milestones), used them as the shared spec for
every session, and reviewed and corrected the actual output at every step rather than accepting it
wholesale.

I think being open about this matters. Knowing how to direct an AI collaborator well — writing down
constraints clearly, breaking ambitious work into reviewable milestones, catching what it gets wrong,
knowing which decisions are yours to make and holding onto them — is a real, current skill, not a
shortcut around having one. The bugs in the section above, the architectural tradeoffs above that, were
things I had to understand and choose, regardless of who typed the fix. I'd rather show that process than
pretend it wasn't part of how this got built.

---

## 8. Stack

- **Client:** React Native, Expo, TypeScript, on-device SQLite
- **Auth / sync:** Supabase (Postgres, Auth, Row-Level Security)
- **Data pipeline:** Python, GitHub Actions (scheduled + manual triggers)
- **Warehouse:** BigQuery, dbt (staging → intermediate → mart)
- **Dashboard:** Power BI (Publish to Web)
- **Source data:** MTA GTFS feed, MTA Stations/Complexes reference data, NYC DCP neighborhood boundaries

---

## 9. What's next

- App Store Connect listing and public release (currently on TestFlight)
- Privacy policy publication
- Recruiting a broader tester group beyond the current TestFlight pool
- Finishing this write-up and the accompanying data-story video

---

*Draft — revise tone, trim, and fill in asset placeholders before this becomes real page copy.*

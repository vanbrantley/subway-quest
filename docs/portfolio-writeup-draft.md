# Subway Quest — portfolio write-up (ship-today version)

Full write-up, ready to ship. The Data Story is told with text and two built-in pipeline diagrams (no
video needed) rather than the deferred Claude Design motion graphic — that can still replace or
supplement the diagrams later without restructuring anything. The app walkthrough reuses the four
screenshots already in the GitHub README, and Stack is shown as a row of real tool logos on the live
page. No outstanding assets.

---

## 1. Hero

**Title:** Subway Quest

**Tagline:** Event-driven mobile application powering a first-party analytics pipeline.

**Buttons:**
- `View on GitHub` → repo link (https://github.com/vanbrantley/subway-quest)
- `Live Dashboard` → public Power BI link (https://app.powerbi.com/view?r=eyJrIjoiZjc0ZDQ0YWQtOGE0NC00ZmY4LTg4YTQtMDVhMzdmNjhmMmZjIiwidCI6Ijg4ZTg3NDc5LTc2NDgtNGZhMS05NWUwLTUzZGZiM2EzYmVkOSIsImMiOjZ9)
- `Try it on TestFlight` → public TestFlight link (https://testflight.apple.com/join/BTd5hQtA)

`[ASSET: logo]` (image path: /images/subway-quest-logo.png)

---

## 2. The pitch

Subway Quest is a React Native app, but it isn't just a client app with some data behind it — it's built
end-to-end as a full data product. There are two real, separate data systems running underneath the
game: a static reference pipeline that transforms public MTA/GTFS data into the offline map the app runs
on, and a live analytics pipeline that takes real user-generated ride events all the way to a public,
BigQuery-connected Power BI dashboard. The mobile app is the front door; the data engineering is the
point.

---

## 3. App walkthrough

A quick look at the app itself before getting into how it's built — the map, logging a ride, a station's
detail page, and progress toward its quests. Screenshots (reused from the GitHub README, same four):

1. **Map** — every station colored by status: not yet visited, saved for later, or checked off.
2. **Log Trip** — pick the line and stations for each leg; on a transfer, it shows exactly which lines
   you can switch to and sets the right platform for you.
3. **Station detail (Jay St-MetroTech)** — routes at this platform, transfer options, visit history, and
   every quest tied to this station.
4. **Achievements** — completed quests and live progress on every ongoing one.

---

## 4. Stack

Shown on the live page as a row of tool logos (reusing the same icon set as the homepage project card),
plus this breakdown:

- **Client:** React Native, Expo, TypeScript, on-device SQLite
- **Auth / sync:** Supabase (Postgres, Auth, Row-Level Security)
- **Data pipeline:** Python, GitHub Actions (scheduled + manual triggers)
- **Warehouse:** BigQuery, dbt (staging → intermediate → mart)
- **Dashboard:** Power BI (Publish to Web)
- **Source data:** MTA GTFS feed, MTA Stations/Complexes reference data, NYC DCP neighborhood boundaries

---

## 5. The data story

Two data systems live side by side in this project, and they barely talk to each other. One answers
**"how does the app know the subway?"** — public transit data, transformed once, compiled directly into
the app, working fully offline. The other answers **"how does the app know you?"** — every ride you log,
flowing continuously through a scheduled pipeline into a warehouse and a public dashboard, whether anyone
is watching or not.

**How the app knows the subway.** Public MTA reference data and the GTFS schedule feed are transformed
once by `build_static_data.py` — cross-validating routes against an independent source and collapsing raw
trip patterns down into real branches — into a set of JSON files. Those get copied into the mobile app and
compiled directly into the binary. Nothing about browsing the map or checking a station's status ever
touches the network; the whole system works the same in airplane mode as it does anywhere else.

```
MTA Stations & Complexes ─┐
                           ├─▶ build_static_data.py ─▶ network/processed/*.json ─▶ sync-data.js ─▶ bundled into app (offline)
GTFS Feed ─────────────────┘
```

**How the app knows you.** Every ride is logged locally first, then synced to Supabase. A Python job
scheduled on GitHub Actions pulls new events into BigQuery every six hours, using a watermark so it only
ever loads what's new. From there, dbt cleans, deduplicates, and privacy-suppresses the data before it ever
reaches the public Power BI dashboard — a continuous, always-on pipeline running whether or not anyone is
watching.

```
On-device event log ─▶ Supabase (raw_events) ─▶ EL job (every 6h, watermarked) ─▶ dbt (dedupe + min-N suppression) ─▶ Power BI (public)
```

The two systems almost never touch. The one narrow exception: if someone reinstalls the app, their own
history gets replayed back out of Supabase into local storage, one time, on sign-in.

`[Live page: rendered as two labeled pipeline diagrams — see components/subway-quest/StaticPipelineDiagram.js and LivePipelineDiagram.js in the portfolio repo]`

---

## 6. Engineering decisions

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

## 7. Bugs found & fixed

None of these were caught because something visibly broke. Each one was caught by a check built
specifically to verify an assumption — before it became a real problem.

**Trains labeled as the wrong line.** A handful of scheduled train trips in the raw MTA data were tagged
with one line's identifier but everything else about them — their route shape, their final stop, their
destination name — clearly belonged to a different line. Left alone, this would have made at least one
real station (4 Av-9 St) falsely appear reachable by trains that never actually stop there. Caught by
cross-checking every trip against an independently-sourced list of which lines actually serve which
stations, and only trusting trips both sources agree on.

**One visit, credit for every line.** Big transfer hubs — stations where five, six, sometimes eight
different lines share a platform — were initially granting "you've ridden this line" credit for every
line at the hub from a single visit via just one of them. Caught by validating quest logic against ground
truth rather than trusting it worked. The fix treats "visited" as a (station, specific line) pair rather
than just a station, so credit only applies to the line you actually rode.

**Privacy protection that quietly turned itself off.** The dashboard suppresses any metric covering fewer
than five people — applied directly to the warehouse tables by hand. But the automated pipeline rebuilds
those same tables from scratch on every scheduled run, and a rebuilt table doesn't carry forward
protections that were applied to the old one. Every run since launch had been silently recreating the
suppressed tables without the suppression — no error, nothing visibly broken. It only surfaced because of
a routine check confirming the protection was still in place after a rebuild. The fix: reapply the privacy
rule automatically as a required last step of every pipeline run, and verify it took effect immediately
after, every time.

**One signed-in device, two people's data.** The on-device database is shared by whichever account is
currently signed in — it isn't wiped and rebuilt per user, only per device. Testing with a second real
account on the same phone surfaced a genuine problem: without a way to tell whose data was whose, a second
account signing in could see the first account's saved stations, and stale data from a previous account
never triggered the reset meant to catch it. Chasing that down surfaced a second bug in the same corner:
two independent parts of the app could open a database transaction against each other at the same time,
which the local database doesn't support — corrupting the local data outright. The fix: wipe and rebuild
local data whenever the signed-in account changes, and add a lock so only one part of the app can touch
the database at a time.

**A database rename that quietly broke a different table.** Rebuilding a table mid-migration seemed
straightforward — set the old one aside, build the replacement under the real name, copy the data over.
But the on-device database doesn't just track the table being renamed; it silently updates every other
table's stored reference to point at the new name too, including a foreign key on a completely different
table that was never touched directly. Once the old table was cleaned up, that reference pointed at
nothing — and it only broke on a device that had actually been through a real migration, never on a fresh
install. A dedicated test simulating an already-migrated device caught it before it ever reached a real
phone. The fix: never rename an existing table away — build the replacement under a temporary name and
rename it into place only once, at the very end.

---

## 8. How I built this

I built Subway Quest working closely with Claude throughout — not as autocomplete, but as a technical
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

## 9. What's next

- App Store Connect listing and public release (currently on TestFlight)
- Privacy policy publication
- Recruiting a broader tester group beyond the current TestFlight pool

---

*Ship-today version — no outstanding assets. The app walkthrough and data-story sections can be added
back in later as their own update once the video/screenshot assets are ready.*

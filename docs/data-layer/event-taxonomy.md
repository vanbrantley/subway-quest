# SubwayQuest — Event Taxonomy v1

Source of truth for the immutable event log (`raw_events` in Supabase, mirrored in local SQLite).
Operational tables (`trips`, `legs`) are a separate, mutable projection built *from* this log — they
never disagree with it, because they're derived from it, not written independently.

## Envelope (every event row has these fields)

| field | type | notes |
|---|---|---|
| `event_id` | UUID (text) | Client-generated. Primary key. Doubles as the idempotency key for sync retries — the same logical action always carries the same `event_id`, so re-sending a pending outbox row is a no-op upsert, not a duplicate. |
| `event_type` | text | e.g. `leg_boarded`. See taxonomy below. |
| `event_domain` | text | `trip` \| `product` — cheap filter, avoids parsing `event_type` prefixes. |
| `event_version` | integer | Versions the *payload shape* for this `event_type`. Starts at `1`. Bump on any breaking payload change; never mutate the meaning of an existing version. |
| `occurred_at` | ISO8601 text | The date the ride happened, as picked by the user (see "Date-only backdating" below) combined with the actual current time-of-day at logging. Not free-typed, not live-tracked — see that section for the full reasoning. |
| `recorded_at` | ISO8601 text | Local device time the row was written to SQLite. |
| `device_id` | text | Stable per-install identifier, client-generated (a random UUID stored in local secure storage — not a hardware/ad identifier, for privacy). The pre-auth tenant key: every row is scoped to a `device_id` today, since there's no login yet. Known limitation, accepted deliberately: a reinstall generates a new `device_id` and orphans prior history — acceptable until real auth exists to carry identity across installs. |
| `user_id` | UUID (text), nullable | **Auth-readiness field, unpopulated until real auth ships.** Maps to Supabase's `auth.users.id` once login exists. Added now so the column doesn't need a schema migration later — just a backfill. Migration path: when a user signs in for the first time, all of that `device_id`'s historical rows get `user_id` backfilled via a `device_to_user` mapping table (also enables multi-device support later, since one `user_id` can then map to several `device_id`s). Supabase RLS policies key off `device_id` for now, `user_id` once populated. |
| `trip_id` | UUID (text), nullable | Real column, not buried in `payload` — needed for `NOT NULL`/`CHECK` enforcement and for cheap filtering (e.g. "everything for this trip") both on-device and once this is a shared multi-tenant table in Supabase/BigQuery. `NOT NULL` for every `event_domain = 'trip'` row; `NULL` for `event_domain = 'product'` rows. **Must be a client-generated UUID, never a locally-incrementing integer** — this app ships to TestFlight/the App Store for many independent users, and integer IDs generated offline on different phones would collide the moment two users' events land in the same shared Supabase table. |
| `leg_id` | UUID (text), nullable | Same UUID requirement as `trip_id`, same collision reasoning. `NOT NULL` only for `leg_boarded`/`leg_alighted`; `NULL` everywhere else. |
| `payload` | JSON (text) | Everything else per event type — station/route/direction, screen names, etc. `trip_id`/`leg_id` are pulled out as real columns above rather than left in here, precisely because they're the fields that need enforcement and filtering; the rest varies enough per event type that forcing it into columns would just produce a wide table full of nulls. |

Sync status (`pending` / `synced`, `synced_at`) is deliberately **not** on this table — it's operational
metadata about the outbox, not a fact about the event itself. Lives in a separate local-only
`sync_status` table keyed by `event_id`. Keeps the event log itself a pure, portable fact table.

**This app is multi-user by design, not just multi-device for one person.** It ships to TestFlight and
eventually the App Store, so Supabase and BigQuery hold many people's events, not one person's. That
doesn't change the local SQLite schema (each install's local file only ever holds that one user's own
rows — still small, still fine to query however's convenient), but it does mean the shared layers need
real indexing/clustering on `device_id`/`user_id` and `trip_id` from day one, and every client-generated
ID needs to be collision-safe across independent phones, not just internally consistent on one device.

## Sync policy

**There is no conflict resolution, by design — not "last-write-wins," genuinely nothing to resolve.**
"Conflict resolution" usually means picking a winner between two different values claiming to be the
same fact. That situation is structurally impossible here, for two reasons:

1. `events` is append-only and idempotent by construction — nothing is ever updated, only inserted, and
   `event_id` is the same UUID on every retry of the same logical action (an outbox retry, a dropped
   connection, a race between attempts). A duplicate send is the same truth arriving twice, not two
   truths competing. Sync writes to Supabase as `INSERT ... ON CONFLICT (event_id) DO NOTHING`.
2. Every `trip_id`/`leg_id` is created by exactly one drafting session, on exactly one device. There is
   never more than one legitimate writer for a given row — even once multi-device support exists, a
   trip's identity stays bound to the session that drafted it. No scenario produces two different
   writers proposing different values for the same row.

So the actual policy is: **idempotent insert, single legitimate writer per row.** Stronger than a
last-write-wins rule, since it means there's structurally nothing to lose in a race — worth stating
explicitly because it's a real property of this design, not an accident that happens to hold today.

**Sync flushes each committed trip's event bundle as one atomic remote transaction, not row-by-row.**
Since a trip commits locally as one atomic write (`trip_started` + every leg + `trip_ended` together —
see "Commit model" below), pushing it to Supabase one row at a time would risk the server briefly
holding a half-formed trip if the app were killed mid-flush — directly contradicting the "never
half-formed" guarantee the whole atomic-commit model exists to provide. Product events carry no such
guarantee and are never claimed to be atomic bundles, so they sync one row at a time, in any order.

## Commit model: trip events are atomic, product events are incremental

Nothing gets written to `event_domain = 'trip'` until the user taps **"Log Trip."** Everything before
that — adding legs to a draft, removing one, backing out entirely — happens as `event_domain = 'product'`
events (see "Draft-session events" below), which *are* written incrementally, in real time, as they
happen. At the "Log Trip" tap, the full trip bundle (`trip_started`, every leg's `leg_boarded`/
`leg_alighted`, `trip_ended`) is written together, atomically, in one local transaction.

This means a committed trip is never half-formed — there's no state where `trip_started` exists in the
log without its legs and `trip_ended` also existing. That's *why* `trip_auto_closed` (a v0 idea for a
trip that started but never got finished) no longer exists: atomic commit makes that state
unreachable. See Edge Cases below for what replaced it.

**There is no edit mode.** A committed trip cannot be partially corrected — only re-logged from scratch
(delete + re-enter) or deleted outright. This was a deliberate simplification: since logging is meant
to take ~20 seconds, fixing a mistake by re-entering the trip correctly (with the right backdated date
and stop sequence) is not meaningfully worse than a dedicated edit flow, and it removes an entire class
of design complexity (see "Correction events" below — this is why `trip_leg_undone` doesn't exist).

## Date-only backdating

Logging is retroactive by design (see edge case 3), and a ride can be logged on a later day than it
happened. Rather than a full date+time picker, the user optionally picks **a date only** (default:
today); there is no time-of-day input anywhere in the flow. `occurred_at` is constructed by the app as
*(the picked date) + (the actual current time-of-day at the moment of logging)* — still a real,
comparable timestamp, so no schema/column type change was needed, but only the date component is ever
user-editable.

**All events in one atomic commit share a single `occurred_at` value.** Batch logging means the app
never actually knows real per-leg times anyway (a leg's position in the trip is already captured by
`sequence`, not by timestamp), so giving each leg a slightly-different synthetic time would imply false
precision rather than add real information.

## Trip-grain events

One row per trip-level fact. `trip_started`/`trip_ended` are always written as part of an atomic
"Log Trip" commit — see "Commit model" above. `trip_deleted` is the one event that can happen later,
against an already-committed trip.

| event_type | payload | grain |
|---|---|---|
| `trip_started` | `{ trip_id, origin_station_id }` | Once per trip, written as part of the commit bundle. |
| `trip_ended` | `{ trip_id, destination_station_id }` | Once per trip, written as part of the commit bundle. |
| `trip_deleted` | `{ trip_id, reason }` | Once per trip, whenever a user deletes an already-logged trip from their history. The *only* post-commit domain event — there is no partial correction, only full deletion (see "Commit model"). |

## Leg-grain events

One row per continuous ride. A trip has one or more legs.

| event_type | payload | grain |
|---|---|---|
| `leg_boarded` | `{ trip_id, leg_id, station_id, route_id, direction_id }` | Once per leg, on boarding. |
| `leg_alighted` | `{ trip_id, leg_id, station_id }` | Once per leg, on alighting. |

**Transfers are not a separate event type.** A transfer is the pattern `leg_alighted` → `leg_boarded`
at the same `station_id`, same `trip_id`, with no `trip_ended` in between — computed downstream in the
`stg_transfers` dbt model. This is a deliberate decision, not an oversight: the two leg events already
carry every fact a `transfer_made` event would, so a third event type would just be redundant state
that has to stay in sync with the two it's derived from.

## Correction events

There are none. `trip_leg_undone` — an earlier design for partial, post-commit correction via an
edit-mode "pencil icon" — was removed once edit mode itself was cut (see "Commit model" above). The
only way to correct a committed trip is `trip_deleted` (full removal) followed by re-logging it
correctly through the normal draft flow. `trip_deleted` deletes the trip's `trips` row and all its
`legs` rows from the projection — consistent with how deletion was already handled everywhere else in
this design (e.g. `trip_started`/`leg_boarded` undo, back when undo existed, also deleted rather than
flagged-and-kept). This doesn't compromise the append-only guarantee on `events` — that guarantee only
ever applied to the log itself; `trip_deleted` is permanently recorded there even though the projection
rows it deletes are gone.

## Draft-session events (product domain)

Captures everything that happens while building a trip in the log-trip screen, before commit — this is
where drafting friction (undos, abandonment) becomes measurable, without touching the trip domain.

| event_type | payload | grain |
|---|---|---|
| `trip_draft_started` | `{ draft_id }` | Once per drafting session — screen opened. |
| `draft_leg_added` | `{ draft_id, sequence, route_id, direction_id, entry_station_id }` | Once per leg added to the draft. |
| `draft_leg_removed` | `{ draft_id, sequence }` | Once per leg removed from the draft — the undo-count signal. |
| `trip_draft_committed` | `{ draft_id, trip_id }` | Fired at the "Log Trip" tap, alongside (same transaction as) the trip-domain bundle it produces. Bridges `draft_id` to the `trip_id` it became, for downstream questions like "did sessions with more undos still convert." |
| `trip_draft_abandoned` | `{ draft_id }` | Terminal event when the user backs out without committing. Undo/edit counts for the session aren't duplicated here — derivable downstream by grouping on `draft_id`. |

`draft_id` (client-generated UUID) lives in `payload`, not as a real column, even on
`trip_draft_committed` where it's paired with a real `trip_id` — kept consistent with every other
product event (`trip_id`/`leg_id` columns stay `NULL` for `event_domain = 'product'`, no exceptions).
Linking a draft session to the trip it produced is a downstream analytics join done once in dbt, not a
repeated on-device query, so it doesn't need the same real-column treatment `trip_id` gets on
trip-domain rows.

**Fixing an earlier leg mid-draft (going "back"):** no direct in-place edit. Tapping back to fix leg N
removes every leg *from N onward* — each firing its own `draft_leg_removed` — then the user re-enters
leg N and whatever came after it via `draft_leg_added` again. Chosen over true in-place editing with
auto-recomputed downstream legs because a later leg's entry station is the prior leg's exit station;
editing leg N in place without touching later legs would leave a dangling, inconsistent transfer point.
Pop-and-redo sidesteps that by construction — no cascading-consistency logic needed, and it reuses
events that already exist rather than adding new ones. No new event type was needed for this.

## Product events (app usage)

Deliberately minimal for v1 — extend as real usage questions come up rather than pre-building a full
taxonomy for screens that don't exist yet.

| event_type | payload | grain |
|---|---|---|
| `screen_viewed` | `{ screen_name, source_screen }` | Once per screen entry. `source_screen` nullable, supports nav-path analysis. |
| `station_detail_opened` | `{ station_id }` | Once per open. |
| `route_detail_opened` | `{ route_id }` | Once per open. |
| `feature_used` | `{ feature_name }` | Catch-all for taps not otherwise covered. Cheap to add specific events later; this just prevents blocking on taxonomy completeness before shipping. |

## Naming convention

`snake_case`, `<subject>_<past-tense-verb>` for domain events (`trip_started`, `leg_boarded`,
`trip_deleted`); `<object>_<past-tense-verb>` for product events (`screen_viewed`,
`station_detail_opened`, `draft_leg_removed`). Always past tense — every row is a fact about something
that already happened, never an instruction.

## Edge cases — stated as deliberate decisions

1. **Trip abandoned mid-draft, never logged.** No longer a trip-domain concern — under atomic commit,
   nothing is written to `events` at trip grain until "Log Trip" is tapped, so there's no half-formed
   domain trip that can be left hanging. Handled entirely at the product layer instead:
   `trip_draft_abandoned` fires when the user backs out of the screen without committing, and whatever
   `draft_leg_added`/`draft_leg_removed` events preceded it are already a complete record of what was
   attempted. (This replaces an earlier v0 idea, `trip_auto_closed`, which assumed trip-domain events
   could commit incrementally — no longer true.)

2. **Duplicate transfer tap.** Two failure modes, two different fixes:
   - *Sync retry re-sending the same logical event* — handled for free by `event_id` as idempotency
     key; upsert on primary key makes retries a no-op.
   - *Genuine accidental double-tap* (two distinct `event_id`s, milliseconds apart) — a UX problem,
     not a schema problem. Fixed with optimistic UI + disabling the tap target after first press, not
     with dedup logic in the data layer. Worth naming so it isn't silently "solved" by a schema hack
     that would also suppress legitimate fast re-boardings.

3. **Retroactive logging is the norm, not an edge case.** The app is designed for quick, after-the-fact
   logging — someone taps through a whole ride once they're off, possibly on a later day (see
   "Date-only backdating"). What's worth actually detecting is a future-dated `occurred_at` (a genuine
   bug or clock problem) — enforced with a simple `CHECK` at the schema level, not a dbt heuristic,
   since it's now a clean binary check rather than a fuzzy "is this gap implausible" judgment call.

## Deliberate exclusions (v1)

- No `transfer_made` event (see above) — derived, not stored.
- No edit mode, no partial post-commit correction — `trip_deleted` + re-logging covers the real use
  case at this app's speed/volume, and removes an entire category of cascading-consistency logic.
- No time-of-day input, anywhere — only date-level backdating. Per-leg real timestamps were never
  something batch logging could honestly provide.
- Product event taxonomy intentionally thin — grows with actual UI, not ahead of it.

## Not yet decided — follow-up work

Resolved since this doc was first written: exact `CHECK` constraints for domain/grain consistency (now
in `schema.sql`), the `sync_status` outbox table shape, the trip-vs-draft atomic commit model, edit mode
removed entirely (`trip_leg_undone` retired, replaced by `trip_deleted`), date-only backdating, the
`status` columns on `trips`/`legs` (removed — see `schema.sql`), and the sync conflict-resolution
policy (see "Sync policy" above — checklist item 6).

**Deferred from earlier in this design pass, still real:**
- `device_to_user` mapping table shape, for when auth ships.
- Supabase RLS policy design keyed on `device_id` (and later `user_id`).
- Index/clustering plan for the shared Supabase and BigQuery tables now that this is confirmed
  multi-tenant (e.g. composite index on `device_id, trip_id`, BigQuery clustering on `device_id`).
- Data dictionary / ERD tying event log → operational tables → warehouse marts together visually
  (checklist item 9 — genuinely separate task from the schema itself).

**Not urgent, just don't want it lost — later phases per PROJECT.md's order of operations:**
- dbt staging → intermediate → mart structure with tests (checklist item 7).
- CI running pipeline tests on every change (checklist item 8).
- Station tap → station info view, trip-logging UI, Supabase wiring, the EL job.
- Achievements/quests — a static quest-definitions table joined against committed trip history
  downstream; no new event types or schema changes needed, confirmed out of scope for this pass.
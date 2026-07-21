# SubwayQuest — Achievements/Quests: what's decided, what's not

Parking doc, not a design doc — consolidates what's already settled elsewhere (mostly
data-layer.md's "Quest-definitions, single source of truth" and status.md's Achievements section)
plus what's genuinely still open. Written to make picking this up later fast, not to make any new
decisions now.

## Already decided (see data-layer.md for full reasoning)

- **`network/processed/quests.json` is the single canonical source** — same bundling pattern as
  `stations.json`/`route_stops.json`/`transfers.json`. The in-app Achievements screen imports it
  directly via `subwayData.ts`'s existing mechanism.
- **The dbt/BigQuery side never gets an independently-authored copy.** A new
  `network/scripts/build_quest_seed.py` (parallel to `build_static_data.py`) reads `quests.json` and
  generates `dbt/seeds/quest_definitions.csv` — a build artifact, never hand-edited. Run manually
  whenever quest content changes, same pattern as `mobile/scripts/sync-data.js`.
- **No new event types or schema changes needed.** Quest completion is a downstream join against
  already-existing trip history (`int_trips`/`int_legs`), not something requiring new
  instrumentation.
- **Two real consumers with different requirements:** the in-app screen (per-device join against
  local trip history) and the BigQuery mart's "% of users completing each quest" stat (cross-user
  aggregate, subject to min-N suppression like everything else in that section).

## Not yet decided — the actual work still ahead

- **Quest content itself.** What are the actual quests? (e.g. "ride every branch of the A train,"
  "visit 50 stations in Brooklyn") — real product/game design, not a technical decision. Nothing
  downstream can be built until this exists in some form.
- **`quests.json`'s shape.** What does a quest definition actually need as fields? At minimum
  something like: quest id, name, description, and a *machine-checkable completion criterion* —
  this last part is the real design problem, since criteria will vary a lot in shape ("visited N
  distinct stations in borough X" vs. "rode every branch of route Y" vs. "logged a trip on N
  different lines") and whatever schema `quests.json` uses has to be expressive enough to cover
  whichever quests actually get designed, in both places that read it — the in-app join and dbt's
  seed/mart join — without needing two different interpretation logics.
- **The BigQuery-side join logic itself.** Once `quest_definitions.csv` exists as a seed, something
  has to actually evaluate "has this user completed this quest" against `int_trips`/`int_legs` —
  not yet designed, and its shape depends entirely on how expressive the completion-criteria schema
  above ends up being.
- **In-app join logic** — same completion-evaluation problem, mirrored client-side against local
  SQLite. Two implementations of the same logic (mirroring the trips/legs precedent — one
  local, one in the mart), so whatever criteria shape gets picked needs to be evaluable both ways.

## Blocked on this

- `dashboard-spec.md`'s "% of users completing each quest" metric (Exploration & mission section)
- `ui-spec.md`'s Achievements page (mobile UI — not built, `status.md` milestone 9)
- `status.md`'s milestone 8, in full
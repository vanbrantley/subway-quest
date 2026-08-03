# SubwayQuest — Quest Component Integration (for milestone 9)

`StationQuestsList` and `ProfileQuestsSummary` (`mobile/components/quests/`) are fully built and
tested — verified against real data via the temporary `app/debug-quest-components.tsx` route — but
were never mounted anywhere real, since milestone 8 built them before the Station and Profile pages
they belong on existed. This doc is the literal, exact insertion instructions for wiring them in —
no logic decisions left, just placement.

## `StationQuestsList` → canonical Station page

**Target:** `app/station/[stationId].tsx` (per `ui-spec.md`'s proposed route — root-level, shared,
reached from the map, search results, and a line's station list).

```tsx
import { StationQuestsList } from '../../components/quests/StationQuestsList';
import { getComplexId } from '../../lib/subwayData';

// ...inside the Station page component, wherever station detail sections go:
<StationQuestsList complexId={Number(getComplexId(stationId))} />
```

**Why `getComplexId`:** the component takes a `complexId: number` prop, not the raw `stationId`
(GTFS stop_id) the route param carries — `getComplexId()` is the existing lookup in
`subwayData.ts`, already used elsewhere in the app for exactly this stop_id → complex_id
translation. Don't build a second lookup; this one already exists and is already correct.

**Placement on the page:** anywhere in the station detail layout makes sense — the component
renders nothing at all (`null`) if the station isn't part of any quest, so it's safe to place
unconditionally near the top of the page without needing a surrounding `{quests.length > 0 && ...}`
check at the call site; that check already lives inside the component itself.

## `ProfileQuestsSummary` → Profile tab

**Target:** `app/(tabs)/profile/index.tsx` — replacing the temporary "Open Achievements (temp)" /
"Open Debug Dump" scaffolding buttons, not sitting alongside them. Those two buttons should be
removed as part of this same change — they were always scaffolding for testing before this real
integration existed (see `status.md`'s "Dev-only debug tooling" section for the equivalent
convention already used elsewhere).

```tsx
import { ProfileQuestsSummary } from '../../../components/quests/ProfileQuestsSummary';

// ...inside the Profile page, in the "Achievements summary" section per ui-spec.md's Profile tab spec:
<ProfileQuestsSummary />
```

No props needed — it's self-contained, and its own `onPress` already navigates to
`/profile/achievements` (the existing, already-built achievements list page — no wiring needed
there, it already exists and already works).

## Cleanup, once both are mounted for real

- [ ] Remove the temporary "Open Achievements (temp)" button from `profile/index.tsx`
- [ ] Remove the temporary "Open Debug Dump" button reference to `debug-quest-components.tsx`
      (the underlying `/debug` screen itself, for raw event dumps, stays — only the
      quest-component-specific temp route goes)
- [ ] Delete `app/debug-quest-components.tsx` entirely — its whole purpose was verifying these two
      components before a real place existed to mount them; once mounted for real, it's redundant
- [ ] Confirm no doubled-up navigator header — `StationQuestsList`'s host page and
      `ProfileQuestsSummary`'s host page both need to be checked once `(tabs)/_layout.tsx`/
      `profile/_layout.tsx`'s real header behavior is known (this was an open item already flagged
      in `milestone-8-achievements.md` for `achievements/index.tsx` and `[questId].tsx` — same
      concern applies here, worth checking once, not per-page)

## One thing NOT to do

Don't have the Station or Profile pages re-implement any part of "what quests apply here" or
"what's the user's progress" themselves. Both components already own that entirely, via
`quests.ts`'s `getQuestsForStation`/`getAllQuestProgress`. The pages' only job is mounting the
component with the right prop (or no prop, for `ProfileQuestsSummary`) — same "one place owns this"
principle as everywhere else in this project's data layer.
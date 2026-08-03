"""
Resolves network/quests_source.json (hand-authored quest content) into
network/processed/quests.json -- the single flat file both build_quest_seed.py
(-> dbt seed) and the mobile app's bundled quests.json trace back to.

Most of quests_source.json is literal data (hardcoded station/route ids,
per-trip criteria, counting criteria) and passes through unchanged -- it's
either already concrete or evaluated live at runtime by the app/dbt, never
precomputed here.

Real resolver logic lives in five places:
  1. group_ref "boroughs"                    -- group stations by their own
                                                 borough field
  2. group_ref "same_name_station_clusters"   -- group stations by exact name,
                                                 minus an explicit exclude list,
                                                 keep groups with 2+ members
  3. group_ref "manhattan_neighborhoods"      -- reads final_neighborhoods.json;
                                                 skips (doesn't crash, doesn't
                                                 guess) if that file isn't there
                                                 yet
  4. line_completion auto-generation          -- one quest per real route,
                                                 generated fresh every run, never
                                                 hand-authored in the source file
  5. branching_out auto-generation            -- one quest per route with 2+
                                                 real branches, using the same
                                                 branch data mobile/lib/
                                                 subwayData.ts's branchesForRoute()
                                                 reads (route_stops.json). Each
                                                 branch's raw station list is its
                                                 FULL span, so this computes the
                                                 true divergent tail per branch
                                                 (excluding shared trunk stations)
                                                 rather than using it directly --
                                                 see resolve_route_branches().

IMPORTANT identifier-space note: every station reference in quests_source.json
and in this script's output is a complex_id (e.g. 611 for Times Sq), not a
GTFS stop_id. Legs actually store stop_id (per dbt-coverage.md's
station_coordinates seed). Both the mobile quests.ts evaluator and the dbt
mart MUST translate a leg's stop_id -> complex_id (via the bundled
stations.json) before checking any quest's station-set membership, or nothing
will ever match.

Every quest in the output also carries a "source" field
("hand_authored" or "auto_generated") -- stamped here, at the exact point
each quest is created, not re-inferred later from its quest_id's naming
pattern (build_quest_seed.py used to guess this from a prefix match, which
was fragile; now it just reads what this script already knows for certain).
Used by the achievements dashboard to show hand-authored quests individually
while collapsing the ~35 auto-generated line_completion_*/branching_out_*
quests into a single count instead.
"""

import json
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path(__file__).resolve().parent.parent  # network/

SOURCE_PATH = BASE_DIR / "quests_source.json"
STATIONS_PATH = BASE_DIR / "processed" / "stations.json"
ROUTE_STOPS_PATH = BASE_DIR / "processed" / "route_stops.json"
NEIGHBORHOODS_PATH = BASE_DIR / "processed" / "final_neighborhoods.json"
OUTPUT_PATH = BASE_DIR / "processed" / "quests.json"


def load_json(path):
    with open(path) as f:
        return json.load(f)


def dedupe_by_complex(stations):
    """stations.json is keyed by stop_id (R01, 101, ...), many-to-one against a
    physical complex_id -- e.g. Canal St's R/W, N/Q, and 6 stop_ids all share
    one complex_id. Every grouping operation below (boroughs, same-name
    clusters) needs one entry per physical place, not per line-serving-that-
    place, or a station served by 3 lines would silently count 3x."""
    complexes = {}
    for s in stations.values():
        cid = s["complex_id"]
        if cid not in complexes:
            complexes[cid] = s
    return complexes


def real_routes(route_stops):
    """Every real, displayable route_id -- the keys of route_stops.json.
    NOTE: currently includes the placeholder 'S' route_id, not the real
    FS/GS/H shuttle routes -- shuttle grouping hasn't shipped yet (see
    status.md). Quests depending on the real shuttle split (s_tier) stay
    blocked until that ships; this function just reflects today's data."""
    return sorted(route_stops.keys())


def resolve_line_completion_quests(route_stops, stations):
    """Auto-generates one 'ride every stop on line X' quest per real route.
    Deliberately not hand-authored in quests_source.json -- regenerated every
    run so it can never drift from the real route list.

    route_stops.json has no flat per-route station list -- it's nested by
    direction and branch (confirmed against mobile/lib/subwayData.ts, same
    shape resolve_route_branches() reads). A route's 'every station' set is
    the union of every branch's stations via branches_for_route(), deduped
    and translated to complex_id -- not a direct pass-through of stop_ids.

    REAL BUG FIXED (found via on-device testing): this used to emit
    'all_stations' criteria (bare station-visited, route-agnostic). A shared
    transfer complex like Atlantic Av-Barclays Ctr (complex 617, served by
    B/D/N/Q/2/3/4/5 all at once) was giving credit toward EVERY line sharing
    that platform just from visiting it via any one of them -- 'all_stations'
    only checks whether the physical place was ever visited, with zero
    awareness of which route actually got you there. Line completion is
    inherently route-specific by definition. Fixed by pairing each required
    station with the specific route being completed via
    'all_station_route_pairs' -- the exact mechanism 'crossroads' (the Times
    Sq hub quest) already uses correctly; no new evaluator logic needed,
    just the right existing criteria type."""
    stop_to_complex = {stop_id: int(s["complex_id"]) for stop_id, s in stations.items()}
    quests = {}
    for route_id in route_stops:
        branches = branches_for_route(route_stops, route_id)
        all_stops = set()
        for b in branches:
            all_stops.update(b["stops"])
        complexes = sorted({stop_to_complex[s] for s in all_stops if s in stop_to_complex})
        if not complexes:
            continue
        quests[f"line_completion_{route_id}"] = {
            "title": f"{route_id} Completionist",
            "description": f"Visit every station on the {route_id} line.",
            "mechanism": "lifetime_set",
            "source": "auto_generated",
            "criteria": {
                "type": "all_station_route_pairs",
                "pairs": [{"station": cid, "route": route_id} for cid in complexes],
            },
        }
    return quests


def resolve_boroughs_group(complexes):
    """group_ref: 'boroughs' -- one group per real borough, straight off the
    existing borough field. No hand data needed."""
    groups = defaultdict(list)
    for cid, s in complexes.items():
        groups[s["borough"]].append(int(cid))
    return list(groups.values())


def resolve_same_name_clusters(complexes, exclude_names):
    """group_ref: 'same_name_station_clusters' -- group by exact station name,
    drop anything in exclude_names, keep only groups with 2+ remaining.
    exclude_names comes from the quest's own criteria in quests_source.json --
    a real, editable list, not a judgment call buried in a comment."""
    by_name = defaultdict(list)
    for cid, s in complexes.items():
        if s["name"] in exclude_names:
            continue
        by_name[s["name"]].append(int(cid))
    return [ids for ids in by_name.values() if len(ids) >= 2]


def resolve_manhattan_neighborhoods(path):
    """group_ref: 'manhattan_neighborhoods' -- reads final_neighborhoods.json.
    Returns None (not an empty list) if the file doesn't exist yet, so the
    caller can skip the quest loudly instead of silently shipping an
    empty/wrong one.

    REAL SHAPE (confirmed against the notebook's actual output): flat, keyed
    by complex_id, one row per station -- {"<complex_id>": {"name": ...,
    "borough": ..., "neighborhood": ..., "lat": ..., "lon": ...}, ...}. Same
    shape as complex_to_neighborhood.json, just with the finalized/tweaked
    neighborhood values from the notebook pass. Group by filtering to
    borough == "Manhattan" and clustering on the neighborhood field.
    """
    if not path.exists():
        return None
    data = load_json(path)
    groups = defaultdict(list)
    for cid, s in data.items():
        if s.get("borough") != "Manhattan":
            continue
        groups[s["neighborhood"]].append(int(cid))
    return list(groups.values())


def branches_for_route(route_stops, route_id):
    """Mirrors mobile/lib/subwayData.ts's branchesForRoute() exactly -- reads
    direction '0' only, same convention already used there for transfer and
    valid-exit-station logic. Keeping this identical (not re-derived a second
    way) is the point: one definition of 'what a branch is,' shared by the app
    and this resolver."""
    return route_stops.get(route_id, {}).get("0", [])


def resolve_route_branches(route_stops, stations):
    """A branch's raw 'stops' list (from mobile/lib/subwayData.ts's Branch
    type) is the FULL station list for that branch, start to end -- needed
    there for valid-exit checks. That means shared stations appear in
    multiple branches' lists. Using it as-is would make 'visit a station in
    every branch' trivially satisfiable by a single shared-station visit --
    defeats the quest entirely. Instead, compute each branch's true divergent
    tail: stations that appear in EXACTLY ONE branch's list.

    Deliberately NOT 'stations shared by every branch' (a simple full
    intersection) -- that only correctly handles a single-level fork. Some
    routes fork as a tree: the A train splits into Lefferts Blvd first, then
    the remaining trunk splits again at Broad Channel into Far Rockaway vs.
    Rockaway Park. The Aqueduct-Broad Channel segment is shared by exactly
    two of the three branches (Far Rockaway and Rockaway Park), not all
    three -- a full-intersection trunk wouldn't exclude it, and it would leak
    into both of those branches' tails as false 'unique' evidence. Excluding
    anything shared by 2+ branches (not just all of them) handles both simple
    and tree-shaped forks correctly.

    Returns: {route_id: [tail_group, tail_group, ...]} for every route with
    2+ real branches. Routes with 0 or 1 branch are omitted -- nothing to
    branch between.
    """
    stop_to_complex = {stop_id: int(s["complex_id"]) for stop_id, s in stations.items()}

    result = {}
    for route_id in route_stops:
        branches = branches_for_route(route_stops, route_id)
        if len(branches) < 2:
            continue  # not a branching route

        stop_lists = [b["stops"] for b in branches]

        occurrence_count = defaultdict(int)
        for stops in stop_lists:
            for stop in set(stops):  # set() so a repeated stop within one branch's own list isn't double-counted
                occurrence_count[stop] += 1

        tails = []
        for stops in stop_lists:
            tail_stops = [s for s in stops if occurrence_count[s] == 1]
            if not tail_stops:
                continue  # a branch with no exclusive stations shouldn't happen; guard anyway
            tail_complexes = sorted({stop_to_complex[s] for s in tail_stops if s in stop_to_complex})
            if tail_complexes:
                tails.append(tail_complexes)

        if len(tails) >= 2:
            result[route_id] = tails

    return result


def resolve_branching_out_quests(route_stops, stations):
    """Auto-generates one 'visit a station on every branch of route X' quest
    per route with 2+ real branches. Same pattern as line_completion --
    generated fresh every run, never hand-authored in quests_source.json."""
    branch_groups = resolve_route_branches(route_stops, stations)
    quests = {}
    for route_id, groups in branch_groups.items():
        quests[f"branching_out_{route_id}"] = {
            "title": f"{route_id} Branching Out",
            "description": f"Visit a station on every branch of the {route_id} line.",
            "mechanism": "lifetime_set",
            "source": "auto_generated",
            "criteria": {"type": "all_groups", "groups": groups},
        }
    return quests


def resolve_group_ref(group_ref, criteria, complexes):
    if group_ref == "boroughs":
        return resolve_boroughs_group(complexes)
    if group_ref == "same_name_station_clusters":
        return resolve_same_name_clusters(complexes, criteria.get("exclude_names", []))
    if group_ref == "manhattan_neighborhoods":
        return resolve_manhattan_neighborhoods(NEIGHBORHOODS_PATH)
    raise ValueError(
        f"Unknown group_ref: {group_ref!r} in quest criteria -- if this is "
        f"branching_out, it no longer belongs in quests_source.json at all; "
        f"it's auto-generated by resolve_branching_out_quests(), same as "
        f"line_completion. Remove the hand-authored entry."
    )


def resolve_quest(quest_id, quest, complexes, route_stops):
    """Resolves one quests_source.json entry into its final quests.json form.
    Returns None if the quest is blocked/skipped (missing data, not-yet-real
    routes, or an explicit manual block) -- caller is responsible for logging
    why."""
    if quest.get("blocked"):
        print(f"  [skipped] {quest_id} -- explicitly marked blocked in quests_source.json")
        return None

    criteria = quest["criteria"]
    ctype = criteria["type"]

    if ctype in ("all_groups", "min_count_groups"):
        groups = resolve_group_ref(criteria["group_ref"], criteria, complexes)
        if groups is None:
            print(f"  [skipped] {quest_id} -- {criteria['group_ref']} data not available yet")
            return None
        resolved = dict(quest)
        resolved["criteria"] = {k: v for k, v in criteria.items() if k != "group_ref"}
        resolved["criteria"]["groups"] = groups
        return resolved

    if ctype == "all_routes":
        routes_needed = criteria.get("routes")
        if routes_needed is None:
            # system-wide, dynamic -- no precomputation, just a sanity check
            if not real_routes(route_stops):
                raise RuntimeError("all_routes resolved against an empty route list")
            return dict(quest)
        # explicit list (e.g. s_tier's FS/GS/H) -- only resolve if every listed
        # route actually exists in the real route list today
        missing = [r for r in routes_needed if r not in real_routes(route_stops)]
        if missing:
            print(f"  [skipped] {quest_id} -- routes not yet real: {missing}")
            return None
        return dict(quest)

    # Everything else -- all_stations, min_count_stations,
    # all_station_route_pairs, leg_count_min, full_line_ride,
    # route_letters_spell_word, geographic_endpoints, ride_count_route,
    # transfer_count -- is literal data or a runtime check. Pass through
    # unchanged; nothing to resolve.
    return dict(quest)


def main():
    source = load_json(SOURCE_PATH)
    stations = load_json(STATIONS_PATH)
    route_stops = load_json(ROUTE_STOPS_PATH)
    complexes = dedupe_by_complex(stations)

    resolved = {}
    skipped = []

    for quest_id, raw_quest in source.items():
        quest = {k: v for k, v in raw_quest.items() if k != "_note"}  # strip authoring notes
        result = resolve_quest(quest_id, quest, complexes, route_stops)
        if result is None:
            skipped.append(quest_id)
            continue
        result["source"] = "hand_authored"  # every quest reaching here came from
        # quests_source.json -- stamped once, centrally, rather than touching every
        # return branch inside resolve_quest() individually
        resolved[quest_id] = result

    # Auto-generate line_completion and branching_out quests -- never
    # hand-authored, always regenerated fresh so they can't drift from the
    # real route/branch data
    resolved.update(resolve_line_completion_quests(route_stops, stations))
    resolved.update(resolve_branching_out_quests(route_stops, stations))

    with open(OUTPUT_PATH, "w") as f:
        json.dump(resolved, f, indent=2)

    print(f"\nResolved {len(resolved)} quests -> {OUTPUT_PATH}")
    if skipped:
        print(f"Skipped/blocked (see messages above): {', '.join(skipped)}")


if __name__ == "__main__":
    main()
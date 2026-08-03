"""
Validates network/processed/quests.json against real stations.json / route_stops.json.

Run after every build_quests.py run, same "required test" pattern as
mobile/db/rehydrate_tests.ts and mobile/db/schema_tests.py -- catches data-layer
bugs (bad complex_id references, malformed criteria, resolver leftovers) before
they get built on top of by quests.ts or dbt.

Exits 0 if every check passes, 1 otherwise -- safe to wire into CI later
alongside the pipeline's existing dbt test step.
"""

import json
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # network/

QUESTS_PATH = BASE_DIR / "processed" / "quests.json"
STATIONS_PATH = BASE_DIR / "processed" / "stations.json"
ROUTE_STOPS_PATH = BASE_DIR / "processed" / "route_stops.json"

VALID_MECHANISMS = {"lifetime_set", "per_trip", "counting"}

VALID_CRITERIA_TYPES = {
    "lifetime_set": {
        "all_stations", "min_count_stations", "all_groups", "min_count_groups",
        "all_station_route_pairs", "all_routes",
    },
    "per_trip": {
        "leg_count_min", "full_line_ride", "route_letters_spell_word",
        "geographic_endpoints",
    },
    "counting": {"ride_count_route", "transfer_count"},
}

# NYC subway line letters that actually exist as route_ids -- used to sanity-check
# route_letters_spell_word without needing route_stops.json loaded for that check
# specifically (kept here as a hardcoded fallback in case route_stops.json is
# ever unavailable when this runs standalone).
KNOWN_LETTER_ROUTES = set("ABCDEFGJLMNQRSWZ")


def load_json(path):
    with open(path) as f:
        return json.load(f)


def main():
    errors = []
    warnings = []
    checks_run = 0

    def check(condition, message):
        nonlocal checks_run
        checks_run += 1
        if not condition:
            errors.append(message)

    def warn(condition, message):
        if not condition:
            warnings.append(message)

    # --- load everything up front; a missing/malformed file is itself a failure ---
    try:
        quests = load_json(QUESTS_PATH)
    except Exception as e:
        print(f"FATAL: couldn't load {QUESTS_PATH}: {e}")
        sys.exit(1)

    try:
        stations = load_json(STATIONS_PATH)
    except Exception as e:
        print(f"FATAL: couldn't load {STATIONS_PATH}: {e}")
        sys.exit(1)

    try:
        route_stops = load_json(ROUTE_STOPS_PATH)
    except Exception as e:
        print(f"FATAL: couldn't load {ROUTE_STOPS_PATH}: {e}")
        sys.exit(1)

    valid_complex_ids = {int(s["complex_id"]) for s in stations.values()}
    valid_route_ids = set(route_stops.keys())

    # routes_at_complex is deliberately derived from route_stops.json, not
    # stations.json's daytime_routes field. daytime_routes still lists the
    # shuttle stops as "S" rather than the real FS/GS/H route_ids -- the same
    # shuttle-grouping gap status.md already tracks -- so it would produce
    # false positives here. route_stops.json is the authoritative source for
    # "which routes actually serve this complex" and correctly distinguishes
    # the real shuttle routes.
    routes_at_complex = {}
    for route_id, directions in route_stops.items():
        for branches in directions.values():
            for branch in branches:
                for stop_id in branch["stops"]:
                    s = stations.get(stop_id)
                    if s:
                        cid = int(s["complex_id"])
                        routes_at_complex.setdefault(cid, set()).add(route_id)

    check(len(quests) > 0, "quests.json is empty")

    # --- per-quest structural checks ---
    for quest_id, quest in quests.items():
        prefix = f"[{quest_id}]"

        for field in ("title", "description", "mechanism", "criteria"):
            check(field in quest, f"{prefix} missing required field '{field}'")

        check("source" in quest,
              f"{prefix} missing 'source' field -- build_quests.py must stamp "
              f"'hand_authored' or 'auto_generated' on every quest, or the "
              f"dashboard's hand-authored/auto-generated split silently breaks")
        if "source" in quest:
            check(quest["source"] in ("hand_authored", "auto_generated"),
                  f"{prefix} has invalid source {quest['source']!r} -- must be "
                  f"'hand_authored' or 'auto_generated'")

        if "mechanism" not in quest or "criteria" not in quest:
            continue  # can't check criteria shape without these

        mechanism = quest["mechanism"]
        criteria = quest["criteria"]

        check(mechanism in VALID_MECHANISMS,
              f"{prefix} unknown mechanism '{mechanism}'")

        ctype = criteria.get("type")
        check(ctype is not None, f"{prefix} criteria missing 'type'")
        if mechanism in VALID_CRITERIA_TYPES and ctype is not None:
            check(ctype in VALID_CRITERIA_TYPES[mechanism],
                  f"{prefix} criteria type '{ctype}' doesn't belong under mechanism '{mechanism}'")

        # resolver leftovers -- these should never survive into the final output
        check("group_ref" not in criteria,
              f"{prefix} still has an unresolved group_ref: {criteria.get('group_ref')!r}")
        check("_note" not in quest,
              f"{prefix} still has a _note field -- strip before shipping")

        if ctype is None:
            continue

        # --- type-specific checks ---
        if ctype == "all_stations":
            stns = criteria.get("stations", [])
            check(len(stns) > 0, f"{prefix} all_stations has an empty station list")
            for cid in stns:
                check(cid in valid_complex_ids,
                      f"{prefix} references unknown complex_id {cid}")

        elif ctype == "min_count_stations":
            stns = criteria.get("stations", [])
            count = criteria.get("count")
            check(len(stns) > 0, f"{prefix} min_count_stations has an empty station list")
            check(isinstance(count, int) and count > 0,
                  f"{prefix} min_count_stations count must be a positive int, got {count!r}")
            if isinstance(count, int):
                check(count <= len(stns),
                      f"{prefix} count ({count}) exceeds the number of candidate stations ({len(stns)}) -- unwinnable")
            for cid in stns:
                check(cid in valid_complex_ids,
                      f"{prefix} references unknown complex_id {cid}")

        elif ctype in ("all_groups", "min_count_groups"):
            groups = criteria.get("groups", [])
            check(len(groups) > 0, f"{prefix} has no groups")
            seen_across_groups = set()
            overlap_found = False
            for i, group in enumerate(groups):
                check(len(group) > 0, f"{prefix} group {i} is empty")
                for cid in group:
                    check(cid in valid_complex_ids,
                          f"{prefix} group {i} references unknown complex_id {cid}")
                    if cid in seen_across_groups:
                        overlap_found = True
                    seen_across_groups.add(cid)
            warn(not overlap_found,
                 f"{prefix} the same complex_id appears in more than one group -- "
                 f"expected for boroughs/same-name (a station can't be in 2 boroughs, "
                 f"so this would be a real bug there), but if this is branching_out, "
                 f"it means trunk stations leaked into a tail group")
            if ctype == "min_count_groups":
                count = criteria.get("count")
                check(isinstance(count, int) and count > 0,
                      f"{prefix} min_count_groups count must be a positive int, got {count!r}")
                if isinstance(count, int):
                    check(count <= len(groups),
                          f"{prefix} count ({count}) exceeds the number of groups ({len(groups)}) -- unwinnable")

        elif ctype == "all_station_route_pairs":
            pairs = criteria.get("pairs", [])
            check(len(pairs) > 0, f"{prefix} has no pairs")
            for pair in pairs:
                cid, route = pair.get("station"), pair.get("route")
                check(cid in valid_complex_ids,
                      f"{prefix} pair references unknown complex_id {cid}")
                check(route in valid_route_ids,
                      f"{prefix} pair references unknown route '{route}'")
                if cid in valid_complex_ids and route in valid_route_ids:
                    check(route in routes_at_complex.get(cid, set()),
                          f"{prefix} claims route '{route}' serves complex {cid}, "
                          f"but stations.json says it doesn't")

        elif ctype == "all_routes":
            routes = criteria.get("routes")
            if routes is not None:
                for r in routes:
                    check(r in valid_route_ids,
                          f"{prefix} references route '{r}' that isn't real yet")

        elif ctype == "leg_count_min":
            count = criteria.get("count")
            check(isinstance(count, int) and count > 0,
                  f"{prefix} leg_count_min count must be a positive int, got {count!r}")

        elif ctype == "full_line_ride":
            route = criteria.get("route")
            check(route == "any" or route in valid_route_ids,
                  f"{prefix} full_line_ride route '{route}' is neither 'any' nor a real route")

        elif ctype == "route_letters_spell_word":
            word = criteria.get("word", "")
            check(len(word) > 0, f"{prefix} route_letters_spell_word has an empty word")
            for letter in word:
                check(letter in valid_route_ids or letter in KNOWN_LETTER_ROUTES,
                      f"{prefix} word '{word}' contains '{letter}', which isn't a real route_id")

        elif ctype == "geographic_endpoints":
            start, end = criteria.get("start"), criteria.get("end")
            check(start in valid_complex_ids, f"{prefix} start complex_id {start} doesn't exist")
            check(end in valid_complex_ids, f"{prefix} end complex_id {end} doesn't exist")
            check(start != end, f"{prefix} start and end are the same station ({start})")

        elif ctype == "ride_count_route":
            route = criteria.get("route")
            count = criteria.get("count")
            check(route == "any" or route in valid_route_ids,
                  f"{prefix} ride_count_route route '{route}' is neither 'any' nor a real route")
            check(isinstance(count, int) and count > 0,
                  f"{prefix} ride_count_route count must be a positive int, got {count!r}")

        elif ctype == "transfer_count":
            count = criteria.get("count")
            check(isinstance(count, int) and count > 0,
                  f"{prefix} transfer_count count must be a positive int, got {count!r}")

    # --- whole-file sanity checks ---
    line_completion_ids = {qid for qid in quests if qid.startswith("line_completion_")}
    branching_out_ids = {qid for qid in quests if qid.startswith("branching_out_")}
    covered_routes = {qid.removeprefix("line_completion_") for qid in line_completion_ids}
    missing_routes = valid_route_ids - covered_routes
    check(not missing_routes,
          f"missing line_completion quests for real route(s): {sorted(missing_routes)} "
          f"-- every real route should resolve to at least one station")

    # REGRESSION CHECK for a real bug found on-device: line_completion quests
    # must be route-SPECIFIC (all_station_route_pairs), never route-agnostic
    # (all_stations). all_stations only checks "was this physical place ever
    # visited," with zero awareness of which route got you there -- at a
    # shared multi-line transfer complex (e.g. Atlantic Av-Barclays Ctr,
    # served by B/D/N/Q/2/3/4/5 all at once), that gives false completion
    # credit toward every line sharing the platform, not just the one
    # actually ridden. This check would have caught that regression directly.
    for qid in line_completion_ids:
        quest = quests[qid]
        expected_route = qid.removeprefix("line_completion_")
        check(quest["criteria"]["type"] == "all_station_route_pairs",
              f"{qid} uses '{quest['criteria']['type']}' criteria -- must be "
              f"'all_station_route_pairs' (route-specific), or it will give false "
              f"credit at any station shared with another line")
        if quest["criteria"]["type"] == "all_station_route_pairs":
            wrong_route = [p for p in quest["criteria"]["pairs"] if p["route"] != expected_route]
            check(not wrong_route,
                  f"{qid} has pair(s) referencing a route other than '{expected_route}': {wrong_route}")

    warn(len(branching_out_ids) > 0,
         "no branching_out quests were generated at all -- expected at least one "
         "(the A train's 3-way fork is a known real branch)")

    check("s_tier" not in quests,
          "s_tier resolved even though shuttle grouping hasn't shipped -- "
          "either that's landed and this check is stale, or something's wrong")

    # --- report ---
    print(f"Ran {checks_run} checks against {len(quests)} quests.\n")

    if warnings:
        print(f"{len(warnings)} warning(s) (not failures, worth a look):")
        for w in warnings:
            print(f"  ! {w}")
        print()

    if errors:
        print(f"{len(errors)} FAILURE(S):")
        for e in errors:
            print(f"  x {e}")
        sys.exit(1)

    print("All checks passed.")
    sys.exit(0)


if __name__ == "__main__":
    main()
"""
Resolves network/processed/quests.json into dbt/seeds/quest_definitions.csv --
same two-stage "never hand-duplicated, always regenerated" pattern as
build_quests.py itself. Run this after build_quests.py, as the last step
before `dbt seed`.

One row per quest: quest_id, title, description, mechanism, criteria_json, source.
criteria_json is the quest's full criteria object, serialized as JSON --
mirrors exactly what quests_logic.ts's evaluators read on the mobile side,
so the dbt intermediate models can parse the same underlying shape via
BigQuery's native JSON functions (JSON_VALUE, JSON_QUERY_ARRAY, etc.) rather
than a second, normalized-relational representation that would have to be
kept in sync by hand -- same reasoning as everything else in this pipeline.

source ('hand_authored' or 'auto_generated') is read directly from each
quest object -- build_quests.py stamps it at the exact point every quest is
created, which is the only place that can know this for certain. This script
used to re-infer it here instead, by pattern-matching quest_id against
'line_completion_'/'branching_out_' prefixes -- fragile (a hand-authored
quest with a colliding prefix would've been silently mislabeled) and a
duplicated fact besides. Fixed to just read what's already known.
"""

import csv
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # network/
QUESTS_PATH = BASE_DIR / "processed" / "quests.json"
OUTPUT_PATH = BASE_DIR.parent / "dbt" / "seeds" / "quest_definitions.csv"


def main():
    with open(QUESTS_PATH) as f:
        quests = json.load(f)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["quest_id", "title", "description", "mechanism", "criteria_json", "source"])
        for quest_id, quest in sorted(quests.items()):
            writer.writerow([
                quest_id,
                quest["title"],
                quest["description"],
                quest["mechanism"],
                json.dumps(quest["criteria"]),
                quest["source"],
            ])

    print(f"Wrote {len(quests)} quest definitions -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
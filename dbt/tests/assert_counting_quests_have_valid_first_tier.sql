-- Custom test, dbt convention: a SELECT that should return zero rows if the
-- invariant holds. Every counting-mechanism quest's criteria_json.tiers must
-- parse into at least one valid tier -- int_quest_completion_counting's
-- first_tier is min(tiers), and every completed comparison there is
-- `count >= first_tier`. If tiers is ever empty/malformed and first_tier
-- comes back NULL, every one of those comparisons silently evaluates to
-- NULL -> coalesced to false, which would make a broken quest look like
-- "nobody has completed this" forever instead of erroring loudly.
-- validate_quests.py already enforces this shape at the source, but this
-- test catches it independently, the same "mirror -- not trust -- the
-- upstream check" reasoning int_quest_completion_counting itself follows
-- relative to quests_logic.ts's evaluator.

select quest_id
from {{ ref('quest_definitions') }}
where mechanism = 'counting'
  and (select min(cast(t as int64)) from unnest(json_value_array(criteria_json, '$.tiers')) as t) is null

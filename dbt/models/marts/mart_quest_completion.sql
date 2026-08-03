-- mart_quest_completion.sql
-- Raw completion count per quest, not a percentage -- decided in
-- dashboard-spec.md: "raw count chosen over percentage... with a small real
-- user base, '60% completed this quest' reads as inflated significance when
-- the denominator is 5 people." segment_user_count equals completion_count
-- here, unlike mart_station_stats (where visit_count and segment_user_count
-- can differ) -- for quest completion, "how many people completed this" IS
-- both the metric and the privacy-relevant count, so the two coincide by
-- construction, not by coincidence.

with all_completions as (

    select quest_id, user_id, completed from {{ ref('int_quest_completion_lifetime_set') }}
    union all
    select quest_id, user_id, completed from {{ ref('int_quest_completion_per_trip') }}
    union all
    select quest_id, user_id, completed from {{ ref('int_quest_completion_counting') }}

),

completion_counts as (

    select
        quest_id,
        count(distinct case when completed then user_id end) as completion_count
    from all_completions
    group by quest_id

)

select
    qd.quest_id,
    qd.title,
    qd.description,
    qd.source,
    coalesce(cc.completion_count, 0) as completion_count,
    coalesce(cc.completion_count, 0) as segment_user_count
from {{ ref('quest_definitions') }} as qd
left join completion_counts as cc on qd.quest_id = cc.quest_id
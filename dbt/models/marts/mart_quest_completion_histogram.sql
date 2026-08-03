-- mart_quest_completion_histogram.sql
-- One row per quest-completion-count bucket. Exempt from suppression -- same
-- reasoning as mart_trips_per_user_histogram and mart_lines_ridden_histogram
-- (dashboard-spec.md): a magnitude of activity, no location content. Answers
-- "is quest completion broad or concentrated in one or two people" directly,
-- without needing per-quest detail suppression would otherwise block.
--
-- Reads the same three int_quest_completion_* models mart_quest_completion
-- does -- just grouped by user_id instead of quest_id. Neither mart
-- re-implements "did this user complete this quest"; see data-layer.md's
-- "Reusable pattern: one intermediate model, many mart-layer views."

with all_completions as (

    select quest_id, user_id, completed from {{ ref('int_quest_completion_lifetime_set') }}
    union all
    select quest_id, user_id, completed from {{ ref('int_quest_completion_per_trip') }}
    union all
    select quest_id, user_id, completed from {{ ref('int_quest_completion_counting') }}

),

-- Every user who's ever logged a trip gets a row here, including 0 --
-- each int_quest_completion_* model already cross-joins every user against
-- every quest of its mechanism, so a user with zero completions still has
-- explicit completed = false rows to count from, not a missing user.
user_completion_counts as (

    select
        user_id,
        count(distinct case when completed then quest_id end) as quests_completed
    from all_completions
    group by user_id

),

bucketed as (

    select
        case
            when quests_completed = 0 then '0'
            when quests_completed = 1 then '1'
            when quests_completed = 2 then '2'
            when quests_completed between 3 and 5 then '3-5'
            else '6+'
        end as bucket,
        user_id
    from user_completion_counts

)

select
    bucket,
    count(distinct user_id) as user_count
from bucketed
group by bucket
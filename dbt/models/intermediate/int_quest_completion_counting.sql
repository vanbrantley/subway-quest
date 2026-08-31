-- One row per (user_id, quest_id, completed) for every counting quest.
-- SQL equivalent of quests_logic.ts's evaluateCounting()/evaluateTiers().
--
-- `completed` mirrors the mobile side's tiered semantics exactly: true the
-- moment a user's count reaches the FIRST (lowest) tier, not the final one.
-- An open-ended counter (e.g. path_finder's unique trip patterns) has no
-- real "done" state to gate a reward behind, and gating on the final tier
-- would mean most riders never register as having "completed" a quest they
-- clearly engaged with -- see quests_logic.ts's evaluateTiers() doc comment
-- for the full reasoning. first_tier is computed once per quest below
-- (min() over its tiers array) rather than re-parsed per match CTE.
--
-- transfer_count reuses {{ ref('int_transfers') }} rather than re-deriving
-- transfer detection here -- same "one place owns this" principle as
-- everything else in this project. int_transfers carries a trip_id column
-- (confirmed directly), so the join below to int_trips for user_id is valid.
--
-- unique_trip_pattern_count reuses {{ ref('int_trip_signatures') }} for the
-- same reason -- one place owns "what is this trip's ordered stop sequence."

with counting_quests as (

    select
        quest_id,
        json_value(criteria_json, '$.type') as type,
        json_value(criteria_json, '$.route') as route,
        (select min(cast(t as int64)) from unnest(json_value_array(criteria_json, '$.tiers')) as t) as first_tier
    from {{ ref('quest_definitions') }}
    where mechanism = 'counting'

),

all_users as (

    select distinct user_id from {{ ref('int_trips') }}

),

-- ============================================================
-- ride_count_route -- always a real, specific route_id now (no more 'any'
-- -- every ride_count_route quest is auto-generated one-per-line, see
-- build_quests.py's resolve_line_loyalist_quests).
-- ============================================================

user_route_counts as (

    select trips.user_id, legs.route_id, count(*) as ride_count
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    group by trips.user_id, legs.route_id

),

ride_count_matches as (

    select
        cq.quest_id,
        urc.user_id,
        urc.ride_count >= cq.first_tier as completed
    from counting_quests as cq
    inner join user_route_counts as urc
        on cq.type = 'ride_count_route'
       and cq.route = urc.route_id

),

-- ============================================================
-- transfer_count
-- ============================================================

user_transfer_counts as (

    select trips.user_id, count(*) as transfer_count
    from {{ ref('int_transfers') }} as transfers
    inner join {{ ref('int_trips') }} as trips on transfers.trip_id = trips.trip_id
    group by trips.user_id

),

transfer_count_matches as (

    select
        cq.quest_id,
        utc.user_id,
        utc.transfer_count >= cq.first_tier as completed
    from counting_quests as cq
    inner join user_transfer_counts as utc on cq.type = 'transfer_count'

),

-- ============================================================
-- total_ride_count -- every leg across every line, lifetime.
-- ============================================================

user_total_ride_counts as (

    select trips.user_id, count(*) as ride_count
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    group by trips.user_id

),

total_ride_matches as (

    select
        cq.quest_id,
        utrc.user_id,
        utrc.ride_count >= cq.first_tier as completed
    from counting_quests as cq
    inner join user_total_ride_counts as utrc on cq.type = 'total_ride_count'

),

-- ============================================================
-- unique_trip_pattern_count -- distinct ordered stop-sequences across a
-- user's whole trip history (see int_trip_signatures).
-- ============================================================

user_unique_pattern_counts as (

    select user_id, count(distinct signature) as pattern_count
    from {{ ref('int_trip_signatures') }}
    group by user_id

),

unique_pattern_matches as (

    select
        cq.quest_id,
        uupc.user_id,
        uupc.pattern_count >= cq.first_tier as completed
    from counting_quests as cq
    inner join user_unique_pattern_counts as uupc on cq.type = 'unique_trip_pattern_count'

),

all_counting_matches as (

    select quest_id, user_id, completed from ride_count_matches
    union all
    select quest_id, user_id, completed from transfer_count_matches
    union all
    select quest_id, user_id, completed from total_ride_matches
    union all
    select quest_id, user_id, completed from unique_pattern_matches

)

select
    users.user_id,
    cq.quest_id,
    coalesce(matches.completed, false) as completed
from all_users as users
cross join counting_quests as cq
left join all_counting_matches as matches
    on matches.quest_id = cq.quest_id and matches.user_id = users.user_id

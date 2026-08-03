-- One row per (user_id, quest_id, completed) for every counting quest.
-- SQL equivalent of quests_logic.ts's evaluateCounting().
--
-- ASSUMPTION FLAGGED: transfer_count reuses {{ ref('int_transfers') }}
-- rather than re-deriving transfer detection here -- same "one place owns
-- this" principle as everything else in this project (int_transfers already
-- does the LAG()-over-sequence detection per dbt-coverage.md). This assumes
-- int_transfers has a trip_id column to join against int_trips for
-- user_id -- I haven't seen int_transfers.sql directly this session, so
-- confirm that join works before trusting this model; if int_transfers only
-- carries leg_id references, this join needs adjusting to go through
-- int_legs instead.

with counting_quests as (

    select quest_id, json_value(criteria_json, '$.type') as type, criteria_json
    from {{ ref('quest_definitions') }}
    where mechanism = 'counting'

),

all_users as (

    select distinct user_id from {{ ref('int_trips') }}

),

-- ============================================================
-- ride_count_route
-- ============================================================

user_route_counts as (

    select trips.user_id, legs.route_id, count(*) as ride_count
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    group by trips.user_id, legs.route_id

),

ride_count_specific as (

    -- explicit route (not 'any')
    select
        cq.quest_id,
        urc.user_id,
        urc.ride_count >= cast(json_value(cq.criteria_json, '$.count') as int64) as completed
    from counting_quests as cq
    inner join user_route_counts as urc
        on cq.type = 'ride_count_route'
       and json_value(cq.criteria_json, '$.route') != 'any'
       and json_value(cq.criteria_json, '$.route') = urc.route_id

),

ride_count_any as (

    -- route: 'any' -- best single route's count decides it
    select
        cq.quest_id,
        urc.user_id,
        max(urc.ride_count) >= any_value(cast(json_value(cq.criteria_json, '$.count') as int64)) as completed
    from counting_quests as cq
    inner join user_route_counts as urc
        on cq.type = 'ride_count_route'
       and json_value(cq.criteria_json, '$.route') = 'any'
    group by cq.quest_id, urc.user_id

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
        utc.transfer_count >= cast(json_value(cq.criteria_json, '$.count') as int64) as completed
    from counting_quests as cq
    inner join user_transfer_counts as utc on cq.type = 'transfer_count'

),

all_counting_matches as (

    select quest_id, user_id, completed from ride_count_specific
    union all
    select quest_id, user_id, completed from ride_count_any
    union all
    select quest_id, user_id, completed from transfer_count_matches

)

select
    users.user_id,
    cq.quest_id,
    coalesce(matches.completed, false) as completed
from all_users as users
cross join counting_quests as cq
left join all_counting_matches as matches
    on matches.quest_id = cq.quest_id and matches.user_id = users.user_id
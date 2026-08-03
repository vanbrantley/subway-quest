-- One row per (user_id, quest_id, completed) for every lifetime_set quest.
-- SQL equivalent of quests_logic.ts's evaluateLifetimeSet() -- same six
-- criteria sub-shapes, same switch. Each shape gets its own set of CTEs,
-- unioned at the end. Pattern used throughout: cross join every user against
-- every quest of that shape, left join against actual achieved counts (so a
-- user who visited zero of the required stations still gets an explicit
-- completed = false row, not a missing one).

with all_users as (

    select distinct user_id from {{ ref('int_trips') }}

),

-- ============================================================
-- all_stations / min_count_stations
-- ============================================================

station_set_quests as (

    select
        quest_id,
        case
            when json_value(criteria_json, '$.type') = 'all_stations'
                then array_length(json_value_array(criteria_json, '$.stations'))
            else cast(json_value(criteria_json, '$.count') as int64)
        end as threshold
    from {{ ref('quest_definitions') }}
    where mechanism = 'lifetime_set'
      and json_value(criteria_json, '$.type') in ('all_stations', 'min_count_stations')

),

station_set_required as (

    select
        qd.quest_id,
        cast(station_str as int64) as complex_id
    from {{ ref('quest_definitions') }} as qd,
        unnest(json_value_array(qd.criteria_json, '$.stations')) as station_str
    where qd.mechanism = 'lifetime_set'
      and json_value(qd.criteria_json, '$.type') in ('all_stations', 'min_count_stations')

),

station_set_matches as (

    select
        req.quest_id,
        visited.user_id,
        count(distinct req.complex_id) as matched_count
    from station_set_required as req
    inner join {{ ref('int_user_visited_complexes') }} as visited
        on req.complex_id = visited.complex_id
    group by req.quest_id, visited.user_id

),

station_set_completion as (

    select
        users.user_id,
        sq.quest_id,
        coalesce(matches.matched_count, 0) >= sq.threshold as completed
    from all_users as users
    cross join station_set_quests as sq
    left join station_set_matches as matches
        on matches.quest_id = sq.quest_id and matches.user_id = users.user_id

),

-- ============================================================
-- all_groups / min_count_groups
-- ============================================================

group_quests as (

    select
        quest_id,
        coalesce(cast(json_value(criteria_json, '$.min_per_group') as int64), 1) as min_per_group,
        case
            when json_value(criteria_json, '$.type') = 'all_groups'
                then array_length(json_query_array(criteria_json, '$.groups'))
            else cast(json_value(criteria_json, '$.count') as int64)
        end as threshold
    from {{ ref('quest_definitions') }}
    where mechanism = 'lifetime_set'
      and json_value(criteria_json, '$.type') in ('all_groups', 'min_count_groups')

),

group_members as (

    -- Double UNNEST: outer array-of-arrays split via JSON_QUERY_ARRAY (each
    -- element stays a serialized JSON array, e.g. "[1,2]"), then each of
    -- those split again via JSON_VALUE_ARRAY. WITH OFFSET tracks which
    -- group each member belongs to.
    select
        qd.quest_id,
        group_index,
        cast(member_str as int64) as complex_id
    from {{ ref('quest_definitions') }} as qd,
        unnest(json_query_array(qd.criteria_json, '$.groups')) as group_json with offset as group_index,
        unnest(json_value_array(group_json, '$')) as member_str
    where qd.mechanism = 'lifetime_set'
      and json_value(qd.criteria_json, '$.type') in ('all_groups', 'min_count_groups')

),

group_visited_counts as (

    select
        gm.quest_id,
        gm.group_index,
        visited.user_id,
        count(distinct gm.complex_id) as visited_in_group
    from group_members as gm
    inner join {{ ref('int_user_visited_complexes') }} as visited
        on gm.complex_id = visited.complex_id
    group by gm.quest_id, gm.group_index, visited.user_id

),

group_qualified_counts as (

    -- how many of this quest's groups did this user clear the min_per_group
    -- bar on (e.g. Deja Vu: visited BOTH members of a same-name cluster)
    select
        gv.quest_id,
        gv.user_id,
        count(*) as groups_qualified
    from group_visited_counts as gv
    inner join group_quests as gq on gv.quest_id = gq.quest_id
    where gv.visited_in_group >= gq.min_per_group
    group by gv.quest_id, gv.user_id

),

group_completion as (

    select
        users.user_id,
        gq.quest_id,
        coalesce(gqc.groups_qualified, 0) >= gq.threshold as completed
    from all_users as users
    cross join group_quests as gq
    left join group_qualified_counts as gqc
        on gqc.quest_id = gq.quest_id and gqc.user_id = users.user_id

),

-- ============================================================
-- all_station_route_pairs
-- ============================================================

pair_quests as (

    select
        quest_id,
        array_length(json_query_array(criteria_json, '$.pairs')) as threshold
    from {{ ref('quest_definitions') }}
    where mechanism = 'lifetime_set'
      and json_value(criteria_json, '$.type') = 'all_station_route_pairs'

),

pair_required as (

    select
        qd.quest_id,
        cast(json_value(pair_json, '$.station') as int64) as complex_id,
        json_value(pair_json, '$.route') as route_id
    from {{ ref('quest_definitions') }} as qd,
        unnest(json_query_array(qd.criteria_json, '$.pairs')) as pair_json
    where qd.mechanism = 'lifetime_set'
      and json_value(qd.criteria_json, '$.type') = 'all_station_route_pairs'

),

-- per-user (complex_id, route_id) pairs actually ridden -- mirrors
-- stationRoutePairsRidden() in quests_logic.ts; entry AND exit stations of a
-- leg both count as evidence for that leg's route
user_station_route_pairs as (

    select distinct trips.user_id, coords.complex_id, legs.route_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    inner join {{ ref('station_coordinates') }} as coords
        on legs.entry_station_id = coords.station_id

    union distinct

    select distinct trips.user_id, coords.complex_id, legs.route_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    inner join {{ ref('station_coordinates') }} as coords
        on legs.exit_station_id = coords.station_id

),

pair_matches as (

    select
        req.quest_id,
        ridden.user_id,
        count(distinct concat(cast(req.complex_id as string), ':', req.route_id)) as matched_count
    from pair_required as req
    inner join user_station_route_pairs as ridden
        on req.complex_id = ridden.complex_id and req.route_id = ridden.route_id
    group by req.quest_id, ridden.user_id

),

pair_completion as (

    select
        users.user_id,
        pq.quest_id,
        coalesce(matches.matched_count, 0) >= pq.threshold as completed
    from all_users as users
    cross join pair_quests as pq
    left join pair_matches as matches
        on matches.quest_id = pq.quest_id and matches.user_id = users.user_id

),

-- ============================================================
-- all_routes -- explicit list (e.g. s_tier, currently blocked/unused) OR
-- dynamic "every real route" (all_lines_rider), via route_definitions
-- ============================================================

user_routes_ridden as (

    select distinct trips.user_id, legs.route_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id

),

route_set_explicit as (

    select
        qd.quest_id,
        route_str as route_id
    from {{ ref('quest_definitions') }} as qd,
        unnest(json_value_array(qd.criteria_json, '$.routes')) as route_str
    where qd.mechanism = 'lifetime_set'
      and json_value(qd.criteria_json, '$.type') = 'all_routes'
      and json_query(qd.criteria_json, '$.routes') is not null

),

route_set_dynamic as (

    select
        qd.quest_id,
        rd.route_id
    from {{ ref('quest_definitions') }} as qd
    cross join {{ ref('route_definitions') }} as rd
    where qd.mechanism = 'lifetime_set'
      and json_value(qd.criteria_json, '$.type') = 'all_routes'
      and json_query(qd.criteria_json, '$.routes') is null

),

route_set_required as (

    select * from route_set_explicit
    union all
    select * from route_set_dynamic

),

route_set_quests as (

    select quest_id, count(*) as threshold
    from route_set_required
    group by quest_id

),

route_set_matches as (

    select
        req.quest_id,
        ridden.user_id,
        count(distinct req.route_id) as matched_count
    from route_set_required as req
    inner join user_routes_ridden as ridden
        on req.route_id = ridden.route_id
    group by req.quest_id, ridden.user_id

),

route_set_completion as (

    select
        users.user_id,
        rsq.quest_id,
        coalesce(matches.matched_count, 0) >= rsq.threshold as completed
    from all_users as users
    cross join route_set_quests as rsq
    left join route_set_matches as matches
        on matches.quest_id = rsq.quest_id and matches.user_id = users.user_id

)

select user_id, quest_id, completed from station_set_completion
union all
select user_id, quest_id, completed from group_completion
union all
select user_id, quest_id, completed from pair_completion
union all
select user_id, quest_id, completed from route_set_completion
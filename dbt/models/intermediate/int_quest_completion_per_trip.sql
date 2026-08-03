-- One row per (user_id, quest_id, completed) for every per_trip quest.
-- "Completed" means at least one of the user's trips satisfied the
-- criteria, mirroring quests_logic.ts's evaluateQuestProgress() per_trip
-- branch -- no fractional/cumulative concept, a per_trip quest is satisfied
-- or it isn't, per trip.

with per_trip_quests as (

    select quest_id, json_value(criteria_json, '$.type') as type, criteria_json
    from {{ ref('quest_definitions') }}
    where mechanism = 'per_trip'

),

all_users as (

    select distinct user_id from {{ ref('int_trips') }}

),

-- One row per trip, legs aggregated in sequence order -- mirrors `ordered =
-- [...legs].sort(...)` in quests_logic.ts's evaluatePerTrip().
trip_legs_ordered as (

    select
        trips.trip_id,
        trips.user_id,
        array_agg(legs.route_id order by legs.sequence) as route_sequence,
        array_agg(legs.entry_station_id order by legs.sequence) as entry_sequence,
        array_agg(legs.exit_station_id order by legs.sequence) as exit_sequence
    from {{ ref('int_trips') }} as trips
    inner join {{ ref('int_legs') }} as legs on trips.trip_id = legs.trip_id
    group by trips.trip_id, trips.user_id

),

trip_summary as (

    select
        trip_id,
        user_id,
        array_length(route_sequence) as leg_count,
        route_sequence,
        entry_sequence[offset(0)] as first_entry_station_id,
        exit_sequence[offset(array_length(exit_sequence) - 1)] as last_exit_station_id
    from trip_legs_ordered

),

-- ============================================================
-- leg_count_min
-- ============================================================

leg_count_matches as (

    select distinct ptq.quest_id, ts.user_id
    from per_trip_quests as ptq
    inner join trip_summary as ts
        on ptq.type = 'leg_count_min'
       and ts.leg_count >= cast(json_value(ptq.criteria_json, '$.count') as int64)

),

-- ============================================================
-- route_letters_spell_word
-- ============================================================

word_matches as (

    select distinct ptq.quest_id, ts.user_id
    from per_trip_quests as ptq
    inner join trip_summary as ts
        on ptq.type = 'route_letters_spell_word'
       and array_to_string(ts.route_sequence, '') = json_value(ptq.criteria_json, '$.word')

),

-- ============================================================
-- geographic_endpoints
-- ============================================================

geo_matches as (

    select distinct ptq.quest_id, ts.user_id
    from per_trip_quests as ptq
    inner join trip_summary as ts on ptq.type = 'geographic_endpoints'
    inner join {{ ref('station_coordinates') }} as start_coords
        on ts.first_entry_station_id = start_coords.station_id
    inner join {{ ref('station_coordinates') }} as end_coords
        on ts.last_exit_station_id = end_coords.station_id
    where start_coords.complex_id = cast(json_value(ptq.criteria_json, '$.start') as int64)
      and end_coords.complex_id = cast(json_value(ptq.criteria_json, '$.end') as int64)

),

-- ============================================================
-- full_line_ride
--
-- Per (trip_id, route_id), the set of stations touched by legs on that
-- route within this trip (entry + exit) -- mirrors quests_logic.ts's
-- riddenStops set inside evaluatePerTrip's full_line_ride case. Compared
-- against route_stations' full required span for that route via an array
-- containment check: "no required station is missing from what was
-- touched." Same documented simplification as the mobile side (station-set
-- coverage, not strict end-to-end ordering) -- see quests_logic.ts's
-- evaluatePerTrip() comment for the full reasoning, unchanged here.
-- ============================================================

trip_route_stations_touched as (

    select
        trips.trip_id,
        trips.user_id,
        legs.route_id,
        array_concat(
            array_agg(distinct legs.entry_station_id),
            array_agg(distinct legs.exit_station_id)
        ) as touched_stations
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    group by trips.trip_id, trips.user_id, legs.route_id

),

route_full_spans as (

    select route_id, array_agg(station_id) as required_stations
    from {{ ref('route_stations') }}
    group by route_id

),

full_line_ride_quests as (

    select quest_id, json_value(criteria_json, '$.route') as route_filter
    from per_trip_quests
    where type = 'full_line_ride'

),

full_line_ride_matches as (

    select distinct
        flq.quest_id,
        trs.user_id
    from full_line_ride_quests as flq
    inner join trip_route_stations_touched as trs
        on flq.route_filter = 'any' or flq.route_filter = trs.route_id
    inner join route_full_spans as rfs
        on trs.route_id = rfs.route_id
    where not exists (
        select required_station
        from unnest(rfs.required_stations) as required_station
        where required_station not in unnest(trs.touched_stations)
    )

),

all_matches as (

    select quest_id, user_id from leg_count_matches
    union all
    select quest_id, user_id from word_matches
    union all
    select quest_id, user_id from geo_matches
    union all
    select quest_id, user_id from full_line_ride_matches

),

any_trip_matched as (

    select distinct quest_id, user_id
    from all_matches

)

select
    users.user_id,
    ptq.quest_id,
    (matched.user_id is not null) as completed
from all_users as users
cross join per_trip_quests as ptq
left join any_trip_matched as matched
    on matched.quest_id = ptq.quest_id and matched.user_id = users.user_id
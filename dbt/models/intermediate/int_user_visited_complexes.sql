-- One row per (user_id, complex_id) ever visited -- mirrors quests_logic.ts's
-- complexIdsVisited() exactly: both leg entry/exit stations AND trip
-- origin/destination count (a trip's origin/destination station is "visited"
-- even on a hypothetical zero-leg edge case, same reasoning the mobile
-- evaluator already applies). Foundational model -- every lifetime_set
-- station/group/pair check in int_quest_completion_lifetime_set reads this,
-- not int_legs/int_trips directly, so the visited-set definition exists in
-- exactly one place.

with stops as (

    select trips.user_id, legs.entry_station_id as stop_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id

    union all

    select trips.user_id, legs.exit_station_id as stop_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id

    union all

    select user_id, origin_station_id as stop_id
    from {{ ref('int_trips') }}

    union all

    select user_id, destination_station_id as stop_id
    from {{ ref('int_trips') }}

)

select distinct
    stops.user_id,
    coords.complex_id
from stops
inner join {{ ref('station_coordinates') }} as coords
    on stops.stop_id = coords.station_id
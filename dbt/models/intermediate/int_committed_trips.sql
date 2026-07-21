-- One row per trip_id, for every trip that was ever committed — including deleted ones.
-- Owns the trip_started/trip_ended join logic in exactly one place; int_trips filters this down
-- to non-deleted trips rather than re-deriving the join itself. Exists specifically because
-- deletion-rate needs a deletion-inclusive denominator (see dbt-coverage.md).

with trip_started as (

    select
        trip_id,
        user_id,
        occurred_at,
        json_value(payload, '$.origin_station_id') as origin_station_id
    from {{ ref('stg_events') }}
    where event_type = 'trip_started'

),

trip_ended as (

    select
        trip_id,
        json_value(payload, '$.destination_station_id') as destination_station_id
    from {{ ref('stg_events') }}
    where event_type = 'trip_ended'

)

-- Inner join, same reasoning as before: trip_started and trip_ended fire together in one atomic
-- commit bundle, so a row only belongs here if both halves of that commit are present.
select
    trip_started.trip_id,
    trip_started.user_id,
    trip_started.occurred_at,
    trip_started.origin_station_id,
    trip_ended.destination_station_id
from trip_started
inner join trip_ended
    on trip_started.trip_id = trip_ended.trip_id
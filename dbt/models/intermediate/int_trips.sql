-- One row per trip_id, excluding any trip whose event group includes a trip_deleted event.
-- The actual trip_started/trip_ended join logic lives in int_committed_trips, not here — this
-- model is deliberately thin, just the deletion filter on top of it. Every downstream model
-- (int_legs, mart) reads this, never int_committed_trips directly, except the deletion-rate
-- metric, which specifically wants the deletion-inclusive count.

with deleted_trip_ids as (

    select distinct trip_id
    from {{ ref('stg_events') }}
    where event_type = 'trip_deleted'

)

select *
from {{ ref('int_committed_trips') }}
where trip_id not in (select trip_id from deleted_trip_ids)
-- The inverse of int_trips' exclusion test: confirms int_committed_trips genuinely includes
-- deleted trips, since that's the entire reason this model exists separately from int_trips.
-- If this ever returns zero rows while real trip_deleted events exist in stg_events, something's
-- wrong with int_committed_trips' join, not with deletion happening correctly.

select distinct e.trip_id
from {{ ref('stg_events') }} as e
where e.event_type = 'trip_deleted'
    and e.trip_id not in (select trip_id from {{ ref('int_committed_trips') }})
-- Confirms int_legs' join-based exclusion actually works: no leg belonging to a trip_deleted
-- trip should ever appear here. Verified separately from int_trips' own version of this test —
-- different model, different join logic, same invariant worth checking independently rather than
-- assuming it holds just because int_trips' version passed.

select l.leg_id
from {{ ref('int_legs') }} as l
inner join {{ ref('stg_events') }} as e
    on l.trip_id = e.trip_id
where e.event_type = 'trip_deleted'
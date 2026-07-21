-- Verifies an assumption int_trips relies on but doesn't check itself: per data-layer.md's
-- "Date-only backdating," every event in one atomic commit bundle shares a single occurred_at, so
-- trip_started and trip_ended for the same trip should always match. int_trips only carries
-- trip_started's occurred_at forward — this test is what justifies that being safe to do silently,
-- rather than assuming it. Worth checking directly: this project has a real precedent
-- (buildOccurredAt's timezone bug) of a "should always be true" assumption turning out false.

with trip_started as (

    select trip_id, occurred_at
    from {{ ref('stg_events') }}
    where event_type = 'trip_started'

),

trip_ended as (

    select trip_id, occurred_at
    from {{ ref('stg_events') }}
    where event_type = 'trip_ended'

)

select
    trip_started.trip_id,
    trip_started.occurred_at as started_occurred_at,
    trip_ended.occurred_at as ended_occurred_at
from trip_started
inner join trip_ended
    on trip_started.trip_id = trip_ended.trip_id
where trip_started.occurred_at != trip_ended.occurred_at
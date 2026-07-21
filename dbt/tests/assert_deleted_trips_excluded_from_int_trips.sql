-- Required test, per data-layer.md's "Deleted trips at the dbt layer": confirm directly that a
-- trip with a trip_deleted event never appears in int_trips. Don't assume the SQL exclusion is
-- correct just because it mirrors already-tested local logic (rehydrate-plan.ts) — SQL and
-- TypeScript are different enough implementations to warrant separately verifying the invariant.

select t.trip_id
from {{ ref('int_trips') }} as t
inner join {{ ref('stg_events') }} as e
    on t.trip_id = e.trip_id
where e.event_type = 'trip_deleted'
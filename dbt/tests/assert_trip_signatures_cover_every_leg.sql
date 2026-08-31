-- Custom test, dbt convention: a SELECT that should return zero rows if the
-- invariant holds. int_trip_signatures inner-joins every leg to
-- station_coordinates twice (entry and exit) -- a leg whose station_id
-- isn't in that seed silently drops out of the signature computation
-- instead of erroring, which could produce a MISSING trip (no row at all)
-- or a TRUNCATED one (fewer stops in the chain than the trip really had),
-- either way quietly undercounting unique_trip_pattern_count (path_finder)
-- for any user who hits the gap. A trip's signature always has exactly
-- (leg count + 1) '>'-separated stops -- the first leg's entry, then every
-- leg's exit -- so comparing that against int_legs' real leg count catches
-- both failure modes directly, not just the "missing entirely" case a plain
-- null-check would.

with leg_counts as (

    select trip_id, count(*) as leg_count
    from {{ ref('int_legs') }}
    group by trip_id

)

select
    trips.trip_id,
    leg_counts.leg_count,
    sigs.signature
from {{ ref('int_trips') }} as trips
inner join leg_counts on trips.trip_id = leg_counts.trip_id
left join {{ ref('int_trip_signatures') }} as sigs on trips.trip_id = sigs.trip_id
where sigs.signature is null
   or array_length(split(sigs.signature, '>')) != leg_counts.leg_count + 1

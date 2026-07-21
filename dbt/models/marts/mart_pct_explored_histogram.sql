-- mart_pct_explored_histogram.sql
-- One row per decile bucket of %-system-explored. Needs segment_user_count (explicit in spec).

with per_user as (
    select trips.user_id, count(distinct legs.entry_station_id) as stations_visited
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    group by trips.user_id
)
select
    cast(floor(safe_divide(stations_visited, 496) * 10) as int64) as bucket,
    count(distinct user_id) as segment_user_count
from per_user
group by bucket
order by bucket
-- mart_trips_per_user_histogram.sql
-- One row per trip-count bucket.

with per_user as (
    select user_id, count(distinct trip_id) as trip_count
    from {{ ref('int_trips') }}
    group by user_id
)
select
    trip_count as bucket,
    count(distinct user_id) as user_count
from per_user
group by bucket
order by bucket
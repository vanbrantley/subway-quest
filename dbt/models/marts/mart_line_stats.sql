-- mart_line_stats.sql
-- One row per route_id — feeds Growth's "Top lines." Needs segment_user_count.

select
    legs.route_id,
    count(*) as ride_count,
    count(distinct trips.user_id) as segment_user_count
from {{ ref('int_legs') }} as legs
inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
group by legs.route_id
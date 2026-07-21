-- mart_station_stats.sql
-- One row per station_id — feeds both the Exploration heatmap and Growth's top-stations.
-- Needs segment_user_count: a barely-visited station is small-N behavioral/location data.

with visits as (
    select legs.entry_station_id as station_id, trips.user_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    union all
    select legs.exit_station_id as station_id, trips.user_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
)
select station_id, count(*) as visit_count, count(distinct user_id) as segment_user_count
from visits
group by station_id
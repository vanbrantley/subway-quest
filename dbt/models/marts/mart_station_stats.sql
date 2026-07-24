-- mart_station_stats.sql
with visits as (
    select legs.entry_station_id as station_id, trips.user_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    union all
    select legs.exit_station_id as station_id, trips.user_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
),
visit_counts as (
    select station_id, count(*) as visit_count, count(distinct user_id) as segment_user_count
    from visits
    group by station_id
)
select
    visit_counts.station_id,
    visit_counts.visit_count,
    visit_counts.segment_user_count,
    coords.lat,
    coords.lon,
    coords.name as station_name,
    coords.routes as station_routes
from visit_counts
inner join {{ ref('station_coordinates') }} as coords
    on visit_counts.station_id = coords.station_id
-- tests/assert_all_visited_stations_have_coordinates.sql
-- Fails if any station with a real leg (entry or exit) is missing from the
-- station_coordinates seed. mart_station_stats inner-joins on this — without
-- this test, a missing coordinate would silently drop that station from the
-- heatmap with no visible failure anywhere in the pipeline.

with visited_stations as (
    select entry_station_id as station_id from {{ ref('int_legs') }}
    union distinct
    select exit_station_id as station_id from {{ ref('int_legs') }}
)
select visited_stations.station_id
from visited_stations
left join {{ ref('station_coordinates') }} as coords
    on visited_stations.station_id = coords.station_id
where coords.station_id is null
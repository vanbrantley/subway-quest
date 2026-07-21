-- mart_station_pairs.sql
-- One row per (entry_station_id, exit_station_id) — a leg's ride edge, the finest adjacency this
-- data captures without route_stops.json. Needs segment_user_count.

select
    legs.entry_station_id,
    legs.exit_station_id,
    count(*) as ride_count,
    count(distinct trips.user_id) as segment_user_count
from {{ ref('int_legs') }} as legs
inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
group by legs.entry_station_id, legs.exit_station_id
-- mart_station_pairs.sql
with pairs as (
    select
        legs.entry_station_id,
        legs.exit_station_id,
        count(*) as ride_count,
        count(distinct trips.user_id) as segment_user_count
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    group by legs.entry_station_id, legs.exit_station_id
)
select
    pairs.entry_station_id,
    entry_coords.name as entry_station_name,
    pairs.exit_station_id,
    exit_coords.name as exit_station_name,
    pairs.ride_count,
    pairs.segment_user_count
from pairs
inner join {{ ref('station_coordinates') }} as entry_coords
    on pairs.entry_station_id = entry_coords.station_id
inner join {{ ref('station_coordinates') }} as exit_coords
    on pairs.exit_station_id = exit_coords.station_id
-- segment_user_count is the column milestone 6's row access policy will filter on — worth
-- verifying directly, not just not_null, that it's always a real, positive count. A zero would
-- mean a row exists for a segment with no users in it, which shouldn't be possible given every
-- one of these models groups by something that only produces a row when at least one user's data
-- landed in it.

select 'mart_station_stats' as model, station_id as segment_key, segment_user_count
from {{ ref('mart_station_stats') }}
where segment_user_count < 1

union all

select 'mart_line_stats', route_id, segment_user_count
from {{ ref('mart_line_stats') }}
where segment_user_count < 1

union all

select 'mart_station_pairs', concat(entry_station_id, ' -> ', exit_station_id), segment_user_count
from {{ ref('mart_station_pairs') }}
where segment_user_count < 1
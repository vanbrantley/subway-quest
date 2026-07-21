-- mart_station_pairs' real grain is the (entry_station_id, exit_station_id) pair, not either
-- column alone — dbt's built-in `unique` test only checks single columns, so this checks the
-- actual grain key directly.

select entry_station_id, exit_station_id, count(*) as row_count
from {{ ref('mart_station_pairs') }}
group by entry_station_id, exit_station_id
having count(*) > 1
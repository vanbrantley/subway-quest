-- Rate columns in mart_global_summary should always fall in [0, 1] — worth checking directly
-- rather than assuming safe_divide's numerator/denominator relationship always holds as intended.

select *
from {{ ref('mart_global_summary') }}
where pct_drafts_corrected not between 0 and 1
    or pct_drafts_abandoned not between 0 and 1
    or pct_trips_deleted not between 0 and 1
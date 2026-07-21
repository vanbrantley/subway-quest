-- mart_time_to_log.sql
-- One row per leg-count bucket. Needs segment_user_count (explicit in spec) — counted by distinct
-- user, not distinct draft, via the trip_id -> int_trips join.

with committed as (
    select
        d.draft_id,
        t.user_id,
        timestamp_diff(d.committed_at, d.started_at, second) as duration_seconds,
        case when d.leg_count = 1 then '1 leg' when d.leg_count = 2 then '2 legs' else '3+ legs' end as leg_count_bucket
    from {{ ref('int_draft_sessions') }} as d
    inner join {{ ref('int_trips') }} as t on d.trip_id = t.trip_id
    where d.committed_at is not null and d.leg_count is not null
)
select
    leg_count_bucket,
    approx_quantiles(duration_seconds, 100)[offset(50)] as median_seconds,
    approx_quantiles(duration_seconds, 100)[offset(95)] as p95_seconds,
    count(distinct user_id) as segment_user_count
from committed
group by leg_count_bucket
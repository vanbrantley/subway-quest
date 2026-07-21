-- mart_sync_health.sql
-- One row per date — p50/p95 sync latency. No suppression: event-level aggregate, not per-user.

with latency as (
    select date(recorded_at) as date, timestamp_diff(received_at, recorded_at, second) as latency_seconds
    from {{ ref('stg_events') }}
)
select
    date,
    approx_quantiles(latency_seconds, 100)[offset(50)] as p50_latency_seconds,
    approx_quantiles(latency_seconds, 100)[offset(95)] as p95_latency_seconds,
    countif(latency_seconds <= 3600) as synced_within_60_min,
    count(*) as total_events
from latency
group by date
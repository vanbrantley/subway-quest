-- mart_global_summary.sql
-- Single row of global rates/totals — no suppression needed, nothing here is a small segment.

with avg_trips as (
    select safe_divide(count(distinct trip_id), count(distinct user_id)) as avg_trips_per_user
    from {{ ref('int_trips') }}
),
lines_ridden as (
    select count(distinct route_id) as lines_ridden_count
    from {{ ref('int_legs') }}
),
lines_total as (
    select total_routes as lines_total from {{ ref('route_totals') }}
),
draft_rates as (
    select
        safe_divide(countif(had_correction and committed_at is not null), countif(committed_at is not null)) as pct_drafts_corrected,
        safe_divide(countif(abandoned_at is not null), countif(abandoned_at is not null or committed_at is not null)) as pct_drafts_abandoned
    from {{ ref('int_draft_sessions') }}
),
deletion_rate as (
    select safe_divide(
        (select count(distinct trip_id) from {{ ref('stg_events') }} where event_type = 'trip_deleted'),
        (select count(distinct trip_id) from {{ ref('int_committed_trips') }})
    ) as pct_trips_deleted
)
select
    avg_trips.avg_trips_per_user,
    lines_ridden.lines_ridden_count,
    lines_total.lines_total,
    draft_rates.pct_drafts_corrected,
    draft_rates.pct_drafts_abandoned,
    deletion_rate.pct_trips_deleted
from avg_trips
cross join lines_ridden
cross join lines_total
cross join draft_rates
cross join deletion_rate
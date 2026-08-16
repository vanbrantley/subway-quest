-- mart_global_summary.sql
-- Single row of global rates/totals — no suppression, nothing here is a small segment.

with avg_trips as (
    select coalesce(safe_divide(count(distinct trip_id), count(distinct user_id)), 0) as avg_trips_per_user
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
),
-- Collective exploration: distinct stations visited by *anyone*, not per-user. Magnitude only, no
-- individual station named — exempt from suppression per dashboard-spec.md.
collective_exploration as (
    select count(distinct station_id) as stations_visited_collective
    from (
        select entry_station_id as station_id from {{ ref('int_legs') }}
        union distinct
        select exit_station_id as station_id from {{ ref('int_legs') }}
    )
),
station_totals_cte as (
    select total_stations from {{ ref('station_totals') }}
),
-- Quest completion, global (milestone 8) — same exemption reasoning as
-- collective_exploration above: magnitudes/headcounts, never which quest,
-- station, or user. total_quest_completions and users_with_any_quest_completion
-- are plain counts; lines_fully_completed is a bare count ("6 of 23"), never
-- WHICH 6 lines — that's what the suppressed mart_line_stats already covers,
-- separately. Reads the same int_quest_completion_* models mart_quest_completion
-- and mart_quest_completion_histogram both do — see data-layer.md's "Reusable
-- pattern: one intermediate model, many mart-layer views."
quest_completion_summary as (
    select
        count(*) as total_quest_completions,
        count(distinct user_id) as users_with_any_quest_completion,
        count(distinct case when quest_id like 'line_completion_%' then quest_id end) as lines_fully_completed
    from (
        select quest_id, user_id, completed from {{ ref('int_quest_completion_lifetime_set') }}
        union all
        select quest_id, user_id, completed from {{ ref('int_quest_completion_per_trip') }}
        union all
        select quest_id, user_id, completed from {{ ref('int_quest_completion_counting') }}
    )
    where completed
)
select
    avg_trips.avg_trips_per_user,
    lines_ridden.lines_ridden_count,
    lines_total.lines_total,
    draft_rates.pct_drafts_corrected,
    draft_rates.pct_drafts_abandoned,
    deletion_rate.pct_trips_deleted,
    safe_divide(collective_exploration.stations_visited_collective, station_totals_cte.total_stations) as pct_system_explored_collective,
    quest_completion_summary.total_quest_completions,
    quest_completion_summary.users_with_any_quest_completion,
    quest_completion_summary.lines_fully_completed
from avg_trips
cross join lines_ridden
cross join lines_total
cross join draft_rates
cross join deletion_rate
cross join collective_exploration
cross join station_totals_cte
cross join quest_completion_summary
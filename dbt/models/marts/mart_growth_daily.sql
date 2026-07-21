-- mart_growth_daily.sql
-- One row per date — new signups, new activations, trips started. No suppression.

with signups_per_day as (
    select date(occurred_at) as date, count(distinct user_id) as new_signups
    from (select user_id, min(occurred_at) as occurred_at from {{ ref('stg_events') }} group by user_id)
    group by date
),
activations_per_day as (
    select date(occurred_at) as date, count(distinct user_id) as new_activations
    from (select user_id, min(occurred_at) as occurred_at from {{ ref('int_trips') }} group by user_id)
    group by date
),
trips_per_day as (
    select date(occurred_at) as date, count(distinct trip_id) as trips_started
    from {{ ref('int_trips') }}
    group by date
)
select
    coalesce(s.date, a.date, t.date) as date,
    coalesce(s.new_signups, 0) as new_signups,
    coalesce(a.new_activations, 0) as new_activations,
    coalesce(t.trips_started, 0) as trips_started
from signups_per_day s
full outer join activations_per_day a on s.date = a.date
full outer join trips_per_day t on coalesce(s.date, a.date) = t.date
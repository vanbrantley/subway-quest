-- Custom test, dbt convention: a SELECT that should return zero rows if the
-- invariant holds. Every user who's ever logged a trip should land in
-- exactly one histogram bucket -- the sum of user_count across all buckets
-- should equal the real distinct user count in int_trips. A mismatch means
-- someone's being silently dropped or double-counted somewhere upstream.

with totals as (

    select
        (select sum(user_count) from {{ ref('mart_quest_completion_histogram') }}) as histogram_total,
        (select count(distinct user_id) from {{ ref('int_trips') }}) as real_total

)

select * from totals where histogram_total != real_total
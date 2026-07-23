-- One row per whole-number bucket of per-user distinct lines ridden. Whole-number buckets, 
-- not percentage deciles like the removed stations histogram
-- — 496 stations is large enough for percentage buckets to mean something; 26 lines is small enough
-- that a direct count is more legible than a % of a small scale.
-- No user_count column suppressed/policy-gated — magnitude-only distribution, no location content,
-- same reasoning already applied to the other two unsuppressed histograms in milestone 6.

with per_user as (
    select trips.user_id, count(distinct legs.route_id) as lines_ridden
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('int_trips') }} as trips on legs.trip_id = trips.trip_id
    group by trips.user_id
)
select lines_ridden as bucket, count(distinct user_id) as user_count
from per_user
group by bucket
order by bucket
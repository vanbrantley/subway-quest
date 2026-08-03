-- Custom test, dbt convention: a SELECT that should return zero rows if the
-- invariant holds. completion_count can never exceed the total number of
-- users who have ever logged a trip -- a violated invariant here almost
-- always means a bad JOIN fanned out rows somewhere upstream (the same
-- class of bug the min-N suppression testing runbook already watches for
-- elsewhere in this project).

select quest_id, completion_count
from {{ ref('mart_quest_completion') }}
where completion_count > (select count(distinct user_id) from {{ ref('int_trips') }})
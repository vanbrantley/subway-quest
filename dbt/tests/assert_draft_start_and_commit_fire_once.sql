-- Required test, decided when int_draft_sessions was designed: confirms trip_draft_started and
-- trip_draft_committed each fire at most once per draft_id. Catches a double-fire (e.g. a remount
-- bug) loudly rather than this model silently swallowing it via an implicit MIN()/first-match.

with started_counts as (

    select
        json_value(payload, '$.draft_id') as draft_id,
        count(*) as event_count
    from {{ ref('stg_events') }}
    where event_type = 'trip_draft_started'
    group by draft_id
    having count(*) > 1

),

committed_counts as (

    select
        json_value(payload, '$.draft_id') as draft_id,
        count(*) as event_count
    from {{ ref('stg_events') }}
    where event_type = 'trip_draft_committed'
    group by draft_id
    having count(*) > 1

)

select draft_id, event_count, 'trip_draft_started' as event_type from started_counts
union all
select draft_id, event_count, 'trip_draft_committed' as event_type from committed_counts
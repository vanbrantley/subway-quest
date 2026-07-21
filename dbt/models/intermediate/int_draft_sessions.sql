-- One row per draft_id, covering every outcome — committed, abandoned, or (in theory) neither yet.
-- Widened from an earlier committed-only design once correction-rate and abandonment-rate turned
-- out to need the same underlying draft-event data as the timing metric. One model, one place this
-- logic lives — see dbt-coverage.md.

with draft_started as (

    select
        json_value(payload, '$.draft_id') as draft_id,
        recorded_at as started_at
    from {{ ref('stg_events') }}
    where event_type = 'trip_draft_started'

),

draft_committed as (

    select
        json_value(payload, '$.draft_id') as draft_id,
        json_value(payload, '$.trip_id') as trip_id,
        recorded_at as committed_at
    from {{ ref('stg_events') }}
    where event_type = 'trip_draft_committed'

),

draft_abandoned as (

    select
        json_value(payload, '$.draft_id') as draft_id,
        recorded_at as abandoned_at
    from {{ ref('stg_events') }}
    where event_type = 'trip_draft_abandoned'

),

-- had_correction: did any draft_leg_removed fire for this draft_id. Per data-layer.md, this event
-- only fires for a previously-complete leg getting cut — an in-progress pick being cut fires
-- nothing, so this is already the right signal for "did the user correct something," not "did any
-- edit happen."
draft_corrections as (

    select distinct
        json_value(payload, '$.draft_id') as draft_id
    from {{ ref('stg_events') }}
    where event_type = 'draft_leg_removed'

),

-- leg_count sourced from int_legs, not raw events — int_legs already excludes legs belonging to a
-- deleted trip (via its own inner join to int_trips), so grouping it by trip_id naturally excludes
-- deleted trips here too, without this model needing to know about trip_deleted itself. A draft
-- whose committed trip was later deleted gets leg_count = null (no match), same effect as the
-- inner-join exclusion we designed earlier — just arrived at via a left join instead, since this
-- model needs to keep the draft-session row for abandonment/correction stats even when leg_count
-- isn't meaningful.
leg_counts as (

    select
        trip_id,
        count(distinct leg_id) as leg_count
    from {{ ref('int_legs') }}
    group by trip_id

)

select
    draft_started.draft_id,
    draft_committed.trip_id,
    draft_started.started_at,
    draft_committed.committed_at,
    draft_abandoned.abandoned_at,
    draft_corrections.draft_id is not null as had_correction,
    leg_counts.leg_count
from draft_started
left join draft_committed
    on draft_started.draft_id = draft_committed.draft_id
left join draft_abandoned
    on draft_started.draft_id = draft_abandoned.draft_id
left join draft_corrections
    on draft_started.draft_id = draft_corrections.draft_id
left join leg_counts
    on draft_committed.trip_id = leg_counts.trip_id
-- One row per leg_id — reconstructed from leg_boarded/leg_alighted, inner-joined to int_trips so
-- any leg belonging to a deleted trip drops out automatically (see int_trips.sql's comment on why
-- this is where that exclusion is owned, not repeated here).

with leg_boarded as (

    select
        trip_id,
        leg_id,
        json_value(payload, '$.route_id') as route_id,
        json_value(payload, '$.station_id') as entry_station_id,
        -- NULL for event_version 1 rows (pre-dates the sequence field) — json_value returns NULL
        -- for a missing key rather than erroring, so no version check needed here. Acceptable gap,
        -- same as rehydration's own handling of the same pre-v2 data — see data-layer.md.
        cast(json_value(payload, '$.sequence') as int64) as sequence

    from {{ ref('stg_events') }}
    where event_type = 'leg_boarded'

),

leg_alighted as (

    select
        leg_id,
        json_value(payload, '$.station_id') as exit_station_id
    from {{ ref('stg_events') }}
    where event_type = 'leg_alighted'

),

joined as (

    -- Inner join, same reasoning as int_trips' trip_started/trip_ended: a leg only exists once
    -- both boarding and alighting are part of the same atomic commit bundle.
    select
        leg_boarded.trip_id,
        leg_boarded.leg_id,
        leg_boarded.route_id,
        leg_boarded.entry_station_id,
        leg_boarded.sequence,
        leg_alighted.exit_station_id
    from leg_boarded
    inner join leg_alighted
        on leg_boarded.leg_id = leg_alighted.leg_id

)

-- Inner join to int_trips, not a WHERE trip_id IN (...) — a leg whose trip was excluded (deleted)
-- simply has no matching row to join against here, same mechanism as int_draft_sessions' design.

-- Note: this join exists purely to filter (inherit the deleted-trip exclusion), not to combine
-- columns — trips.* is deliberately not selected. int_legs stays leg-grain only (one row per
-- leg_id); pulling trip-level facts like user_id in here would denormalize them across every leg
-- of a multi-leg trip, blurring the grain (e.g. COUNT(DISTINCT user_id) would need care to avoid
-- double-counting). Combining trip- and leg-level facts for a specific metric's needs happens one
-- layer up, in mart — not here.

select
    joined.trip_id,
    joined.leg_id,
    joined.route_id,
    joined.entry_station_id,
    joined.sequence,
    joined.exit_station_id
from joined
inner join {{ ref('int_trips') }} as trips
    on joined.trip_id = trips.trip_id
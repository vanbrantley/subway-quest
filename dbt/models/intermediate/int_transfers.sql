-- One row per detected transfer — a leg_alighted -> leg_boarded pair at the same station, within
-- one trip. Built on int_legs, which already excludes legs belonging to a deleted trip, so that
-- exclusion is inherited for free (same pattern as int_draft_sessions' leg_count), no re-derivation
-- needed here. Per data-layer.md: "no trip_ended between" is automatically satisfied — trip_ended
-- fires once per commit bundle, after every leg, so any two legs sharing a trip_id are already
-- structurally before it.
--
-- Known limitation: ordering relies on `sequence`, which is NULL for pre-event_version-2 legs —
-- same accepted gap data-layer.md already names for rehydration replay, not new here.

with ordered_legs as (

    select
        trip_id,
        leg_id,
        sequence,
        route_id,
        entry_station_id,
        exit_station_id,
        lag(leg_id) over (partition by trip_id order by sequence) as prev_leg_id,
        lag(route_id) over (partition by trip_id order by sequence) as prev_route_id,
        lag(exit_station_id) over (partition by trip_id order by sequence) as prev_exit_station_id
    from {{ ref('int_legs') }}

)

-- A transfer exists wherever a leg's entry matches the immediately prior leg's exit — the normal
-- case, guaranteed today by the trip-logging flow's transfer-detection UI (auto-sets a new leg's
-- entry to the prior leg's exit). Written as a real join condition rather than assumed, so this
-- model stays correct even if that guarantee ever changed on the app side.
select
    trip_id,
    prev_leg_id as from_leg_id,
    leg_id as to_leg_id,
    prev_route_id as from_route_id,
    route_id as to_route_id,
    prev_exit_station_id as station_id
from ordered_legs
where prev_leg_id is not null
    and prev_exit_station_id = entry_station_id
-- One row per real transfer — every leg after a trip's first, within one trip. Built on int_legs,
-- which already excludes legs belonging to a deleted trip, so that exclusion is inherited for free
-- (same pattern as int_draft_sessions' leg_count), no re-derivation needed here.
--
-- NOT matched on station_id (a prior version of this model required
-- prev_exit_station_id = entry_station_id, mirroring the leg_alighted -> leg_boarded "same station"
-- framing). That undercounted real transfers: a transfer's entry is auto-set to "the correct
-- platform at that complex" (ui-spec.md), which is frequently a DIFFERENT stop_id than the prior
-- leg's exit -- e.g. Union Sq (complex 602): exiting the 6 at stop_id 635, entering the L at stop_id
-- L03, same real-world complex, different platforms, both real. Every leg after a trip's first is a
-- real transfer by construction instead: the trip-logging flow's transfer step only ever offers
-- routes other than the one just ridden (ui-spec.md's "Transfer detection" step), so no station
-- match is needed at all. Per data-layer.md: "no trip_ended between" is automatically satisfied --
-- trip_ended fires once per commit bundle, after every leg, so any two legs sharing a trip_id are
-- already structurally before it.
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

select
    trip_id,
    prev_leg_id as from_leg_id,
    leg_id as to_leg_id,
    prev_route_id as from_route_id,
    route_id as to_route_id,
    prev_exit_station_id as from_station_id,
    entry_station_id as to_station_id
from ordered_legs
where prev_leg_id is not null

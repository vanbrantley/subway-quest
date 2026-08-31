-- One row per (user_id, trip_id, signature). A trip's signature is its
-- ordered sequence of stops -- the first leg's entry complex, then every
-- leg's exit complex in sequence order -- SQL equivalent of
-- quests_logic.ts's tripSignature(). complex_id-based, not raw station_id,
-- same translation rule as int_user_visited_complexes: a transfer's exit and
-- the next leg's entry are frequently different station_ids at the SAME
-- physical complex (different platform), and using raw station_id would
-- fragment what's really one signature into two different ones.
--
-- Powers int_quest_completion_counting's unique_trip_pattern_count check --
-- factored into its own model (not inlined there) for the same "one place
-- owns this" reason int_transfers/int_user_visited_complexes are their own
-- models: a per-trip fact, reusable by more than just that one quest type.

with legs_with_complex as (

    select
        legs.trip_id,
        legs.sequence,
        entry_coords.complex_id as entry_complex_id,
        exit_coords.complex_id as exit_complex_id
    from {{ ref('int_legs') }} as legs
    inner join {{ ref('station_coordinates') }} as entry_coords on legs.entry_station_id = entry_coords.station_id
    inner join {{ ref('station_coordinates') }} as exit_coords on legs.exit_station_id = exit_coords.station_id

),

trip_first_entry as (

    select trip_id, entry_complex_id
    from legs_with_complex
    qualify row_number() over (partition by trip_id order by sequence asc) = 1

),

trip_exit_chain as (

    select
        trip_id,
        string_agg(cast(exit_complex_id as string), '>' order by sequence) as exit_chain
    from legs_with_complex
    group by trip_id

)

select
    trips.user_id,
    chain.trip_id,
    concat(cast(entry.entry_complex_id as string), '>', chain.exit_chain) as signature
from trip_exit_chain as chain
inner join trip_first_entry as entry on chain.trip_id = entry.trip_id
inner join {{ ref('int_trips') }} as trips on chain.trip_id = trips.trip_id

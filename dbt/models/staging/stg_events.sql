-- One row per event_id: deduped on the received_at watermark boundary, dev/test rows excluded
-- by launch-date cutoff. Deliberately does NOT parse `payload` — its shape varies too much per
-- event_type to force into columns at this layer; that's intermediate's job.
-- loaded_at intentionally not carried through — EL-job debugging tool only, not needed by any
-- downstream metric. Query the raw source directly if debugging EL lag specifically.

with source as (

    select * from {{ source('raw', 'events') }}

),

deduped as (

    select
        event_id,
        event_type,
        event_domain,
        event_version,
        occurred_at,
        recorded_at,
        received_at,
        device_id,
        user_id,
        trip_id,
        leg_id,
        payload
    from source
    qualify row_number() over (
        partition by event_id
        order by received_at desc
    ) = 1

),

filtered as (

    select *
    from deduped
    where date(occurred_at) >= date('{{ var("launch_date") }}')

)

select * from filtered
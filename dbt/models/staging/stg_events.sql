-- One row per event_id: deduped on the received_at watermark boundary, dev/test rows excluded
-- by is_test (set at write time from EXPO_PUBLIC_DEV_MODE -- see docs/data-layer.md's "Dev/prod
-- data separation"). Replaces an earlier launch-date-cutoff design (`occurred_at >= <launch
-- date>`) that turned out unworkable: dev/testing signs in with the same Apple ID used for real
-- post-launch usage, so once ongoing dev testing continues past any chosen cutoff date, a date
-- alone can no longer tell the two apart -- is_test is set per-build (EAS profile / .env), not
-- inferred from when a row happened to occur. Deliberately does NOT parse `payload` — its shape
-- varies too much per event_type to force into columns at this layer; that's intermediate's job.
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
        payload,
        is_test
    from source
    qualify row_number() over (
        partition by event_id
        order by received_at desc
    ) = 1

),

filtered as (

    select *
    from deduped
    where is_test = false

)

-- is_test itself isn't carried into the final output -- every row here is
-- already guaranteed is_test = false by the filter above, so exposing a
-- column that can only ever hold one value downstream would be redundant,
-- not informative. Keeps this model's output shape identical to before
-- this filter existed.
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
from filtered
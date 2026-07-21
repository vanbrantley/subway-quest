-- Fails (returns rows) if either invariant from the envelope design in docs/data-layer.md is
-- violated post-dedup:
--   - every trip-domain event has a trip_id
--   - every leg_boarded/leg_alighted event has a leg_id
-- This is already enforced as a real CHECK constraint at the schema level in Supabase, so this
-- test isn't expected to ever catch anything real — it's here to catch a dedup or EL-job bug that
-- silently corrupted the invariant on the way into BigQuery, not to validate app logic.

select event_id, event_type, event_domain, trip_id, leg_id
from {{ ref('stg_events') }}
where
    (event_domain = 'trip' and trip_id is null)
    or (event_type in ('leg_boarded', 'leg_alighted') and leg_id is null)
-- Per data-layer.md's draft-abandonment-asymmetry bug fix: every draft resolves to exactly one of
-- committed or abandoned, never both. Worth checking directly rather than assuming — this is
-- exactly the kind of "should always be true given the app logic" claim this project has learned
-- not to trust silently (see buildOccurredAt's timezone bug).

select draft_id, committed_at, abandoned_at
from {{ ref('int_draft_sessions') }}
where committed_at is not null
    and abandoned_at is not null
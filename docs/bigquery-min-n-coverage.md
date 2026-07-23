# SubwayQuest — Milestone 6: BigQuery Min-N Suppression

Reference doc for everything done in milestone 6 — reasoning, setup, and the exact testing flow,
including the gotchas hit along the way. `dashboard-spec.md`'s "Privacy: minimum-N suppression"
section has the full narrative reasoning; this doc is the practical companion — what to actually run,
and what to remember next time N changes or a new suppressed mart gets added.

## The decision, in one paragraph

Suppression applies only to metrics that disclose actual stations/routes at small-group grain — not
to every bucketed stat. The re-identification risk in mobility data comes from **space + time
together**; this app never stores time-of-day (only date), so that compounding factor doesn't exist
here. What's left is a weaker but real risk: naming which places a small group touched, identifiable
by social elimination in a small tester population even without a timestamp. **N = 5.**

## Which marts are in scope

| Mart | Suppressed? | Why |
|---|---|---|
| `mart_station_stats` | ✅ Yes | Names actual stations |
| `mart_station_pairs` | ✅ Yes | Names actual station-pair transfers |
| `mart_line_stats` | ✅ Yes | Shuttle rows (`FS`/`GS`/`H`) can have very few riders — same disclosure risk one grain coarser than a station |
| `mart_pct_explored_histogram`, `mart_trips_per_user_histogram`, `mart_time_to_log` | ❌ No | Magnitude only, no location content — `segment_user_count` was removed from these three |
| `mart_global_summary`, `mart_growth_daily`, `mart_sync_health` | ❌ No | Never had it — single aggregates / non-location time series |
| `mart_quest_completion` | Not built yet (milestone 8) | Will need it — a quest is a named set of stations |

Only the three ✅ marts carry `segment_user_count` **and** a row access policy. If a `segment_user_count`
column exists on a table with no policy attached, that's a sign something's out of sync with this
table — go check dbt-coverage.md's "Min-N suppression coverage" section.

## Dataset layout

`dbt_project.yml` gives `marts` a `+schema: mart` config, which makes dbt suffix the target dataset
rather than replace it — so with a `subwayquest_dbt` target, all nine mart tables build into
**`subwayquest_dbt_mart`**, a separate dataset from staging/intermediate (`subwayquest_dbt` itself).
This is a deliberate split, matching `PROJECT.md`'s original architecture diagram (raw dataset →
mart layer, drawn as two distinct things) — `powerbi-reader` only ever gets granted access to
`subwayquest_dbt_mart`, never `subwayquest_dbt`, so staging/intermediate (near-raw, pre-suppression
per-user rows) can never reach Power BI even by accident.

**Gotcha hit doing this:** switching the schema config doesn't move existing tables — dbt has no
"this model used to live elsewhere, clean that up" logic. After the `dbt_project.yml` change, the
nine old mart tables were still sitting in `subwayquest_dbt` and had to be dropped manually
(`DROP TABLE` × 9). Worth remembering for any future schema/dataset reconfig — always check for
orphaned tables in the old location after.

## Service account: `powerbi-reader`

Dedicated account, separate from the EL job's account — least privilege, since Power BI only ever
needs read access to the mart dataset, nothing the EL job's write/RLS-bypass access implies.

**Setup (Console UI):**
1. IAM & Admin → Service Accounts → Create — name `powerbi-reader`, skip the project-role grant
   screen (or add **BigQuery Job User** there directly to save a step)
2. BigQuery → `subwayquest_dbt_mart` dataset → Sharing/Permissions → Add Principal →
   `powerbi-reader@<project-id>.iam.gserviceaccount.com` → role **BigQuery Data Viewer**
   (dataset-scoped, not project-wide — this is the one that has to stay scoped)
3. If not done in step 1: IAM & Admin → IAM → Grant Access → same account → **BigQuery Job User**
   (project-level role, no dataset-scoped version exists)
4. Service Accounts → `powerbi-reader` → Keys → Add Key → Create new key → JSON — this file is
   Power BI's BigQuery connector credential. Never commit it.

**Role name gotcha:** "BigQuery User" (`roles/bigquery.user`) and "BigQuery Job User"
(`roles/bigquery.jobUser`) are different roles, not two labels for the same thing — User is broader
(also grants dataset creation/listing), Job User is just run/manage jobs. Use Job User; it doesn't
always show up on a loose "bigquery" search, type more specifically if it's not appearing.

## Row access policies

Run once per suppressed mart, in the BigQuery SQL editor, against `subwayquest_dbt_mart`:

```sql
CREATE ROW ACCESS POLICY min_n_suppression
ON `subwayquest_dbt_mart.mart_station_stats`
GRANT TO ('serviceAccount:powerbi-reader@subway-quest-502219.iam.gserviceaccount.com')
FILTER USING (segment_user_count >= 5);

CREATE ROW ACCESS POLICY min_n_suppression
ON `subwayquest_dbt_mart.mart_station_pairs`
GRANT TO ('serviceAccount:powerbi-reader@subway-quest-502219.iam.gserviceaccount.com')
FILTER USING (segment_user_count >= 5);

CREATE ROW ACCESS POLICY min_n_suppression
ON `subwayquest_dbt_mart.mart_line_stats`
GRANT TO ('serviceAccount:powerbi-reader@subway-quest-502219.iam.gserviceaccount.com')
FILTER USING (segment_user_count >= 5);
```

**View existing policies at any time:**
```sql
SELECT * FROM `subwayquest_dbt_mart.INFORMATION_SCHEMA.ROW_ACCESS_POLICIES`;
```

**To change N later:** no edit — drop and recreate, per table:
```sql
DROP ROW ACCESS POLICY min_n_suppression ON `subwayquest_dbt_mart.mart_station_stats`;

CREATE ROW ACCESS POLICY min_n_suppression
ON `subwayquest_dbt_mart.mart_station_stats`
GRANT TO ('serviceAccount:powerbi-reader@subway-quest-502219.iam.gserviceaccount.com')
FILTER USING (segment_user_count >= <new N>);
```
Repeat for the other two tables.

**Real behavior worth knowing, learned by hitting it directly:** a row access policy on a table
restricts **everyone querying it, by default** — there's no automatic exemption for the table owner
or project owner. `GRANT TO` is the only thing that grants visibility; anyone not listed sees zero
rows, including you. Table preview also gets disabled entirely once any row access policy exists on
a table ("Table preview is not supported for tables using row-level security"). This is stricter than
it might sound at first, but it's the more defensible version of the mechanism for exactly the
scenario this project cares about — nobody sees suppressed rows by default, visibility is opt-in per
identity, not opt-out.

## Testing: seeding, `owner_test_access`, and impersonation

**Why a second temporary policy is needed to test as yourself:** since the real policy only grants
`powerbi-reader`, your own account can't see the seeded test rows either, by the same rule above.
BigQuery unions multiple row access policies on one table (a row is visible if *any* policy's filter
passes), so a second, permissive, temporary policy lets you confirm the seed data exists without
touching the real one.

**1. Seed synthetic rows** (fake `TEST_` prefix so cleanup is unambiguous):
```sql
INSERT INTO `subwayquest_dbt_mart.mart_station_stats`
(station_id, visit_count, segment_user_count)
VALUES
  ('TEST_N3',  15, 3),
  ('TEST_N4',  20, 4),
  ('TEST_N5',  25, 5),
  ('TEST_N9',  45, 9),
  ('TEST_N20', 100, 20);
```

**2. Grant yourself temporary visibility to confirm the seed:**
```sql
CREATE ROW ACCESS POLICY owner_test_access
ON `subwayquest_dbt_mart.mart_station_stats`
GRANT TO ('user:<your-google-account-email>')
FILTER USING (TRUE);
```
Query the table as yourself — all 5 `TEST_` rows should be visible.

**3. Impersonate `powerbi-reader` to run the real checks.** The `bq` CLI has no
`--impersonate_service_account` flag (a real error hit doing this — `bq.py help` suggests
`use_gce_service_account`, which is not it). Impersonation is set via `gcloud config` instead, then
every `bq`/`gcloud` command in that Cloud Shell session runs as the impersonated account:

```bash
gcloud config set auth/impersonate_service_account powerbi-reader@subway-quest-502219.iam.gserviceaccount.com
```

**Second gotcha hit doing this:** even with Owner on the project, impersonating a specific service
account needs a separate, explicit grant — Owner/Editor deliberately do **not** include
`iam.serviceAccounts.getAccessToken` (Google keeps impersonation out of the basic roles on purpose,
so broad project control doesn't silently also mean "can act as any service account"). Fix, one-time,
scoped to just this service account:

IAM & Admin → Service Accounts → `powerbi-reader` → **Permissions** tab (the service account's own
permissions page, not the project IAM page) → Grant Access → your email → role **Service Account
Token Creator**.

**4. Run the checks:**
```bash
bq query --use_legacy_sql=false \
  "SELECT * FROM \`subwayquest_dbt_mart.mart_station_stats\` WHERE station_id = 'TEST_N3'"
# expect: empty

bq query --use_legacy_sql=false \
  "SELECT * FROM \`subwayquest_dbt_mart.mart_station_stats\` WHERE station_id = 'TEST_N4'"
# expect: empty

bq query --use_legacy_sql=false \
  "SELECT * FROM \`subwayquest_dbt_mart.mart_station_stats\` WHERE station_id = 'TEST_N5'"
# expect: row present, values unmodified — confirms >= not >

bq query --use_legacy_sql=false \
  "SELECT * FROM \`subwayquest_dbt_mart.mart_station_stats\` WHERE station_id = 'TEST_N9'"
# expect: row present

bq query --use_legacy_sql=false \
  "SELECT * FROM \`subwayquest_dbt_mart.mart_station_stats\` WHERE station_id = 'TEST_N20'"
# expect: row present
```

All five ran and matched expectations on this milestone's first real pass — `TEST_N3`/`TEST_N4`
empty, `TEST_N5`/`TEST_N9`/`TEST_N20` present with exact seeded values, via direct impersonated `bq`
calls outside Power BI entirely. That last part is the actual proof of the design goal: enforcement
that's independent of which client is asking, not just "Power BI happens to show the right thing."

## Cleanup — every time this test flow is repeated

Order: unset impersonation first (so nothing afterward accidentally runs as `powerbi-reader`), then
clean up the SQL side.

```bash
gcloud config unset auth/impersonate_service_account
```

```sql
DELETE FROM `subwayquest_dbt_mart.mart_station_stats`
WHERE station_id LIKE 'TEST_%';

DROP ROW ACCESS POLICY owner_test_access ON `subwayquest_dbt_mart.mart_station_stats`;
```

**Service Account Token Creator on your own account** — not required for Power BI itself (it
authenticates directly with `powerbi-reader`'s key, never through your identity), only needed for you
to test as that account from the command line. Removed after this milestone's testing, matching this
project's least-privilege pattern elsewhere (`service_role` select-only, `powerbi-reader` itself
existing separately from the EL job's account) — re-grant it the same way (Service Accounts →
`powerbi-reader` → Permissions → Grant Access) whenever N changes and needs re-verifying.

## Why this is worth explaining plainly, not glossing over, in an interview

A fully-populated public dashboard was never really the thing being evaluated — the reasoning is.
The stronger, specific story: *started with a blanket "suppress every bucketed stat" rule, worked
through what re-identification in mobility data actually requires — space plus time together —
noticed this app never stores time-of-day by design, and narrowed the policy to the three metrics
that genuinely disclose location at small-group grain, landing on N=5 with reasoning tied to a small,
socially-connected tester population rather than picking a round number.* The verification flow above
proves the mechanism works on synthetic data, independent of whether real usage ever reaches N=5 on
a given segment — that's the artifact, not the live chart.
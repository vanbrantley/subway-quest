"""
el/sync_to_bigquery.py

Batch EL job: pulls new rows from Supabase's raw_events.events (using the
service_role key — this job intentionally bypasses RLS, since it needs every
user's data, not one signed-in user's) and appends them into BigQuery's
subwayquest_raw.events table.

Incremental via watermark: queries BigQuery for MAX(received_at) already
loaded, pulls only newer rows from Supabase. No external state — derived
fresh from BigQuery each run, since GitHub Actions runners are stateless.

Duplicates are possible at the watermark boundary (deliberately not solved
here — see docs/status.md's EL job section) and are expected to be handled
by dbt's staging layer (milestone 5), not this script. This table is a raw
capture layer, not a deduplicated source of truth.

Run: python3 el/sync_to_bigquery.py
Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_APPLICATION_CREDENTIALS
"""

import os
import sys
from datetime import datetime, timezone

from supabase import create_client
from google.cloud import bigquery

BQ_PROJECT = os.environ["GCP_PROJECT_ID"]
BQ_DATASET = "subwayquest_raw"
BQ_TABLE = "events"
BQ_TABLE_FULL = f"{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}"

PAGE_SIZE = 1000  # Supabase's default query cap — pagination loop below
                   # handles pulling more than one page per run.

SCHEMA = [
    bigquery.SchemaField("event_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("event_type", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("event_domain", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("event_version", "INTEGER", mode="REQUIRED"),
    bigquery.SchemaField("occurred_at", "TIMESTAMP", mode="REQUIRED"),
    bigquery.SchemaField("recorded_at", "TIMESTAMP", mode="REQUIRED"),
    bigquery.SchemaField("received_at", "TIMESTAMP", mode="REQUIRED"),
    bigquery.SchemaField("device_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("user_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("trip_id", "STRING", mode="NULLABLE"),
    bigquery.SchemaField("leg_id", "STRING", mode="NULLABLE"),
    bigquery.SchemaField("payload", "JSON", mode="REQUIRED"),
    bigquery.SchemaField("loaded_at", "TIMESTAMP", mode="REQUIRED"),  # this job's own run time,
                                                                        # not received_at — useful
                                                                        # for debugging EL lag
                                                                        # separately from sync lag
]


def get_watermark(bq_client: bigquery.Client) -> str | None:
    """Latest received_at already in BigQuery, or None if the table is empty/doesn't exist yet."""
    try:
        query = f"SELECT MAX(received_at) AS max_received_at FROM `{BQ_TABLE_FULL}`"
        result = list(bq_client.query(query).result())
        max_received_at = result[0].max_received_at
        return max_received_at.isoformat() if max_received_at else None
    except Exception as e:
        # Table doesn't exist yet — first-ever run. Not an error, just "load everything."
        print(f"No existing watermark (likely first run): {e}")
        return None


def fetch_new_events(supabase_client, watermark: str | None) -> list[dict]:
    """Pages through raw_events.events, newer than the watermark, ordered by received_at."""
    all_rows = []
    offset = 0

    while True:
        query = (
            supabase_client.schema("raw_events")
            .from_("events")
            .select("*")
            .order("received_at", desc=False)
            .range(offset, offset + PAGE_SIZE - 1)
        )
        if watermark:
            query = query.gt("received_at", watermark)

        response = query.execute()
        rows = response.data
        if not rows:
            break

        all_rows.extend(rows)
        offset += PAGE_SIZE

        if len(rows) < PAGE_SIZE:
            break  # last page

    return all_rows


def ensure_table(bq_client: bigquery.Client):
    dataset_ref = bigquery.DatasetReference(BQ_PROJECT, BQ_DATASET)
    table_ref = dataset_ref.table(BQ_TABLE)
    try:
        bq_client.get_table(table_ref)
    except Exception:
        print(f"Creating table {BQ_TABLE_FULL} (first run)")
        table = bigquery.Table(table_ref, schema=SCHEMA)
        # Partitioned on received_at — matches status.md's planned
        # partitioning strategy for query cost/performance downstream,
        # not just a nice-to-have here.
        table.time_partitioning = bigquery.TimePartitioning(field="received_at")
        table.clustering_fields = ["user_id"]
        bq_client.create_table(table)


def to_bq_row(event: dict, loaded_at: str) -> dict:
    row = {k: event[k] for k in (
        "event_id", "event_type", "event_domain", "event_version",
        "occurred_at", "recorded_at", "received_at", "device_id",
        "user_id", "trip_id", "leg_id",
    )}
    # payload comes back from Supabase as a parsed dict already (jsonb).
    # Leave it as a real dict — load_table_from_json serializes the whole
    # row to NDJSON itself, so a nested dict here becomes a proper nested
    # JSON object in the row, which is what BigQuery's JSON column type
    # actually wants. json.dumps()'ing it first was the bug: it turned the
    # dict into a JSON *string*, which then got serialized a second time
    # by NDJSON encoding, landing as an escaped string value in BigQuery
    # rather than a real JSON object — which is why JSON_VALUE() returned
    # null on every row instead of the real field values.
    row["payload"] = event["payload"]
    row["loaded_at"] = loaded_at
    return row


def main():
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    supabase_client = create_client(supabase_url, supabase_key)
    bq_client = bigquery.Client(project=BQ_PROJECT)

    ensure_table(bq_client)

    watermark = get_watermark(bq_client)
    print(f"Watermark: {watermark or '(none — loading all rows)'}")

    events = fetch_new_events(supabase_client, watermark)
    print(f"Fetched {len(events)} new event(s) from Supabase")

    if not events:
        print("Nothing to load.")
        return

    loaded_at = datetime.now(timezone.utc).isoformat()
    rows = [to_bq_row(e, loaded_at) for e in events]

    job_config = bigquery.LoadJobConfig(
        schema=SCHEMA,
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
        source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON,
    )

    # A single load job is one atomic operation — either the whole batch
    # lands or none of it does. This is what keeps a crash mid-run safe to
    # just retry next time: no partial batch can ever be sitting in BigQuery.
    load_job = bq_client.load_table_from_json(rows, BQ_TABLE_FULL, job_config=job_config)
    load_job.result()  # blocks until finished, raises on failure

    print(f"Loaded {len(rows)} row(s) into {BQ_TABLE_FULL}")


if __name__ == "__main__":
    sys.exit(main() or 0)
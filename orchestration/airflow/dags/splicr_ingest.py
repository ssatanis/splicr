"""
SplicR autonomous screen ingest, for teams that schedule with Apache Airflow.

The work itself runs on Modal (engine/modal_app.py, deployed as app
`splicr-ingest`); this DAG only sequences it. Modal's own cron
(`discover_daily`, `sweep_scheduled`) does the same job without Airflow, so run
one or the other, not both: if this DAG is enabled, stop the Modal schedules
with `modal app stop splicr-ingest` and redeploy without them, or simply leave
this DAG paused.

Requirements on the Airflow workers: `pip install modal==1.6.*` and a Modal
token (MODAL_TOKEN_ID / MODAL_TOKEN_SECRET) in the worker environment.

Task graph, daily at 07:00 UTC:

    discover  ->  list_unplanned  ->  plan[*]  ->  list_planned  ->  process[*]

`plan` and `process` are dynamically mapped over the accessions the listing
tasks return, so every study is its own retriable task in the Airflow UI. Each
Modal function is idempotent (it checks the study's status in ingest.studies
first), so an Airflow retry never double-processes a screen.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from airflow.decorators import dag, task

APP = "splicr-ingest"
MIN_SCORE_TO_PLAN = 0.40   # same as engine/modal_app.py: plan "screen" and "maybe"
MAX_PROCESS_PER_RUN = 12


def _fn(name: str):
    import modal

    return modal.Function.from_name(APP, name)


@dag(
    dag_id="splicr_ingest",
    schedule="0 7 * * *",
    start_date=datetime(2026, 9, 30),
    catchup=False,
    max_active_runs=1,
    default_args={"retries": 2, "retry_delay": timedelta(minutes=15)},
    tags=["splicr", "ingest", "crispr"],
    doc_md=__doc__,
)
def splicr_ingest():
    @task
    def discover() -> dict:
        return _fn("discover").remote()

    @task
    def list_unplanned(_: dict) -> list[str]:
        import os

        import psycopg

        with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
            rows = conn.execute(
                "select accession from ingest.studies where status = 'discovered' and score >= %s "
                "and attempts < 5 order by score desc limit 100", (MIN_SCORE_TO_PLAN,)).fetchall()
        return [r[0] for r in rows]

    @task(max_active_tis_per_dag=8)
    def plan(accession: str) -> dict:
        return _fn("plan_study").remote(accession)

    @task
    def list_planned(_: list) -> list[str]:
        import os

        import psycopg

        with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as conn:
            rows = conn.execute(
                "select accession from ingest.studies where status = 'planned' and attempts < 5 "
                "order by score desc limit %s", (MAX_PROCESS_PER_RUN,)).fetchall()
        return [r[0] for r in rows]

    @task(max_active_tis_per_dag=4, execution_timeout=timedelta(hours=7))
    def process(accession: str) -> dict:
        return _fn("process_study").remote(accession)

    planned = plan.expand(accession=list_unplanned(discover()))
    process.expand(accession=list_planned(planned))


splicr_ingest()

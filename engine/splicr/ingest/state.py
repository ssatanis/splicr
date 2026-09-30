"""
The ingest.* tables: every study's status, plan, runs and event log.

All writes go through here so the status machine in models.STATUSES is enforced
in one place. Connections use SUPABASE_DB_URL (the database owner), which on
Modal comes from the `splicr-ingest` secret; the engine never uses the API keys.

Idempotency is the rule: re-discovering a study updates its metadata but never
moves its status backwards, and every stage checks the status it expects before
doing work, so a retried Modal call or a double-scheduled Airflow task is a no-op.
"""

from __future__ import annotations

import json
import os
import socket
from contextlib import contextmanager
from typing import Any, Iterable, Iterator

from .models import STATUSES, FastqcReport, StudyCandidate, StudyPlan

# Forward moves allowed; failed/needs_review reachable from anywhere.
_NEXT = {
    "discovered": {"planned", "rejected", "needs_review"},
    "planned": {"fetching", "needs_review"},
    "needs_review": {"planned", "rejected"},
    "fetching": {"analyzing", "planned"},
    "analyzing": {"published", "planned"},
    "failed": {"discovered", "planned"},
    "published": {"planned"},        # explicit reprocess, e.g. after a pipeline upgrade
    "rejected": {"discovered"},      # classifier improved
}


class TransitionError(RuntimeError):
    pass


def owner() -> str:
    return os.environ.get("MODAL_TASK_ID") or f"{socket.gethostname()}:{os.getpid()}"


@contextmanager
def connect() -> Iterator[Any]:
    import psycopg

    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL is not set")
    with psycopg.connect(url, autocommit=True, prepare_threshold=None) as conn:
        yield conn


def upsert_candidates(conn, candidates: Iterable[StudyCandidate]) -> dict[str, int]:
    """Insert new studies; refresh metadata of known ones without touching progress."""
    new = updated = 0
    for c in candidates:
        row = conn.execute(
            """
            insert into ingest.studies (accession, source, title, summary, organism, taxid, xrefs,
                pubmed_ids, first_public, last_updated, n_runs, score, verdict, reasons, status)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                    case when %s = 'not_screen' then 'rejected' else 'discovered' end)
            on conflict (accession) do update set
                title = excluded.title, summary = excluded.summary, organism = excluded.organism,
                taxid = excluded.taxid, xrefs = ingest.studies.xrefs || excluded.xrefs,
                pubmed_ids = excluded.pubmed_ids, last_updated = excluded.last_updated,
                n_runs = coalesce(excluded.n_runs, ingest.studies.n_runs),
                score = excluded.score, verdict = excluded.verdict, reasons = excluded.reasons,
                status = case when ingest.studies.status in ('discovered', 'rejected')
                              then excluded.status else ingest.studies.status end
            returning (xmax = 0) as inserted
            """,
            (c.accession, c.source, c.title[:2000], (c.summary or "")[:10000], c.organism, c.taxid,
             json.dumps(c.xrefs), c.pubmed_ids, c.first_public, c.last_updated, c.n_runs,
             max(0.0, min(1.0, float(c.score))), c.verdict, c.reasons, c.verdict),
        ).fetchone()
        if row and row[0]:
            new += 1
        else:
            updated += 1
    return {"new": new, "updated": updated}


def status_of(conn, accession: str) -> str | None:
    row = conn.execute("select status from ingest.studies where accession = %s", (accession,)).fetchone()
    return row[0] if row else None


def transition(conn, accession: str, to: str, *, expect: set[str] | None = None, **fields) -> None:
    """Move a study to `to`, checking the move is legal. Extra fields are set too."""
    if to not in STATUSES:
        raise ValueError(to)
    cur = status_of(conn, accession)
    if cur is None:
        raise TransitionError(f"{accession} is not in ingest.studies")
    if expect is not None and cur not in expect:
        raise TransitionError(f"{accession} is {cur}, expected one of {sorted(expect)}")
    if to not in ("failed", "needs_review") and to != cur and to not in _NEXT.get(cur, set()):
        raise TransitionError(f"{accession}: {cur} -> {to} is not a legal transition")
    cols = {"status": to, **fields}
    if to != "failed":
        cols.setdefault("error", None)
        cols.setdefault("error_stage", None)
    sets = ", ".join(f"{k} = %s" for k in cols)
    vals = [json.dumps(v) if k == "plan" and v is not None and not isinstance(v, str) else v
            for k, v in cols.items()]
    conn.execute(f"update ingest.studies set {sets}, lease_owner = null, lease_expires = null "
                 f"where accession = %s", [*vals, accession])


def fail(conn, accession: str, stage: str, error: BaseException | str) -> None:
    msg = str(error)[:4000]
    conn.execute("update ingest.studies set status = 'failed', error_stage = %s, error = %s, "
                 "lease_owner = null, lease_expires = null where accession = %s", (stage, msg, accession))
    event(conn, accession, stage, "failed", msg)


def defer(conn, accession: str, interval: str, reason: str, issues: list[str] | None = None) -> None:
    """Keep a study `discovered` but out of every queue until the interval passes."""
    conn.execute("update ingest.studies set status = 'discovered', lease_owner = %s, "
                 "lease_expires = now() + %s::interval, issues = %s where accession = %s",
                 (reason[:200], interval, issues or [], accession))


def event(conn, accession: str | None, stage: str, status: str, message: str, detail: dict | None = None) -> None:
    conn.execute("insert into ingest.events (accession, stage, status, message, detail) values (%s,%s,%s,%s,%s)",
                 (accession, stage, status, message[:4000], json.dumps(detail or {}, default=str)))


def claim(conn, status: str, lease: str = "2 hours") -> str | None:
    row = conn.execute("select accession from ingest.claim(%s, %s, %s::interval)", (status, owner(), lease)).fetchone()
    return row[0] if row else None


def pending(conn, status: str, limit: int = 50, min_score: float = 0.0) -> list[str]:
    rows = conn.execute(
        "select accession from ingest.studies where status = %s and score >= %s "
        "and (lease_expires is null or lease_expires < now()) and attempts < 5 "
        "order by score desc, discovered_at limit %s", (status, min_score, limit)).fetchall()
    return [r[0] for r in rows]


def load_candidate(conn, accession: str) -> StudyCandidate:
    r = conn.execute(
        "select accession, source, title, summary, organism, taxid, xrefs, pubmed_ids, first_public::text, "
        "last_updated::text, n_runs, score, verdict, reasons from ingest.studies where accession = %s",
        (accession,)).fetchone()
    if r is None:
        raise KeyError(accession)
    keys = ["accession", "source", "title", "summary", "organism", "taxid", "xrefs", "pubmed_ids",
            "first_public", "last_updated", "n_runs", "score", "verdict", "reasons"]
    return StudyCandidate.from_dict(dict(zip(keys, r)))


def save_plan(conn, plan: StudyPlan) -> None:
    to = {"ready": "planned", "needs_review": "needs_review", "unsupported": "rejected"}[plan.status]
    transition(conn, plan.accession, to, plan=plan.to_json(), plan_confidence=plan.confidence,
               issues=plan.issues)
    roles = {r.run: r for r in plan.roles}
    for run in plan.runs:
        role = roles.get(run.run)
        conn.execute(
            """insert into ingest.runs (run, accession, label, role, read_count, fastq)
               values (%s,%s,%s,%s,%s,%s)
               on conflict (run) do update set label = excluded.label, role = excluded.role,
                 read_count = excluded.read_count, fastq = excluded.fastq""",
            (run.run, plan.accession, role.label if role else None, role.role if role else None, run.read_count,
             json.dumps([{"url": u, "md5": m, "bytes": b} for u, m, b in
                         zip(run.fastq_urls, run.fastq_md5 or [None] * len(run.fastq_urls),
                             run.fastq_bytes or [None] * len(run.fastq_urls))])))


def load_plan(conn, accession: str) -> StudyPlan:
    r = conn.execute("select plan from ingest.studies where accession = %s", (accession,)).fetchone()
    if not r or r[0] is None:
        raise KeyError(f"{accession} has no plan")
    return StudyPlan.from_dict(r[0] if isinstance(r[0], dict) else json.loads(r[0]))


def update_run(conn, run: str, **fields) -> None:
    if not fields:
        return
    sets = ", ".join(f"{k} = %s" for k in fields)
    vals = [json.dumps(v, default=str) if isinstance(v, (dict, list)) else v for v in fields.values()]
    conn.execute(f"update ingest.runs set {sets} where run = %s", [*vals, run])


def record_fastqc(conn, report: FastqcReport) -> None:
    conn.execute(
        "update ingest.runs set fastqc = coalesce(fastqc, '[]'::jsonb) || %s::jsonb where run = %s",
        (json.dumps([json.loads(report.to_json())]), report.run))


def get_watermark(conn, source: str):
    r = conn.execute("select last_seen from ingest.watermarks where source = %s", (source,)).fetchone()
    return r[0] if r else None


def set_watermark(conn, source: str, last_seen, cursor: dict | None = None) -> None:
    conn.execute(
        """insert into ingest.watermarks (source, last_checked, last_seen, cursor) values (%s, now(), %s, %s)
           on conflict (source) do update set last_checked = now(),
             last_seen = greatest(ingest.watermarks.last_seen, excluded.last_seen), cursor = excluded.cursor""",
        (source, last_seen, json.dumps(cursor or {})))

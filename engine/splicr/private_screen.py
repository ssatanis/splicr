"""Run a queued private workspace screen.

The console intake owns the screen, samples, comparison, files and run rows.
This module only materializes the uploaded objects and points the existing
pipeline at those rows. It never creates a second screen and never invents a
design if the saved sample sheet is incomplete.
"""

from __future__ import annotations

import os
import socket
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from . import db, r2
from .pipeline import ExistingRun, ScreenInput, run_pipeline


@dataclass(frozen=True)
class Job:
    id: str
    run_id: str
    screen_id: str
    org_id: str
    attempts: int


def _worker_name() -> str:
    return f"modal:{socket.gethostname()}:{os.getpid()}"


def _claim(conn, owner: str) -> Job | None:
    row = conn.execute("select * from public.claim_pipeline_job(%s)", (owner,)).fetchone()
    if not row:
        return None
    return Job(id=str(row[0]), run_id=str(row[1]), screen_id=str(row[2]), org_id=str(row[3]), attempts=int(row[5]))


def _heartbeat(conn, job: Job, owner: str, progress: float | None = None) -> None:
    conn.execute("select public.pipeline_job_heartbeat(%s, %s, %s)", (job.id, owner, progress))
    conn.commit()


def _finish(conn, job: Job, owner: str, ok: bool, error: str | None = None) -> None:
    conn.execute("select public.finish_pipeline_job(%s, %s, %s, %s)", (job.id, owner, ok, error))
    conn.commit()


def _r2_parts(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "r2" or not parsed.netloc or not parsed.path:
        raise ValueError(f"unsupported private upload storage URI {uri!r}")
    return parsed.netloc, parsed.path.lstrip("/")


def _download(uri: str, dest: Path) -> None:
    bucket, key = _r2_parts(uri)
    client = r2.client()
    dest.parent.mkdir(parents=True, exist_ok=True)
    client.download_file(bucket, key, str(dest))


def _safe_name(name: str) -> str:
    base = Path(name).name[-180:]
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in base) or "file"


def _screen_spec(conn, job: Job, workdir: Path) -> tuple[ScreenInput, str | None]:
    screen = conn.execute(
        """
        select s.name, s.cell_line, s.phenotype, s.modality, l.slug,
               s.library_id
          from public.screens s
          left join atlas.libraries l on l.id = s.library_id
         where s.id = %s and s.org_id = %s
        """,
        (job.screen_id, job.org_id),
    ).fetchone()
    if not screen:
        raise ValueError("screen is missing or belongs to a different workspace")

    samples = conn.execute(
        "select id, label, role, metadata from public.samples where screen_id = %s order by position",
        (job.screen_id,),
    ).fetchall()
    if not samples:
        raise ValueError("screen has no saved sample sheet")
    by_id = {str(row[0]): {"label": row[1], "role": row[2], "metadata": row[3] or {}} for row in samples}
    by_file = {
        str(row[3].get("file_id")): {"label": row[1], "role": row[2]}
        for row in samples
        if isinstance(row[3], dict) and row[3].get("file_id")
    }

    comparison = conn.execute(
        "select id, treatment_ids, control_ids from public.comparisons where screen_id = %s and is_primary",
        (job.screen_id,),
    ).fetchone()
    if not comparison:
        raise ValueError("screen has no primary comparison")
    comparison_id = str(comparison[0])
    treatment = [by_id[str(sample_id)]["label"] for sample_id in (comparison[1] or []) if str(sample_id) in by_id]
    control = [by_id[str(sample_id)]["label"] for sample_id in (comparison[2] or []) if str(sample_id) in by_id]
    if not treatment or not control:
        raise ValueError("primary comparison does not name both arms")

    files = conn.execute(
        """
        select id, kind, storage_key, original_name, checksum_sha256, byte_size
          from public.screen_files
         where screen_id = %s and status = 'complete'
         order by created_at
        """,
        (job.screen_id,),
    ).fetchall()
    if not files:
        raise ValueError("screen has no complete uploaded files")

    fastqs: dict[str, Path] = {}
    count_table: Path | None = None
    downloads = workdir / "inputs"
    for file_id, kind, storage_key, original_name, checksum, byte_size in files:
        target = downloads / f"{file_id}_{_safe_name(original_name)}"
        _download(storage_key, target)
        if byte_size is not None and target.stat().st_size != int(byte_size):
            raise ValueError(f"{original_name} changed size while downloading from R2")
        if kind == "counts":
            if count_table is not None:
                raise ValueError("more than one count table was uploaded; split this into separate screens")
            count_table = target
        elif kind == "fastq":
            sample = by_file.get(str(file_id))
            if not sample:
                raise ValueError(f"{original_name} is not assigned to a sample")
            fastqs[sample["label"]] = target

    roles = {row["label"]: row["role"] for row in by_id.values()}
    if bool(fastqs) == bool(count_table):
        raise ValueError("supply either FASTQ files or one count table, not both")

    settings = conn.execute("select settings from public.runs where id = %s", (job.run_id,)).fetchone()
    hit_callers = ((settings[0] or {}).get("hit_callers") if settings else []) or []
    return (
        ScreenInput(
            name=screen[0],
            fastqs=fastqs,
            count_table=count_table,
            roles=roles,
            treatment=treatment,
            control=control,
            library_slug=screen[4],
            cell_line=screen[1],
            phenotype=screen[2],
            modality=screen[3],
            run_drugz="drugz" in hit_callers,
        ),
        comparison_id,
    )


def process_one(owner: str | None = None) -> dict:
    owner = owner or _worker_name()
    with db.connect() as conn:
        job = _claim(conn, owner)
        if job is None:
            return {"claimed": False}
        conn.commit()

    error: str | None = None
    ok = False
    with tempfile.TemporaryDirectory(prefix="splicr-private-") as tmp:
        workdir = Path(tmp)
        try:
            with db.connect() as conn:
                _heartbeat(conn, job, owner, 0.01)
                spec, comparison_id = _screen_spec(conn, job, workdir)
                conn.commit()
            result = run_pipeline(
                spec,
                workdir / "work",
                persist=True,
                existing=ExistingRun(job.org_id, job.screen_id, job.run_id, comparison_id),
                verbose=True,
            )
            ok = result.ok
            error = result.error
        except Exception as exc:  # noqa: BLE001 - persisted below
            error = f"{type(exc).__name__}: {exc}"

    with db.connect() as conn:
        _finish(conn, job, owner, ok, error)
    return {"claimed": True, "job_id": job.id, "run_id": job.run_id, "ok": ok, "error": error}

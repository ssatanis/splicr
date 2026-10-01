"""
The three units of work every scheduler calls: discover, plan, process.

    discover(since, until)   search GEO + SRA + ENA, classify, upsert ingest.studies
    plan(accession)          fetch run metadata, infer the design -> planned | needs_review | rejected
    process(accession)       FASTQ + FastQC -> count -> QC -> MAGeCK/BAGEL2 -> harmonize -> publish

Modal (engine/modal_app.py), Airflow (orchestration/airflow) and the local CLI
(`python -m splicr.ingest ...`) all call these same functions, so behaviour does
not depend on where it runs. Each is idempotent: it checks the study's status
first and does nothing if another worker already moved it on.
"""

from __future__ import annotations

import shutil
import tempfile
import traceback
from datetime import date, timedelta
from pathlib import Path

from . import state
from .models import StudyPlan

DEFER_FOR = "3 days"
DEFER_LIMIT = 5


def discover(since: date | None = None, until: date | None = None, sources=("geo", "sra", "ena")) -> dict:
    """Search since the stored watermark (minus 3 days' overlap for late indexing)."""
    from . import discover as disc

    with state.connect() as conn:
        if since is None:
            marks = [state.get_watermark(conn, s) for s in sources]
            known = [m for m in marks if m is not None]
            since = (min(known) - timedelta(days=3)) if known else date.today() - timedelta(days=30)
        until = until or date.today()
        state.event(conn, None, "discover", "started", f"searching {since}..{until}", {"sources": list(sources)})
        candidates = disc.discover(since, until)
        counts = state.upsert_candidates(conn, candidates)
        for s in sources:
            state.set_watermark(conn, s, until)
        by_verdict: dict[str, int] = {}
        for c in candidates:
            by_verdict[c.verdict] = by_verdict.get(c.verdict, 0) + 1
        summary = {"since": str(since), "until": str(until), "found": len(candidates), **counts, **by_verdict}
        state.event(conn, None, "discover", "ok", f"{len(candidates)} studies, {counts['new']} new", summary)
    return summary


def request(accession: str) -> dict:
    """
    A lab asks SplicR to process one accession (GSE, PRJNA/PRJEB/PRJDB, SRP/ERP/DRP).

    The request is recorded as such and never auto-rejected by the text
    classifier: the requester is telling us it is a screen, which is better
    evidence than its summary. The design still has to be inferred confidently;
    a request whose design is ambiguous goes to review like any other study.
    """
    from .__main__ import candidate_for

    try:
        cand = candidate_for(accession)
    except SystemExit as exc:
        return {"accession": accession, "error": str(exc)}
    cand.reasons = [*cand.reasons, "processing requested explicitly"]
    if cand.verdict == "not_screen":
        cand.verdict, cand.score = "maybe", max(cand.score, 0.5)
    with state.connect() as conn:
        state.upsert_candidates(conn, [cand])
        cur = state.status_of(conn, cand.accession)
        if cur == "rejected":
            state.transition(conn, cand.accession, "discovered")
        state.event(conn, cand.accession, "request", "ok", f"processing requested for {accession}")
    return {"accession": cand.accession, **plan(cand.accession)}


MISLABEL_ISSUE = "every run is filed as"


def _probe_reads(conn, accession: str, p: StudyPlan) -> None:
    """
    Let the reads settle what the metadata cannot. One included run's first
    200k reads are streamed and fingerprinted against every library SplicR
    holds. A confident match clears the "filed as RNA-seq" doubt; no match
    sends a ready plan to review before any full download.
    """
    from . import fetch as fe

    included = {r.run for r in p.roles if r.role != "exclude"} or {r.run for r in p.runs}
    run = next((r for r in p.runs if r.run in included and r.fastq_urls), None)
    if run is None:
        return
    try:
        det = fe.probe_library(run)
    except Exception as exc:  # noqa: BLE001 - the probe is advisory; the full fetch checks again
        state.event(conn, accession, "probe", "warn", f"read probe of {run.run} failed: {exc}")
        return
    if det.confident and det.best is not None:
        p.notes.append(f"reads of {run.run} match {det.describe()}")
        before = len(p.issues)
        p.issues = [i for i in p.issues if not i.startswith(MISLABEL_ISSUE)]
        if p.status == "needs_review" and before and not p.issues and p.contrasts:
            p.status = "ready"
        state.event(conn, accession, "probe", "ok", f"{run.run}: {det.describe()}")
    elif _learn_library(conn, accession, p, run, det):
        return
    else:
        p.issues.append(f"the first reads of {run.run} match no library SplicR holds ({det.describe()})")
        p.status = "needs_review"
        state.event(conn, accession, "probe", "warn", f"{run.run}: no library matched; {det.describe()}")


def _learn_library(conn, accession: str, p: StudyPlan, run, det) -> bool:
    """
    No library matched, so go and read the one the paper published.

    This is the difference between analysing the 13 libraries SplicR ships
    with and analysing the custom libraries most current screens use. The
    extracted library is accepted only if it explains this study's own reads
    better than anything already held, measured by the same fingerprint that
    just failed, so a wrong table cannot get through: see
    `splicr.ingest.library_extract`.

    Returns True when a library was learned and the plan is usable.
    """
    from . import library_extract as lx

    incumbent = det.best.match_rate if det.best else 0.0
    try:
        cand = state.load_candidate(conn, accession)
        pmcid = lx.pmid_to_pmcid(cand.pubmed_ids)
        title = cand.title
    except Exception:  # noqa: BLE001 - a missing candidate row must not block the probe
        pmcid, title = "", ""
    state.event(conn, accession, "probe", "started",
                f"no known library; searching supplementary files for a custom one")
    try:
        out = lx.learn_library_for(accession, run, pmcid=pmcid, title=title,
                                   incumbent_rate=incumbent)
    except Exception as exc:  # noqa: BLE001 - advisory, like the probe itself
        state.event(conn, accession, "probe", "warn", f"library extraction failed: {exc}")
        return False
    if not out.ok:
        state.event(conn, accession, "probe", "warn",
                    f"no custom library found: {out.note}")
        return False

    p.learned_library = lx.slug_for(accession)
    p.notes.append(
        f"library learned from {Path(out.accepted.url).name}"
        + (f" [{out.accepted.member}]" if out.accepted.member else "")
        + f": {len(out.accepted.guides):,} guides explaining {out.match_rate:.1%} of "
          f"{run.run}'s reads")
    before = len(p.issues)
    p.issues = [i for i in p.issues if not i.startswith(MISLABEL_ISSUE)]
    if p.status == "needs_review" and before and not p.issues and p.contrasts:
        p.status = "ready"
    state.event(conn, accession, "probe", "ok",
                f"learned library {p.learned_library}: {out.note}")
    return True


def plan(accession: str) -> dict:
    from . import design, metadata
    from .. import pmc_agent

    with state.connect() as conn:
        status = state.status_of(conn, accession)
        if status not in ("discovered", "failed", "needs_review"):
            return {"accession": accession, "skipped": f"status is {status}"}
        try:
            cand = state.load_candidate(conn, accession)
            state.event(conn, accession, "plan", "started", "fetching run metadata")
            runs = metadata.fetch_runs(cand)
            p: StudyPlan = design.plan_study(cand, runs)
            if pmc_agent.needs_context(p):
                state.event(conn, accession, "context", "started",
                            f"planner confidence {p.confidence:.2f}; reading PMC Methods")
                try:
                    context = pmc_agent.resolve(cand, p)
                    if context.override is not None:
                        p.notes.append("PMC context JSON: " + context.override.model_dump_json())
                    state.event(
                        conn, accession, "context",
                        "ok" if context.status == "resolved" else "warn",
                        (f"resolved: {len(context.override.contrasts[0].control_samples)} control, "
                         f"{len(context.override.contrasts[0].treatment_samples)} treatment accessions; "
                         f"confidence {context.override.confidence:.2f}")
                        if context.override else f"manual review: {context.reason}",
                        context.model_dump(),
                    )
                except Exception as exc:  # noqa: BLE001 - context is a fallback, never a hidden failure
                    state.event(conn, accession, "context", "warn",
                                f"PMC Methods lookup failed: {type(exc).__name__}: {exc}")
            if status == "failed":
                state.transition(conn, accession, "discovered")
            # Raw reads that are not public yet are the normal state of a fresh
            # deposit: GEO releases the series days before SRA/ENA serve the
            # runs, which are listed with 0 reads and no FASTQ meanwhile.
            # Rejecting then would drop exactly the new screens this engine
            # exists to catch, so the study is deferred and re-planned later.
            unreleased = not runs or all(not r.fastq_urls or not r.read_count for r in runs)
            if p.status == "unsupported" and unreleased:
                row = conn.execute("update ingest.studies set attempts = attempts + 1 where accession = %s "
                                   "returning attempts", (accession,)).fetchone()
                if row[0] < DEFER_LIMIT:
                    reason = ("ENA lists no runs yet" if not runs
                              else f"{len(runs)} runs registered but not yet released (no reads/FASTQ)")
                    state.defer(conn, accession, DEFER_FOR, f"deferred: {reason}", p.issues)
                    state.event(conn, accession, "plan", "skipped",
                                f"{reason}; re-checking in {DEFER_FOR} (attempt {row[0]} of {DEFER_LIMIT})")
                    return {"accession": accession, "deferred": reason}
                p.issues.append(f"raw reads still not public after {DEFER_LIMIT} checks")
            if p.status in ("ready", "needs_review") and p.runs:
                _probe_reads(conn, accession, p)
            state.save_plan(conn, p)
            state.event(conn, accession, "plan", "ok" if p.status == "ready" else "warn",
                        f"{p.status}: {len(p.runs)} runs, {len(p.contrasts)} contrasts, confidence {p.confidence:.2f}",
                        {"issues": p.issues})
            return {"accession": accession, "status": p.status, "confidence": p.confidence, "issues": p.issues}
        except Exception as exc:  # noqa: BLE001 - recorded on the study, not swallowed
            state.fail(conn, accession, "plan", f"{type(exc).__name__}: {exc}")
            return {"accession": accession, "failed": str(exc)}


def process(accession: str, workdir: Path | None = None, processes: int = 4, keep_files: bool = False) -> dict:
    from . import analyze as an
    from . import fetch as fe
    from .publish import publish

    workdir = Path(workdir or tempfile.mkdtemp(prefix=f"splicr-{accession}-"))
    with state.connect() as conn:
        status = state.status_of(conn, accession)
        if status != "planned":
            return {"accession": accession, "skipped": f"status is {status}"}
        stage = "fetch"
        try:
            state.transition(conn, accession, "fetching", expect={"planned"})
            cand = state.load_candidate(conn, accession)
            p = state.load_plan(conn, accession)
            included = {r.run for r in p.roles if r.role != "exclude"}
            fastq_by_run: dict[str, Path] = {}
            fastqc_summary: dict[str, dict] = {}
            # Runs download and pass through FastQC in parallel (network- and
            # I/O-bound); database writes stay on this thread, one connection.
            from concurrent.futures import ThreadPoolExecutor, as_completed

            def fetch_one(run):
                files = fe.fetch_run(run, workdir / "fastq")
                return run, files, fe.fastqc(files, workdir / "fastqc" / run.run, threads=2)

            todo = [r for r in p.runs if r.run in included]
            with ThreadPoolExecutor(max_workers=min(6, len(todo))) as pool:
                for fut in as_completed([pool.submit(fetch_one, r) for r in todo]):
                    run, files, reports = fut.result()
                    for path, rep in reports:
                        state.record_fastqc(conn, rep)
                        concerns = fe.interpret(rep)
                        fastqc_summary[run.run] = {"total_sequences": rep.total_sequences,
                                                   "length": rep.sequence_length, "concerns": concerns}
                        if run.read_count and rep.total_sequences and rep.total_sequences != run.read_count:
                            concerns.append(f"FastQC counted {rep.total_sequences:,} reads, ENA lists {run.read_count:,}")
                        if concerns:
                            state.event(conn, accession, "fastqc", "warn", f"{run.run}: {'; '.join(concerns)}")
                    state.update_run(conn, run.run, status="qc_done")
                    fastq_by_run[run.run] = files[0]
            state.event(conn, accession, "fetch", "ok", f"{len(fastq_by_run)} runs downloaded and md5-verified")

            stage = "analyze"
            state.transition(conn, accession, "analyzing", expect={"fetching"})
            study = an.analyze(p, fastq_by_run, workdir / "analysis", processes=processes)
            for label, s in study.samples.items():
                state.update_run(conn, s["run"], status="counted", mapped_reads=s["mapped"],
                                 mapping_rate=s["mapping_rate"])
            failed = [c.name for c in study.contrasts if c.result.failed_at]
            for c in study.contrasts:
                for w in (c.result.hits.warnings if c.result.hits else []):
                    state.event(conn, accession, "analyze", "warn", f"{c.name}: {w}")
            state.event(conn, accession, "analyze", "warn" if failed else "ok",
                        f"library {study.library_name}; {len(study.contrasts)} contrasts"
                        + (f"; failed: {failed}" if failed else ""),
                        {"samples": study.samples, "detection": study.detection})

            stage = "crosscheck"
            from . import crosscheck
            try:
                check = crosscheck.run(accession, study.counts_paths)
            except Exception as exc:  # noqa: BLE001 - a verification failure is recorded, not fatal
                check = {"verdict": "error", "error": f"{type(exc).__name__}: {exc}"}
            if check:
                state.event(conn, accession, "crosscheck",
                            "ok" if check.get("verdict") == "agrees" else "warn",
                            f"deposited counts {check.get('verdict')}: median Spearman "
                            f"{check.get('median_spearman')} vs {check.get('source', 'n/a')}", check)

            stage = "publish"
            with conn.transaction():
                out = publish(conn, cand, p, study, fastqc_summary, check)
                state.transition(conn, accession, "published", expect={"analyzing"},
                                 atlas_screen_id=out["screen_ids"][0] if out["screen_ids"] else None)
            state.event(conn, accession, "publish", "ok",
                        f"{out['n_hits']} hits over {out['n_genes']} genes; {out['n_quarantined']} quarantined", out)
            return {"accession": accession, "published": out}
        except an.LibraryNotRecognized as exc:
            state.transition(conn, accession, "needs_review", issues=[str(exc)])
            state.event(conn, accession, stage, "warn", str(exc))
            return {"accession": accession, "needs_review": str(exc)}
        except fe.NotYetAvailable as exc:
            state.transition(conn, accession, "planned")
            state.event(conn, accession, stage, "skipped", f"FASTQ not yet available at ENA: {exc}")
            return {"accession": accession, "retry_later": str(exc)}
        except Exception as exc:  # noqa: BLE001
            state.fail(conn, accession, stage, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-2500:]}")
            return {"accession": accession, "failed": f"{stage}: {exc}"}
        finally:
            if not keep_files:
                shutil.rmtree(workdir, ignore_errors=True)

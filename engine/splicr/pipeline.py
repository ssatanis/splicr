"""
The pipeline: nine stages from reads to scored hits.

Each stage records its own row, so a run is inspectable while it is still
going and a failure says which stage failed rather than just failing. A
caller can run the whole thing in memory, or persist every stage to Postgres
by passing an org_id.
"""

from __future__ import annotations

import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path

from . import db
from .artifacts import Flag, flag_artifacts, summarise_flags
from .atlas import AtlasResult, atlas_context
from .count import (
    CountMatrix, SampleCounts, count_fastq, count_table_samples, read_count_table,
)
from .design import Design, DesignError, build_design
from .detect import Detection, detect_from_count_table, detect_from_fastq
from .hits import HitTable, call_hits
from .qc import ScreenQc, screen_qc
from .references import Library, load_library

STAGES = ("ingest", "detect", "count", "qc", "hits", "artifacts", "atlas", "score", "report")


@dataclass
class StageRecord:
    stage: str
    status: str
    detail: str = ""
    tool: str = ""
    duration_sec: float = 0.0
    metrics: dict = field(default_factory=dict)


@dataclass
class PipelineResult:
    screen_name: str
    library: Library | None = None
    design: Design | None = None
    detection: Detection | None = None
    matrix: CountMatrix | None = None
    qc: ScreenQc | None = None
    hits: HitTable | None = None
    atlas: AtlasResult | None = None
    flags: dict[str, list[Flag]] = field(default_factory=dict)
    stages: list[StageRecord] = field(default_factory=list)
    screen_id: str | None = None
    run_id: str | None = None
    failed_at: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.failed_at is None

    def summary(self) -> str:
        lines = [f"Screen: {self.screen_name}"]
        for s in self.stages:
            mark = {"done": "ok", "failed": "FAILED", "skipped": "skipped"}.get(s.status, s.status)
            lines.append(f"  {s.stage:<10} {mark:<8} {s.duration_sec:6.1f}s  {s.detail}")
        for note in (self.design.notes if self.design else []):
            lines.append(f"  design: {note}")
        # A verdict with no reason attached is not actionable, and on the
        # persist=False path there is nowhere else for the reason to live: it
        # would otherwise exist only inside the qc stage's metrics dict, which
        # nothing prints. The real olaparib screen fails QC on one arm mapping
        # at 48%, and the summary used to say only "fail".
        if self.qc is not None and self.qc.verdict != "pass":
            for note in self.qc.notes:
                lines.append(f"  qc: {note}")
            for s in self.qc.samples:
                if s.verdict != "pass":
                    for note in s.notes:
                        lines.append(f"  qc {s.label} ({s.verdict}): {note}")
        if self.hits:
            sig = self.hits.significant(0.1)
            lines.append(f"  {len(self.hits.genes)} genes scored, {len(sig)} significant at FDR 0.1")
            d = self.hits.direction
            if d is not None and d.n_essential:
                lines.append(f"  known essentials among them: {d.depleted} depleted, "
                             f"{d.enriched} enriched"
                             + ("" if d.powered else " (too few to test direction)"))
            for w in self.hits.warnings:
                lines.append(f"  hits warning: {w}")
        if self.flags and self.hits:
            called = [g.gene for g in self.hits.significant(0.1)]
            lines.append(f"  flags on called hits: "
                         f"{summarise_flags(self.flags, called) or 'none'}")
            lines.append(f"  flags over all genes: {summarise_flags(self.flags)}")
        return "\n".join(lines)


@dataclass
class ScreenInput:
    """What a caller hands the pipeline."""

    name: str
    fastqs: dict[str, Path] = field(default_factory=dict)   # label -> path
    count_table: Path | None = None
    roles: dict[str, str] = field(default_factory=dict)     # label -> role
    treatment: list[str] = field(default_factory=list)
    control: list[str] = field(default_factory=list)
    library_slug: str | None = None                         # None means detect
    cell_line: str | None = None
    model_id: str | None = None                             # DepMap ACH-######
    phenotype: str | None = None
    modality: str = "knockout"


def run_pipeline(
    spec: ScreenInput,
    workdir: Path,
    org_id: str | None = None,
    created_by: str | None = None,
    persist: bool = False,
    verbose: bool = True,
) -> PipelineResult:
    """
    Run the pipeline.

    persist=True writes every stage to Postgres as it completes, so progress
    is visible from the app while the run is still going. It needs org_id.
    """
    result = PipelineResult(screen_name=spec.name)
    workdir.mkdir(parents=True, exist_ok=True)
    conn = None
    ctx: db.RunContext | None = None

    def say(msg: str) -> None:
        if verbose:
            print(msg, flush=True)

    def record(stage: str, status: str, detail: str = "", tool: str = "",
               started: float | None = None, metrics: dict | None = None) -> None:
        duration = (time.time() - started) if started else 0.0
        rec = StageRecord(stage, status, detail, tool, duration, metrics or {})
        result.stages.append(rec)
        say(f"  [{stage}] {status} ({duration:.1f}s) {detail}")
        if conn is not None and ctx is not None:
            db.record_stage(conn, ctx.run_id, stage, status, STAGES.index(stage),
                            detail, tool, metrics, duration)
            conn.commit()

    try:
        if persist:
            if not org_id:
                raise ValueError("persist=True requires org_id")
            conn = db.open_connection()

        # --- 01 ingest -----------------------------------------------------
        t = time.time()
        sources = list(spec.fastqs.values()) + ([spec.count_table] if spec.count_table else [])
        missing = [p for p in sources if not Path(p).exists()]
        if missing:
            raise FileNotFoundError(f"input not found: {missing}")
        total_bytes = sum(Path(p).stat().st_size for p in sources)

        # The design is settled here, before anything expensive runs. A mistyped
        # sample label or a swapped contrast used to survive counting and QC and
        # then either analyse the wrong arms or fail inside MAGeCK, minutes in,
        # with a message that named MAGeCK rather than the typo. Sample labels
        # for an uploaded count table live only in its header, so that is read
        # first.
        labels = (list(spec.fastqs) if spec.fastqs
                  else count_table_samples(Path(spec.count_table)))
        design = build_design(labels, spec.roles, spec.treatment, spec.control)
        result.design = design
        roles, treat, ctrl = design.roles, design.treatment, design.control
        for note in design.notes:
            say(f"      design: {note}")
        detail = (f"{len(sources)} file(s), {total_bytes / 1e9:.2f} GB, "
                  f"{'+'.join(treat)} vs {'+'.join(ctrl)}")

        if persist and conn is not None:
            screen_id = db.create_screen(conn, org_id, spec.name, spec.library_slug,
                                         spec.cell_line, spec.phenotype, spec.modality,
                                         created_by)
            run_id = db.start_run(conn, screen_id, org_id,
                                  {"treatment": treat, "control": ctrl,
                                   "roles": roles, "design_notes": design.notes})
            ctx = db.RunContext(org_id, screen_id, run_id, "")
            result.screen_id, result.run_id = screen_id, run_id
            conn.commit()
        record("ingest", "done", detail, "splicr.ingest", t, design.as_dict())

        # --- 02 detect -----------------------------------------------------
        t = time.time()
        if spec.library_slug:
            library = load_library(spec.library_slug)
            detail = f"{library.name} (supplied, not detected)"
        else:
            probe = next(iter(spec.fastqs.values()), None)
            detection = (detect_from_fastq(probe) if probe
                         else detect_from_count_table(read_count_table(spec.count_table)))
            result.detection = detection
            if not detection.best:
                raise RuntimeError(f"library could not be identified: {detection.reason}")
            library = load_library(detection.best.slug)
            detail = detection.describe()
        result.library = library
        record("detect", "done", detail, "splicr.detect", t,
               {"library": library.slug, "n_guides": len(library)})

        # --- 03 count ------------------------------------------------------
        t = time.time()
        if spec.fastqs:
            samples: list[SampleCounts] = []
            location = None
            for label, path in spec.fastqs.items():
                sc = count_fastq(Path(path), library, label=label, location=location)
                location = sc.location      # reuse across samples of one screen
                samples.append(sc)
                say(f"      {sc.summary()}")
            matrix = CountMatrix.from_samples(library, samples)
            mean_rate = sum(s.mapping_rate for s in samples) / len(samples)
            detail = f"{len(samples)} samples, {mean_rate:.1%} mean mapping rate"
        else:
            matrix = read_count_table(Path(spec.count_table), library)
            detail = f"count table with {len(matrix.samples)} samples"
        result.matrix = matrix
        record("count", "done", detail, "splicr.count", t,
               {"n_samples": len(matrix.samples), "n_guides": len(matrix.guide_ids)})

        if persist and conn is not None and ctx is not None:
            sample_ids = db.write_samples(conn, ctx.screen_id, matrix, roles)
            n = db.write_guide_counts(conn, ctx, matrix, sample_ids)
            conn.commit()
            say(f"      wrote {n:,} guide count rows")
        else:
            sample_ids = {}

        # --- 04 QC ---------------------------------------------------------
        t = time.time()
        qc = screen_qc(matrix, roles, treat, ctrl, library)
        result.qc = qc
        nnmd = f"NNMD {qc.nnmd:.2f}" if qc.nnmd is not None else "NNMD n/a"
        record("qc", "done", f"{qc.verdict}, {nnmd}", "splicr.qc", t, qc.as_dict())
        if persist and conn is not None and ctx is not None and sample_ids:
            db.write_qc(conn, ctx, qc, sample_ids)
            conn.commit()

        if qc.verdict == "fail":
            say("      QC failed; continuing so the report can explain why")

        # --- 05 hits -------------------------------------------------------
        t = time.time()
        hits = call_hits(matrix, library, treat, ctrl, workdir / "hits")
        result.hits = hits
        sig = hits.significant(0.1)
        record("hits", "done",
               f"{len(hits.genes)} genes, {len(sig)} at FDR 0.1, methods {hits.methods}",
               ", ".join(hits.methods), t,
               {"methods": hits.methods, "n_significant": len(sig),
                "warnings": hits.warnings})

        if persist and conn is not None and ctx is not None:
            comparison_id = db.create_comparison(
                conn, ctx.screen_id, "primary",
                [sample_ids[s] for s in treat if s in sample_ids],
                [sample_ids[s] for s in ctrl if s in sample_ids],
            )
            ctx.comparison_id = comparison_id
            conn.commit()

        # --- 06 artifacts --------------------------------------------------
        # The Atlas is retrieved here rather than in stage 07, because the
        # frequent_hitter flag needs it and stage 07 runs after this one. Stage
        # 07 then reports on what this loaded. atlas_context never raises: a
        # missing or half-built Atlas comes back as available=False with a
        # reason, and flag_artifacts falls back to DepMap pan-essentials alone
        # rather than to a fabricated rate.
        t = time.time()
        t_atlas = time.time()
        atlas = atlas_context(
            sorted(hits.genes),
            cell_line=spec.cell_line,
            phenotype=spec.phenotype,
        )
        atlas_seconds = time.time() - t_atlas
        result.atlas = atlas
        flags = flag_artifacts(hits, library, model_id=spec.model_id,
                               atlas_hit_rates=atlas.hit_rates if atlas.available else None)
        result.flags = flags
        # Reported over the called hits. Every gene keeps its flags in the
        # database; the headline is about the genes anyone will read.
        called = [g.gene for g in hits.significant(0.1)]
        on_called = summarise_flags(flags, called)
        record("artifacts", "done",
               f"{len(called)} called hits: {on_called or 'no flags'}",
               "splicr.artifacts", t,
               {"on_called_hits": on_called, "all_genes": summarise_flags(flags)})

        # --- 07 atlas ------------------------------------------------------
        t = time.time()
        # The work happened in stage 06, so the duration is back-dated.
        # Recording time.time() here would report 0.0s for a stage that did
        # real work.
        record("atlas", "done" if atlas.available else "skipped",
               atlas.describe(), "splicr.atlas", time.time() - atlas_seconds,
               atlas.metrics())

        # --- 08 score ------------------------------------------------------
        t = time.time()
        record("score", "skipped",
               "no calibrated model is fitted yet, so hits are stored without a confidence",
               "splicr.score", t)

        # --- 09 report -----------------------------------------------------
        t = time.time()
        if persist and conn is not None and ctx is not None:
            written = db.write_hits(conn, ctx, hits, flags)
            db.finish_run(conn, ctx, "complete")
            conn.commit()
            record("report", "done", f"wrote {written:,} hit rows", "splicr.db", t)
        else:
            record("report", "done", "in-memory only", "splicr.report", t)

    except Exception as exc:
        result.failed_at = result.stages[-1].stage if result.stages else "ingest"
        result.error = f"{type(exc).__name__}: {exc}"
        say(f"  FAILED at {result.failed_at}: {result.error}")
        if verbose:
            traceback.print_exc()
        if conn is not None and ctx is not None:
            try:
                db.log_event(conn, ctx.run_id, result.error, result.failed_at, "error")
                db.finish_run(conn, ctx, "failed", result.error)
                conn.commit()
            except Exception:
                pass
    finally:
        if conn is not None:
            try:
                conn.commit()
            finally:
                conn.close()

    return result

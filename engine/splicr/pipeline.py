"""
The pipeline: nine stages from reads to scored hits.

Each stage records its own row, so a run is inspectable while it is still
going and a failure says which stage failed rather than just failing. A
caller can run the whole thing in memory, or persist every stage to Postgres
by passing an org_id.
"""

from __future__ import annotations

import time
import sys
import traceback
import json
import hashlib
import platform
from dataclasses import asdict, dataclass, field
from pathlib import Path

from . import db
from .artifacts import Flag, flag_artifacts, summarise_flags
from .atlas import AtlasResult, atlas_context
from .count import (
    CountMatrix, SampleCounts, count_fastq, count_table_samples, read_count_table,
)
from .design import Design, DesignError, REFERENCE_ROLES, build_design
from .detect import Detection, detect_from_count_table, detect_from_fastq
from .hits import HitTable, call_hits
from .qc import ScreenQc, screen_qc
from .references import Library, load_library

STAGES = ("ingest", "detect", "count", "qc", "hits", "artifacts", "atlas", "score", "report")

#: How many genes get their guides' protein context resolved at analysis time.
#: Placing one cut in the MANE CDS is cheap; the UniProt feature lookup behind it
#: is a network call on a cache miss, so a genome-wide run would make twenty
#: thousand of them for genes nobody opens. The shortlist is the genes that
#: reached significance, most significant first, and every other guide is still
#: stored with its measurement and coordinates and says the protein context was
#: not requested - which is not the same as looked for and not found.
GUIDE_ANNOTATION_LIMIT = 500


def _persist_guide_evidence(conn, ctx, hits: HitTable, library: Library,
                            significant) -> tuple[int, int]:
    """
    Store what the deep dive reads, and never fail the run over it.

    Two tables, one pass:

      public.guide_effects      MAGeCK's own per-guide fold change under the guide
                                id MAGeCK printed, the library's verified cut
                                coordinates, and - for the shortlist - the residue
                                and curated features that cut falls in.
      public.gene_disagreement  one report per gene with at least two guides: the
                                spread against this screen's own spread for genes
                                of the same size, whether the call survives
                                dropping a guide, and the concordance table.

    The gene-level statistics are computed for every gene, because they are
    arithmetic on numbers already in hand. The protein context is resolved only
    for the shortlist, and a gene outside it records concordance_status
    'not_evaluated' rather than a finding of no annotation.

    Returns (guide rows, gene rows). Either failure is logged as a run event and
    leaves the gene-level results, which stand on their own, untouched.
    """
    from .validate.domain_report import (
        DEPLETION_LFC, MIN_GUIDES, REFERENCE_VERSIONS, Provenance, annotate_guides,
        build_report, spread_baseline,
    )

    if not hits.guide_effects:
        db.log_event(conn, ctx.run_id,
                     "no per-guide rows stored: the caller produced no sgRNA summary",
                     "report", "warn")
        return 0, 0
    shortlist = {
        g.gene for g in sorted(
            significant, key=lambda g: (g.fdr if g.fdr is not None else 1.0))
        [:GUIDE_ANNOTATION_LIMIT]
    }
    try:
        annotated = annotate_guides(hits.guide_effects, library, genes=shortlist)
        guide_rows = db.write_guide_effects(conn, ctx, annotated, REFERENCE_VERSIONS)
    except Exception as exc:  # noqa: BLE001
        db.log_event(conn, ctx.run_id,
                     f"per-guide rows were not stored: {type(exc).__name__}: {exc}",
                     "report", "warn")
        return 0, 0

    try:
        usable = [g for g in annotated
                  if g.gene and g.log2_fold_change == g.log2_fold_change]
        baseline, n_baseline = spread_baseline(
            (g.gene, g.log2_fold_change) for g in usable)
        by_gene: dict[str, list] = {}
        for row in usable:
            by_gene.setdefault(row.gene, []).append(row)
        provenance = Provenance(
            reference_versions=REFERENCE_VERSIONS,
            measurement_source="MAGeCK sgRNA summary for this comparison",
        )
        reports = [
            build_report(
                gene, rows, ensembl_gene_id=None,
                uniprot_accession=next((r.uniprot_accession for r in rows
                                        if r.uniprot_accession), None),
                mane_transcript=next((r.mane_transcript for r in rows
                                      if r.mane_transcript), None),
                n_residues=next((r.n_residues for r in rows if r.n_residues), None),
                depletion_lfc=DEPLETION_LFC, baseline=baseline or None,
                baseline_n_genes=n_baseline or None, provenance=provenance,
                protein_context_requested=gene in shortlist,
            )
            for gene, rows in sorted(by_gene.items())
            if len(rows) >= MIN_GUIDES
        ]
        gene_rows = db.write_gene_disagreement(conn, ctx, reports)
    except Exception as exc:  # noqa: BLE001
        db.log_event(conn, ctx.run_id,
                     f"gene disagreement rows were not stored: {type(exc).__name__}: {exc}",
                     "report", "warn")
        return guide_rows, 0
    return guide_rows, gene_rows


def _file_sha256(path: Path) -> str | None:
    """Hash existing analysis inputs; missing evidence remains explicit."""
    try:
        with path.open("rb") as handle:
            digest = hashlib.sha256()
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
            return digest.hexdigest()
    except FileNotFoundError:
        return None


def _report_provenance(workdir: Path, source_dir: Path | None = None) -> dict:
    source_dir = source_dir or Path(__file__).resolve().parent
    counts = workdir / "hits" / "counts.txt"
    counts_hash = _file_sha256(counts)
    requirements = source_dir.parent / "requirements.txt"
    return {
        "python_version": platform.python_version(),
        "code_sha256": {name: _file_sha256(source_dir / name) for name in (
            "pipeline.py", "hits.py", "count.py", "qc.py", "artifacts.py", "atlas.py",
        )},
        "requirements_sha256": _file_sha256(requirements),
        "requirements_note": "Declared dependency pins; this is not an installed-environment lockfile.",
        "analyzed_counts": {
            "path": str(counts), "sha256": counts_hash,
            "available": counts_hash is not None,
            "unavailable_reason": "analysis count file is absent" if counts_hash is None else None,
        },
    }


def _score_candidates(hits: HitTable, flags, qc, atlas, spec, result) -> dict:
    """
    Ask the Validation Network for a calibrated probability per called hit.

    Returns a payload for the stage record and the report, never raising: a
    scoring failure must not lose a run that has already produced its hits and
    its QC. A failure comes back as zero estimates with the exception in
    `detail`, which is a worse outcome than a probability and a much better one
    than a lost run.

    The four questions are kept apart all the way through. A candidate can come
    back with a probability for independent genetic reproduction and a refusal
    for pharmacologic translation, which is the normal case rather than an edge
    one.
    """
    from .validation.endpoints import QUESTIONS
    from .validation.network import Estimate
    from .validation.store import load_network

    blank = {"n_estimated": 0, "n_declined": 0, "by_question": {}, "candidates": [],
             "cohort": None, "detail": "", "metrics": {}}
    try:
        loaded = load_network()
    except Exception as exc:  # noqa: BLE001 - scoring never loses a run
        blank["detail"] = (f"the validation cohort could not be loaded, so no "
                           f"probability was estimated: {type(exc).__name__}: {exc}")
        blank["metrics"] = {"validation_probability": None,
                            "validation_error": blank["detail"]}
        return blank

    called = hits.significant(0.1)
    context = {
        "assay_class": _assay_class(spec),
        "modality": spec.modality if spec.modality in
                    ("knockout", "crispri", "crispra", "base_editing") else "other",
        "phenotype_family": _phenotype_family(spec),
        "model_type": "cancer_cell_line",
        "treatment": spec.condition,
    }
    try:
        candidates = [
            {"gene": gene.gene,
             "context": context,
             "n_genes_scored": len(hits.genes),
             "hit": {"lfc": gene.lfc, "fdr": gene.fdr, "p_value": gene.p_value,
                     "bayes_factor": gene.bayes_factor, "norm_z": gene.norm_z,
                     "n_guides": gene.n_guides, "n_good_guides": gene.n_good_guides,
                     "direction": "depleted" if (gene.lfc or 0) < 0 else "enriched",
                     "max_guide_share": gene.max_guide_share,
                     "atlas_hit_rate": (atlas.hit_rates.get(gene.gene)
                                        if atlas.available and atlas.hit_rates else None)},
             "qc": qc.as_dict().get("run", {}) if hasattr(qc, "as_dict") else {},
             "flags": [f.flag for f in flags.get(gene.gene, [])]}
            for gene in called
        ]
        estimates = loaded.network.estimate_many(candidates)
    except Exception as exc:  # noqa: BLE001
        blank["detail"] = (f"candidates could not be scored, so no probability was "
                           f"estimated: {type(exc).__name__}: {exc}")
        blank["metrics"] = {"validation_probability": None,
                            "validation_error": blank["detail"],
                            "cohort": loaded.as_dict()}
        return blank

    rows: list[dict] = []
    n_estimated = 0
    by_question: dict[str, dict] = {q: {"estimated": 0, "declined": 0, "reasons": {}}
                                    for q in QUESTIONS}
    for candidate, per_question in zip(candidates, estimates):
        row = {"gene": candidate["gene"], "questions": {}}
        any_available = False
        for question, value in per_question.items():
            row["questions"][question] = value.as_dict()
            if isinstance(value, Estimate):
                by_question[question]["estimated"] += 1
                any_available = True
            else:
                by_question[question]["declined"] += 1
                reason = value.reason
                by_question[question]["reasons"][reason] = (
                    by_question[question]["reasons"].get(reason, 0) + 1)
        rows.append(row)
        if any_available:
            n_estimated += 1

    n_declined = len(rows) - n_estimated
    if n_estimated:
        detail = (f"{n_estimated} of {len(rows)} called hits received at least one "
                  f"calibrated probability; {n_declined} were outside the "
                  f"calibrated cohort. {loaded.source}")
    elif rows:
        first = next(iter(rows[0]["questions"].values()))
        detail = (f"no probability was estimated for any of {len(rows)} called "
                  f"hits. {first.get('because', '')}")
    else:
        detail = (f"no hit reached the calling threshold, so nothing was scored. "
                  f"{loaded.source}")

    return {
        "n_estimated": n_estimated, "n_declined": n_declined,
        "by_question": by_question, "candidates": rows,
        "cohort": loaded.as_dict(), "detail": detail,
        "metrics": {"n_called": len(rows), "n_estimated": n_estimated,
                    "n_declined": n_declined, "by_question": by_question,
                    "cohort": loaded.as_dict(),
                    "context": context},
    }


def _assay_class(spec) -> str:
    """The cohort stratum's assay class, from the screen's own declaration."""
    if spec.condition:
        return "drug_modifier"
    phenotype = (spec.phenotype or "").lower()
    if "reporter" in phenotype or "facs" in phenotype:
        return "reporter"
    if spec.fitness_assay is False:
        return "other"
    return "ko_fitness"


def _phenotype_family(spec) -> str:
    phenotype = (spec.phenotype or "").lower()
    if spec.condition:
        #: A drug arm is resistance or sensitisation and the pipeline does not
        #: know which from the contrast alone, so it reports the one the
        #: condition name states and 'other' when it states neither. Guessing
        #: would put the screen in the wrong stratum, which is worse than
        #: landing in 'other' and being refused a number.
        if "resist" in phenotype:
            return "drug_resistance"
        if "sensit" in phenotype:
            return "drug_sensitisation"
        return "other"
    if "reporter" in phenotype or "facs" in phenotype:
        return "reporter"
    if "differentiat" in phenotype:
        return "differentiation"
    if spec.fitness_assay is False:
        return "other"
    return "fitness"


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
    report_path: Path | None = None
    #: The score stage's output: per-candidate, per-question calibrated
    #: probabilities, or the named reason there are none.
    validation: dict | None = None

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
    condition: str | None = None
    # None uses only unambiguous fitness phenotype labels. A reporter/FACS
    # screen must not be judged by loss of core essential genes.
    fitness_assay: bool | None = None
    run_drugz: bool = False
    drugz_paired: bool = False


@dataclass
class ExistingRun:
    """Database rows already created by the console intake."""

    org_id: str
    screen_id: str
    run_id: str
    comparison_id: str | None = None


def run_pipeline(
    spec: ScreenInput,
    workdir: Path,
    org_id: str | None = None,
    created_by: str | None = None,
    persist: bool = False,
    verbose: bool = True,
    existing: ExistingRun | None = None,
) -> PipelineResult:
    """
    Run the pipeline.

    persist=True writes every stage to Postgres as it completes, so progress
    is visible from the app while the run is still going. It needs org_id.
    """
    result = PipelineResult(screen_name=spec.name)
    workdir = workdir.resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    conn = None
    ctx: db.RunContext | None = None
    active_stage = "ingest"

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
            if existing is None and not org_id:
                raise ValueError("persist=True requires org_id")
            conn = db.open_connection()

        # --- 01 ingest -----------------------------------------------------
        t = time.time()
        sources = list(spec.fastqs.values()) + ([spec.count_table] if spec.count_table else [])
        if bool(spec.fastqs) == bool(spec.count_table):
            raise ValueError("supply exactly one input type: FASTQ files or a count table")
        if spec.drugz_paired and not spec.run_drugz:
            raise ValueError("drugz_paired requires run_drugz=True")
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
        loss_of_function = spec.modality.lower() in {
            "knockout", "crisprko", "crispr-ko", "ko", "inhibition", "crispri", "crispr-i",
        }
        fitness = (spec.fitness_assay if spec.fitness_assay is not None else
                   (spec.phenotype or "").strip().lower() in {
                       "fitness", "viability", "proliferation", "cell viability",
                       "cell proliferation", "growth", "essentiality", "dropout",
                   })
        assess_essentiality = loss_of_function and fitness
        essentiality_contrast = assess_essentiality and all(roles[s] in REFERENCE_ROLES for s in ctrl)
        for note in design.notes:
            say(f"      design: {note}")
        detail = (f"{len(sources)} file(s), {total_bytes / 1e9:.2f} GB, "
                  f"{'+'.join(treat)} vs {'+'.join(ctrl)}")

        if persist and conn is not None:
            settings = {"treatment": treat, "control": ctrl,
                        "roles": roles, "design_notes": design.notes}
            if existing is not None:
                screen_id, run_id = existing.screen_id, existing.run_id
                ctx = db.RunContext(existing.org_id, existing.screen_id, existing.run_id,
                                    existing.comparison_id or "")
                conn.execute(
                    """
                    update public.runs
                       set status = 'running',
                           started_at = coalesce(started_at, now()),
                           settings = coalesce(nullif(settings, '{}'::jsonb), %s::jsonb)
                     where id = %s
                    """,
                    (json.dumps(settings), existing.run_id),
                )
                conn.execute(
                    "update public.screens set status = 'running', current_run_id = %s where id = %s",
                    (existing.run_id, existing.screen_id),
                )
            else:
                screen_id = db.create_screen(conn, org_id, spec.name, spec.library_slug,
                                             spec.cell_line, spec.phenotype, spec.modality,
                                             created_by)
                run_id = db.start_run(conn, screen_id, org_id, settings)
                ctx = db.RunContext(org_id, screen_id, run_id, "")
            result.screen_id, result.run_id = screen_id, run_id
            conn.commit()
        record("ingest", "done", detail, "splicr.ingest", t, design.as_dict())

        # --- 02 detect -----------------------------------------------------
        active_stage = "detect"
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
        active_stage = "count"
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
        active_stage = "qc"
        t = time.time()
        qc = screen_qc(matrix, roles, treat, ctrl, library,
                       assess_essentiality=assess_essentiality)
        result.qc = qc
        nnmd = f"NNMD {qc.nnmd:.2f}" if qc.nnmd is not None else "NNMD n/a"
        record("qc", "done", f"{qc.verdict}, {nnmd}", "splicr.qc", t, qc.as_dict())
        if persist and conn is not None and ctx is not None and sample_ids:
            db.write_qc(conn, ctx, qc, sample_ids)
            conn.commit()

        if qc.verdict == "fail":
            say("      QC failed; continuing so the report can explain why")

        # --- 05 hits -------------------------------------------------------
        active_stage = "hits"
        t = time.time()
        hits = call_hits(matrix, library, treat, ctrl, workdir / "hits",
                         run_bagel=essentiality_contrast,
                         run_drug=spec.run_drugz, drugz_paired=spec.drugz_paired,
                         essentiality_contrast=essentiality_contrast)
        if not essentiality_contrast:
            hits.warnings.append("BAGEL2 and the essential-direction inversion guard were "
                                 "not applied: this contrast is not a declared loss-of-function "
                                 "fitness endpoint against a library reference.")
        result.hits = hits
        sig = hits.significant(0.1)
        record("hits", "done",
               f"{len(hits.genes)} genes, {len(sig)} at FDR 0.1, methods {hits.methods}",
               ", ".join(hits.methods), t,
               {"methods": hits.methods, "n_significant": len(sig),
                "warnings": hits.warnings,
                "fdr_method": "min(1, 2*min(MAGeCK directional FDRs)); two-family union bound",
                "essentiality_contrast": essentiality_contrast})

        if persist and conn is not None and ctx is not None:
            comparison_id = db.create_comparison(
                conn, ctx.screen_id, "primary",
                [sample_ids[s] for s in treat if s in sample_ids],
                [sample_ids[s] for s in ctrl if s in sample_ids],
            ) if not ctx.comparison_id else ctx.comparison_id
            ctx.comparison_id = comparison_id
            conn.commit()

        # --- 06 artifacts --------------------------------------------------
        active_stage = "artifacts"
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
            condition=spec.condition,
            modality=spec.modality,
            library=library.slug,
        )
        atlas_seconds = time.time() - t_atlas
        result.atlas = atlas
        flags = flag_artifacts(hits, library, model_id=spec.model_id,
                               atlas_hit_rates=atlas.hit_rates if atlas.available else None,
                               modality=spec.modality,
                               screened_guide_ids={gid for gid, row in zip(matrix.guide_ids, matrix.matrix)
                                                   if any(row)})
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
        active_stage = "atlas"
        t = time.time()
        # The work happened in stage 06, so the duration is back-dated.
        # Recording time.time() here would report 0.0s for a stage that did
        # real work.
        record("atlas", "done" if atlas.available else "skipped",
               atlas.describe(), "splicr.atlas", time.time() - atlas_seconds,
               atlas.metrics())

        # --- 08 score ------------------------------------------------------
        active_stage = "score"
        t = time.time()
        # The Validation Network, if a cohort exists to fit it on.
        #
        # This stage used to be hard-coded `skipped`, which was true and
        # uninformative: it said no calibrated model is fitted without saying
        # what would change that. It now asks the network, and the network
        # either returns calibrated per-question probabilities or returns the
        # named shortfall that keeps the gate shut. Either way the reason is
        # recorded against the run rather than asserted in a string.
        #
        # Nothing here can invent a number. `estimate` consults the coverage
        # gate before it asks the model, so a run outside the calibrated cohort
        # produces no probability at all - not a probability that the report
        # then declines to print.
        scored = _score_candidates(hits, flags, qc, atlas, spec, result)
        result.validation = scored
        record("score",
               "done" if scored["n_estimated"] > 0 else "skipped",
               scored["detail"], "splicr.validation", t, scored["metrics"])

        # --- 09 report -----------------------------------------------------
        active_stage = "report"
        t = time.time()
        # A portable report also preserves raw directional statistics, which
        # the existing database columns cannot represent without a migration.
        report = {
            "schema_version": "splicr.postscreen.v1",
            "provenance": _report_provenance(workdir),
            "screen_name": spec.name,
            "task": "post_screen_analysis",
            "context": {"cell_line": spec.cell_line, "phenotype": spec.phenotype,
                        "modality": spec.modality, "condition": spec.condition},
            "design": design.as_dict(), "qc": qc.as_dict(),
            "methods": hits.methods, "warnings": hits.warnings,
            "drugz_pairing": ("paired in the declared sample order" if spec.drugz_paired
                              else "unpaired") if spec.run_drugz else None,
            "statistics": {"fdr_method": "min(1, 2*min(MAGeCK directional FDRs)); two-family union bound",
                           "p_value_method": "min(1, 2*min(MAGeCK directional p-values))",
                           "directional_statistics": "tool-native; separate tail families",
                           # The score stage answers this now. It is still null
                           # whenever the coverage gate is shut, and the reason
                           # is the gate's own sentence rather than a constant.
                           "validation_probability":
                               "per candidate and per question; see the validation block"
                               if (result.validation or {}).get("n_estimated") else None,
                           "validation_probability_reason":
                               (result.validation or {}).get("detail")
                               or "the score stage did not run"},
            "validation": result.validation,
            "atlas": atlas.metrics(),
            "comparable_screens": [asdict(screen) for screen in atlas.comparable],
            "tool_output_directory": str(workdir / "hits"),
            "genes": [{**asdict(g), "flags": [asdict(f) for f in flags.get(g.gene, [])],
                       "atlas_context": (atlas.contexts[g.gene].as_dict()
                                         if g.gene in atlas.contexts else None)}
                      for g in hits.ranked()],
        }
        report_path = workdir / "postscreen_report.json"
        temporary = report_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
        temporary.replace(report_path)
        result.report_path = report_path
        if persist and conn is not None and ctx is not None:
            written = db.write_hits(conn, ctx, hits, flags)
            guide_rows, gene_rows = _persist_guide_evidence(conn, ctx, hits, library, sig)
            #  Both branches of the gate are stored. A refusal is a row saying
            #  which candidate was considered and why no probability was
            #  stated, because a gene with no row and a gene the gate declined
            #  look identical to a reader otherwise. A failure here is logged
            #  and does not lose a run that has already produced its hits.
            prediction_rows = 0
            try:
                prediction_rows = db.write_validation_predictions(
                    conn, ctx, result.validation or {})
            except Exception as exc:  # noqa: BLE001
                db.log_event(conn, ctx.run_id,
                             f"validation predictions were not stored: "
                             f"{type(exc).__name__}: {exc}", "score", "warn")
            db.finish_run(conn, ctx, "complete")
            conn.commit()
            record("report", "done",
                   f"wrote {written:,} hit rows, {guide_rows:,} per-guide rows, "
                   f"{gene_rows:,} guide-disagreement reports and "
                   f"{prediction_rows:,} validation predictions",
                   "splicr.db", t)
        else:
            record("report", "done", str(report_path), "splicr.report", t)

    except Exception as exc:
        result.failed_at = active_stage
        result.error = f"{type(exc).__name__}: {exc}"
        result.stages.append(StageRecord(active_stage, "failed", result.error))
        say(f"  FAILED at {result.failed_at}: {result.error}")
        if verbose:
            traceback.print_exc()
        if conn is not None and ctx is not None:
            try:
                db.log_event(conn, ctx.run_id, result.error, result.failed_at, "error")
                db.finish_run(conn, ctx, "failed", result.error)
                conn.commit()
            except Exception as recording:  # noqa: BLE001 - the run already failed
                #  Swallowing this leaves the run marked running for ever with
                #  no record of why it stopped, which is how a failure becomes
                #  invisible. The original failure is still what gets raised to
                #  the caller; this one goes to stderr so an operator sees that
                #  the record itself is missing.
                print(f"  FAILED to record the failure: {type(recording).__name__}: {recording}",
                      file=sys.stderr)
    finally:
        if conn is not None:
            try:
                conn.commit()
            finally:
                conn.close()

    return result

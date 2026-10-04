"""
Writing pipeline results to Postgres.

The engine connects with the secret key and therefore bypasses Row Level
Security. That is deliberate and is exactly why it must never run anywhere a
browser can reach it. Every row it writes carries an org_id, so the policies
that protect reads still apply to everyone else.

Bulk paths use COPY rather than executemany: a genome-wide screen is ~77k
guide rows per sample, and row-by-row inserts turn a 20 second write into
several minutes.
"""

from __future__ import annotations

import json
import os
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

try:
    import psycopg
    from psycopg import sql
except ImportError:  # pragma: no cover
    psycopg = None

from .artifacts import Flag
from .count import CountMatrix
from .hits import HitTable
from .qc import ScreenQc
from .references import Library


def _load_env() -> None:
    """Read .env files without adding a dependency."""
    root = Path(__file__).resolve().parents[2]
    for name in (".env", ".env.local"):
        path = root / name
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


def database_url() -> str:
    _load_env()
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError(
            "SUPABASE_DB_URL is not set. Copy .env.example to .env and fill in the "
            "pooler connection string."
        )
    return url


def open_connection() -> "psycopg.Connection":
    """
    Open a connection the caller owns and must close.

    Use this for long-running work such as a pipeline run, which needs to
    commit progress at each stage rather than once at the end. Do NOT write
    `db.connect().__enter__()`: the context manager would be garbage
    collected immediately and its cleanup would close the connection out
    from under you.
    """
    if psycopg is None:  # pragma: no cover
        raise RuntimeError(
            "psycopg is not installed: engine/.tools/env/bin/python -m pip install 'psycopg[binary]'"
        )
    return psycopg.connect(database_url(), autocommit=False)


@contextmanager
def connect() -> Iterator["psycopg.Connection"]:
    """Short transactional block: commits on success, rolls back on error."""
    conn = open_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Verdict mapping
# ---------------------------------------------------------------------------

def classify(
    gene: str,
    chance: float | None,
    novelty: float | None,
    flags: list[Flag],
) -> str:
    """
    Map a scored gene onto the public.hit_verdict enum.

    Artifact flags are risk assessments, not confirmed experimental failures.
    A critical flag requires review even with a high score, but cannot prove
    the gene is an artifact: amplified loci can contain true dependencies.
    """
    if any(f.severity == "critical" for f in flags):
        return "uncertain"
    if chance is None:
        return "uncertain"
    if chance < 0.35:
        return "artifact"
    if chance < 0.6:
        return "uncertain"
    if any(f.flag == "frequent_hitter" for f in flags):
        return "real_generic"
    if novelty is not None and novelty >= 0.5:
        return "real_new"
    return "real_known"


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

@dataclass
class RunContext:
    org_id: str
    screen_id: str
    run_id: str
    comparison_id: str


def create_screen(
    conn: "psycopg.Connection",
    org_id: str,
    name: str,
    library_slug: str | None,
    cell_line: str | None = None,
    phenotype: str | None = None,
    modality: str = "knockout",
    created_by: str | None = None,
) -> str:
    library_id = None
    if library_slug:
        row = conn.execute(
            "select id from atlas.libraries where slug = %s and org_id is null",
            (library_slug,),
        ).fetchone()
        library_id = row[0] if row else None

    return conn.execute(
        """
        insert into public.screens
            (org_id, name, library_id, cell_line, phenotype, modality, status, created_by)
        values (%s, %s, %s, %s, %s, %s, 'running', %s)
        returning id
        """,
        (org_id, name, library_id, cell_line, phenotype, modality, created_by),
    ).fetchone()[0]


def start_run(conn: "psycopg.Connection", screen_id: str, org_id: str,
              settings: dict | None = None, engine_version: str = "0.1.0") -> str:
    run_id = conn.execute(
        """
        insert into public.runs (screen_id, org_id, status, settings, engine_version, started_at)
        values (%s, %s, 'running', %s, %s, now())
        returning id
        """,
        (screen_id, org_id, json.dumps(settings or {}), engine_version),
    ).fetchone()[0]
    conn.execute("update public.screens set current_run_id = %s where id = %s",
                 (run_id, screen_id))
    return run_id


def record_stage(conn: "psycopg.Connection", run_id: str, stage: str, status: str,
                 position: int, detail: str = "", tool: str = "",
                 metrics: dict | None = None, duration_sec: float | None = None) -> None:
    conn.execute(
        """
        insert into public.run_stages
            (run_id, stage, status, position, detail, tool, metrics, duration_sec,
             started_at, finished_at)
        values (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
        on conflict (run_id, stage) do update set
            status = excluded.status, detail = excluded.detail,
            metrics = excluded.metrics, duration_sec = excluded.duration_sec,
            finished_at = now()
        """,
        (run_id, stage, status, position, detail, tool,
         json.dumps(metrics or {}), duration_sec),
    )


def write_samples(conn: "psycopg.Connection", screen_id: str,
                  matrix: CountMatrix, roles: dict[str, str]) -> dict[str, str]:
    """Create sample rows and return label -> sample_id."""
    ids: dict[str, str] = {}
    for position, label in enumerate(matrix.samples):
        ids[label] = conn.execute(
            """
            insert into public.samples (screen_id, label, condition, replicate, role, position)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (screen_id, label) do update set role = excluded.role
            returning id
            """,
            (screen_id, label, roles.get(label, "treatment"), 1,
             roles.get(label, "treatment"), position),
        ).fetchone()[0]
    return ids


def write_guide_counts(conn: "psycopg.Connection", ctx: RunContext,
                       matrix: CountMatrix, sample_ids: dict[str, str]) -> int:
    """
    Bulk-load the count matrix with COPY.

    Guides with no reads in any sample are skipped: they are not part of the
    experiment and storing tens of thousands of zeros per sample is pure
    waste on a partly represented library.
    """
    written = 0
    with conn.cursor().copy(
        "copy public.guide_counts "
        "(screen_id, run_id, sample_id, guide_key, gene_symbol, count) from stdin"
    ) as copy:
        for i, guide_id in enumerate(matrix.guide_ids):
            row = matrix.matrix[i]
            if not any(row):
                continue
            gene = matrix.genes[i]
            for j, label in enumerate(matrix.samples):
                copy.write_row((ctx.screen_id, ctx.run_id, sample_ids[label],
                                guide_id, gene, row[j]))
                written += 1
    return written


def write_qc(conn: "psycopg.Connection", ctx: RunContext, qc: ScreenQc,
             sample_ids: dict[str, str]) -> None:
    for s in qc.samples:
        sample_id = sample_ids.get(s.label)
        if sample_id is None:
            continue
        conn.execute(
            """
            insert into public.sample_qc
                (run_id, sample_id, total_reads, mapped_reads, mapped_frac,
                 zero_guides, zero_frac, gini, skew_ratio, mean_reads_per_guide,
                 verdict, notes, metrics)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (run_id, sample_id) do update set
                verdict = excluded.verdict, metrics = excluded.metrics,
                total_reads = excluded.total_reads, mapped_reads = excluded.mapped_reads,
                mapped_frac = excluded.mapped_frac, notes = excluded.notes
            """,
            (ctx.run_id, sample_id, s.total_reads, s.mapped_reads, s.mapping_rate,
             s.zero_guides, s.zero_fraction, s.gini,
             None if s.skew_ratio == float("inf") else s.skew_ratio,
             s.mean_reads_per_guide, s.verdict, " ".join(s.notes),
             json.dumps(s.as_dict())),
        )

    conn.execute(
        """
        insert into public.run_qc
            (run_id, verdict, auroc, nnmd, min_replicate_r, median_replicate_r,
             bottlenecked_samples, metrics, notes)
        values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        on conflict (run_id) do update set
            verdict = excluded.verdict, metrics = excluded.metrics
        """,
        (ctx.run_id, qc.verdict, qc.auroc, qc.nnmd,
         min((p.r for p in qc.replicate_pairs), default=None),
         (sorted(p.r for p in qc.replicate_pairs)[len(qc.replicate_pairs) // 2]
          if qc.replicate_pairs else None),
         len(qc.bottlenecked), json.dumps(qc.as_dict()), " ".join(qc.notes)),
    )


def create_comparison(conn: "psycopg.Connection", screen_id: str, name: str,
                      treatment_ids: list[str], control_ids: list[str],
                      kind: str = "treatment_vs_control", primary: bool = True) -> str:
    return conn.execute(
        """
        insert into public.comparisons
            (screen_id, name, kind, treatment_ids, control_ids, is_primary)
        values (%s,%s,%s,%s,%s,%s)
        on conflict (screen_id, name) do update set kind = excluded.kind
        returning id
        """,
        (screen_id, name, kind, treatment_ids, control_ids, primary),
    ).fetchone()[0]


def write_hits(
    conn: "psycopg.Connection",
    ctx: RunContext,
    hits: HitTable,
    flags: dict[str, list[Flag]],
    scores: dict[str, tuple[float | None, float | None, str | None]] | None = None,
    model_version: str | None = None,
) -> int:
    """
    Write hits and their flags.

    Bulk-loaded with COPY. A genome-wide screen produces ~19k gene rows, and
    one INSERT ... RETURNING per gene over a connection pooler turns a few
    seconds of work into several minutes. Ids are generated here so the flag
    rows can reference them without a round trip per hit.

    `scores` maps gene -> (chance_real, novelty, reason). When absent the hit
    is stored with statistics only and no confidence, which is honest: a
    score requires a fitted model.
    """
    scores = scores or {}

    # Re-running a comparison replaces its hits rather than accumulating them.
    conn.execute("delete from public.hits where comparison_id = %s", (ctx.comparison_id,))

    hit_rows: list[tuple] = []
    flag_rows: list[tuple] = []

    for name, g in hits.genes.items():
        chance, novelty, reason = scores.get(name, (None, None, None))
        gene_flags = flags.get(name, [])
        hit_id = str(uuid.uuid4())

        hit_rows.append((
            hit_id, ctx.run_id, ctx.screen_id, ctx.comparison_id, name, g.direction,
            g.n_guides, g.n_good_guides, g.lfc, g.rra_score, g.p_value, g.fdr,
            g.rank, g.bayes_factor, g.norm_z,
            _pg_float_array(g.guide_lfcs), g.max_guide_share,
            chance, novelty, classify(name, chance, novelty, gene_flags),
            reason, model_version,
        ))
        for f in gene_flags:
            flag_rows.append((str(uuid.uuid4()), hit_id, f.flag, f.severity,
                              f.message, json.dumps(f.evidence)))

    with conn.cursor().copy(
        "copy public.hits "
        "(id, run_id, screen_id, comparison_id, gene_symbol, direction, "
        " n_guides, n_good_guides, lfc, rra_score, p_value, fdr, stat_rank, "
        " bayes_factor, norm_z, guide_lfcs, max_guide_share, "
        " chance_real, novelty, verdict, reason, model_version) from stdin"
    ) as copy:
        for row in hit_rows:
            copy.write_row(row)

    if flag_rows:
        with conn.cursor().copy(
            "copy public.hit_flags (id, hit_id, flag, severity, message, evidence) from stdin"
        ) as copy:
            for row in flag_rows:
                copy.write_row(row)

    return len(hit_rows)


def write_validation_predictions(conn: "psycopg.Connection", ctx: RunContext,
                                 scored: dict) -> int:
    """
    Store the score stage's per-candidate, per-question estimates.

    Both branches are rows. An available estimate carries its probability, its
    interval and the cohort that licensed it; an unavailable one carries the
    reason and no probability at all, and the table's own check constraint
    refuses anything in between. A refusal has to be a row rather than an
    absence, because a gene with no row and a gene the gate declined look
    identical to a reader otherwise, and only one of them has been considered.

    Re-running a comparison replaces its predictions. A prediction is a
    statement about one run's evidence under one model version, so keeping the
    previous run's alongside would leave two answers to one question with
    nothing saying which is current. The frozen copy that must survive a
    re-analysis lives in the round's receipt, which this never touches.
    """
    candidates = scored.get("candidates") or []
    if not candidates:
        return 0

    conn.execute(
        "delete from public.validation_predictions where comparison_id = %s",
        (ctx.comparison_id,))

    rows: list[tuple] = []
    for candidate in candidates:
        gene = candidate.get("gene")
        for question, estimate in (candidate.get("questions") or {}).items():
            available = bool(estimate.get("available"))
            coverage = estimate.get("coverage") or {}
            matched = coverage.get("matched") or {}
            rows.append((
                str(uuid.uuid4()), ctx.org_id, ctx.screen_id, ctx.run_id,
                ctx.comparison_id, gene, question, available,
                estimate.get("probability") if available else None,
                estimate.get("lower") if available else None,
                estimate.get("upper") if available else None,
                estimate.get("bounded") or "none",
                coverage.get("n_decided") if available else None,
                coverage.get("n_labs") if available else None,
                coverage.get("n_screens") if available else None,
                coverage.get("stratum_key") or (coverage.get("stratum") or {}).get("assay_class"),
                coverage.get("matched_key") if available else None,
                _pg_text_array(coverage.get("relaxed") if available else None),
                coverage.get("cohort_sentence") if available else None,
                None if available else (estimate.get("reason") or "unavailable"),
                estimate.get("sentence") if available else (estimate.get("because") or ""),
                json.dumps(estimate.get("contributions")) if available else None,
                _pg_text_array(estimate.get("missing_channels")),
                estimate.get("model_version"),
            ))

    with conn.cursor().copy(
        "copy public.validation_predictions "
        "(id, org_id, screen_id, run_id, comparison_id, gene_symbol, question, "
        " available, probability, lower, upper, bounded, cohort_n_decided, "
        " cohort_n_labs, cohort_n_screens, cohort_stratum, cohort_matched, "
        " cohort_relaxed, cohort_sentence, unavailable_reason, because, "
        " contributions, missing_channels, model_version) from stdin"
    ) as copy:
        for row in rows:
            copy.write_row(row)
    return len(rows)


def _pg_text_array(values) -> str:
    """A text list as a Postgres array literal. Absent and empty are both '{}'."""
    if not values:
        return "{}"
    escaped = []
    for value in values:
        text = str(value).replace("\\", "\\\\").replace('"', '\\"')
        escaped.append(f'"{text}"')
    return "{" + ",".join(escaped) + "}"


def _pg_float_array(values: list[float] | None) -> str | None:
    """Render a float list as a Postgres array literal for COPY."""
    if not values:
        return None
    return "{" + ",".join(f"{v:.6g}" for v in values) + "}"


def write_guide_effects(conn: "psycopg.Connection", ctx: RunContext,
                        guides, reference_versions: dict[str, str] | None = None) -> int:
    """
    Write the per-guide rows for one comparison, keyed by guide id.

    `guides` are `validate.domain_report.GuideEvidence` rows. Re-running a
    comparison replaces its rows rather than accumulating them, matching
    `write_hits`.

    The protein columns are written exactly as the annotation produced them.
    A guide with no resolvable residue is stored with those columns null and
    `annotation_evidence = 'none'`; the database CHECK constraints refuse a
    residue without a transcript, or a curated claim without a feature, so a
    partially filled row cannot be persisted as if it were annotated.
    """
    conn.execute("delete from public.guide_effects where comparison_id = %s",
                 (ctx.comparison_id,))
    versions = json.dumps(reference_versions or {})
    written = 0
    with conn.cursor().copy(
        "copy public.guide_effects "
        "(screen_id, run_id, comparison_id, guide_key, gene_symbol, sequence, "
        " method, lfc, p_value, fdr, control_mean, treatment_mean, "
        " chrom, cut_pos, strand, uniprot_accession, mane_transcript, "
        " protein_residue, n_residues, cds_fraction, in_last_exon, "
        " features_hit, annotation_evidence, reference_versions) from stdin"
    ) as copy:
        for g in guides:
            copy.write_row((
                ctx.screen_id, ctx.run_id, ctx.comparison_id, g.guide_key, g.gene,
                g.sequence, "mageck",
                None if g.log2_fold_change != g.log2_fold_change else g.log2_fold_change,
                g.p_value, g.fdr, g.control_mean, g.treatment_mean,
                g.chromosome, g.cut_position, g.strand,
                g.uniprot_accession, g.mane_transcript,
                g.protein_residue, g.n_residues, g.cds_fraction, g.in_last_exon,
                list(g.features_hit), g.annotation_evidence, versions,
            ))
            written += 1
    return written


def write_gene_disagreement(conn: "psycopg.Connection", ctx: RunContext, reports) -> int:
    """
    Store one guide-disagreement report per gene for this comparison.

    `reports` are `validate.domain_report.DisagreementReport` objects. The
    queryable scalars are lifted out of each report and the whole document is
    stored beside them, so the console renders a recorded value and never
    reimplements the statistics. Re-running a comparison replaces its rows.
    """
    conn.execute("delete from public.gene_disagreement where comparison_id = %s",
                 (ctx.comparison_id,))
    written = 0
    with conn.cursor().copy(
        "copy public.gene_disagreement "
        "(screen_id, run_id, comparison_id, gene_symbol, ensembl_gene_id, "
        " n_guides, n_depleting, mean_lfc, median_lfc, spread, spread_vs_screen, "
        " discordant, fragile, pivotal_guide, concordance_status, "
        " concordance_feature, fisher_p, fisher_p_floor, schema_version, report) "
        "from stdin"
    ) as copy:
        for r in reports:
            copy.write_row((
                ctx.screen_id, ctx.run_id, ctx.comparison_id, r.gene_symbol,
                r.ensembl_gene_id, r.n_guides, r.n_depleting,
                r.mean_log2_fold_change, r.median_log2_fold_change,
                r.spread, r.spread_vs_screen, r.discordant, r.fragile,
                r.pivotal_guide, r.concordance.status, r.concordance.feature,
                r.concordance.fisher_p, r.concordance.fisher_p_floor,
                "1", r.model_dump_json(),
            ))
            written += 1
    return written


def finish_run(conn: "psycopg.Connection", ctx: RunContext, status: str = "complete",
               error: str | None = None) -> None:
    conn.execute(
        "update public.runs set status = %s, error = %s, finished_at = now() where id = %s",
        (status, error, ctx.run_id),
    )
    # Roll the run's QC verdict up onto the screen. Without this the screen sits
    # at the 'pending' default forever, so a screen whose QC failed is served as
    # "not checked yet" by the dashboard and by /api/v1/hits. Read back from
    # run_qc rather than passed in, so the two can never disagree.
    verdict = conn.execute(
        "select verdict from public.run_qc where run_id = %s", (ctx.run_id,)
    ).fetchone()
    counts = conn.execute(
        """
        select count(*),
               count(*) filter (where chance_real >= 0.6),
               count(*) filter (where verdict = 'real_new')
        from public.hits where run_id = %s
        """,
        (ctx.run_id,),
    ).fetchone()
    conn.execute(
        """
        update public.screens
           set status = %s, qc = %s, n_hits = %s, n_real_hits = %s, updated_at = now()
         where id = %s
        """,
        ("complete" if status == "complete" else "failed",
         verdict[0] if verdict else "pending",
         counts[0] or 0, counts[1] or 0, ctx.screen_id),
    )


def log_event(conn: "psycopg.Connection", run_id: str, message: str,
              stage: str | None = None, level: str = "info", data: dict | None = None) -> None:
    conn.execute(
        "insert into public.run_events (run_id, stage, level, message, data) "
        "values (%s,%s,%s,%s,%s)",
        (run_id, stage, level, message, json.dumps(data or {})),
    )

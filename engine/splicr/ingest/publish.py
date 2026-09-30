"""
Publish a reanalyzed study: harmonize, write the lake, write Postgres.

Order matters and is deliberate:

1. Harmonize first (`harmonize.enforce`). Every gene gets an Ensembl id, the
   cell line its Cellosaurus RRID, the compound its ChEMBL id. Genes that cannot
   be mapped are quarantined and counted, never written under a free-text name.
   A study whose genes mostly fail to map is refused outright: that means a
   wrong organism or a corrupted library, not a few retired symbols.
2. Lake next (R2 Parquet): the complete per-gene results for every contrast,
   the per-guide count matrix and one summary row per contrast. This is the
   corpus SplicR builds from raw reads, and it is the large part.
3. Postgres last: one atlas.screens row per contrast and the called hits
   (FDR < 0.1) in atlas.screen_hits, which the app and gene_history() read.
   Triggers in 20260929000500_ingest_engine.sql re-check the harmonization.

Because the lake write happens before Postgres, a failure in between leaves
files that nothing points at yet, and a retry overwrites them. The reverse
order could leave the app showing a screen whose data do not exist.
"""

from __future__ import annotations

import io
import json
import os
from dataclasses import asdict
from datetime import date

from .analyze import StudyResult
from .models import StudyCandidate, StudyPlan

HIT_FDR = 0.1
MIN_GENE_MAP_RATE = 0.9
CONTROL_LABELS = {"CONTROL", "NONTARGETING", "NON-TARGETING", "NON_TARGETING", "NTC", "SAFE", "INTERGENIC"}

MODALITIES = {"knockout", "crispri", "crispra", "base_edit", "prime", "knockout_cas12a"}


def _num(x):
    """A float column value for Postgres: NaN and None both become NULL."""
    try:
        return None if x is None or x != x else float(x)
    except (TypeError, ValueError):
        return None


def _int(x):
    # pandas turns an int column with any missing value (a gene BAGEL2 scored
    # but MAGeCK did not rank) into float; Postgres int refuses "1.0".
    v = _num(x)
    return None if v is None else int(round(v))


def pipeline_version() -> str:
    return os.environ.get("SPLICR_PIPELINE_VERSION", "local")


def gene_frame(study: StudyResult, plan: StudyPlan):
    """Every gene in every contrast, all method columns, before harmonization."""
    import pandas as pd

    rows = []
    for c in study.contrasts:
        res = c.result
        if res.hits is None:
            continue
        flags = res.flags or {}
        for g in res.hits.genes.values():
            if g.gene.upper() in CONTROL_LABELS or g.gene.upper().startswith(("NON-TARGET", "NONTARGET")):
                continue
            is_hit = g.fdr is not None and g.fdr < HIT_FDR
            rows.append({
                "accession": plan.accession, "contrast": c.name, "gene": g.gene,
                "n_guides": g.n_guides, "n_good_guides": g.n_good_guides, "lfc": g.lfc,
                "rra_score": g.rra_score, "p_value": g.p_value, "fdr": g.fdr,
                "depleted_fdr": g.depleted_fdr, "enriched_fdr": g.enriched_fdr, "direction": g.direction,
                "rank": g.rank, "bayes_factor": g.bayes_factor, "drugz_norm_z": g.norm_z,
                "drugz_fdr": g.drugz_fdr, "max_guide_share": g.max_guide_share,
                "guide_agreement": g.guide_agreement, "is_hit": is_hit,
                "flags": [f.flag if hasattr(f, "flag") else str(f) for f in flags.get(g.gene, [])],
                "library_slug": c.library_slug or study.library_slug, "pipeline_version": pipeline_version(),
            })
    return pd.DataFrame(rows)


def harmonize_genes(frame, taxid: int):
    """(clean, quarantine) through the harmonization gate; refuses a mostly-unmappable study."""
    from .. import harmonize

    clean, quarantine = harmonize.enforce(frame, taxid=taxid, gene_col="gene", min_rate=MIN_GENE_MAP_RATE)
    return clean, quarantine


def _put(df_or_table, key: str) -> str:
    import pyarrow as pa
    import pyarrow.parquet as pq

    from ..r2 import R2Config, client

    table = df_or_table if isinstance(df_or_table, pa.Table) else pa.Table.from_pandas(df_or_table, preserve_index=False)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd")
    cfg = R2Config.from_env()
    client(cfg).put_object(Bucket=cfg.bucket, Key=key, Body=buf.getvalue(),
                           ContentType="application/vnd.apache.parquet")
    return key


def guide_count_table(study: StudyResult, plan: StudyPlan):
    import pandas as pd

    parts = []
    for slug, path in study.counts_paths.items():
        df = pd.read_csv(path, sep="\t")
        long = df.melt(id_vars=["sgRNA", "Gene"], var_name="sample_label", value_name="count")
        long.insert(0, "accession", plan.accession)
        long["run"] = long["sample_label"].map({l: s["run"] for l, s in study.samples.items()})
        long["library_slug"] = slug
        parts.append(long.rename(columns={"sgRNA": "guide_id", "Gene": "library_gene"}))
    return pd.concat(parts, ignore_index=True)


def contrast_summary(study: StudyResult, plan: StudyPlan, n_quarantined: dict[str, int]):
    import pandas as pd

    rows = []
    for c in study.contrasts:
        res = c.result
        qc = res.qc.as_dict() if res.qc is not None and hasattr(res.qc, "as_dict") else {}
        rows.append({
            "accession": plan.accession, "contrast": c.name, "treatment": c.treatment, "control": c.control,
            "library_slug": c.library_slug or study.library_slug, "library_detection": study.detection,
            "qc_verdict": getattr(res.qc, "verdict", None), "qc": json.dumps(qc, default=str),
            "n_genes": len(res.hits.genes) if res.hits else 0,
            "n_hits": len(res.hits.significant(HIT_FDR)) if res.hits else 0,
            "methods": res.hits.methods if res.hits else [],
            "failed_at": res.failed_at, "error": res.error,
            "n_genes_quarantined": n_quarantined.get(c.name, 0),
            "cell_line_rrid": plan.cell_line_rrid, "compound_chembl": plan.compound_chembl,
            "modality": plan.modality, "phenotype": plan.phenotype, "taxid": plan.taxid,
            "plan_confidence": plan.confidence, "pipeline_version": pipeline_version(),
            "published": date.today().isoformat(),
        })
    return pd.DataFrame(rows)


def publish(conn, candidate: StudyCandidate, plan: StudyPlan, study: StudyResult, fastqc: dict | None = None,
            deposited_check: dict | None = None) -> dict:
    taxid = plan.taxid or candidate.taxid or 9606
    genes = gene_frame(study, plan)
    if genes.empty:
        raise RuntimeError(f"{plan.accession}: no contrast produced gene-level results")
    clean, quarantine = harmonize_genes(genes, taxid)
    n_quarantined = quarantine.groupby("contrast").size().to_dict() if len(quarantine) else {}

    prefix = f"lake/reprocessed_%s/accession={plan.accession}/data_0.parquet"
    keys = [
        _put(clean, prefix % "gene_results"),
        _put(guide_count_table(study, plan), prefix % "guide_counts"),
        _put(contrast_summary(study, plan, n_quarantined).assign(
            deposited_counts_verdict=(deposited_check or {}).get("verdict"),
            deposited_counts_median_spearman=(deposited_check or {}).get("median_spearman")), prefix % "screens"),
    ]
    if len(quarantine):
        keys.append(_put(quarantine, prefix % "quarantine"))

    source = "geo_rerun" if plan.accession.startswith("GSE") else "sra_rerun"
    year = int(candidate.first_public[:4]) if candidate.first_public else None
    # A reprocess replaces the accession's whole set of screens: contrasts that
    # no longer exist (a re-inferred plan renamed or dropped them) are removed,
    # with their hits, in the same transaction, so a gene is never counted
    # twice for one study.
    current = [f"{plan.accession}/{c.name}" for c in study.contrasts]
    conn.execute("delete from atlas.screens where ingest_accession = %s and not (source_id = any(%s))",
                 (plan.accession, current))
    screen_ids = []
    for c in study.contrasts:
        res = c.result
        sub = clean[clean.contrast == c.name]
        hits = sub[sub.is_hit]
        metadata = {
            "treatment": c.treatment, "control": c.control, "library_detection": study.detection,
            "samples": study.samples, "qc_verdict": getattr(res.qc, "verdict", None),
            "stages": [asdict(s) for s in res.stages] if res.stages else [],
            "n_genes_quarantined": n_quarantined.get(c.name, 0), "plan_confidence": plan.confidence,
            "fastqc": fastqc or {}, "lake": keys, "pipeline_version": pipeline_version(),
            "deposited_counts_check": deposited_check,
            "methods": res.hits.methods if res.hits else [],
            "method_warnings": res.hits.warnings if res.hits else [],
        }
        if not plan.cell_line_rrid:
            metadata["cell_line_unmappable"] = next(
                (i for i in plan.issues if "RRID" in i or "cell line" in i.lower()),
                f"no Cellosaurus entry for '{plan.cell_line_raw or 'unstated cell line'}'")
        row = conn.execute(
            """
            insert into atlas.screens (source, source_id, title, pmid, year, taxid, library_name, modality,
                cell_line, cell_line_rrid, compound_chembl, phenotype, condition, methodology, analysis_tool,
                n_genes, n_hits, has_raw_reads, reanalyzed, ingest_accession, metadata)
            values (%s::public.atlas_source, %s, %s, %s, %s, %s, %s, %s::public.modality, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, true, true, %s, %s)
            on conflict (source, source_id) do update set
                title = excluded.title, pmid = excluded.pmid, library_name = excluded.library_name,
                modality = excluded.modality, cell_line = excluded.cell_line,
                cell_line_rrid = excluded.cell_line_rrid, compound_chembl = excluded.compound_chembl,
                phenotype = excluded.phenotype, analysis_tool = excluded.analysis_tool,
                n_genes = excluded.n_genes, n_hits = excluded.n_hits, metadata = excluded.metadata,
                updated_at = now()
            returning id
            """,
            (source, f"{plan.accession}/{c.name}", f"{candidate.title} [{c.name}]"[:1000],
             candidate.pubmed_ids[0] if candidate.pubmed_ids else None, year, taxid, study.library_name,
             plan.modality if plan.modality in MODALITIES else None, plan.cell_line_raw, plan.cell_line_rrid,
             plan.compound_chembl, plan.phenotype, c.name,
             "SplicR reanalysis from raw reads (ENA FASTQ, md5-verified)",
             "+".join(res.hits.methods) if res.hits else None,
             int(len(sub)), int(len(hits)), plan.accession, json.dumps(metadata, default=str)),
        ).fetchone()
        screen_id = row[0]
        screen_ids.append(str(screen_id))
        conn.execute("delete from atlas.screen_hits where screen_id = %s", (screen_id,))
        with conn.cursor().copy(
                "copy atlas.screen_hits (screen_id, gene_symbol, ensembl_gene_id, is_hit, direction, "
                "score, lfc, fdr, rank) from stdin") as cp:
            for h in hits.itertuples():
                cp.write_row((screen_id, h.gene_symbol_approved, h.ensembl_gene_id, True,
                              "enriched" if h.direction == "enriched" else "depleted",
                              _num(h.rra_score), _num(h.lfc), _num(h.fdr), _int(h.rank)))
    return {"screen_ids": screen_ids, "lake_keys": keys, "n_genes": int(len(clean)),
            "n_hits": int(clean.is_hit.sum()), "n_quarantined": int(len(quarantine))}

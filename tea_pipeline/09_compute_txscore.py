"""
Step 09: Compute Therapeutic Viability Scores → tx_txscore_cache

For every gene × cancer type combination:
  1. Efficacy Score    (0.30 weight) — DepMap Chronos + selectivity + dependency prob
  2. Safety Score      (0.25 weight) — GTEx expression × gnomAD constraint × tissue criticality
  3. Druggability Score(0.20 weight) — AlphaFold pLDDT + protein class + drug precedent
  4. Precedent Score   (0.15 weight) — ClinVar + DGIdb approved drugs
  5. Stratification    (0.10 weight) — Biomarker correlation strength

TVS = Efficacy^0.30 × Safety^0.25 × Druggability^0.20 × Precedent^0.15 × Stratification^0.10

~20K genes × 30 cancer types = ~600K score entries.
"""
import json
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import pandas as pd
from tqdm import tqdm
from config import (CANCER_TYPE_METADATA, TISSUE_METADATA, DRUGGABLE_CLASSES,
                    DEPMAP_RELEASE)
from utils.db import upsert_rows, count_rows, transaction

# ─── Weights ─────────────────────────────────────────────────────────────────
WEIGHTS = {
    "efficacy":        0.30,
    "safety":          0.25,
    "druggability":    0.20,
    "precedent":       0.15,
    "stratification":  0.10,
}

# ─── Critical tissues for safety (tissue_name → weight multiplier) ───────────
CRITICAL_TISSUES = {t: m["weight"] for t, m in TISSUE_METADATA.items() if m["critical"]}


# ═══════════════════════════════════════════════════════════════════════════════
# Data loading from DB
# ═══════════════════════════════════════════════════════════════════════════════

def load_depmap_stats() -> pd.DataFrame:
    """
    Load per-gene × per-cancer aggregated DepMap stats.
    Returns: gene_id, cancer_type, mean_chronos, mean_dep_prob,
             n_dependent (chronos < -0.5), n_total
    """
    print("  Loading DepMap aggregated stats...")
    with transaction() as cur:
        cur.execute("""
            SELECT
                gene_id,
                cancer_type,
                AVG(chronos_effect)::REAL         AS mean_chronos,
                AVG(dependency_probability)::REAL  AS mean_dep_prob,
                COUNT(*) FILTER (WHERE chronos_effect < -0.5)::INT AS n_dependent,
                COUNT(*)::INT                      AS n_total,
                AVG(chronos_effect) FILTER (WHERE chronos_effect < -0.5)::REAL
                                                   AS mean_dep_chronos
            FROM tx_depmap_data
            WHERE cancer_type IS NOT NULL
            GROUP BY gene_id, cancer_type
        """)
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=[
        "gene_id", "cancer_type", "mean_chronos", "mean_dep_prob",
        "n_dependent", "n_total", "mean_dep_chronos"
    ])
    print(f"  DepMap stats: {len(df):,} gene-cancer combinations")
    return df


def load_depmap_pan_cancer() -> pd.DataFrame:
    """Pan-cancer aggregated stats (all cell lines)."""
    print("  Loading pan-cancer DepMap stats...")
    with transaction() as cur:
        cur.execute("""
            SELECT
                gene_id,
                AVG(chronos_effect)::REAL          AS mean_chronos,
                AVG(dependency_probability)::REAL   AS mean_dep_prob,
                COUNT(*) FILTER (WHERE chronos_effect < -0.5)::INT AS n_dependent,
                COUNT(*)::INT                       AS n_total
            FROM tx_depmap_data
            GROUP BY gene_id
        """)
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=["gene_id", "mean_chronos", "mean_dep_prob",
                                      "n_dependent", "n_total"])
    df["cancer_type"] = "pan-cancer"
    print(f"  Pan-cancer stats: {len(df):,} genes")
    return df


def load_gnomad() -> pd.DataFrame:
    print("  Loading gnomAD constraint...")
    with transaction() as cur:
        cur.execute("SELECT gene_id, loeuf, pli FROM tx_gnomad_constraint")
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=["gene_id", "loeuf", "pli"]).set_index("gene_id")


def load_gtex_max_critical() -> pd.DataFrame:
    """Max TPM across critical tissues per gene."""
    print("  Loading GTEx critical tissue expression...")
    critical_list = list(CRITICAL_TISSUES.keys())
    placeholders  = ",".join(f"'{t.replace(chr(39), chr(39)+chr(39))}'" for t in critical_list)
    with transaction() as cur:
        cur.execute(f"""
            SELECT
                g.gene_id,
                t.tissue_name,
                g.median_tpm,
                t.toxicity_weight
            FROM tx_gtex_expression g
            JOIN tx_tissue_metadata t ON g.tissue_name = t.tissue_name
            WHERE t.is_critical = true
        """)
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=["gene_id", "tissue_name", "median_tpm", "toxicity_weight"])
    # Compute weighted risk per tissue, then max per gene
    df["risk"] = (df["median_tpm"].clip(0, 50) / 50.0) * df["toxicity_weight"].clip(0, 2)
    gene_max_risk = df.groupby("gene_id")["risk"].max().rename("max_critical_risk")
    tissue_risks  = (
        df.groupby("gene_id")
          .apply(lambda x: dict(zip(x["tissue_name"], x["risk"].round(4).tolist())))
          .rename("tissue_risks")
    )
    result = pd.concat([gene_max_risk, tissue_risks], axis=1).reset_index()
    print(f"  GTEx critical expression: {len(result):,} genes")
    return result.set_index("gene_id")


def load_alphafold() -> pd.DataFrame:
    print("  Loading AlphaFold structure data...")
    with transaction() as cur:
        cur.execute("""
            SELECT gene_id, mean_plddt, num_druggable_pockets,
                   plddt_confident_frac
            FROM tx_alphafold_structures
        """)
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=["gene_id", "mean_plddt",
                                      "num_druggable_pockets", "plddt_confident_frac"])
    print(f"  AlphaFold: {len(df):,} structures")
    return df.set_index("gene_id")


def load_drug_counts() -> pd.DataFrame:
    """Approved drug count per gene."""
    print("  Loading drug interactions...")
    with transaction() as cur:
        cur.execute("""
            SELECT gene_id,
                   COUNT(DISTINCT drug_name)                                AS total_drugs,
                   COUNT(DISTINCT drug_name) FILTER (WHERE approval_status = 'approved')
                                                                            AS approved_drugs
            FROM tx_drug_interactions
            GROUP BY gene_id
        """)
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=["gene_id", "total_drugs", "approved_drugs"])
    print(f"  Drug counts: {len(df):,} genes")
    return df.set_index("gene_id")


def load_clinvar_counts() -> pd.DataFrame:
    """Pathogenic variant counts per gene."""
    print("  Loading ClinVar pathogenic counts...")
    with transaction() as cur:
        cur.execute("""
            SELECT gene_id,
                   COUNT(*) FILTER (WHERE clinical_significance IN ('Pathogenic','Likely pathogenic'))
                               AS pathogenic_count,
                   COUNT(*)   AS total_variants
            FROM tx_clinvar_variants
            GROUP BY gene_id
        """)
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=["gene_id", "pathogenic_count", "total_variants"])
    print(f"  ClinVar counts: {len(df):,} genes")
    return df.set_index("gene_id")


def load_protein_classes() -> dict:
    with transaction() as cur:
        cur.execute("SELECT gene_id, protein_class FROM tx_genes_master")
        return {r[0]: r[1] for r in cur.fetchall()}


def load_all_genes() -> list:
    with transaction() as cur:
        cur.execute("SELECT gene_id FROM tx_genes_master")
        return [r[0] for r in cur.fetchall()]


# ═══════════════════════════════════════════════════════════════════════════════
# Scoring functions
# ═══════════════════════════════════════════════════════════════════════════════

def normalize_chronos(val: float | None) -> float:
    """Map Chronos effect [-2.5, 0] → [1, 0]. More negative = more essential."""
    if val is None or np.isnan(val):
        return 0.0
    return float(np.clip((0 - val) / 2.5, 0, 1))


def compute_selectivity(cancer_mean: float | None,
                         pan_cancer_mean: float | None) -> float:
    """
    How much MORE essential in this cancer vs. all others.
    delta = other_mean - target_mean (positive = more essential in target)
    """
    if cancer_mean is None or pan_cancer_mean is None:
        return 0.0
    delta = pan_cancer_mean - cancer_mean    # approx: cancer more essential if delta > 0
    return float(np.clip(delta / 1.0, 0, 1))


def efficacy_score(cancer_mean_chronos: float | None,
                   pan_mean_chronos: float | None,
                   mean_dep_prob: float | None) -> tuple[float, dict]:
    """
    Efficacy = 0.4 × dep_prob + 0.3 × selectivity + 0.3 × chronos_norm
    Returns (score, components_dict)
    """
    dep_prob    = float(mean_dep_prob or 0.0)
    chron_norm  = normalize_chronos(cancer_mean_chronos)
    selectivity = compute_selectivity(cancer_mean_chronos, pan_mean_chronos)

    score = (
        0.40 * dep_prob +
        0.30 * selectivity +
        0.30 * chron_norm
    )
    score = float(np.clip(score, 0, 1))

    return score, {
        "dep_prob":    round(dep_prob,    4),
        "selectivity": round(selectivity, 4),
        "chronos_norm":round(chron_norm,  4),
    }


def safety_score(max_critical_risk: float | None,
                  loeuf: float | None,
                  pli: float | None,
                  tissue_risks: dict | None) -> tuple[float, float]:
    """
    Safety = 1 - composite_risk
    Composite risk = expression_risk × constraint_penalty × tissue_criticality
    Returns (safety_score, critical_tissue_risk)
    """
    # Constraint penalty
    constraint = 0.0
    if loeuf is not None and loeuf < 0.6:
        constraint += 0.4   # highly constrained
    elif loeuf is not None and loeuf < 1.0:
        constraint += 0.2   # moderately constrained
    if pli is not None and pli > 0.9:
        constraint += 0.3   # pLoF intolerant

    constraint = min(constraint, 1.0)

    # Expression-based risk in critical tissues
    expr_risk = float(max_critical_risk or 0.0)
    expr_risk = min(expr_risk, 1.0)

    # Combined risk (expression matters more when constrained)
    combined_risk = expr_risk * (0.5 + 0.5 * constraint) + constraint * 0.2
    combined_risk = float(np.clip(combined_risk, 0, 1))

    safety = 1.0 - combined_risk
    return float(np.clip(safety, 0, 1)), round(combined_risk, 4)


def druggability_score(mean_plddt: float | None,
                        num_pockets: int | None,
                        approved_drugs: int | None,
                        protein_class: str | None) -> tuple[float, dict]:
    """
    Druggability = weighted combination of structure quality, pockets, drugs, protein class.
    Returns (overall_druggability, modality_breakdown)
    """
    # 1. Structure quality: pLDDT → [0,1]
    struct_quality = float(np.clip(((mean_plddt or 0) - 50) / 40, 0, 1))

    # 2. Pocket score: 0 pockets = 0, 1 pocket ≈ 0.5, 2+ pockets ≈ 1.0
    pocket_s = float(min((num_pockets or 0) / 2.0, 1.0))

    # 3. Chemical matter: any approved drug = strong signal
    n_approved  = int(approved_drugs or 0)
    chemical_s  = float(min(n_approved / 2.0, 1.0))

    # 4. Protein class
    class_s = DRUGGABLE_CLASSES.get(protein_class or "unknown", 0.5)

    # Small molecule druggability
    sm = (struct_quality * 0.3 + pocket_s * 0.4 +
          chemical_s * 0.2 + class_s * 0.1)

    # Antibody tractability heuristic: extracellular/membrane classes
    MEMBRANE_CLASSES = {"gpcr", "ion_channel", "receptor", "transporter"}
    ab = 0.8 if protein_class in MEMBRANE_CLASSES else 0.3

    # Gene therapy tractability (all genes are potentially amenable)
    gt = 0.6

    # Overall = max across modalities
    overall = float(np.clip(max(sm, ab, gt), 0, 1))

    modality = {
        "small_molecule": round(sm, 4),
        "antibody":       round(ab, 4),
        "gene_therapy":   round(gt, 4),
        "recommended_modality": (
            "small_molecule" if sm == max(sm, ab, gt) else
            ("antibody" if ab >= gt else "gene_therapy")
        ),
    }
    return overall, modality


def precedent_score(pathogenic_count: int,
                     approved_drugs: int,
                     total_drugs: int) -> tuple[float, dict]:
    """
    Precedent = 0.4 × drug_evidence + 0.3 × mendelian + 0.3 × chemical_matter
    """
    mendelian     = float(np.clip(pathogenic_count / 10.0, 0, 1))
    drug_evidence = float(np.clip(approved_drugs / 2.0,    0, 1))
    chem_matter   = float(np.clip(total_drugs    / 5.0,    0, 1))

    score = (
        0.40 * drug_evidence +
        0.30 * mendelian +
        0.30 * chem_matter
    )
    score = float(np.clip(score, 0, 1))
    return score, {
        "mendelian_evidence": round(mendelian,     4),
        "drug_evidence":      round(drug_evidence, 4),
        "chemical_matter":    round(chem_matter,   4),
    }


def stratification_score(n_dependent: int, n_total: int,
                          cancer_mean_chronos: float | None) -> float:
    """
    Proxy for biomarker availability.
    Uses cancer-specific dependency prevalence as signal.
    Strong signal = many cell lines dependent (suggesting a clear patient subgroup).
    """
    if n_total == 0:
        return 0.3   # no data → low but non-zero score
    prevalence = n_dependent / n_total
    # Ideal prevalence: 20-80% (enrichable population, not universal)
    prevalence_score = 1.0 - abs(prevalence - 0.5) / 0.5
    # Signal strength: how strong is the dependency signal?
    chron_norm = normalize_chronos(cancer_mean_chronos)
    signal     = chron_norm
    score      = signal * 0.7 + prevalence_score * 0.3
    return float(np.clip(score, 0, 1))


def compute_tvs(eff: float, saf: float, drug: float, prec: float, strat: float) -> float:
    """Weighted geometric mean TVS (each score must be > 0 for log to work)."""
    # Clip to avoid 0^positive = 0 destroying the score
    e = max(eff,  0.01)
    s = max(saf,  0.01)
    d = max(drug, 0.01)
    p = max(prec, 0.01)
    t = max(strat,0.01)
    tvs = (e ** WEIGHTS["efficacy"]     *
           s ** WEIGHTS["safety"]       *
           d ** WEIGHTS["druggability"] *
           p ** WEIGHTS["precedent"]    *
           t ** WEIGHTS["stratification"])
    return float(np.clip(tvs, 0, 1))


# ═══════════════════════════════════════════════════════════════════════════════
# Main compute function
# ═══════════════════════════════════════════════════════════════════════════════

def compute_txscores():
    print("\n=== Computing TxScores ===\n")

    # Load all data into memory
    depmap_cancer   = load_depmap_stats()          # gene × cancer
    depmap_pan      = load_depmap_pan_cancer()      # gene-level pan-cancer
    gnomad          = load_gnomad()
    gtex_risk       = load_gtex_max_critical()
    alphafold       = load_alphafold()
    drug_counts     = load_drug_counts()
    clinvar_counts  = load_clinvar_counts()
    protein_classes = load_protein_classes()

    # Pan-cancer lookup: gene_id → mean_chronos
    pan_lookup = depmap_pan.set_index("gene_id")["mean_chronos"].to_dict()

    # Build cancer type set from DepMap data + our metadata
    cancer_types_in_data = set(depmap_cancer["cancer_type"].unique())
    all_cancer_types = (cancer_types_in_data |
                        set(CANCER_TYPE_METADATA.keys()))
    print(f"  Cancer types: {len(all_cancer_types)}")

    # Pivot DepMap data to {(gene_id, cancer_type): stats}
    depmap_idx = depmap_cancer.set_index(["gene_id", "cancer_type"])

    COLS = [
        "gene_id", "cancer_type",
        "tvs",
        "efficacy_score", "safety_score", "druggability_score",
        "precedent_score", "stratification_score",
        "efficacy_components",
        "tissue_risks", "critical_tissue_risk",
        "modality_recommendation",
        "precedent_components",
        "model_version", "weights", "data_sources",
    ]

    total_computed = 0
    batch          = []

    all_genes = list(protein_classes.keys())
    print(f"  Computing scores for {len(all_genes):,} genes × {len(all_cancer_types)} cancer types...")

    for gene_id in tqdm(all_genes, desc="  Genes", unit="gene"):
        # Gene-level data
        gnomad_row   = gnomad.loc[gene_id]    if gene_id in gnomad.index    else None
        gtex_row     = gtex_risk.loc[gene_id] if gene_id in gtex_risk.index else None
        af_row       = alphafold.loc[gene_id] if gene_id in alphafold.index else None
        drug_row     = drug_counts.loc[gene_id]  if gene_id in drug_counts.index  else None
        clinv_row    = clinvar_counts.loc[gene_id] if gene_id in clinvar_counts.index else None
        pclass       = protein_classes.get(gene_id, "unknown")

        loeuf         = float(gnomad_row["loeuf"]) if gnomad_row is not None and pd.notna(gnomad_row.get("loeuf")) else None
        pli           = float(gnomad_row["pli"])   if gnomad_row is not None and pd.notna(gnomad_row.get("pli"))   else None
        max_crit_risk = float(gtex_row["max_critical_risk"]) if gtex_row is not None and pd.notna(gtex_row.get("max_critical_risk")) else 0.0
        tissue_risks  = gtex_row["tissue_risks"]  if gtex_row is not None else {}
        mean_plddt    = float(af_row["mean_plddt"])        if af_row is not None and pd.notna(af_row.get("mean_plddt"))        else None
        n_pockets     = int(af_row["num_druggable_pockets"]) if af_row is not None and pd.notna(af_row.get("num_druggable_pockets")) else 0
        approved_d    = int(drug_row["approved_drugs"])    if drug_row is not None and pd.notna(drug_row.get("approved_drugs"))    else 0
        total_d       = int(drug_row["total_drugs"])       if drug_row is not None and pd.notna(drug_row.get("total_drugs"))       else 0
        pathogenic_c  = int(clinv_row["pathogenic_count"]) if clinv_row is not None and pd.notna(clinv_row.get("pathogenic_count")) else 0

        pan_mean = pan_lookup.get(gene_id)

        for cancer_type in all_cancer_types:
            # Get cancer-specific DepMap stats
            key = (gene_id, cancer_type)
            if key in depmap_idx.index:
                dr = depmap_idx.loc[key]
                c_mean_chron = float(dr["mean_chronos"])  if pd.notna(dr["mean_chronos"])  else None
                c_dep_prob   = float(dr["mean_dep_prob"]) if pd.notna(dr["mean_dep_prob"]) else None
                n_dep        = int(dr["n_dependent"])
                n_tot        = int(dr["n_total"])
            elif cancer_type == "pan-cancer":
                if gene_id in pan_lookup:
                    pan_row   = depmap_pan[depmap_pan["gene_id"] == gene_id].iloc[0]
                    c_mean_chron = pan_mean
                    c_dep_prob   = float(pan_row["mean_dep_prob"]) if pd.notna(pan_row["mean_dep_prob"]) else None
                    n_dep = int(pan_row["n_dependent"])
                    n_tot = int(pan_row["n_total"])
                else:
                    continue
            else:
                # No DepMap data for this gene in this cancer type → skip
                continue

            # ── Compute subscores ────────────────────────────────────────────
            eff_s, eff_comp     = efficacy_score(c_mean_chron, pan_mean, c_dep_prob)
            saf_s, crit_risk    = safety_score(max_crit_risk, loeuf, pli, tissue_risks)
            drug_s, modality    = druggability_score(mean_plddt, n_pockets, approved_d, pclass)
            prec_s, prec_comp   = precedent_score(pathogenic_c, approved_d, total_d)
            strat_s             = stratification_score(n_dep, n_tot, c_mean_chron)

            tvs = compute_tvs(eff_s, saf_s, drug_s, prec_s, strat_s)

            batch.append((
                gene_id,
                cancer_type,
                round(tvs,    4),
                round(eff_s,  4),
                round(saf_s,  4),
                round(drug_s, 4),
                round(prec_s, 4),
                round(strat_s,4),
                json.dumps(eff_comp),
                json.dumps(tissue_risks) if tissue_risks else None,
                round(crit_risk, 4),
                json.dumps(modality),
                json.dumps(prec_comp),
                "v1.0",
                json.dumps(WEIGHTS),
                json.dumps({"depmap": DEPMAP_RELEASE,
                            "gnomad": "v4.1",
                            "gtex":   "v8",
                            "alphafold": "v6"}),
            ))
            total_computed += 1

        # Flush every 1K rows (smaller batches for reliability)
        if len(batch) >= 1000:
            try:
                upsert_rows("tx_txscore_cache", COLS, batch,
                            conflict_cols=["gene_id", "cancer_type"],
                            update_cols=None,  # DO NOTHING - skip existing, faster
                            page_size=500)
            except Exception as e:
                print(f"\n  Warning: batch failed ({e}), retrying...")
                import time; time.sleep(2)
                upsert_rows("tx_txscore_cache", COLS, batch,
                            conflict_cols=["gene_id", "cancer_type"],
                            update_cols=None, page_size=200)
            batch = []

    if batch:
        try:
            upsert_rows("tx_txscore_cache", COLS, batch,
                        conflict_cols=["gene_id", "cancer_type"],
                        update_cols=None, page_size=500)
        except Exception as e:
            print(f"\n  Warning: final batch failed ({e}), retrying...")
            import time; time.sleep(2)
            upsert_rows("tx_txscore_cache", COLS, batch,
                        conflict_cols=["gene_id", "cancer_type"],
                        update_cols=None, page_size=200)

    print(f"\nDone. Computed {total_computed:,} TxScores")
    print(f"  tx_txscore_cache: {count_rows('tx_txscore_cache'):,} rows")


if __name__ == "__main__":
    compute_txscores()

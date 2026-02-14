"""
TxScore Calculation Engine

Adapted from tea_pipeline/09_compute_txscore.py for on-demand calculation.
Computes Therapeutic Viability Scores (TVS) for specific genes and cancer types.
"""

import os
import json
import numpy as np
import pandas as pd
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
from typing import List, Dict, Any, Optional, Tuple

# ─── Configuration ────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL")

# Weights from original pipeline
WEIGHTS = {
    "efficacy":        0.30,
    "safety":          0.25,
    "druggability":    0.20,
    "precedent":       0.15,
    "stratification":  0.10,
}

# Drugglable classes weights
DRUGGABLE_CLASSES = {
    "kinase":               0.90,
    "gpcr":                 0.95,
    "ion_channel":          0.85,
    "nuclear_receptor":     0.90,
    "protease":             0.80,
    "phosphatase":          0.70,
    "epigenetic_regulator": 0.75,
    "enzyme":               0.60,
    "transporter":          0.65,
    "receptor":             0.75,
    "transcription_factor": 0.30,
    "structural":           0.20,
    "ubiquitin_ligase":     0.60,
    "deubiquitinase":       0.65,
    "chaperone":            0.55,
    "unknown":              0.50,
}

# ─── Database Utils ───────────────────────────────────────────────────────────

def get_conn():
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL environment variable is not set")
    return psycopg2.connect(DATABASE_URL)

@contextmanager
def transaction():
    conn = get_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                yield cur
    finally:
        conn.close()

def upsert_rows(table: str, columns: List[str], rows: List[tuple],
                conflict_cols: List[str], update_cols: Optional[List[str]] = None):
    if not rows:
        return
    
    if update_cols:
        update_str = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
        conflict_str = f"({', '.join(conflict_cols)}) DO UPDATE SET {update_str}"
    else:
        conflict_str = f"({', '.join(conflict_cols)}) DO NOTHING"

    col_str = ", ".join(columns)
    sql = f"INSERT INTO {table} ({col_str}) VALUES %s ON CONFLICT {conflict_str}"

    with get_conn() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(cur, sql, rows, page_size=1000)
        conn.commit()

# ─── Scoring Functions ────────────────────────────────────────────────────────

def normalize_chronos(val: float | None) -> float:
    """Map Chronos effect [-2.5, 0] → [1, 0]. More negative = more essential."""
    if val is None or np.isnan(val):
        return 0.0
    return float(np.clip((0 - val) / 2.5, 0, 1))

def compute_selectivity(cancer_mean: float | None, pan_cancer_mean: float | None) -> float:
    if cancer_mean is None or pan_cancer_mean is None:
        return 0.0
    delta = pan_cancer_mean - cancer_mean
    return float(np.clip(delta / 1.0, 0, 1))

def efficacy_score(cancer_mean_chronos: float | None,
                   pan_mean_chronos: float | None,
                   mean_dep_prob: float | None) -> Tuple[float, dict]:
    dep_prob    = float(mean_dep_prob or 0.0)
    chron_norm  = normalize_chronos(cancer_mean_chronos)
    selectivity = compute_selectivity(cancer_mean_chronos, pan_mean_chronos)

    score = (0.40 * dep_prob + 0.30 * selectivity + 0.30 * chron_norm)
    score = float(np.clip(score, 0, 1))

    return score, {
        "dep_prob":    round(dep_prob,    4),
        "selectivity": round(selectivity, 4),
        "chronos_norm":round(chron_norm,  4),
    }

def safety_score(max_critical_risk: float | None,
                  loeuf: float | None,
                  pli: float | None,
                  tissue_risks: dict | None) -> Tuple[float, float]:
    constraint = 0.0
    if loeuf is not None and loeuf < 0.6:
        constraint += 0.4
    elif loeuf is not None and loeuf < 1.0:
        constraint += 0.2
    if pli is not None and pli > 0.9:
        constraint += 0.3
    constraint = min(constraint, 1.0)

    expr_risk = float(max_critical_risk or 0.0)
    expr_risk = min(expr_risk, 1.0)

    combined_risk = expr_risk * (0.5 + 0.5 * constraint) + constraint * 0.2
    combined_risk = float(np.clip(combined_risk, 0, 1))

    safety = 1.0 - combined_risk
    return float(np.clip(safety, 0, 1)), round(combined_risk, 4)

def druggability_score(mean_plddt: float | None,
                        num_pockets: int | None,
                        approved_drugs: int | None,
                        protein_class: str | None) -> Tuple[float, dict]:
    struct_quality = float(np.clip(((mean_plddt or 0) - 50) / 40, 0, 1))
    pocket_s = float(min((num_pockets or 0) / 2.0, 1.0))
    n_approved  = int(approved_drugs or 0)
    chemical_s  = float(min(n_approved / 2.0, 1.0))
    class_s = DRUGGABLE_CLASSES.get(protein_class or "unknown", 0.5)

    sm = (struct_quality * 0.3 + pocket_s * 0.4 + chemical_s * 0.2 + class_s * 0.1)

    MEMBRANE_CLASSES = {"gpcr", "ion_channel", "receptor", "transporter"}
    ab = 0.8 if protein_class in MEMBRANE_CLASSES else 0.3
    gt = 0.6

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
                     total_drugs: int) -> Tuple[float, dict]:
    mendelian     = float(np.clip(pathogenic_count / 10.0, 0, 1))
    drug_evidence = float(np.clip(approved_drugs / 2.0,    0, 1))
    chem_matter   = float(np.clip(total_drugs    / 5.0,    0, 1))

    score = (0.40 * drug_evidence + 0.30 * mendelian + 0.30 * chem_matter)
    score = float(np.clip(score, 0, 1))
    return score, {
        "mendelian_evidence": round(mendelian,     4),
        "drug_evidence":      round(drug_evidence, 4),
        "chemical_matter":    round(chem_matter,   4),
    }

def stratification_score(n_dependent: int, n_total: int,
                          cancer_mean_chronos: float | None) -> float:
    if n_total == 0:
        return 0.3
    prevalence = n_dependent / n_total
    prevalence_score = 1.0 - abs(prevalence - 0.5) / 0.5
    chron_norm = normalize_chronos(cancer_mean_chronos)
    score      = chron_norm * 0.7 + prevalence_score * 0.3
    return float(np.clip(score, 0, 1))

def compute_tvs(eff: float, saf: float, drug: float, prec: float, strat: float) -> float:
    """Weighted geometric mean TVS."""
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

# ─── Data Loading ─────────────────────────────────────────────────────────────

def load_data_for_genes(gene_ids: List[str], cancer_type: str) -> Dict[str, pd.DataFrame]:
    """Load all necessary data for the given genes and cancer type."""
    
    gene_list_sql = "(" + ",".join([f"'{g}'" for g in gene_ids]) + ")"
    
    data = {}
    
    with transaction() as cur:
        # 1. DepMap specific cancer
        cur.execute(f"""
            SELECT gene_id, AVG(chronos_effect)::REAL, AVG(dependency_probability)::REAL,
                   COUNT(*) FILTER (WHERE chronos_effect < -0.5)::INT, COUNT(*)::INT
            FROM tx_depmap_data
            WHERE gene_id IN {gene_list_sql} AND cancer_type = %s
            GROUP BY gene_id
        """, (cancer_type,))
        data['depmap_cancer'] = pd.DataFrame(cur.fetchall(), columns=[
            "gene_id", "mean_chronos", "mean_dep_prob", "n_dependent", "n_total"
        ]).set_index("gene_id")

        # 2. DepMap Pan-Cancer (for selectivity)
        cur.execute(f"""
            SELECT gene_id, AVG(chronos_effect)::REAL
            FROM tx_depmap_data
            WHERE gene_id IN {gene_list_sql}
            GROUP BY gene_id
        """)
        data['depmap_pan'] = pd.DataFrame(cur.fetchall(), columns=["gene_id", "mean_chronos"]).set_index("gene_id")

        # 3. gnomAD Constraint
        cur.execute(f"SELECT gene_id, loeuf, pli FROM tx_gnomad_constraint WHERE gene_id IN {gene_list_sql}")
        data['gnomad'] = pd.DataFrame(cur.fetchall(), columns=["gene_id", "loeuf", "pli"]).set_index("gene_id")

        # 4. GTEx Risk (requires joining with tissue metadata to find critical tissues)
        # Simplified: We assume we can query pre-computed if available, OR we compute on fly. 
        # For efficiency, let's query the raw table but filter by critical tissues. 
        # Note: In the original script, it loads everything. Here we query specifically.
        
        # Determine critical tissues first (hardcoded or queried? Let's hardcode a few common ones or query metadata)
        # Better: Query tx_tissue_metadata where is_critical=True
        cur.execute("SELECT tissue_name, toxicity_weight FROM tx_tissue_metadata WHERE is_critical = true")
        critical_tissues = {row[0]: row[1] for row in cur.fetchall()}
        
        if not critical_tissues:
            # Fallback if metadata missing
            critical_tissues = {"Heart": 1.0, "Brain": 1.0, "Liver": 1.0, "Kidney": 1.0}

        crit_tissue_sql = "(" + ",".join([f"'{t.replace(chr(39), chr(39)+chr(39))}'" for t in critical_tissues.keys()]) + ")"

        cur.execute(f"""
            SELECT gene_id, tissue_name, median_tpm
            FROM tx_gtex_expression 
            WHERE gene_id IN {gene_list_sql} AND tissue_name IN {crit_tissue_sql}
        """)
        gtex_rows = cur.fetchall()
        
        # Process GTEx in Python to get max_critical_risk per gene
        gtex_df = pd.DataFrame(gtex_rows, columns=["gene_id", "tissue_name", "median_tpm"])
        gtex_df["toxicity_weight"] = gtex_df["tissue_name"].map(lambda t: critical_tissues.get(t, 1.0))
        gtex_df["risk"] = (gtex_df["median_tpm"].clip(0, 50) / 50.0) * gtex_df["toxicity_weight"].clip(0, 2)
        
        data['gtex_risk'] = gtex_df.groupby("gene_id")["risk"].max().rename("max_critical_risk").to_frame()
        # Also store full tissue risks for detail
        data['gtex_details'] = gtex_df.groupby("gene_id").apply(
             lambda x: dict(zip(x["tissue_name"], x["risk"].round(4)))
        ).rename("tissue_risks").to_frame()

        # 5. AlphaFold
        cur.execute(f"""
            SELECT gene_id, mean_plddt, num_druggable_pockets 
            FROM tx_alphafold_structures WHERE gene_id IN {gene_list_sql}
        """)
        data['alphafold'] = pd.DataFrame(cur.fetchall(), columns=["gene_id", "mean_plddt", "num_druggable_pockets"]).set_index("gene_id")

        # 6. Drugs
        cur.execute(f"""
            SELECT gene_id,
                   COUNT(DISTINCT drug_name) AS total_drugs,
                   COUNT(DISTINCT drug_name) FILTER (WHERE approval_status = 'approved') AS approved_drugs
            FROM tx_drug_interactions WHERE gene_id IN {gene_list_sql}
            GROUP BY gene_id
        """)
        data['drugs'] = pd.DataFrame(cur.fetchall(), columns=["gene_id", "total_drugs", "approved_drugs"]).set_index("gene_id")

        # 7. ClinVar
        cur.execute(f"""
            SELECT gene_id, 
                   COUNT(*) FILTER (WHERE clinical_significance IN ('Pathogenic','Likely pathogenic')) AS pathogenic_count
            FROM tx_clinvar_variants WHERE gene_id IN {gene_list_sql}
            GROUP BY gene_id
        """)
        data['clinvar'] = pd.DataFrame(cur.fetchall(), columns=["gene_id", "pathogenic_count"]).set_index("gene_id")

        # 8. Protein Class
        cur.execute(f"SELECT gene_id, protein_class FROM tx_genes_master WHERE gene_id IN {gene_list_sql}")
        data['protein_class'] = dict(cur.fetchall())

    return data


def calculate_txscore(gene_ids: List[str], cancer_type: str) -> List[dict]:
    """Calculate TxScore for a list of genes and a specific cancer type."""
    if not gene_ids:
        return []

    data = load_data_for_genes(gene_ids, cancer_type)
    
    results = []
    
    for gene_id in gene_ids:
        # Extract data (safely handle missing)
        dep_c = data['depmap_cancer'].loc[gene_id] if gene_id in data['depmap_cancer'].index else None
        dep_p = data['depmap_pan'].loc[gene_id] if gene_id in data['depmap_pan'].index else None
        gnomad = data['gnomad'].loc[gene_id] if gene_id in data['gnomad'].index else None
        gtex_r = data['gtex_risk'].loc[gene_id] if gene_id in data['gtex_risk'].index else None
        gtex_d = data['gtex_details'].loc[gene_id] if gene_id in data['gtex_details'].index else None
        af = data['alphafold'].loc[gene_id] if gene_id in data['alphafold'].index else None
        drug = data['drugs'].loc[gene_id] if gene_id in data['drugs'].index else None
        clinv = data['clinvar'].loc[gene_id] if gene_id in data['clinvar'].index else None
        pclass = data['protein_class'].get(gene_id, "unknown")

        # Safe values
        c_mean_chron = float(dep_c["mean_chronos"]) if dep_c is not None and pd.notna(dep_c["mean_chronos"]) else None
        c_dep_prob   = float(dep_c["mean_dep_prob"]) if dep_c is not None and pd.notna(dep_c["mean_dep_prob"]) else None
        n_dep        = int(dep_c["n_dependent"]) if dep_c is not None else 0
        n_tot        = int(dep_c["n_total"]) if dep_c is not None else 0
        
        pan_mean     = float(dep_p["mean_chronos"]) if dep_p is not None and pd.notna(dep_p["mean_chronos"]) else None
        
        loeuf        = float(gnomad["loeuf"]) if gnomad is not None and pd.notna(gnomad["loeuf"]) else None
        pli          = float(gnomad["pli"]) if gnomad is not None and pd.notna(gnomad["pli"]) else None
        
        max_crit_risk = float(gtex_r["max_critical_risk"]) if gtex_r is not None else 0.0
        tissue_risks  = gtex_d["tissue_risks"] if gtex_d is not None else {}
        
        mean_plddt    = float(af["mean_plddt"]) if af is not None and pd.notna(af["mean_plddt"]) else None
        n_pockets     = int(af["num_druggable_pockets"]) if af is not None and pd.notna(af["num_druggable_pockets"]) else 0
        
        approved_d    = int(drug["approved_drugs"]) if drug is not None and pd.notna(drug["approved_drugs"]) else 0
        total_d       = int(drug["total_drugs"]) if drug is not None and pd.notna(drug["total_drugs"]) else 0
        
        pathogenic_c  = int(clinv["pathogenic_count"]) if clinv is not None and pd.notna(clinv["pathogenic_count"]) else 0

        # Compute
        eff_s, eff_comp     = efficacy_score(c_mean_chron, pan_mean, c_dep_prob)
        saf_s, crit_risk    = safety_score(max_crit_risk, loeuf, pli, tissue_risks)
        drug_s, modality    = druggability_score(mean_plddt, n_pockets, approved_d, pclass)
        prec_s, prec_comp   = precedent_score(pathogenic_c, approved_d, total_d)
        strat_s             = stratification_score(n_dep, n_tot, c_mean_chron)

        tvs = compute_tvs(eff_s, saf_s, drug_s, prec_s, strat_s)

        res = {
            "gene_id": gene_id,
            "cancer_type": cancer_type,
            "tvs": round(tvs, 4),
            "efficacy_score": round(eff_s, 4),
            "safety_score": round(saf_s, 4),
            "druggability_score": round(drug_s, 4),
            "precedent_score": round(prec_s, 4),
            "stratification_score": round(strat_s, 4),
            "efficacy_components": eff_comp,
            "tissue_risks": tissue_risks,
            "critical_tissue_risk": round(crit_risk, 4),
            "modality_recommendation": modality,
            "precedent_components": prec_comp,
            "model_version": "v1.0",
        }
        results.append(res)
    
    # Store results in DB
    COLS = [
        "gene_id", "cancer_type", "tvs",
        "efficacy_score", "safety_score", "druggability_score",
        "precedent_score", "stratification_score",
        "efficacy_components", "tissue_risks", "critical_tissue_risk",
        "modality_recommendation", "precedent_components", "model_version"
    ]
    upsert_rows("tx_txscore_cache", COLS, [tuple(r[c] for c in COLS) for r in results],
                conflict_cols=["gene_id", "cancer_type"],
                update_cols=COLS[2:])

    return results

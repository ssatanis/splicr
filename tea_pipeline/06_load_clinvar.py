"""
Step 06: Load ClinVar → tx_clinvar_variants
Parses variant_summary.txt.gz (GRCh38 rows only, significant variants)
"""
import gzip
import json
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
from tqdm import tqdm
from config import CLINVAR_VARIANTS, CLINVAR_GENE_COND
from utils.db import upsert_rows, count_rows, transaction

# Map gene symbol → entrez_id → gene_id (ENSG)
def build_entrez_to_ensg() -> dict:
    with transaction() as cur:
        cur.execute("""
            SELECT
              (aliases->>'entrez_id')::text AS entrez_id,
              gene_id
            FROM tx_genes_master
            WHERE aliases ? 'entrez_id'
        """)
        return {r[0]: r[1] for r in cur.fetchall() if r[0]}

def build_symbol_to_ensg() -> dict:
    with transaction() as cur:
        cur.execute("SELECT gene_symbol, gene_id FROM tx_genes_master")
        return {r[0]: r[1] for r in cur.fetchall()}


# Simplify clinical significance to canonical values
SIG_MAP = {
    "pathogenic":                  "Pathogenic",
    "likely pathogenic":           "Likely pathogenic",
    "pathogenic/likely pathogenic":"Pathogenic",
    "benign":                      "Benign",
    "likely benign":               "Likely benign",
    "benign/likely benign":        "Benign",
    "uncertain significance":      "VUS",
    "conflicting interpretations": "Conflicting",
    "conflicting classifications": "Conflicting",
    "risk factor":                 "Risk factor",
    "drug response":               "Drug response",
    "association":                 "Association",
    "not provided":                None,
    "other":                       None,
}

def normalize_sig(sig: str) -> str | None:
    if not sig:
        return None
    sl = sig.lower().strip()
    for key, val in SIG_MAP.items():
        if key in sl:
            return val
    return sig.strip() if sig.strip() else None


def load_clinvar():
    print("\n=== Loading ClinVar variants ===\n")

    entrez_to_ensg = build_entrez_to_ensg()
    sym_to_ensg    = build_symbol_to_ensg()
    print(f"  Gene lookups: {len(entrez_to_ensg)} entrez IDs, {len(sym_to_ensg)} symbols")

    # Read variant_summary.txt.gz (only GRCh38 rows)
    NEEDED = [
        "VariationID", "Type", "GeneID", "GeneSymbol",
        "ClinicalSignificance", "ClinSigSimple", "ReviewStatus",
        "Chromosome", "Start", "Stop",
        "ReferenceAllele", "AlternateAllele",
        "PhenotypeIDS", "PhenotypeList",
        "Assembly", "NumberSubmitters", "LastEvaluated",
        "RS# (dbSNP)",
    ]

    print("  Reading variant_summary.txt.gz...")
    df = pd.read_csv(
        CLINVAR_VARIANTS,
        sep="\t",
        low_memory=False,
        usecols=lambda c: c in set(NEEDED),
        na_values=["-", "na", "N/A"],
    )
    print(f"  Total rows: {len(df):,}")

    # GRCh38 only
    if "Assembly" in df.columns:
        df = df[df["Assembly"].astype(str).str.contains("GRCh38", na=False)]
    print(f"  GRCh38 rows: {len(df):,}")

    # Only significant variants (Pathogenic, Likely pathogenic, Benign, Risk factor)
    sig_keep = {"Pathogenic", "Likely pathogenic", "Benign", "Likely benign",
                "Risk factor", "Drug response", "Association", "VUS", "Conflicting"}

    COLS = [
        "variant_id", "gene_id",
        "clinical_significance", "review_status",
        "variant_type", "molecular_consequence",
        "chromosome", "position",
        "ref_allele", "alt_allele",
        "conditions", "phenotype_ids",
        "submitter_count",
    ]

    batch = []
    skipped = 0
    loaded  = 0
    total   = 0

    for _, r in tqdm(df.iterrows(), total=len(df), desc="  Processing variants"):
        total += 1

        # Resolve gene_id
        gene_id_str = str(r.get("GeneID", "")).strip()
        sym_str     = str(r.get("GeneSymbol", "")).strip().upper()

        gene_id = entrez_to_ensg.get(gene_id_str) or sym_to_ensg.get(sym_str)
        if not gene_id:
            skipped += 1
            continue

        raw_sig = str(r.get("ClinicalSignificance", "") or "")
        sig     = normalize_sig(raw_sig)
        if not sig:
            skipped += 1
            continue

        # Build conditions array
        phenotype_list = str(r.get("PhenotypeList", "") or "")
        conditions = [c.strip() for c in phenotype_list.split("|")
                      if c.strip() and c.strip() != "not provided"][:20]

        phenotype_ids_raw = str(r.get("PhenotypeIDS", "") or "")
        pheno_ids = [p.strip() for p in phenotype_ids_raw.split("|")
                     if p.strip() and p.strip() != "na"][:20]

        try:
            pos = int(float(r.get("Start", 0) or 0))
        except (ValueError, TypeError):
            pos = 0

        chrom = str(r.get("Chromosome", "") or "").strip()
        if chrom and not chrom.startswith("chr"):
            chrom = "chr" + chrom

        ref = str(r.get("ReferenceAllele", "") or "")[:50]
        alt = str(r.get("AlternateAllele", "") or "")[:50]
        if ref in ("-", "na", "N/A", "nan"): ref = None
        if alt in ("-", "na", "N/A", "nan"): alt = None

        var_type = str(r.get("Type", "") or "").strip() or None
        review   = str(r.get("ReviewStatus", "") or "").strip() or None
        sub_cnt  = None
        try:
            sub_cnt = int(float(r.get("NumberSubmitters", 0) or 0))
        except (ValueError, TypeError):
            pass

        variation_id = str(r.get("VariationID", "")).strip()
        if not variation_id or variation_id in ("", "nan", "0"):
            continue

        batch.append((
            variation_id,
            gene_id,
            sig,
            review,
            var_type,
            None,       # molecular_consequence (not in this file)
            chrom,
            pos,
            ref,
            alt,
            conditions if conditions else None,
            pheno_ids if pheno_ids else None,
            sub_cnt,
        ))

        if len(batch) >= 5000:
            # Deduplicate by variant_id (index 0)
            deduped = list({r[0]: r for r in batch}.values())
            upsert_rows("tx_clinvar_variants", COLS, deduped,
                        conflict_cols=["variant_id"],
                        update_cols=["clinical_significance", "conditions"])
            loaded += len(deduped)
            batch = []

    if batch:
        deduped = list({r[0]: r for r in batch}.values())
        upsert_rows("tx_clinvar_variants", COLS, deduped,
                    conflict_cols=["variant_id"],
                    update_cols=["clinical_significance", "conditions"])
        loaded += len(deduped)

    print(f"\nDone. Loaded {loaded:,} variants, skipped {skipped:,}")
    print(f"  tx_clinvar_variants: {count_rows('tx_clinvar_variants'):,} rows")


if __name__ == "__main__":
    load_clinvar()

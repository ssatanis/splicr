"""
Step 03: Load DepMap data
 - Model.csv            → tx_cell_line_metadata
 - CRISPRGeneEffect.csv + CRISPRGeneDependency.csv → tx_depmap_data

Strategy for ~17M rows (1000 cell lines × 17000 genes):
  Read both matrices, melt to long-format in chunks of 500 genes.
"""
import re
import json
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import numpy as np
from tqdm import tqdm
from config import (DEPMAP_GENE_EFFECT, DEPMAP_GENE_DEP, DEPMAP_MODEL,
                    DEPMAP_RELEASE, BATCH_SIZE)
from utils.db import upsert_rows, count_rows, transaction

SYMBOL_RE = re.compile(r'^[A-Z0-9][A-Z0-9\-]*$')

def clean_symbol(s: str) -> str:
    s = s.upper().strip()
    return re.sub(r'[^A-Z0-9\-]', '', s)


# ─── Cell line metadata ───────────────────────────────────────────────────────
def load_cell_lines():
    print("Loading cell line metadata from Model.csv...")
    df = pd.read_csv(DEPMAP_MODEL, low_memory=False)

    rows = []
    for _, r in df.iterrows():
        cell_line_id = str(r.get("ModelID", "")).strip()
        if not cell_line_id.startswith("ACH-"):
            continue

        mut_profile = {}
        # Include key driver mutations if column exists
        for col in ["OncotreeCode", "OncotreeSubtype", "OncotreePrimaryDisease"]:
            val = r.get(col)
            if pd.notna(val):
                mut_profile[col] = str(val)

        rows.append((
            cell_line_id,
            str(r.get("CellLineName", "") or "").strip(),
            str(r.get("OncotreeCode", "") or "").strip() or None,
            str(r.get("OncotreeLineage", "") or "").strip() or None,
            str(r.get("OncotreeLineage", "") or "").strip() or None,   # lineage ≈ tissue
            str(r.get("OncotreePrimaryDisease", "") or "").strip() or None,
            str(r.get("OncotreeSubtype", "") or "").strip() or None,
            int(r["Age"]) if pd.notna(r.get("Age")) else None,
            str(r.get("Sex", "") or "").strip() or None,
            str(r.get("SourceType", "") or "").strip() or None,
            json.dumps(mut_profile) if mut_profile else None,
            None,   # expression_cluster
            None,   # msi_status
            None,   # ploidy
            DEPMAP_RELEASE,
        ))

    COLS = [
        "cell_line_id", "cell_line_name", "cancer_type", "tissue_origin",
        "lineage", "primary_disease", "subtype", "age", "sex", "source",
        "mutation_profile", "expression_cluster", "msi_status", "ploidy",
        "depmap_release",
    ]
    upsert_rows("tx_cell_line_metadata", COLS, rows,
                conflict_cols=["cell_line_id"],
                update_cols=["cancer_type", "tissue_origin", "lineage",
                             "primary_disease", "subtype"])
    print(f"  Loaded {len(rows)} cell lines → tx_cell_line_metadata")
    return df.set_index("ModelID")  # return for later use


# ─── Build ENSG lookup from DB ────────────────────────────────────────────────
def build_symbol_to_ensg() -> dict:
    """Query tx_genes_master for gene_symbol → gene_id mapping."""
    print("Building gene symbol → ENSG lookup...")
    with transaction() as cur:
        cur.execute("SELECT gene_symbol, gene_id FROM tx_genes_master")
        return {row[0]: row[1] for row in cur.fetchall()}


# ─── Parse gene columns from DepMap header ───────────────────────────────────
def parse_depmap_cols(header_line: str):
    """
    Returns list of (col_index, gene_symbol, entrez_id) tuples.
    Header format: ,SYMBOL (ENTREZ), ...
    """
    cols = header_line.strip().split(",")
    result = []
    for i, col in enumerate(cols):
        if i == 0:
            continue   # first col is cell line ID
        m = re.match(r'"?([A-Za-z0-9\.\-]+)\s+\((\d+)\)"?', col.strip())
        if m:
            sym = clean_symbol(m.group(1))
            entrez = int(m.group(2))
            result.append((i, sym, entrez))
    return result


# ─── Main DepMap loader ───────────────────────────────────────────────────────
def load_depmap():
    print("\n=== Loading DepMap essentiality data ===\n")

    # 1. Load cell lines
    model_df = load_cell_lines()

    # 2. Build lookup tables
    sym_to_ensg = build_symbol_to_ensg()

    # 3. Build cell line → cancer type lookup from Model.csv
    cell_line_cancer = {}
    cell_line_tissue  = {}
    cell_line_lineage = {}
    cell_line_disease = {}
    for model_id, row in model_df.iterrows():
        mid = str(model_id)
        cell_line_cancer[mid]  = str(row.get("OncotreeCode", "") or "").strip() or None
        cell_line_tissue[mid]  = str(row.get("TissueOrigin", "") or "").strip() or None
        cell_line_lineage[mid] = str(row.get("OncotreeLineage", "") or "").strip() or None
        cell_line_disease[mid] = str(row.get("OncotreePrimaryDisease", "") or "").strip() or None

    # 4. Read headers from both files to get gene column info
    with open(DEPMAP_GENE_EFFECT, "r") as f:
        effect_header = f.readline()
    with open(DEPMAP_GENE_DEP, "r") as f:
        dep_header = f.readline()

    effect_cols = parse_depmap_cols(effect_header)
    dep_cols    = parse_depmap_cols(dep_header)

    # Build column-index → (symbol, entrez) for both files
    eff_by_pos   = {i: (sym, ent) for (i, sym, ent) in effect_cols}
    dep_by_pos   = {i: (sym, ent) for (i, sym, ent) in dep_cols}

    # All gene columns (use effect file as primary, dep file should match)
    all_gene_cols = effect_cols   # list of (idx, sym, entrez)

    print(f"  {len(all_gene_cols)} genes in DepMap")
    print(f"  Reading full matrices (this takes a few minutes)...")

    # 5. Read both CSV matrices
    print("  Reading CRISPRGeneEffect.csv...")
    effect_df = pd.read_csv(DEPMAP_GENE_EFFECT, index_col=0, low_memory=False)
    print(f"  Shape: {effect_df.shape}")

    print("  Reading CRISPRGeneDependency.csv...")
    dep_df = pd.read_csv(DEPMAP_GENE_DEP, index_col=0, low_memory=False)
    print(f"  Shape: {dep_df.shape}")

    # 6. Build gene column → ENSG lookup (filter only genes in master table)
    gene_col_names = effect_df.columns.tolist()
    col_to_ensg = {}
    skipped_genes = 0
    for col_name in gene_col_names:
        m = re.match(r'"?([A-Za-z0-9\.\-]+)\s+\((\d+)\)"?', str(col_name).strip())
        if not m:
            skipped_genes += 1
            continue
        sym     = clean_symbol(m.group(1))
        gene_id = sym_to_ensg.get(sym)
        if gene_id:
            col_to_ensg[col_name] = gene_id
        else:
            skipped_genes += 1

    mapped_cols = list(col_to_ensg.keys())
    print(f"  Mapped {len(mapped_cols):,} genes to ENSG IDs ({skipped_genes} skipped)")

    # Filter both matrices to mapped columns only
    effect_df = effect_df[[c for c in mapped_cols if c in effect_df.columns]]
    dep_df    = dep_df[[c for c in mapped_cols if c in dep_df.columns]]

    COLS = [
        "gene_id", "cell_line_id", "chronos_effect", "dependency_probability",
        "cancer_type", "tissue_origin", "lineage", "primary_disease",
        "depmap_release", "screen_type",
    ]

    # 7. Add metadata columns to index
    cl_metadata = pd.DataFrame({
        "cancer_type":    pd.Series(cell_line_cancer),
        "tissue_origin":  pd.Series(cell_line_tissue),
        "lineage":        pd.Series(cell_line_lineage),
        "primary_disease":pd.Series(cell_line_disease),
    })

    # 8. Melt all at once (vectorized — much faster than itertuples)
    print("  Melting matrices to long format...")
    effect_df.index.name = "cell_line_id"
    dep_df.index.name    = "cell_line_id"

    eff_melt = (
        effect_df
        .reset_index()
        .melt(id_vars=["cell_line_id"], var_name="gene_col", value_name="chronos_effect")
        .dropna(subset=["chronos_effect"])
    )
    dep_melt = (
        dep_df
        .reset_index()
        .melt(id_vars=["cell_line_id"], var_name="gene_col", value_name="dep_prob")
    )
    print(f"  Effect rows: {len(eff_melt):,}")

    merged = eff_melt.merge(dep_melt, on=["cell_line_id", "gene_col"], how="left")
    merged["gene_id"] = merged["gene_col"].map(col_to_ensg)
    merged = merged.dropna(subset=["gene_id"])
    merged = merged.join(cl_metadata, on="cell_line_id", how="left")
    merged["depmap_release"] = DEPMAP_RELEASE
    merged["screen_type"]    = "CRISPR"

    # Replace NaN with None for nullable columns
    str_cols = ["cancer_type", "tissue_origin", "lineage", "primary_disease"]
    for c in str_cols:
        if c in merged.columns:
            merged[c] = merged[c].where(merged[c].notna(), None)

    print(f"  Inserting {len(merged):,} rows in batches...")
    CHUNK = 200_000   # rows per DB transaction
    total_rows = 0

    # Column order must match COLS exactly
    out_cols = ["gene_id", "cell_line_id", "chronos_effect", "dep_prob",
                "cancer_type", "tissue_origin", "lineage", "primary_disease",
                "depmap_release", "screen_type"]

    for i in tqdm(range(0, len(merged), CHUNK), desc="  Inserting", unit="batch"):
        chunk_df = merged.iloc[i:i+CHUNK][out_cols]
        # Convert to list of tuples efficiently via numpy
        chunk_arr = chunk_df.to_numpy()
        rows = [tuple(
            None if (v != v or v is None) else v   # NaN → None
            for v in row
        ) for row in chunk_arr]

        upsert_rows("tx_depmap_data", COLS, rows,
                    conflict_cols=["gene_id", "cell_line_id", "depmap_release"],
                    update_cols=None,   # DO NOTHING for existing rows (much faster)
                    page_size=10000)
        total_rows += len(rows)

    print(f"\nDone. Loaded {total_rows:,} rows → tx_depmap_data")
    print(f"  Skipped {skipped_genes} genes (not in tx_genes_master)")
    print(f"  Final count: {count_rows('tx_depmap_data'):,}")


if __name__ == "__main__":
    load_depmap()

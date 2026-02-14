"""
Step 04: Load GTEx v8 Median TPM → tx_gtex_expression
GCT format:
  Line 1: #1.2
  Line 2: <n_genes>\t<n_tissues>
  Line 3: Name\tDescription\t<tissue1>\t<tissue2>...
  Lines 4+: ENSG...\tGENE_SYMBOL\t<tpm1>\t...
"""
import gzip
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
from tqdm import tqdm
from config import GTEX_MEDIAN_TPM, GTEX_VERSION, TISSUE_METADATA
from utils.db import upsert_rows, count_rows, transaction

# ─── Tissue category lookup ───────────────────────────────────────────────────
def get_tissue_info(tissue_name: str) -> tuple:
    meta = TISSUE_METADATA.get(tissue_name, {})
    return (
        meta.get("category", "other"),
        tissue_name,   # tissue_detail = full name
    )


def build_ensg_set() -> set:
    """Get all gene_ids from tx_genes_master."""
    with transaction() as cur:
        cur.execute("SELECT gene_id FROM tx_genes_master")
        return {r[0] for r in cur.fetchall()}


def load_gtex():
    print("\n=== Loading GTEx expression data ===\n")

    known_ensg = build_ensg_set()
    print(f"  {len(known_ensg)} genes in tx_genes_master")

    COLS = [
        "gene_id", "tissue_name", "median_tpm", "mean_tpm", "std_tpm",
        "samples_count", "max_tpm",
        "tissue_category", "tissue_detail", "gtex_version",
    ]

    total_rows = 0
    tissue_names = []
    batch = []

    with gzip.open(GTEX_MEDIAN_TPM, "rt") as f:
        for i, line in enumerate(tqdm(f, desc="  Parsing GTEx", unit="lines",
                                      mininterval=1)):
            line = line.rstrip("\n")

            if i == 0:   # "#1.2"
                continue
            elif i == 1: # "56200\t54"
                parts = line.split("\t")
                n_genes    = int(parts[0])
                n_tissues  = int(parts[1])
                print(f"  GTEx: {n_genes} genes × {n_tissues} tissues")
                continue
            elif i == 2: # header row: Name\tDescription\t<tissue1>...
                headers    = line.split("\t")
                tissue_names = headers[2:]   # skip Name, Description
                print(f"  Tissues: {len(tissue_names)}")
                continue

            # Data rows
            parts = line.split("\t")
            if len(parts) < 3:
                continue

            ensg_ver = parts[0]
            ensg     = ensg_ver.split(".")[0]

            if ensg not in known_ensg:
                continue

            try:
                tpm_vals = [float(v) if v not in ("", "NA", "nan") else 0.0
                            for v in parts[2:2+len(tissue_names)]]
            except ValueError:
                continue

            for j, tissue_name in enumerate(tissue_names):
                if j >= len(tpm_vals):
                    break
                tpm = tpm_vals[j]
                tcat, tdetail = get_tissue_info(tissue_name)

                batch.append((
                    ensg,
                    tissue_name,
                    round(tpm, 6),     # median_tpm
                    None,              # mean_tpm (not in this file)
                    None,              # std_tpm
                    1,                 # samples_count placeholder
                    None,              # max_tpm
                    tcat,
                    tdetail,
                    GTEX_VERSION,
                ))

            # Flush every 200K rows
            if len(batch) >= 200_000:
                upsert_rows("tx_gtex_expression", COLS, batch,
                            conflict_cols=["gene_id", "tissue_name", "gtex_version"],
                            update_cols=["median_tpm"])
                total_rows += len(batch)
                batch = []

    # Final flush
    if batch:
        upsert_rows("tx_gtex_expression", COLS, batch,
                    conflict_cols=["gene_id", "tissue_name", "gtex_version"],
                    update_cols=["median_tpm"])
        total_rows += len(batch)

    # Update tissue sample counts from GTEx annotations
    print("\nRefreshing materialized view tx_gtex_high_expression...")
    with transaction() as cur:
        cur.execute("REFRESH MATERIALIZED VIEW tx_gtex_high_expression")

    print(f"\nDone. Loaded {total_rows:,} rows → tx_gtex_expression")
    print(f"  Final count: {count_rows('tx_gtex_expression'):,}")


if __name__ == "__main__":
    load_gtex()

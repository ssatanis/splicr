"""
Step 05: Load gnomAD v4.1 constraint metrics → tx_gnomad_constraint
gnomAD TSV has two rows per gene:
  - gene_id = gene symbol (Entrez)
  - gene_id = ENSG...        ← we want this one, canonical == true
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import numpy as np
from tqdm import tqdm
from config import GNOMAD_CONSTRAINT, GNOMAD_VERSION
from utils.db import upsert_rows, count_rows, transaction


def build_ensg_set() -> set:
    with transaction() as cur:
        cur.execute("SELECT gene_id FROM tx_genes_master")
        return {r[0] for r in cur.fetchall()}


REAL_MAX = 3.4e+38
REAL_MIN = 1.18e-38   # smallest positive normal REAL

def safe_float(val) -> float | None:
    """Convert to float, clamp to PostgreSQL REAL range; NaN/inf → None."""
    try:
        f = float(val)
        if f != f or abs(f) == float("inf"):
            return None
        if f != 0.0 and abs(f) < REAL_MIN:
            return 0.0                   # subnormal → 0
        if abs(f) > REAL_MAX:
            return None                  # overflow → NULL
        return f
    except (TypeError, ValueError):
        return None


def safe_int(val) -> int | None:
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def load_gnomad():
    print("\n=== Loading gnomAD constraint metrics ===\n")

    known_ensg = build_ensg_set()
    print(f"  {len(known_ensg)} genes in tx_genes_master")

    # Read gnomAD TSV with only columns we need
    NEEDED_COLS = [
        "gene", "gene_id", "canonical",
        "lof.oe_ci.lower", "lof.oe_ci.upper",
        "lof.pLI", "lof.pNull", "lof.pRec",
        "lof.obs", "lof.exp", "lof.oe",
        "mis.z_score", "mis.oe", "mis.oe_ci.lower", "mis.oe_ci.upper",
        "mis.obs", "mis.exp",
        "syn.z_score", "syn.oe", "syn.oe_ci.lower", "syn.oe_ci.upper",
        "syn.obs", "syn.exp",
        "lof.z_score",
    ]

    print("  Reading gnomAD TSV (95MB)...")
    df = pd.read_csv(
        GNOMAD_CONSTRAINT,
        sep="\t",
        low_memory=False,
        usecols=lambda c: c in set(NEEDED_COLS),
    )
    print(f"  Raw rows: {len(df):,}")

    # Filter: ENSG IDs only + canonical
    mask = (
        df["gene_id"].astype(str).str.startswith("ENSG") &
        (df["canonical"].astype(str).str.lower() == "true")
    )
    df = df[mask].copy()
    print(f"  Canonical ENSG rows: {len(df):,}")

    # Filter to genes in our master table
    df = df[df["gene_id"].isin(known_ensg)].copy()
    print(f"  Matched to tx_genes_master: {len(df):,}")

    COLS = [
        "gene_id",
        "loeuf", "loeuf_lower", "loeuf_upper",
        "pli",
        "mis_z", "oe_mis", "oe_mis_lower", "oe_mis_upper",
        "syn_z", "oe_syn", "oe_syn_lower", "oe_syn_upper",
        "oe_lof", "oe_lof_lower", "oe_lof_upper",
        "obs_lof", "exp_lof",
        "obs_mis", "exp_mis",
        "obs_syn", "exp_syn",
        "gnomad_version",
    ]

    rows = []
    for _, r in tqdm(df.iterrows(), total=len(df), desc="  Building rows"):
        ensg   = str(r["gene_id"])
        loeuf  = safe_float(r.get("lof.oe_ci.upper"))   # LOEUF = OE upper CI
        loeuf_lower = safe_float(r.get("lof.oe_ci.lower"))

        # loeuf_upper is NULL (LOEUF IS the upper bound; no upper-of-upper)
        loeuf_upper = None

        # Validate constraint: loeuf_lower ≤ loeuf (if both present)
        if loeuf is not None and loeuf_lower is not None:
            if loeuf_lower > loeuf:
                loeuf_lower = None   # data quality issue, drop

        rows.append((
            ensg,
            loeuf,
            loeuf_lower,
            loeuf_upper,
            safe_float(r.get("lof.pLI")),
            safe_float(r.get("mis.z_score")),
            safe_float(r.get("mis.oe")),
            safe_float(r.get("mis.oe_ci.lower")),
            safe_float(r.get("mis.oe_ci.upper")),
            safe_float(r.get("syn.z_score")),
            safe_float(r.get("syn.oe")),
            safe_float(r.get("syn.oe_ci.lower")),
            safe_float(r.get("syn.oe_ci.upper")),
            safe_float(r.get("lof.oe")),
            safe_float(r.get("lof.oe_ci.lower")),
            safe_float(r.get("lof.oe_ci.upper")),   # same as loeuf
            safe_int(r.get("lof.obs")),
            safe_float(r.get("lof.exp")),
            safe_int(r.get("mis.obs")),
            safe_float(r.get("mis.exp")),
            safe_int(r.get("syn.obs")),
            safe_float(r.get("syn.exp")),
            GNOMAD_VERSION,
        ))

    print(f"  Inserting {len(rows):,} rows...")
    upsert_rows(
        "tx_gnomad_constraint", COLS, rows,
        conflict_cols=["gene_id"],
        update_cols=["loeuf", "loeuf_lower", "pli", "mis_z", "oe_mis",
                     "oe_lof", "obs_lof", "exp_lof"],
    )

    print(f"\nDone. tx_gnomad_constraint: {count_rows('tx_gnomad_constraint'):,} rows")


if __name__ == "__main__":
    load_gnomad()

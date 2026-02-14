"""
Step 07: Load DGIdb drug-gene interactions → tx_drug_interactions
Parses interactions.tsv from DGIdb Dec-2024 release.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
from tqdm import tqdm
from config import DGIDB_INTERACTIONS, DGIDB_GENES
from utils.db import upsert_rows, count_rows, transaction


def build_symbol_to_ensg() -> dict:
    with transaction() as cur:
        cur.execute("SELECT gene_symbol, gene_id FROM tx_genes_master")
        return {r[0]: r[1] for r in cur.fetchall()}


# Normalize approval status from DGIdb fields
def infer_approval(row: pd.Series) -> str:
    if row.get("drug_is_approved") == True or str(row.get("drug_is_approved","")).lower() == "true":
        return "approved"
    name_lower = str(row.get("drug_name", "") or "").lower()
    if any(x in name_lower for x in ["investigational", "phase"]):
        return "investigational"
    return "experimental"


def load_dgidb():
    print("\n=== Loading DGIdb drug interactions ===\n")

    sym_to_ensg = build_symbol_to_ensg()
    print(f"  {len(sym_to_ensg)} genes in tx_genes_master")

    # Read interactions.tsv (skip comment lines starting with #)
    print("  Reading interactions.tsv...")
    df = pd.read_csv(
        DGIDB_INTERACTIONS,
        sep="\t",
        comment="#",
        low_memory=False,
    )
    print(f"  Rows: {len(df):,}")

    COLS = [
        "gene_id", "drug_name", "interaction_type",
        "interaction_claim_source", "approval_status",
        "source", "source_db_version",
    ]

    batch = []
    loaded = 0
    skipped = 0

    for _, r in tqdm(df.iterrows(), total=len(df), desc="  Processing interactions"):
        # Resolve gene
        sym = str(r.get("gene_name", "") or "").upper().strip()
        gene_id = sym_to_ensg.get(sym)
        if not gene_id:
            # Try gene_claim_name
            sym2 = str(r.get("gene_claim_name", "") or "").upper().strip()
            gene_id = sym_to_ensg.get(sym2)
        if not gene_id:
            skipped += 1
            continue

        drug_name = str(r.get("drug_name", "") or "").strip()
        if not drug_name or drug_name.lower() in ("nan", ""):
            skipped += 1
            continue

        # Interaction types (can be multiple, pipe-separated)
        int_types_raw = str(r.get("interaction_types", "") or "")
        int_types = int_types_raw.strip() or None

        source_db = str(r.get("interaction_source_db_name", "") or "DGIdb").strip()
        source_ver = str(r.get("interaction_source_db_version", "") or "").strip() or None

        approval = infer_approval(r)

        batch.append((
            gene_id,
            drug_name[:500],
            int_types[:200] if int_types else None,
            source_db[:200],
            approval,
            "DGIdb",
            source_ver,
        ))

        if len(batch) >= 5000:
            # Deduplicate by (gene_id, drug_name) — indices 0,1
            # Prefer approved entries, then by interaction_type presence
            deduped_map = {}
            for r in batch:
                key = (r[0], r[1])
                if key not in deduped_map or r[4] == "approved":
                    deduped_map[key] = r
            deduped = list(deduped_map.values())
            upsert_rows("tx_drug_interactions", COLS, deduped,
                        conflict_cols=["gene_id", "drug_name", "source"],
                        update_cols=["interaction_type", "approval_status"])
            loaded += len(deduped)
            batch = []

    if batch:
        deduped_map = {}
        for r in batch:
            key = (r[0], r[1])
            if key not in deduped_map or r[4] == "approved":
                deduped_map[key] = r
        deduped = list(deduped_map.values())
        upsert_rows("tx_drug_interactions", COLS, deduped,
                    conflict_cols=["gene_id", "drug_name", "source"],
                    update_cols=["interaction_type", "approval_status"])
        loaded += len(deduped)

    print(f"\nDone. Loaded {loaded:,} interactions, skipped {skipped:,}")
    print(f"  tx_drug_interactions: {count_rows('tx_drug_interactions'):,} rows")


if __name__ == "__main__":
    load_dgidb()

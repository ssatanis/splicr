"""
Step 01: Load static metadata tables
- tx_tissue_metadata   (54 GTEx tissues)
- tx_cancer_type_metadata
Runs in seconds. Must run before any loaders that use tissue/cancer FK references.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from config import TISSUE_METADATA, CANCER_TYPE_METADATA
from utils.db import upsert_rows, count_rows

def load_tissue_metadata():
    print("Loading tissue metadata...")
    rows = []
    for tissue_name, meta in TISSUE_METADATA.items():
        rows.append((
            tissue_name,
            meta["category"],
            None,          # tissue_detail (not needed)
            meta["critical"],
            meta["weight"],
            None,          # sample_count (will update after GTEx load)
        ))

    upsert_rows(
        "tx_tissue_metadata",
        ["tissue_name", "tissue_category", "tissue_detail", "is_critical", "toxicity_weight", "sample_count"],
        rows,
        conflict_cols=["tissue_name"],
        update_cols=["tissue_category", "is_critical", "toxicity_weight"],
    )
    print(f"  Loaded {len(rows)} tissues → tx_tissue_metadata")


def load_cancer_metadata():
    print("Loading cancer type metadata...")
    rows = []
    for code, meta in CANCER_TYPE_METADATA.items():
        rows.append((
            code,
            meta["name"],
            meta["tissue"],
            meta["category"],
            None,   # prevalence_rank
            None,   # five_year_survival
        ))

    upsert_rows(
        "tx_cancer_type_metadata",
        ["cancer_type", "cancer_name", "tissue_of_origin", "category",
         "prevalence_rank", "five_year_survival"],
        rows,
        conflict_cols=["cancer_type"],
        update_cols=["cancer_name", "tissue_of_origin", "category"],
    )
    print(f"  Loaded {len(rows)} cancer types → tx_cancer_type_metadata")


if __name__ == "__main__":
    load_tissue_metadata()
    load_cancer_metadata()
    print(f"\nDone. Tissues: {count_rows('tx_tissue_metadata')}, Cancers: {count_rows('tx_cancer_type_metadata')}")

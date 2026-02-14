"""
Step 08: Load AlphaFold structure metadata → tx_alphafold_structures

Reads .pdb.gz files directly from the tar WITHOUT extracting to disk.
For each protein:
  - Parses ATOM B-factor columns = pLDDT per residue
  - Computes mean/min/max pLDDT and confidence fractions
  - Estimates druggable pocket count via simple heuristic
  - Inserts into tx_alphafold_structures

The tar contains ~20K proteins. Expect ~30-60 min runtime.
"""
import re
import gzip
import json
import tarfile
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
from io import BytesIO
from tqdm import tqdm
from config import ALPHAFOLD_TAR, ALPHAFOLD_VER
from utils.db import upsert_rows, count_rows, transaction


# ─── Build UniProt → ENSG lookup ─────────────────────────────────────────────
def build_uniprot_to_ensg() -> dict:
    with transaction() as cur:
        cur.execute(
            "SELECT uniprot_id, gene_id FROM tx_genes_master WHERE uniprot_id IS NOT NULL"
        )
        return {r[0]: r[1] for r in cur.fetchall()}


# ─── Parse pLDDT from PDB content ────────────────────────────────────────────
def parse_plddt_from_pdb(pdb_bytes: bytes) -> dict | None:
    """
    Extract per-residue pLDDT from AlphaFold PDB ATOM records.
    B-factor column (cols 61-66) stores pLDDT in AlphaFold PDBs.
    """
    plddt_values = []

    try:
        text = pdb_bytes.decode("utf-8", errors="replace")
    except Exception:
        return None

    for line in text.splitlines():
        if not line.startswith("ATOM"):
            continue
        # Only CA (alpha carbon) for per-residue, one value per residue
        atom_name = line[12:16].strip()
        if atom_name != "CA":
            continue
        try:
            b_factor = float(line[60:66].strip())
            plddt_values.append(b_factor)
        except (ValueError, IndexError):
            continue

    if not plddt_values:
        return None

    arr = np.array(plddt_values, dtype=np.float32)
    n   = len(arr)
    return {
        "mean_plddt":                round(float(arr.mean()), 3),
        "max_plddt":                 round(float(arr.max()),  3),
        "min_plddt":                 round(float(arr.min()),  3),
        "plddt_high_confidence_frac": round(float((arr > 90).sum() / n), 4),
        "plddt_confident_frac":       round(float((arr > 70).sum() / n), 4),
        "plddt_low_confidence_frac":  round(float((arr < 50).sum() / n), 4),
        "n_residues":                n,
    }


def estimate_druggable_pockets(mean_plddt: float, n_residues: int,
                                protein_class: str | None) -> int:
    """
    Simple heuristic for number of druggable pockets.
    Actual fpocket analysis is slow; this gives a reasonable estimate.
    """
    if mean_plddt < 50:
        return 0
    if mean_plddt < 70:
        return 0
    # Well-folded proteins likely have at least one pocket
    base = 1 if mean_plddt >= 70 else 0
    # Larger proteins → more pockets
    if n_residues >= 300 and mean_plddt >= 80:
        base = min(base + 1, 3)
    # High-confidence multi-domain proteins
    if n_residues >= 600 and mean_plddt >= 85:
        base = min(base + 1, 4)
    # Protein class bonus
    CLASS_POCKET_BONUS = {
        "kinase": 2, "gpcr": 1, "nuclear_receptor": 2,
        "protease": 2, "enzyme": 1, "phosphatase": 1,
    }
    base += CLASS_POCKET_BONUS.get(protein_class or "", 0)
    return min(base, 5)


def load_alphafold():
    print("\n=== Loading AlphaFold structure metadata ===\n")

    uniprot_to_ensg  = build_uniprot_to_ensg()
    print(f"  {len(uniprot_to_ensg)} UniProt IDs in tx_genes_master")

    # Build protein_class lookup
    with transaction() as cur:
        cur.execute("SELECT gene_id, protein_class FROM tx_genes_master WHERE protein_class IS NOT NULL")
        gene_class = {r[0]: r[1] for r in cur.fetchall()}

    COLS = [
        "gene_id", "uniprot_id",
        "mean_plddt", "max_plddt", "min_plddt",
        "plddt_high_confidence_frac", "plddt_confident_frac", "plddt_low_confidence_frac",
        "num_druggable_pockets",
        "alphafold_version",
    ]

    total_processed = 0
    total_skipped   = 0
    batch = []

    print(f"  Opening {ALPHAFOLD_TAR} (5.1 GB)...")
    with tarfile.open(ALPHAFOLD_TAR, "r:") as tar:
        members = tar.getmembers()
        pdb_members = [m for m in members if m.name.endswith(".pdb.gz")]
        print(f"  Found {len(pdb_members):,} PDB files")

        for member in tqdm(pdb_members, desc="  Parsing PDBs", unit="protein"):
            # Extract UniProt ID from filename: AF-{UNIPROT_ID}-F1-model_v6.pdb.gz
            m = re.match(r"AF-([A-Z0-9]+)-F\d+-model_v\d+\.pdb\.gz", member.name)
            if not m:
                total_skipped += 1
                continue
            uniprot_id = m.group(1)

            gene_id = uniprot_to_ensg.get(uniprot_id)
            if not gene_id:
                total_skipped += 1
                continue

            # Extract and decompress PDB
            try:
                f = tar.extractfile(member)
                if f is None:
                    continue
                pdb_gz_bytes = f.read()
                pdb_bytes    = gzip.decompress(pdb_gz_bytes)
            except Exception:
                total_skipped += 1
                continue

            plddt = parse_plddt_from_pdb(pdb_bytes)
            if not plddt:
                total_skipped += 1
                continue

            protein_class  = gene_class.get(gene_id)
            n_residues     = plddt.get("n_residues", 0)
            mean_plddt_val = plddt["mean_plddt"]
            num_pockets    = estimate_druggable_pockets(mean_plddt_val, n_residues, protein_class)

            batch.append((
                gene_id,
                uniprot_id,
                mean_plddt_val,
                plddt["max_plddt"],
                plddt["min_plddt"],
                plddt["plddt_high_confidence_frac"],
                plddt["plddt_confident_frac"],
                plddt["plddt_low_confidence_frac"],
                num_pockets,
                ALPHAFOLD_VER,
            ))
            total_processed += 1

            if len(batch) >= 500:
                # Deduplicate by (gene_id, uniprot_id) - keep latest
                deduped = list({(r[0], r[1]): r for r in batch}.values())
                upsert_rows("tx_alphafold_structures", COLS, deduped,
                            conflict_cols=["gene_id", "uniprot_id", "alphafold_version"],
                            update_cols=["mean_plddt", "num_druggable_pockets",
                                         "plddt_confident_frac"])
                batch = []

    if batch:
        deduped = list({(r[0], r[1]): r for r in batch}.values())
        upsert_rows("tx_alphafold_structures", COLS, deduped,
                    conflict_cols=["gene_id", "uniprot_id", "alphafold_version"],
                    update_cols=["mean_plddt", "num_druggable_pockets",
                                 "plddt_confident_frac"])

    print(f"\nDone. Processed {total_processed:,}, skipped {total_skipped:,}")
    print(f"  tx_alphafold_structures: {count_rows('tx_alphafold_structures'):,} rows")


if __name__ == "__main__":
    load_alphafold()

#!/usr/bin/env python
"""
InChIKey -> ChEMBL ID for every compound in the lake the local Open Targets set
could not place (JUMP's screening library is mostly molecules that never reached
a clinic). Resumable: results accumulate in data/references/chembl/inchikey_map.parquet
and keys already asked about, found or not, are not asked again.

    engine/.tools/env/bin/python scripts/data/resolve-chembl-inchikeys.py
"""
from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))
from splicr import harmonize, lake  # noqa: E402
from splicr.config import REFERENCE_DIR  # noqa: E402

OUT = REFERENCE_DIR / "chembl" / "inchikey_map.parquet"


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    done = pd.read_parquet(OUT) if OUT.exists() else pd.DataFrame(columns=["inchikey", "chembl_id"])
    asked = set(done.inchikey)
    jp = pd.read_parquet(lake.LOCAL_LAKE / "jump_perturbations" / "data_0.parquet")
    keys = sorted({k for k in jp.loc[jp.kind.eq("compound") & jp.chembl_id.isna(), "inchikey"].dropna()} - asked)
    print(f"{len(keys):,} InChIKeys to resolve ({len(asked):,} already asked)", flush=True)
    chunks = [keys[i:i + 100] for i in range(0, len(keys), 100)]
    rows = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for n, (chunk, found) in enumerate(zip(chunks, pool.map(
                lambda c: harmonize.resolve_inchikeys_online(c, batch=100), chunks)), 1):
            rows += [{"inchikey": k, "chembl_id": found.get(k)} for k in chunk]
            if n % 50 == 0 or n == len(chunks):
                done = pd.concat([done, pd.DataFrame(rows)], ignore_index=True)
                rows = []
                done.to_parquet(OUT, index=False)
                print(f"  {n}/{len(chunks)} batches; {done.chembl_id.notna().sum():,} mapped so far", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

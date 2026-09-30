#!/usr/bin/env python
"""
Measure whether predicted repair outcome explains real screen behaviour.

    engine/.tools/env/bin/python scripts/research/validate-benchmark.py --samples 60

Uses DepMap 26Q1 Avana raw read counts, which is the largest set of pooled
screens with per-guide counts and a matched plasmid pool, so the within-gene
comparison has real power. Guide log fold changes are taken against the pDNA
batch the screen was built from, averaged over `--samples` passing screens, and
handed to `splicr.validate.benchmark`.

Writes research/artifacts/validate/benchmark_avana.json.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from splicr import lake  # noqa: E402
from splicr.config import DEPMAP_DIR  # noqa: E402
from splicr.references import essentials, nonessentials  # noqa: E402
from splicr.validate import benchmark  # noqa: E402

RELEASE = "26Q1"
COUNTS = DEPMAP_DIR / RELEASE / "AvanaRawReadcounts.csv"
SEQMAP = DEPMAP_DIR / RELEASE / "ScreenSequenceMap.csv"
OUT = ROOT / "research" / "artifacts" / "validate"


def pick_samples(batch: str, n: int) -> tuple[str, list[str]]:
    rows = list(csv.DictReader(open(SEQMAP)))
    pdna = [r["SequenceID"] for r in rows if r["ScreenType"] == "pDNA" and r["pDNABatch"] == batch]
    if not pdna:
        raise SystemExit(f"no pDNA sample for batch {batch}")
    screens = [r["SequenceID"] for r in rows
               if r["Library"] == "Avana" and r["ScreenType"] == "2DS"
               and r["pDNABatch"] == batch and r["PassesQC"] == "True"
               and r["ExcludeFromCRISPRCombined"] == "False"]
    return pdna[0], sorted(screens)[:n]


def guide_lfc(pdna: str, samples: list[str]) -> dict[str, float]:
    """Mean log2 fold change per guide: screen CPM over plasmid CPM."""
    import duckdb

    con = duckdb.connect()
    con.execute("set enable_progress_bar = false")
    cols = ", ".join(f'"{c}"' for c in [pdna, *samples])
    df = con.execute(
        f'select "column0000" as sgrna, {cols} from read_csv(\'{COUNTS}\', header=true, '
        f"sample_size=2000)").df()
    con.close()

    guides = df["sgrna"].to_numpy()
    mat = df[[pdna, *samples]].to_numpy(dtype=float)
    mat = np.where(np.isfinite(mat), mat, 0.0)
    cpm = (mat + 1.0) / (mat.sum(axis=0, keepdims=True) + len(mat)) * 1e6
    logcpm = np.log2(cpm)
    lfc = logcpm[:, 1:] - logcpm[:, [0]]
    # A guide missing from the plasmid pool has no interpretable fold change.
    keep = mat[:, 0] >= 30
    return dict(zip(guides[keep], lfc[keep].mean(axis=1)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", default="Avana-4")
    ap.add_argument("--samples", type=int, default=60)
    ap.add_argument("--ploidy", type=float, default=2.0)
    args = ap.parse_args()

    import pandas as pd

    started = time.time()
    val = pd.read_parquet(lake.LOCAL_LAKE / "guide_validation" / "library=avana" / "data_0.parquet")
    val = val[val.status.eq("ok")][["guide_key", "gene_symbol", "frameshift", "n_alignments", "drop_reason"]]
    # Multi-mapping guides and ones DepMap drops would add a confound that has
    # nothing to do with repair; the question is about repair outcome alone.
    val = val[val.n_alignments.fillna(1).le(1) & val.drop_reason.isna()]

    pdna, samples = pick_samples(args.batch, args.samples)
    print(f"pDNA {pdna}; {len(samples)} screens from batch {args.batch}")
    lfc = guide_lfc(pdna, samples)
    print(f"  {len(lfc):,} guides with a usable plasmid count")

    val["lfc"] = val.guide_key.map(lfc)
    val = val.dropna(subset=["lfc"])
    val["knockout_probability"] = benchmark.knockout_probability(val.frameshift.to_numpy(), args.ploidy)

    ess, non = set(essentials(9606)), set(nonessentials(9606))
    result = benchmark.run(val, ess, non)
    result["inputs"] = {"release": RELEASE, "library": "Avana", "pdna": pdna,
                        "n_screens": len(samples), "batch": args.batch, "ploidy": args.ploidy,
                        "essential_genes": len(ess), "nonessential_genes": len(non),
                        "seconds": round(time.time() - started, 1)}
    print()
    print(benchmark.summarise(result))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "benchmark_avana.json").write_text(json.dumps(result, indent=2, default=str) + "\n")
    print(f"\nwrote {OUT / 'benchmark_avana.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

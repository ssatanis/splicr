#!/usr/bin/env python
"""
Place every guide in a library on the genome and predict its repair outcome.

    engine/.tools/env/bin/python scripts/data/build-guide-validation.py avana
    engine/.tools/env/bin/python scripts/data/build-guide-validation.py brunello --upload
    engine/.tools/env/bin/python scripts/data/build-guide-validation.py all

Writes one Parquet per library to the lake under `guide_validation`, with a row
per guide: its genomic placement, the 60 bp repair window, Lindel's predicted
frameshift fraction, and the in-frame deletions it predicts. This is the slow,
purely reference-derived half of biophysical validation, so it is computed once
per library and reused by every screen that uses it.

Guides whose stated coordinates do not reproduce their own sequence are written
with status set and no prediction, never silently dropped: a library whose
placement rate falls is a library whose annotation drifted from the assembly.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from splicr import lake  # noqa: E402
from splicr.config import DEPMAP_DIR  # noqa: E402
from splicr.references import available_libraries, load_library, refseq_to_chrom  # noqa: E402
from splicr.validate import repair  # noqa: E402
from splicr.validate.conventions import convention, is_measured  # noqa: E402
from splicr.validate.genome import Genome, place_guide  # noqa: E402

DATASET = "guide_validation"
AVANA_MAP = DEPMAP_DIR / "26Q1" / "AvanaGuideMap.csv"
ALIGNMENT = re.compile(r"^(chr[^_]+)_(\d+)_([+-])$")


def avana_guides():
    """DepMap's Avana map: `GenomeAlignment` is chrom_pos_strand on hg38."""
    offset = convention("avana").cut_offset
    with open(AVANA_MAP, newline="") as fh:
        for row in csv.DictReader(fh):
            m = ALIGNMENT.match(row.get("GenomeAlignment") or "")
            if not m:
                continue
            gene = (row.get("Gene") or "").split(" (")[0]
            yield {
                "guide_key": row["sgRNA"], "sequence": row["sgRNA"], "gene_symbol": gene or None,
                "chrom": m.group(1), "anchor": int(m.group(2)) + offset, "strand": m.group(3),
                "n_alignments": float(row.get("nAlignments") or 0) or None,
                "drop_reason": row.get("DropReason") or None,
            }


def library_guides(slug: str):
    lib = load_library(slug)
    offset = convention(slug).cut_offset
    for g in lib.guides:
        if g.is_control or not g.chrom or g.cut_pos is None:
            continue
        chrom = g.chrom if g.chrom.startswith("chr") else (refseq_to_chrom(g.chrom) or g.chrom)
        yield {
            "guide_key": g.guide_id, "sequence": g.sequence, "gene_symbol": g.gene,
            "chrom": chrom, "anchor": int(g.cut_pos) + offset, "strand": g.strand,
            "n_alignments": float(g.perfect_alignments) if g.perfect_alignments is not None else None,
            "drop_reason": None,
        }


SOURCES = {"avana": avana_guides}


def build(name: str, processes: int, upload: bool) -> dict:
    import pandas as pd

    started = time.time()
    if not is_measured(name):
        print(f"  {name}: no measured cut convention; assuming {convention(name).stated}. "
              f"Run scripts/data/validate-cutsite-convention.py --libraries {name} to check it.")
    rows = list(SOURCES[name]() if name in SOURCES else library_guides(name))
    if not rows:
        print(f"  {name}: no guide carries genomic coordinates; needs alignment first")
        return {"library": name, "guides": 0}

    genome = Genome()
    contexts: dict[str, str] = {}
    for i, r in enumerate(rows):
        r["_row"] = i
        cs = place_guide(genome, r["chrom"], r["anchor"], r["sequence"],
                         guide_key=r["guide_key"], strand_hint=r["strand"])
        r["status"] = cs.status
        r["placed_strand"] = cs.strand if cs.ok else None
        r["cut_pos"] = cs.cut_pos if cs.ok else None
        r["pam"] = cs.pam or None
        r["context"] = cs.context or None
        if cs.ok:
            contexts[str(i)] = cs.context
    genome.close()
    placed = len(contexts)

    outcomes = repair.predict_many(contexts, processes=processes)
    for r in rows:
        o = outcomes.get(str(r["_row"]))
        r["frameshift"] = o.frameshift if o else None
        r["in_frame"] = o.in_frame if o else None
        r["insertion"] = o.insertion if o else None
        # Kept as parallel arrays rather than structs: DuckDB and pandas both
        # read them without a nested-type dance, and the score layer zips them.
        r["inframe_del_offsets"] = [s for s, _l, _p in o.in_frame_deletions] if o else []
        r["inframe_del_lengths"] = [l for _s, l, _p in o.in_frame_deletions] if o else []
        r["inframe_del_probs"] = [p for _s, _l, p in o.in_frame_deletions] if o else []
        r["repair_model"] = repair.MODEL_NAME if o else None
        r["repair_model_commit"] = repair.LINDEL_COMMIT if o else None
        if o is None and r["status"] == "ok":
            r["status"] = "repair_failed"
        r.pop("anchor", None)
        r.pop("_row", None)

    df = pd.DataFrame(rows)
    df.insert(0, "library", name)
    out = lake.LOCAL_LAKE / DATASET / f"library={name}"
    out.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out / "data_0.parquet", compression="zstd", index=False)

    fs = df["frameshift"].dropna()
    stats = {
        "library": name, "guides": len(df), "placed": placed,
        "placed_rate": round(placed / len(df), 4),
        "predicted": int(fs.size),
        "frameshift_mean": round(float(fs.mean()), 4) if fs.size else None,
        "frameshift_p10": round(float(fs.quantile(0.10)), 4) if fs.size else None,
        "frameshift_p90": round(float(fs.quantile(0.90)), 4) if fs.size else None,
        "seconds": round(time.time() - started, 1),
    }
    print(f"  {name}: {placed:,}/{len(df):,} placed ({stats['placed_rate']:.1%}), "
          f"{stats['predicted']:,} predicted, frameshift mean {stats['frameshift_mean']}, "
          f"{stats['seconds']}s")
    for status, n in df["status"].value_counts().items():
        if status != "ok":
            print(f"      {status}: {n:,}")
    if upload:
        lake.DATASETS.setdefault(DATASET, lake.Dataset(DATASET, ("library",), (), "Per-guide repair prediction."))
        print(f"      uploaded {lake.upload_dataset(DATASET)} file(s)")
    return stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("libraries", nargs="+", help="avana, a library slug, or all")
    ap.add_argument("--processes", type=int, default=8)
    ap.add_argument("--upload", action="store_true")
    args = ap.parse_args()

    names = list(args.libraries)
    if "all" in names:
        names = ["avana", *available_libraries()]
    print(f"Repair prediction -> {lake.LOCAL_LAKE / DATASET}")
    for name in names:
        build(name, args.processes, args.upload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

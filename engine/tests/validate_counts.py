#!/usr/bin/env python
"""
Check SplicR's counting against the authors' own published counts.

    engine/.tools/env/bin/python engine/tests/validate_counts.py

This is the strongest evidence in the repository that the counting stage is
correct, because it does not compare SplicR to itself: it counts the raw FASTQ
from GSE145743 and compares the result, guide by guide, to the count table the
paper's authors deposited alongside it.

WHY ABSOLUTE COUNTS CANNOT MATCH, AND WHAT IS COMPARED INSTEAD

The deposited table is normalised to exactly 10,000,000 reads per column, which
is visible in the column sums and is 5,000,000 per library across the two
GeCKOv2 halves it merges, so raw counts are not comparable and should
not be. Both sides are converted to counts per million and compared as a ratio per
guide. A median ratio of 1.0 means SplicR assigns reads to guides in the same
proportions the authors did.

The deposited table also merges GeCKOv2 libraries A and B into one column per
condition, while the FASTQ runs are per library, so only the library A guides
are compared and only for the samples that exist on both sides.

The numbers this prints have been quoted as evidence, so they need to be
reproducible by anyone with the repository rather than remembered from a
session. It writes its result to docs/validation/counting.json so a claim on the
site can cite a file rather than a memory.
"""

from __future__ import annotations

import csv
import gzip
import json
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from splicr.config import TESTDATA_DIR  # noqa: E402
from splicr.count import count_fastq  # noqa: E402
from splicr.references import load_library  # noqa: E402

SCREEN = TESTDATA_DIR / "GSE145743"
PUBLISHED = SCREEN / "counts" / "GSE145743_my_counts_anno_merged.txt.gz"

# The FASTQ runs, and the column each corresponds to in the deposited table.
# Library A only: the deposited columns merge A and B.
PAIRS = [
    ("SRR12401850_libA_plasmid.fastq.gz", "plasmid"),
    ("SRR11144449_libA_T0_input.fastq.gz", "input"),
    ("SRR11144453_libA_DMSO_rep1.fastq.gz", "DMSO1"),
    ("SRR11144451_libA_olaparib_rep1.fastq.gz", "Olaparib1"),
]


def load_published() -> tuple[dict[str, dict[str, int]], list[str]]:
    with gzip.open(PUBLISHED, "rt") as fh:
        reader = csv.reader(fh, delimiter="\t")
        header = next(reader)
        samples = header[2:]
        rows: dict[str, dict[str, int]] = {}
        for row in reader:
            if len(row) < len(header):
                continue
            rows[row[0]] = {s: int(v) for s, v in zip(samples, row[2:]) if v.lstrip("-").isdigit()}
    return rows, samples


def cpm(counts: dict[str, int]) -> dict[str, float]:
    total = sum(counts.values())
    if not total:
        return {}
    return {k: v * 1_000_000 / total for k, v in counts.items()}


def spearman(a: list[float], b: list[float]) -> float:
    def ranks(xs: list[float]) -> list[float]:
        order = sorted(range(len(xs)), key=lambda i: xs[i])
        out = [0.0] * len(xs)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
                j += 1
            shared = (i + j) / 2 + 1
            for k in range(i, j + 1):
                out[order[k]] = shared
            i = j + 1
        return out

    ra, rb = ranks(a), ranks(b)
    ma, mb = st.fmean(ra), st.fmean(rb)
    num = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    da = sum((x - ma) ** 2 for x in ra) ** 0.5
    db = sum((y - mb) ** 2 for y in rb) ** 0.5
    return num / (da * db) if da and db else 0.0


def main() -> int:
    if not PUBLISHED.exists():
        print(f"missing {PUBLISHED}; run scripts/data/download.sh")
        return 1

    published, samples = load_published()
    print(f"Published table: {len(published):,} guides, columns {samples}")
    print(f"  column sums: "
          f"{ {s: sum(r.get(s, 0) for r in published.values()) for s in samples} }")

    library = load_library("geckov2-a")
    results = []

    for fastq_name, column in PAIRS:
        fastq = SCREEN / "fastq" / fastq_name
        if not fastq.exists():
            print(f"\nskipping {fastq_name}: not downloaded")
            continue

        print(f"\n{fastq_name}  vs published column {column!r}")
        counted = count_fastq(fastq, library, label=column)
        print(f"  {counted.summary()}")

        theirs_raw = {g: r[column] for g, r in published.items() if column in r}
        # Compare only guides both sides carry, which is library A.
        shared = [g for g in counted.counts if g in theirs_raw]
        ours_cpm = cpm({g: counted.counts[g] for g in shared})
        theirs_cpm = cpm({g: theirs_raw[g] for g in shared})

        # A ratio needs both sides non-zero to be defined.
        ratios = [ours_cpm[g] / theirs_cpm[g]
                  for g in shared if theirs_cpm.get(g, 0) > 0 and ours_cpm.get(g, 0) > 0]
        within25 = sum(1 for r in ratios if 0.75 <= r <= 1.25) / len(ratios) if ratios else 0.0
        rho = spearman([ours_cpm.get(g, 0.0) for g in shared],
                       [theirs_cpm.get(g, 0.0) for g in shared])

        ours_zero = sum(1 for g in shared if counted.counts[g] == 0)
        theirs_zero = sum(1 for g in shared if theirs_raw[g] == 0)

        row = {
            "fastq": fastq_name,
            "published_column": column,
            "guides_compared": len(shared),
            "median_cpm_ratio": round(st.median(ratios), 4) if ratios else None,
            "fraction_within_25_percent": round(within25, 4),
            "spearman": round(rho, 4),
            "zero_guides_splicr": ours_zero,
            "zero_guides_published": theirs_zero,
            "reads": counted.total_reads,
            "mapping_rate": round(counted.mapping_rate, 4),
        }
        results.append(row)
        print(f"  guides compared        {row['guides_compared']:,}")
        print(f"  median CPM ratio       {row['median_cpm_ratio']}")
        print(f"  within 25 percent      {within25:.1%}")
        print(f"  Spearman               {row['spearman']}")
        print(f"  zero guides, SplicR    {ours_zero:,}")
        print(f"  zero guides, published {theirs_zero:,}")

    if not results:
        print("\nNothing compared: no FASTQ files present.")
        return 1

    out = Path(__file__).resolve().parents[2] / "docs" / "validation" / "counting.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "dataset": "GSE145743",
        "library": "geckov2-a",
        "published_table": PUBLISHED.name,
        "note": (
            "The deposited table is normalised to 10,000,000 reads per column, "
            "5,000,000 per library across the two halves it merges, so "
            "counts are compared as counts per million rather than raw. Only "
            "GeCKOv2 library A guides are compared, because the deposited columns "
            "merge libraries A and B."
        ),
        "samples": results,
    }, indent=2) + "\n")
    print(f"\nwrote {out}")

    medians = [r["median_cpm_ratio"] for r in results if r["median_cpm_ratio"]]
    rhos = [r["spearman"] for r in results]
    print(f"\nAcross {len(results)} samples: median CPM ratio "
          f"{min(medians):.3f} to {max(medians):.3f}, Spearman {min(rhos):.3f} to {max(rhos):.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

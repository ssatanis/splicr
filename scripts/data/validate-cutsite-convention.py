#!/usr/bin/env python
"""
Does `splicr.validate.genome` reproduce the coordinates a library states?

    engine/.tools/env/bin/python scripts/data/validate-cutsite-convention.py
    engine/.tools/env/bin/python scripts/data/validate-cutsite-convention.py --limit 2000

WHY THIS RUNS BEFORE ANYTHING READS A CUT SITE

`place_guide` locates a guide by searching the genome near a stated position
rather than by trusting the position, because every library states it
differently. That search has to be checked against a library that publishes its
own answer, or the refusal to trust conventions is just a different untested
convention.

Brunello is the check. It publishes, per guide: a RefSeq chromosome accession,
"Position of Base After Cut (1-based)", a strand, and -- independently -- the
30 bp `Target Context Sequence` the Broad's design tool cut from the assembly.
So two things can be compared, and they fail differently:

  cut position   our 0-based cut against (stated - 1). Catches an off-by-one or
                 a strand-flipped offset, both of which move the repair window.
  30 bp context  Brunello's own context against ours at [9:39]. Catches a window
                 pulled from the wrong place entirely, which a position check
                 alone would miss if both were wrong the same way.

Avana has no published context, so only its placement is checked, against
DepMap's `GenomeAlignment` (chrom_pos_strand).

THE TWO LIBRARIES DO NOT AGREE, WHICH IS THE POINT

Brunello's stated position is the base 3' of the blunt cut, 1-based. DepMap's
is the same cut written 0-based, so the same physical site differs by one
between the two files. Both are recorded in CONVENTIONS below with the offset
that reconciles them; neither is "corrected", because Brunello's own 30-mer
independently confirms its convention and there is no reason to think DepMap's
is wrong rather than different. A library added later gets its own row here,
found the same way: run this and read the offset off the delta histogram.

Avana's placement is judged on guides that align once. A guide with 14,367
genomic alignments is listed at every one of them, and all but one lack a real
NGG PAM, so `place_guide` refusing them is the behaviour under test rather than
a failure of it. Both rates are reported.

WHAT THE STRAND COLUMNS MEAN, WHICH IS NOT WHAT THEY LOOK LIKE

Brunello's "sense"/"antisense" is relative to the *target transcript*, not to
the genome, so it agrees with the protospacer's genomic strand about half the
time. Passing it to `place_guide` as a strand hint is therefore passing a wrong
hint for half the library; this script measures that, and it is the reason
`place_guide` retries without the hint instead of reporting the guide missing.
The rate printed here is expected to be near 50% and is not an error.

Exit status is non-zero if any placed guide disagrees about its cut position or
its context, or if the placement rate falls below --min-placed.
"""

from __future__ import annotations

import argparse
import collections
import csv
import io
import json
import random
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from splicr.config import DEPMAP_DIR  # noqa: E402
from splicr.references import read_text_any, refseq_to_chrom  # noqa: E402
from splicr.validate.conventions import CONVENTIONS  # noqa: E402
from splicr.validate.genome import Genome, place_guide  # noqa: E402

BRUNELLO = ROOT / "data" / "references" / "libraries" / "brunello.txt"
AVANA_MAP = DEPMAP_DIR / "26Q1" / "AvanaGuideMap.csv"
OUT = ROOT / "research" / "artifacts" / "validate" / "cutsite_convention.json"

ALIGNMENT = re.compile(r"^(chr[^_]+)_(\d+)_([+-])$")
#: Brunello's 30-mer is 4 bp of upstream flank + 20 bp protospacer + 3 bp PAM
#: + 3 bp downstream. Our 60-mer puts the protospacer at 13, so the 30-mer
#: starts 4 bases before that.
CONTEXT_30_OFFSET = 9

def brunello_rows():
    text = read_text_any(BRUNELLO)
    for row in csv.DictReader(io.StringIO(text), delimiter="\t"):
        accession = (row.get("Genomic Sequence") or "").strip()
        if not accession:
            continue  # a non-targeting control: no coordinate to check
        chrom = refseq_to_chrom(accession)
        if chrom is None:
            yield {"skip": f"unmapped accession {accession}"}
            continue
        stated = int(row["Position of Base After Cut (1-based)"])
        yield {
            "guide": row["sgRNA Target Sequence"].strip().upper(),
            "chrom": chrom,
            "cut0": stated + CONVENTIONS["brunello"].cut_offset,
            "hint": {"sense": "+", "antisense": "-"}.get(row["Strand"].strip().lower()),
            "context30": (row.get("Target Context Sequence") or "").strip().upper() or None,
            "unique": True,
        }


def avana_rows():
    with open(AVANA_MAP, newline="") as fh:
        for row in csv.DictReader(fh):
            m = ALIGNMENT.match(row.get("GenomeAlignment") or "")
            if not m:
                continue
            yield {
                "guide": row["sgRNA"].strip().upper(),
                "chrom": m.group(1),
                "cut0": int(m.group(2)) + CONVENTIONS["avana"].cut_offset,
                "hint": m.group(3),
                "context30": None,
                # A guide that aligns in many places is listed at all of them;
                # only its one real site carries a PAM.
                "unique": float(row.get("nAlignments") or 0) <= 1
                          and not (row.get("DropReason") or "").strip(),
            }


def check(name: str, rows, limit: int, seed: int, min_placed: float) -> dict:
    rows = [r for r in rows]
    skipped = [r["skip"] for r in rows if "skip" in r]
    rows = [r for r in rows if "skip" not in r]
    if limit and limit < len(rows):
        random.Random(seed).shuffle(rows)
        rows = rows[:limit]

    started = time.time()
    genome = Genome()
    status = collections.Counter()
    status_unique = collections.Counter()
    delta = collections.Counter()
    context_ok = collections.Counter()
    hint_agrees = collections.Counter()
    examples: list[dict] = []

    for r in rows:
        cs = place_guide(genome, r["chrom"], r["cut0"], r["guide"], strand_hint=r["hint"])
        status[cs.status] += 1
        if r["unique"]:
            status_unique[cs.status] += 1
        if not cs.ok:
            if len(examples) < 10:
                examples.append({"guide": r["guide"], "at": f"{r['chrom']}:{r['cut0']}",
                                 "status": cs.status, "detail": cs.detail})
            continue
        d = cs.cut_pos - r["cut0"]
        # Only a uniquely-aligning guide has one right answer to compare with;
        # a repeat-family guide can legitimately land on a neighbouring copy.
        if r["unique"]:
            delta[d] += 1
        hint_agrees[cs.strand == r["hint"]] += 1
        if r["context30"] is not None:
            match = cs.context[CONTEXT_30_OFFSET:CONTEXT_30_OFFSET + 30] == r["context30"]
            context_ok[match] += 1
            if not match and len(examples) < 10:
                examples.append({"guide": r["guide"], "at": f"{r['chrom']}:{r['cut0']}",
                                 "stated_context": r["context30"],
                                 "ours": cs.context[CONTEXT_30_OFFSET:CONTEXT_30_OFFSET + 30]})
        if d != 0 and len(examples) < 10:
            examples.append({"guide": r["guide"], "at": f"{r['chrom']}:{r['cut0']}",
                             "delta": d, "placed_strand": cs.strand, "hint": r["hint"]})
    genome.close()

    placed = status["ok"]
    total = len(rows)
    n_unique = sum(status_unique.values())
    result = {
        "library": name,
        "convention": vars(CONVENTIONS[name]),
        "checked": total,
        "skipped_unmapped": len(skipped),
        "placed": placed,
        "placed_rate": round(placed / total, 5) if total else 0.0,
        "unique_alignment_guides": n_unique,
        "unique_placed": status_unique["ok"],
        "unique_placed_rate": round(status_unique["ok"] / n_unique, 5) if n_unique else None,
        "status": dict(status),
        "cut_delta": {str(k): v for k, v in sorted(delta.items())},
        "cut_checked": sum(delta.values()),
        "cut_exact": delta.get(0, 0),
        "context30_checked": sum(context_ok.values()),
        "context30_match": context_ok.get(True, 0),
        "strand_hint_agrees_with_genome": (
            round(hint_agrees[True] / placed, 4) if placed else None),
        "examples": examples,
        "seconds": round(time.time() - started, 1),
    }
    result["passes"] = bool(
        result["cut_checked"] and result["cut_exact"] == result["cut_checked"]
        and result["context30_match"] == result["context30_checked"]
        and (result["unique_placed_rate"] or 0) >= min_placed)

    print(f"{name}: {placed:,}/{total:,} placed ({result['placed_rate']:.2%}) in {result['seconds']}s")
    for k, v in sorted(status.items()):
        if k != "ok":
            print(f"    {k}: {v:,} (of these, {status_unique[k]:,} align uniquely)")
    print(f"    uniquely-aligning guides placed: {result['unique_placed']:,}/{n_unique:,} "
          f"({(result['unique_placed_rate'] or 0):.2%})")
    off = {k: v for k, v in delta.items() if k != 0}
    print(f"    cut position reproduced (offset {CONVENTIONS[name].cut_offset:+d}): "
          f"{result['cut_exact']:,}/{result['cut_checked']:,}"
          + (f"  OFF BY {off}" if off else ""))
    if result["context30_checked"]:
        print(f"    published 30 bp context reproduced: "
              f"{result['context30_match']:,}/{result['context30_checked']:,}")
    print(f"    stated strand equals genomic strand: "
          f"{result['strand_hint_agrees_with_genome']:.1%} "
          f"(transcript-relative columns land near 50%; not an error)")
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="guides per library; 0 = all")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--min-placed", type=float, default=0.95)
    ap.add_argument("--libraries", nargs="*", default=["brunello", "avana"])
    args = ap.parse_args()

    sources = {"brunello": brunello_rows, "avana": avana_rows}
    results = []
    for name in args.libraries:
        results.append(check(name, sources[name](), args.limit, args.seed, args.min_placed))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"libraries": results,
                               "min_placed": args.min_placed}, indent=2) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)}")
    failed = [r["library"] for r in results if not r["passes"]]
    if failed:
        print(f"FAILED: {', '.join(failed)}")
        return 1
    print("All libraries reproduce their own stated cut sites.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

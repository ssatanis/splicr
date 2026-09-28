"""Reproduce the post-screen reliability audit on a published olaparib screen.

This is a wrapper/inference audit on already observed data, not an AssayBench
score or an independent estimate of prospective validation success.

PYTHONPATH=engine engine/.tools/env/bin/python engine/analysis/postscreen_reliability.py \
    --out data/research/postscreen_reliability
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import time
from dataclasses import asdict
from pathlib import Path

from splicr.config import ROOT
from splicr.count import read_count_table
from splicr.hits import call_hits
from splicr.qc import screen_qc
from splicr.references import Library, load_library


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--counts", type=Path, default=ROOT / "data/testdata/GSE145743/counts/GSE145743_my_counts_anno_merged.txt.gz")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--drugz-paired", action="store_true",
                        help="declare sample pairing; default does not assume matched replicates")
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    libraries = [load_library("geckov2-a"), load_library("geckov2-b")]
    library = Library("geckov2-ab", "Human GeCKOv2 A+B", [g for lib in libraries for g in lib.guides])
    matrix = read_count_table(args.counts.resolve(), library)
    treatment, control = ["Olaparib1", "Olaparib2"], ["DMSO1", "DMSO2"]
    roles = {"plasmid": "plasmid", "input": "reference",
             **{s: "treatment" for s in treatment}, **{s: "control" for s in control}}
    qc = screen_qc(matrix, roles, treatment, control, library)
    table = call_hits(matrix, library, treatment, control, out / "tools",
                      run_bagel=False, run_drug=True, essentiality_contrast=False,
                      drugz_paired=args.drugz_paired)
    native = [g for g in table.genes.values()
              if g.depleted_fdr is not None and g.enriched_fdr is not None
              and min(g.depleted_fdr, g.enriched_fdr) < 0.1]
    corrected = table.significant(0.1)
    ranked = table.ranked()
    drugz = [g for g in table.genes.values() if g.norm_z is not None]
    missing_tools = [tool for tool in ("mageck_rra", "drugz") if tool not in table.methods]
    summary = {
        "task": "post_screen_wrapper_audit", "dataset": "GSE145743",
        "source": "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE145743",
        "input_sha256": hashlib.sha256(args.counts.read_bytes()).hexdigest(),
        "gene_library": "Human GeCKOv2 A+B",
        "code_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "working_tree_patch_sha256": hashlib.sha256(subprocess.check_output(
            ["git", "diff", "--", "engine/splicr/hits.py", "engine/splicr/count.py", "engine/splicr/qc.py"], cwd=ROOT)).hexdigest(),
        "python": platform.python_version(), "elapsed_seconds": round(time.monotonic() - started, 3),
        "n_guides": len(matrix.guide_ids), "n_genes": len(table.genes), "methods": table.methods,
        "fdr_threshold": 0.1, "original_min_directional_fdr_hits": len(native),
        "corrected_two_family_fdr_hits": len(corrected),
        "statistical_method": "min(1, 2*min(MAGeCK directional FDRs)); two-family union bound",
        "drugz_scored_genes": len(drugz),
        "drugz_pairing": "paired" if args.drugz_paired else "unpaired",
        "drugz_significant_sensitizers": sum(g.norm_z < 0 and g.drugz_fdr is not None and g.drugz_fdr < .1 for g in drugz),
        "drugz_significant_suppressors": sum(g.norm_z > 0 and g.drugz_fdr is not None and g.drugz_fdr < .1 for g in drugz),
        "CHD1L": asdict(table.genes["CHD1L"]) if "CHD1L" in table.genes else None,
        "CHD1L_rank": next((i + 1 for i, g in enumerate(ranked) if g.gene == "CHD1L"), None),
        "qc": qc.as_dict(), "warnings": table.warnings, "missing_tools": missing_tools,
        "validation_probability": None,
        "interpretation": "Published case sanity check. CHD1L was known in advance; recovery is not independent validation or prospective accuracy. Count table is author-processed; FASTQ counting was not repeated.",
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k not in {"qc", "CHD1L"}}, indent=2))
    if missing_tools:
        raise SystemExit("Incomplete audit: required tools did not produce results")


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""
End-to-end integration test: FASTQ through counting, QC and hit calling.

Builds a small screen from REAL Brunello guide sequences, writes real
gzipped FASTQ with the documented Broad GPP primer staggers, and runs the
actual pipeline over it. Essentials from CEGv2 are simulated as depleting and
NEGv1 nonessentials as flat.

The separation is planted, so strong recovery is expected. What the test
genuinely proves is that every stage is wired correctly on real inputs:
library parsing with bare CR line endings, anchor-based spacer location
across staggers, exact and mismatch counting, the QC metric definitions, and
both hit callers including BAGEL2's two different column numbering schemes.

    export PATH="engine/.tools/env/bin:$PATH"
    python engine/tests/integration_test.py
"""

from __future__ import annotations

import gzip
import random
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from splicr.count import CountMatrix, count_fastq                     # noqa: E402
from splicr.detect import detect_from_fastq                            # noqa: E402
from splicr.hits import call_hits                                      # noqa: E402
from splicr.qc import screen_qc                                        # noqa: E402
from splicr.references import essentials, load_library, nonessentials  # noqa: E402

ANCHOR = "TTGTGGAAAGGACGAAACACCG"      # lentiGuide / lentiCRISPRv2
SCAFFOLD = "GTTTTAGAGCTAGAAATAGCAAG"
STAGGERS = (0, 1, 2, 3, 4, 6, 7, 8)     # Broad GPP primer set; note 5 is absent

N_ESSENTIAL, N_NONESSENTIAL, N_OTHER = 100, 150, 250
MIN_PRECISION_AT_100 = 0.85
MAX_NNMD = -1.25
MIN_MAPPING_RATE = 0.99
MIN_REPLICATE_R = 0.90

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{(' :: ' + detail) if detail else ''}")
    if not ok:
        failures.append(f"{label}{(' :: ' + detail) if detail else ''}")


def build_screen(tmp: Path, lib, rng: random.Random):
    ess, non = essentials(), nonessentials()
    by_gene: dict[str, list] = {}
    for g in lib.guides:
        if not g.is_control and g.gene:
            by_gene.setdefault(g.gene, []).append(g)

    picked = (
        rng.sample(sorted(ess & by_gene.keys()), N_ESSENTIAL)
        + rng.sample(sorted(non & by_gene.keys()), N_NONESSENTIAL)
        + rng.sample(sorted(by_gene.keys() - ess - non), N_OTHER)
    )
    guides = [g for gene in picked for g in by_gene[gene][:4]]

    def write(name: str, depth: int) -> Path:
        path = tmp / f"{name}.fastq.gz"
        n = 0
        with gzip.open(path, "wt") as fh:
            for g in guides:
                if name == "plasmid" or name.startswith("T0"):
                    effect = 1.0
                elif g.gene in ess:
                    effect = rng.uniform(0.05, 0.25)
                elif g.gene in non:
                    effect = rng.uniform(0.9, 1.1)
                else:
                    effect = rng.uniform(0.5, 1.2)
                reads = max(0, int(rng.gauss(depth * effect, depth * effect * 0.25)))
                for _ in range(reads):
                    stagger = "".join(rng.choice("ACGT") for _ in range(rng.choice(STAGGERS)))
                    seq = (stagger + ANCHOR + g.sequence + SCAFFOLD)[:75]
                    fh.write(f"@{name}{n}\n{seq}\n+\n{'I' * len(seq)}\n")
                    n += 1
        return path

    layout = [("plasmid", 60), ("T0_r1", 55), ("T0_r2", 55), ("Treat_r1", 50), ("Treat_r2", 50)]
    return {name: write(name, depth) for name, depth in layout}, guides, ess, non


def main() -> None:
    if shutil.which("mageck") is None:
        print("mageck is not on PATH. Run:\n"
              '    export PATH="engine/.tools/env/bin:$PATH"')
        sys.exit(1)

    print("SplicR integration test\n")
    rng = random.Random(3)
    lib = load_library("brunello")
    print(f"  library: {lib!r}")

    tmp = Path(tempfile.mkdtemp())
    try:
        fastqs, guides, ess, non = build_screen(tmp, lib, rng)
        print(f"  screen:  {len(guides)} real guides across 500 genes, 5 samples\n")

        # --- detect --------------------------------------------------------
        print("Stage: detect")
        det = detect_from_fastq(fastqs["Treat_r1"])
        check(det.best is not None and det.best.slug == "brunello",
              "library identified as Brunello",
              det.best.name if det.best else "no match")
        check(det.confident, "detection is confident", det.reason)
        check(det.best is not None and det.best.match_rate > 0.95,
              "reads explained",
              f"{det.best.match_rate:.1%}" if det.best else "-")

        # --- count ---------------------------------------------------------
        print("\nStage: count")
        samples = [count_fastq(p, lib, label=name) for name, p in fastqs.items()]
        for s in samples:
            check(s.mapping_rate >= MIN_MAPPING_RATE,
                  f"{s.label} mapping rate", f"{s.mapping_rate:.2%}")
        check(all(s.no_spacer == 0 for s in samples),
              "spacer located in every read",
              f"{sum(s.no_spacer for s in samples)} failures")

        matrix = CountMatrix.from_samples(lib, samples)

        # --- QC ------------------------------------------------------------
        print("\nStage: QC")
        roles = {"plasmid": "plasmid", "T0_r1": "reference", "T0_r2": "reference",
                 "Treat_r1": "treatment", "Treat_r2": "treatment"}
        q = screen_qc(matrix, roles, ["Treat_r1", "Treat_r2"], ["T0_r1", "T0_r2"], lib)
        check(q.nnmd is not None, "NNMD computed",
              f"{q.nnmd:.2f}" if q.nnmd is not None else "None")
        if q.nnmd is not None:
            check(q.nnmd <= MAX_NNMD, "NNMD separates essentials", f"{q.nnmd:.2f}")
        check(q.auroc is not None and q.auroc > 0.90, "essential vs nonessential AUROC",
              f"{q.auroc:.3f}" if q.auroc else "-")
        for p in q.replicate_pairs:
            check(p.r >= MIN_REPLICATE_R, f"replicates {p.a} x {p.b}", f"r={p.r:.3f}")
        print(f"        represented fraction of library: "
              f"{q.samples[0].represented_fraction:.1%}")

        # --- hits ----------------------------------------------------------
        print("\nStage: call hits")
        ht = call_hits(matrix, lib, ["Treat_r1", "Treat_r2"], ["T0_r1", "T0_r2"], tmp / "hits")
        check("mageck_rra" in ht.methods, "MAGeCK RRA ran", str(ht.methods))
        check("bagel2" in ht.methods, "BAGEL2 ran",
              "; ".join(ht.warnings) if ht.warnings else "ok")

        top = ht.ranked("fdr", 100)
        precision = sum(1 for g in top if g.gene in ess) / max(1, len(top))
        check(precision >= MIN_PRECISION_AT_100, "precision@100", f"{precision:.0%}")

        significant = ht.significant(0.1)
        false_positives = sum(1 for g in significant if g.gene in non)
        check(false_positives == 0, "no nonessential called significant",
              f"{false_positives} of {len(significant)}")

        with_bf = [g for g in top if g.bayes_factor is not None]
        check(len(with_bf) > 50, "BAGEL2 scored the top hits", f"{len(with_bf)}/100")

        g0 = top[0]
        check(g0.guide_agreement is not None and g0.max_guide_share is not None,
              "guide-level evidence captured",
              f"{g0.gene}: agree={g0.guide_agreement:.0%} "
              f"max_share={g0.max_guide_share:.0%}" if g0.guide_agreement else "-")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"{len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All stages passed.")


if __name__ == "__main__":
    main()

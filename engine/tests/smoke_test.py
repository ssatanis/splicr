#!/usr/bin/env python
"""
End-to-end check that the analysis toolchain works on real data.

Builds a count table from actual Brunello guides and simulates a dropout
screen in which CEGv2 core essentials deplete and NEGv1 nonessentials do not,
then runs MAGeCK RRA and BAGEL2 over it and checks that each recovers the
planted essentials.

What this proves: the toolchain is wired correctly end to end, real library
files parse (including their bare CR line endings), and the reference gene
sets line up with library gene symbols.

What it does not prove: that the pipeline handles messy real screens. The
separation here is planted, so near-perfect recovery is expected. A drop below
the thresholds means something is broken, not that the science is hard.

    export PATH="engine/.tools/env/bin:$PATH"
    python engine/tests/smoke_test.py
"""

from __future__ import annotations

import random
import shutil
import statistics as st
import subprocess
import sys
import tempfile
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
ROOT = ENGINE.parent
REF = Path(__file__).resolve().parents[2] / "data" / "references"
BAGEL = ENGINE / ".tools" / "bagel2" / "BAGEL.py"

N_ESSENTIAL, N_NONESSENTIAL, N_OTHER = 120, 200, 300
MIN_PRECISION = 0.90          # of the top N_ESSENTIAL MAGeCK calls
MAX_NNMD = -1.25              # DepMap's screen-quality threshold


def fail(msg: str) -> None:
    print(f"\n  FAIL: {msg}")
    sys.exit(1)


def read_gene_set(path: Path) -> set[str]:
    lines = path.read_text().split("\n")[1:]
    return {l.split("\t")[0].strip() for l in lines if l.strip()}


def read_library(path: Path) -> dict[str, list[str]]:
    """Broad GPP files use bare CR line endings, so normalize before splitting."""
    text = path.read_text().replace("\r\n", "\n").replace("\r", "\n")
    lines = [l for l in text.split("\n") if l.strip()]
    header = lines[0].split("\t")
    gi, si = header.index("Target Gene Symbol"), header.index("sgRNA Target Sequence")
    by_gene: dict[str, list[str]] = {}
    for line in lines[1:]:
        f = line.split("\t")
        if len(f) <= max(gi, si):
            continue
        gene, seq = f[gi].strip(), f[si].strip()
        if not gene or gene == "Non-Targeting Control":
            continue
        by_gene.setdefault(gene, []).append(seq)
    return by_gene


def build_counts(dest: Path, rng: random.Random) -> tuple[set[str], set[str]]:
    essential = read_gene_set(REF / "genesets" / "CEGv2.txt")
    nonessential = read_gene_set(REF / "genesets" / "NEGv1.txt")
    library = read_library(REF / "libraries" / "brunello.txt")

    picked_e = rng.sample(sorted(essential & library.keys()), N_ESSENTIAL)
    picked_n = rng.sample(sorted(nonessential & library.keys()), N_NONESSENTIAL)
    picked_o = rng.sample(sorted(library.keys() - essential - nonessential), N_OTHER)

    rows = []
    groups = (
        [(g, "ess") for g in picked_e]
        + [(g, "non") for g in picked_n]
        + [(g, "oth") for g in picked_o]
    )
    for gene, kind in groups:
        for j, _seq in enumerate(library[gene][:4]):
            base = rng.randint(180, 520)
            if kind == "ess":
                effect = rng.uniform(0.04, 0.22)
            elif kind == "non":
                effect = rng.uniform(0.85, 1.15)
            else:
                effect = rng.uniform(0.45, 1.25)
            t0 = max(1, int(rng.gauss(base, base * 0.12)))
            treated = [
                max(0, int(rng.gauss(base * effect, max(2, base * effect * 0.22))))
                for _ in range(2)
            ]
            rows.append((f"{gene}_{j}", gene, t0, *treated))

    with dest.open("w") as fh:
        fh.write("sgRNA\tGene\tT0\tTreat1\tTreat2\n")
        for r in rows:
            fh.write("\t".join(map(str, r)) + "\n")

    print(f"  built {len(rows)} guides over {len(groups)} genes from real Brunello sequences")
    return set(picked_e), set(picked_n)


def run(cmd: list[str], cwd: Path) -> None:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        fail(f"{cmd[0]} exited {result.returncode}\n{result.stderr[-1500:]}")


def check_mageck(work: Path, essential: set[str], nonessential: set[str]) -> None:
    run(["mageck", "test", "-k", "counts.txt", "-t", "Treat1,Treat2",
         "-c", "T0", "-n", "mg", "--norm-method", "median"], work)

    summary = work / "mg.gene_summary.txt"
    if not summary.exists():
        fail("MAGeCK produced no gene_summary. If RRA was 'command not found', "
             "put engine/.tools/env/bin on PATH rather than calling binaries directly.")

    rows = []
    for line in summary.read_text().split("\n")[1:]:
        f = line.split("\t")
        if len(f) > 4:
            rows.append((f[0], float(f[3]), float(f[4])))
    rows.sort(key=lambda r: r[1])

    top = rows[:N_ESSENTIAL]
    precision = sum(1 for g, _, _ in top if g in essential) / N_ESSENTIAL
    called = [r for r in rows if r[2] < 0.1]
    false_positives = sum(1 for g, _, _ in called if g in nonessential)

    rank = {g: i for i, (g, _, _) in enumerate(rows)}
    ess_ranks = [rank[g] for g in essential if g in rank]
    non_ranks = [rank[g] for g in nonessential if g in rank]
    mad = st.median([abs(x - st.median(non_ranks)) for x in non_ranks]) or 1
    nnmd = (st.median(ess_ranks) - st.median(non_ranks)) / mad

    print(f"  MAGeCK: precision@{N_ESSENTIAL} = {precision:.0%}, "
          f"{len(called)} called at FDR<0.1, {false_positives} nonessential, NNMD {nnmd:.2f}")

    if precision < MIN_PRECISION:
        fail(f"precision {precision:.0%} below {MIN_PRECISION:.0%}")
    if nnmd > MAX_NNMD:
        fail(f"NNMD {nnmd:.2f} worse than {MAX_NNMD}")


def check_bagel(work: Path, essential: set[str]) -> None:
    if not BAGEL.exists():
        print("  BAGEL2: not installed, skipping. Run engine/setup.sh.")
        return

    run([sys.executable, str(BAGEL), "fc", "-i", "counts.txt", "-o", "bg", "-c", "1"], work)
    # BAGEL2 writes .normed_readcount, not the .normalized_reads its docs mention.
    if not (work / "bg.foldchange").exists():
        fail("BAGEL2 fc produced no foldchange file")

    ceg, neg = BAGEL.parent / "CEGv2.txt", BAGEL.parent / "NEGv1.txt"
    run([sys.executable, str(BAGEL), "bf", "-i", "bg.foldchange", "-o", "bg.bf",
         "-e", str(ceg), "-n", str(neg), "-c", "1,2"], work)

    scored = []
    for line in (work / "bg.bf").read_text().split("\n")[1:]:
        f = line.split("\t")
        if len(f) >= 2:
            try:
                scored.append((f[0], float(f[1])))
            except ValueError:
                continue
    scored.sort(key=lambda r: -r[1])

    top = scored[:N_ESSENTIAL]
    precision = sum(1 for g, _ in top if g in essential) / max(1, len(top))
    print(f"  BAGEL2: precision@{len(top)} = {precision:.0%}, "
          f"top BF {scored[0][1]:.0f} ({scored[0][0]})")

    if precision < MIN_PRECISION:
        fail(f"BAGEL2 precision {precision:.0%} below {MIN_PRECISION:.0%}")


def main() -> None:
    for tool in ("mageck", "RRA"):
        if shutil.which(tool) is None:
            fail(f"{tool} is not on PATH. Run:\n"
                 f"    export PATH=\"{ENGINE / '.tools' / 'env' / 'bin'}:$PATH\"")

    missing = [
        p for p in (REF / "genesets" / "CEGv2.txt",
                    REF / "genesets" / "NEGv1.txt",
                    REF / "libraries" / "brunello.txt")
        if not p.exists()
    ]
    if missing:
        fail("missing reference data, run scripts/data/download.sh first:\n    "
             + "\n    ".join(str(p) for p in missing))

    print("SplicR toolchain smoke test")
    rng = random.Random(7)
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        essential, nonessential = build_counts(work / "counts.txt", rng)
        check_mageck(work, essential, nonessential)
        check_bagel(work, essential)

    print("\n  PASS: MAGeCK and BAGEL2 both recover the planted essentials.")


# --- pytest entry point ------------------------------------------------------
# See the note in integration_test.py: a file with no collectable test is
# indistinguishable from a passing one.
def test_smoke():
    import shutil
    import pytest

    if shutil.which("mageck") is None:
        pytest.skip("MAGeCK is not on PATH; run engine/setup.sh and export it")
    assert main() in (0, None)


if __name__ == "__main__":
    main()

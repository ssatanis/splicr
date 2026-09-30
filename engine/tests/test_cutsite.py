#!/usr/bin/env python3
"""
Cut-site arithmetic, against a synthetic contig.

A real-genome spot check confirms one locus and hides everything it does not
touch. A synthetic contig lets the protospacer be *placed* at a known coordinate,
so both strands, all three annotation conventions and the window edges can each
be asserted against a value derived independently of the code under test.

The reverse strand is where this goes wrong in practice, so it is checked base by
base rather than by round-trip.

    python3 engine/tests/test_cutsite.py
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from splicr.cutsite import (  # noqa: E402
    BASES_3PRIME_OF_CUT,
    CUT_OFFSET_IN_PROTOSPACER,
    CutSiteError,
    DEFAULT_FLANK,
    IndexedFasta,
    InMemoryGenome,
    PROTOSPACER_LEN,
    resolve_annotated,
    resolve_by_search,
    revcomp,
)

FAILURES: list[str] = []


def check(label: str, got: object, want: object) -> None:
    if got != want:
        FAILURES.append(f"{label}\n     got  {got!r}\n     want {want!r}")


def expect_raises(label: str, exc: type[BaseException], fn) -> None:
    try:
        fn()
    except exc:
        return
    except BaseException as other:  # noqa: BLE001
        FAILURES.append(f"{label}: raised {type(other).__name__}, wanted {exc.__name__}")
        return
    FAILURES.append(f"{label}: nothing raised, wanted {exc.__name__}")


# ---------------------------------------------------------------------------
# A contig with one protospacer planted on each strand at a known coordinate.
# Flanks are random so an off-by-one shows up as a different base rather than
# landing inside a run of the same letter.
# ---------------------------------------------------------------------------
rng = random.Random(20260930)
PROTOSPACER = "GCACTGTAATCGGACCTTAG"
assert len(PROTOSPACER) == PROTOSPACER_LEN


def filler(n: int) -> str:
    return "".join(rng.choice("ACGT") for _ in range(n))


# Forward: [0,300) filler, protospacer at 300, PAM "AGG" at 320.
FWD_START = 300
fwd = filler(FWD_START) + PROTOSPACER + "AGG" + filler(300)
# Reverse: the forward strand carries revcomp(protospacer), and the PAM sits on
# the forward strand immediately *left* of it as revcomp("TGG") == "CCA".
REV_START = 400
rev = filler(REV_START - 3) + "CCA" + revcomp(PROTOSPACER) + filler(300)

genome = InMemoryGenome({"chrTestF": fwd, "chrTestR": rev})

# Derived by hand, not by the module: the break lies between protospacer
# positions 17 and 18, so on the forward strand it is 17 bases into the
# protospacer, and on the reverse strand 3 bases in from the interval's left end.
FWD_CUT = FWD_START + CUT_OFFSET_IN_PROTOSPACER      # 317
REV_CUT = REV_START + BASES_3PRIME_OF_CUT            # 403

# ---------------------------------------------------------------------------
# Forward strand
# ---------------------------------------------------------------------------
# "Position of base after cut", 1-based, counted along the forward strand.
site = resolve_annotated(PROTOSPACER, "chrTestF", FWD_CUT + 1, "+", genome)

check("fwd protospacer", site.protospacer, PROTOSPACER)
check("fwd cut", site.cut, FWD_CUT)
check("fwd strand", site.strand, "+")
check("fwd pam", site.pam, "AGG")
check("fwd canonical pam", site.canonical_pam, True)
check("fwd convention", site.source, "annotated:base-after-cut/forward")

# The window is 2*flank long, centred on the break.
check("fwd context length", len(site.context), 2 * DEFAULT_FLANK)
check("fwd context cut", site.context_cut, DEFAULT_FLANK)
check("fwd context", site.context, fwd[FWD_CUT - DEFAULT_FLANK : FWD_CUT + DEFAULT_FLANK])
check("fwd left+right", site.left + site.right, site.context)
check("fwd left length", len(site.left), DEFAULT_FLANK)

# The 17 bases immediately 5' of the break are protospacer positions 1-17, and
# the 3 immediately 3' of it are positions 18-20 followed by the PAM.
check("fwd 17 before cut", site.left[-CUT_OFFSET_IN_PROTOSPACER:], PROTOSPACER[:17])
check("fwd 3 after cut", site.right[:BASES_3PRIME_OF_CUT], PROTOSPACER[17:])
check("fwd pam follows", site.right[3:6], "AGG")

# ---------------------------------------------------------------------------
# Reverse strand
# ---------------------------------------------------------------------------
# Counted along the guide, the base after the cut is guide position 18, which is
# forward coordinate REV_CUT - 1.
rsite = resolve_annotated(PROTOSPACER, "chrTestR", REV_CUT, "-", genome)

check("rev protospacer", rsite.protospacer, PROTOSPACER)
check("rev cut", rsite.cut, REV_CUT)
check("rev strand", rsite.strand, "-")
check("rev pam", rsite.pam, "TGG")
check("rev canonical pam", rsite.canonical_pam, True)

# Context is in guide orientation, so it is the reverse complement of the
# forward-strand window -- and the break stays flank bases from the 5' end.
check("rev context length", len(rsite.context), 2 * DEFAULT_FLANK)
check("rev context cut", rsite.context_cut, DEFAULT_FLANK)
check(
    "rev context",
    rsite.context,
    revcomp(rev[REV_CUT - DEFAULT_FLANK : REV_CUT + DEFAULT_FLANK]),
)
check("rev 17 before cut", rsite.left[-CUT_OFFSET_IN_PROTOSPACER:], PROTOSPACER[:17])
check("rev 3 after cut", rsite.right[:BASES_3PRIME_OF_CUT], PROTOSPACER[17:])
check("rev pam follows", rsite.right[3:6], "TGG")

# The reverse context must NOT equal the forward-strand slice: that mistake keeps
# the right length and the right centre, and is exactly what this asserts against.
if rsite.context == rev[REV_CUT - DEFAULT_FLANK : REV_CUT + DEFAULT_FLANK]:
    FAILURES.append("rev context was not reverse-complemented")

# ---------------------------------------------------------------------------
# Every annotation convention resolves to the same site
# ---------------------------------------------------------------------------
# Forward: protospacer 5' base, 1-based.
alt = resolve_annotated(PROTOSPACER, "chrTestF", FWD_START + 1, "+", genome)
check("fwd via 5' base", alt.cut, FWD_CUT)
check("fwd via 5' base convention", alt.source, "annotated:protospacer-5prime")

# Reverse: base after cut along the forward strand, and the guide's 5' base.
for pos1, want_convention in (
    (REV_CUT + 1, "annotated:base-after-cut/forward"),
    (REV_START + PROTOSPACER_LEN, "annotated:protospacer-5prime"),
):
    got = resolve_annotated(PROTOSPACER, "chrTestR", pos1, "-", genome)
    check(f"rev via {want_convention}", got.cut, REV_CUT)
    check(f"rev convention {pos1}", got.source, want_convention)

# ---------------------------------------------------------------------------
# A coordinate that does not spell the protospacer must fail loudly
# ---------------------------------------------------------------------------
expect_raises(
    "wrong coordinate accepted",
    CutSiteError,
    lambda: resolve_annotated(PROTOSPACER, "chrTestF", FWD_CUT + 41, "+", genome),
)
expect_raises(
    "wrong strand accepted",
    CutSiteError,
    lambda: resolve_annotated(PROTOSPACER, "chrTestF", FWD_CUT + 1, "-", genome),
)
expect_raises(
    "short protospacer accepted",
    CutSiteError,
    lambda: resolve_annotated(PROTOSPACER[:19], "chrTestF", FWD_CUT + 1, "+", genome),
)
expect_raises(
    "bad strand label accepted",
    CutSiteError,
    lambda: resolve_annotated(PROTOSPACER, "chrTestF", FWD_CUT + 1, "?", genome),
)
expect_raises(
    "non-DNA accepted",
    ValueError,
    lambda: resolve_annotated("GCACTGTAATCGGACCTTAU", "chrTestF", FWD_CUT + 1, "+", genome),
)

# require_pam rejects a locus whose PAM is not NGG.
nopam = InMemoryGenome({"c": filler(200) + PROTOSPACER + "AAA" + filler(200)})
check(
    "no-PAM locus resolves without require_pam",
    resolve_annotated(PROTOSPACER, "c", 200 + CUT_OFFSET_IN_PROTOSPACER + 1, "+", nopam).pam,
    "AAA",
)
expect_raises(
    "no-PAM locus accepted under require_pam",
    CutSiteError,
    lambda: resolve_annotated(
        PROTOSPACER, "c", 200 + CUT_OFFSET_IN_PROTOSPACER + 1, "+", nopam, require_pam=True
    ),
)

# ---------------------------------------------------------------------------
# Search, for a library that ships no coordinates
# ---------------------------------------------------------------------------
hits = resolve_by_search(PROTOSPACER, "chrTestF", 100, 500, genome)
check("search found one", len(hits), 1)
check("search cut", hits[0].cut, FWD_CUT)
check("search strand", hits[0].strand, "+")
check("search context matches annotated", hits[0].context, site.context)
check("search source", hits[0].source, "search")

rhits = resolve_by_search(PROTOSPACER, "chrTestR", 200, 600, genome)
check("search found reverse", len(rhits), 1)
check("search reverse cut", rhits[0].cut, REV_CUT)
check("search reverse strand", rhits[0].strand, "-")
check("search reverse context", rhits[0].context, rsite.context)

# A window that excludes the locus finds nothing rather than guessing.
check("search outside window", resolve_by_search(PROTOSPACER, "chrTestF", 0, 40, genome), [])

# Two copies in the window must both come back: taking [0] would invent an answer.
dup = InMemoryGenome(
    {"c": filler(200) + PROTOSPACER + "AGG" + filler(200) + PROTOSPACER + "CGG" + filler(200)}
)
dup_hits = resolve_by_search(PROTOSPACER, "c", 0, 900, dup)
check("duplicate hits both returned", len(dup_hits), 2)
check("duplicate hits ordered", [h.cut for h in dup_hits], sorted(h.cut for h in dup_hits))
check("duplicate pams", [h.pam for h in dup_hits], ["AGG", "CGG"])

# require_pam=True is the search default, so a PAM-less occurrence is dropped.
check("search drops PAM-less", resolve_by_search(PROTOSPACER, "c", 0, 500, nopam), [])
check(
    "search keeps PAM-less when asked",
    len(resolve_by_search(PROTOSPACER, "c", 0, 500, nopam, require_pam=False)),
    1,
)

# A protospacer present on both strands is reported twice, once per strand.
palin = filler(200) + PROTOSPACER + "AGG" + filler(50) + "CCA" + revcomp(PROTOSPACER) + filler(200)
both = resolve_by_search(PROTOSPACER, "c", 0, 700, InMemoryGenome({"c": palin}))
check("both strands found", sorted(h.strand for h in both), ["+", "-"])

# ---------------------------------------------------------------------------
# IndexedFasta must agree with the in-memory genome, including across line wraps
# ---------------------------------------------------------------------------
import tempfile  # noqa: E402

with tempfile.TemporaryDirectory() as tmp:
    fa = Path(tmp) / "t.fa"
    wrap = 60
    wrapped = "\n".join(fwd[i : i + wrap] for i in range(0, len(fwd), wrap))
    fa.write_text(f">chrTestF\n{wrapped}\n")
    # A .fai is five columns: name, length, offset of first base, bases/line,
    # bytes/line. Written here rather than shelling out to samtools.
    header = len(">chrTestF\n")
    fa.with_suffix(".fa.fai").write_text(
        f"chrTestF\t{len(fwd)}\t{header}\t{wrap}\t{wrap + 1}\n"
    )

    with IndexedFasta(fa) as fasta:
        check("fasta length", fasta.length("chrTestF"), len(fwd))
        # Spot-check offsets that straddle line boundaries, where the newline
        # arithmetic is the only thing that can be wrong.
        for start, end in ((0, 10), (55, 70), (59, 61), (300, 320), (FWD_CUT - 30, FWD_CUT + 30)):
            check(f"fasta fetch {start}-{end}", fasta.fetch("chrTestF", start, end), fwd[start:end])
        fsite = resolve_annotated(PROTOSPACER, "chrTestF", FWD_CUT + 1, "+", fasta)
        check("fasta cut", fsite.cut, FWD_CUT)
        check("fasta context equals in-memory", fsite.context, site.context)
        expect_raises(
            "fasta accepted out-of-range",
            ValueError,
            lambda: fasta.fetch("chrTestF", len(fwd) - 5, len(fwd) + 5),
        )
        expect_raises("fasta accepted unknown contig", KeyError, lambda: fasta.length("nope"))

    # hg38 ships as "1" from Ensembl and "chr1" from UCSC, so a lookup must
    # resolve across that difference in both directions.
    bare = Path(tmp) / "bare.fa"
    bare.write_text(f">7\n{fwd}\n")
    bare.with_suffix(".fa.fai").write_text(f"7\t{len(fwd)}\t{len('>7')+1}\t{len(fwd)}\t{len(fwd)+1}\n")
    with IndexedFasta(bare) as plain:
        check("fai bare name", plain.length("7"), len(fwd))
        check("fai chr-prefixed lookup of bare name", plain.length("chr7"), len(fwd))
        check("fai fetch via alias", plain.fetch("chr7", 300, 320), PROTOSPACER)

# ---------------------------------------------------------------------------
# revcomp is an involution, and the two arms never overlap or drop a base
# ---------------------------------------------------------------------------
for _ in range(200):
    s = filler(rng.randint(1, 80))
    if revcomp(revcomp(s)) != s:
        FAILURES.append(f"revcomp not an involution for {s}")
        break

for flank in (1, 5, 17, 30, 60):
    f = resolve_annotated(PROTOSPACER, "chrTestF", FWD_CUT + 1, "+", genome, flank=flank)
    r = resolve_annotated(PROTOSPACER, "chrTestR", REV_CUT, "-", genome, flank=flank)
    for tag, s in (("fwd", f), ("rev", r)):
        check(f"{tag} flank {flank} length", len(s.context), 2 * flank)
        check(f"{tag} flank {flank} arms", s.left + s.right, s.context)
        check(f"{tag} flank {flank} cut", s.context_cut, flank)
        # The base immediately 3' of the break is protospacer position 18,
        # whatever the flank.
        check(f"{tag} flank {flank} first base after cut", s.right[0], PROTOSPACER[17])

# The checks above run at import, which is what makes this file work as a script.
# This gives pytest something to collect as well: without it, `pytest engine/tests/`
# reports "no tests ran" for a file named test_*.py and the suite looks clean.
def test_cutsite() -> None:
    assert not FAILURES, "\n".join(FAILURES)


if __name__ == "__main__":
    if FAILURES:
        print(f"FAIL  {len(FAILURES)} check(s)\n")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)

    print("cutsite: all checks passed")
    print(f"  forward  cut {FWD_CUT}  pam {site.pam}  context {site.context}")
    print(f"  reverse  cut {REV_CUT}  pam {rsite.pam}  context {rsite.context}")

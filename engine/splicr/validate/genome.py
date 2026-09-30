"""
Random access to the reference genome, and the 60 bp cut-site window that
repair-outcome models take as input.

WHY THE WINDOW IS BUILT BY SEARCH, NOT BY ARITHMETIC

Every pooled library states a guide's position differently. Brunello gives
"Position of Base After Cut (1-based)" against a RefSeq accession; DepMap's
Avana map gives "chr10_110964620_+"; TKOv3 gives an exon-relative offset. Each
convention differs by a few bases, and an off-by-three lands the cut inside the
PAM and silently produces a repair prediction for the wrong sequence. Nothing
downstream would flag it: the numbers stay plausible.

So the stated coordinate is treated as a hint, not as truth. A window around it
is pulled from the genome, the guide's own 20 bp is located inside that window
on whichever strand carries it, and the 60-mer is cut from the match. If the
protospacer is not found, or the three bases after it are not an NGG PAM, the
guide is returned unresolved rather than guessed at. The extraction therefore
either reproduces the guide the library says is there, or it refuses.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass
from pathlib import Path

from ..config import REFERENCE_DIR

GENOME_DIR = Path(os.environ.get("SPLICR_GENOME_DIR", REFERENCE_DIR / "genome"))
HG38 = GENOME_DIR / "hg38.fa"

#: Lindel's input layout: 60 bp, protospacer at [13:33], PAM at [33:36], and the
#: blunt Cas9 cut between index 29 and 30 (3 bp 5' of the PAM).
GUIDE_OFFSET = 13
GUIDE_LEN = 20
CONTEXT_LEN = 60
CUT_INDEX = 30

_COMPLEMENT = str.maketrans("ACGTNacgtn", "TGCANtgcan")


def revcomp(seq: str) -> str:
    return seq.translate(_COMPLEMENT)[::-1]


class Genome:
    """
    A .fa + .fai pair, read by seeking. Keeping the FASTA uncompressed costs
    3.1 GB of disk and buys O(1) random access with no index library; bgzip
    would need a BGZF reader for the same thing.
    """

    def __init__(self, path: Path = HG38):
        self.path = Path(path)
        fai = self.path.with_suffix(self.path.suffix + ".fai")
        if not self.path.exists() or not fai.exists():
            raise FileNotFoundError(
                f"{self.path} (and .fai) not found. Fetch it with "
                f"scripts/data/fetch-genome.sh, or set SPLICR_GENOME_DIR.")
        self.index: dict[str, tuple[int, int, int, int]] = {}
        for line in fai.read_text().splitlines():
            name, length, offset, line_bases, line_width = line.split("\t")[:5]
            self.index[name] = (int(length), int(offset), int(line_bases), int(line_width))
        self._fh: io.BufferedReader | None = None

    def _file(self) -> io.BufferedReader:
        if self._fh is None:
            self._fh = open(self.path, "rb")
        return self._fh

    def close(self) -> None:
        if self._fh is not None:
            self._fh.close()
            self._fh = None

    def contigs(self) -> list[str]:
        return list(self.index)

    def fetch(self, chrom: str, start: int, end: int) -> str:
        """Uppercase sequence for 0-based, half-open [start, end). Clipped to the contig."""
        if chrom not in self.index:
            alt = chrom[3:] if chrom.startswith("chr") else f"chr{chrom}"
            if alt not in self.index:
                raise KeyError(f"{chrom} is not in {self.path.name}")
            chrom = alt
        length, offset, line_bases, line_width = self.index[chrom]
        start, end = max(0, start), min(length, end)
        if start >= end:
            return ""
        fh = self._file()
        fh.seek(offset + start // line_bases * line_width + start % line_bases)
        # Read the newlines too, then drop them: a line holds line_bases bases
        # in line_width bytes, so the span is at most (end-start) * width/bases.
        raw = fh.read((end - start) + (end - start) // line_bases + line_width)
        return raw.decode("ascii", "replace").replace("\n", "").replace("\r", "")[: end - start].upper()


@dataclass(frozen=True)
class CutSite:
    """One guide placed on the genome, with the window a repair model needs."""

    guide_key: str
    guide_seq: str
    chrom: str
    #: 0-based genomic index of the blunt Cas9 cut (between cut_pos-1 and cut_pos
    #: on the + strand; for a - strand guide the cut is on the guide's own strand).
    cut_pos: int
    strand: str
    pam: str
    context: str                  # 60 bp in guide orientation
    status: str = "ok"            # ok | not_found | no_pam | out_of_bounds
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status == "ok"


def _window(genome: Genome, chrom: str, anchor: int, slack: int) -> tuple[str, int]:
    start = max(0, anchor - slack)
    return genome.fetch(chrom, start, anchor + slack), start


def _occurrences(haystack: str, needle: str):
    i = haystack.find(needle)
    while i >= 0:
        yield i
        i = haystack.find(needle, i + 1)


def place_guide(genome: Genome, chrom: str, anchor: int, guide_seq: str,
                guide_key: str = "", strand_hint: str | None = None,
                slack: int = 60) -> CutSite:
    """
    Locate `guide_seq` near `anchor` and return its 60 bp repair window.

    `anchor` is any 0-based position within a few dozen bases of the guide: a
    cut position, a protospacer start, an alignment start. The search settles
    the exact placement, so callers do not have to normalise conventions.

    Every occurrence of the guide in the window is considered, on both strands.
    They are ranked by whether an NGG PAM follows and then by distance from
    `anchor`, so a guide that appears twice inside a tandem duplication is
    placed at the copy the library meant rather than at whichever copy comes
    first in the chromosome. `strand_hint` only breaks a remaining tie: it is
    genomic in DepMap's map but transcript-relative in Brunello's, where it
    disagrees with the genome for half the library, so it cannot be a filter.
    """
    guide = (guide_seq or "").upper().replace("U", "T")
    if len(guide) != GUIDE_LEN or set(guide) - set("ACGT"):
        return CutSite(guide_key, guide, chrom, anchor, ".", "", "", "not_found",
                       f"guide is not 20 unambiguous bases: {guide_seq!r}")
    try:
        window, win_start = _window(genome, chrom, anchor, slack)
    except KeyError as exc:
        return CutSite(guide_key, guide, chrom, anchor, ".", "", "", "out_of_bounds", str(exc))

    rc = revcomp(window)
    found = [("+", i) for i in _occurrences(window, guide)]
    found += [("-", j) for j in _occurrences(rc, guide)]
    if not found:
        return CutSite(guide_key, guide, chrom, anchor, ".", "", "", "not_found",
                       f"guide not present within {slack} bp of {chrom}:{anchor}")

    candidates = []
    for strand, pos in found:
        # Rebuild in guide orientation so one set of offsets serves both strands.
        oriented = window if strand == "+" else rc
        lo = pos - GUIDE_OFFSET
        hi = lo + CONTEXT_LEN
        if lo < 0 or hi > len(oriented):
            continue  # too near the window edge to cut a full 60-mer
        context = oriented[lo:hi]
        pam = context[GUIDE_OFFSET + GUIDE_LEN: GUIDE_OFFSET + GUIDE_LEN + 3]
        has_pam = len(pam) == 3 and pam[1:] == "GG"
        # Genomic index of the cut, which sits 3 bp 5' of the PAM.
        if strand == "+":
            cut = win_start + pos + 17
        else:
            # `pos` counts from the window's 3' end once reversed.
            cut = win_start + (len(window) - pos - 17)
        # A site with a PAM always beats one without; among those, the copy
        # nearest the stated position wins, and the stated strand breaks any
        # remaining tie.
        rank = (not has_pam, abs(cut - anchor), strand != strand_hint)
        candidates.append((rank, strand, cut, pam, context))

    if not candidates:
        return CutSite(guide_key, guide, chrom, anchor, ".", "", "", "out_of_bounds",
                       f"every occurrence sits within {GUIDE_OFFSET} bp of the window edge")
    rank, strand, cut, pam, context = min(candidates, key=lambda c: c[0])
    if rank[0]:
        return CutSite(guide_key, guide, chrom, anchor, ".", "", "", "no_pam",
                       "guide found but the three bases after it are not NGG")
    return CutSite(guide_key, guide, chrom, cut, strand, pam, context)

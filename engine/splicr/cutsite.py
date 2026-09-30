"""
Where a guide cuts, and the sequence around it.

A repair-outcome model (inDelphi, FORECasT, Lindel) does not read a protospacer.
It reads the genome on both sides of the blunt double-strand break, because the
microhomology that decides the repair outcome lives in that flanking sequence.
`engine/research/frameshift/` tested a proxy built from the bare 20bp protospacer
and got a null; its stated reason for not testing a real model was that
`atlas.guides.cut_pos` is 0 for every GeCKOv2 guide, so the flanking sequence did
not exist in the database. This module is what produces it.

Two things here are deliberately unforgiving.

**Conventions are verified, never assumed.** A library that ships coordinates
ships them in *some* convention, and the phrase "position of base after cut" does
not say whether the position counts along the genome's forward strand or along
the guide. Guessing wrong shifts every context window by a few bases, which is
invisible in the output and fatal to the model reading it. So an annotated
coordinate is only accepted when the genome at that locus actually spells the
protospacer; the candidate conventions are tried in turn and one must survive.

**Ambiguity is returned, not resolved.** A 20-mer can occur more than once in a
search window. Picking the first hit would manufacture a coordinate; the caller
is given every match and decides.

The genome is behind `GenomeSource` so the arithmetic can be tested against a
synthetic contig, which is the only way to test it: a real-genome spot check
confirms one locus, whereas a synthetic contig can assert both strands and every
convention. `IndexedFasta` is the production implementation and needs no compiled
dependency, only a `.fa` and its `.fai`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Protocol

# SpCas9 geometry. The protospacer is 20nt with the PAM immediately 3' of it,
# and the blunt cut falls 3bp 5' of the PAM -- between protospacer positions 17
# and 18, counting from the 5' end, 1-based.
PROTOSPACER_LEN = 20
BASES_3PRIME_OF_CUT = 3
CUT_OFFSET_IN_PROTOSPACER = PROTOSPACER_LEN - BASES_3PRIME_OF_CUT  # 17

# inDelphi and FORECasT both want a window centred on the cut. 30bp each side is
# the published default and comfortably covers the microhomology arms either
# model considers.
DEFAULT_FLANK = 30

_COMPLEMENT = str.maketrans("ACGTNacgtn", "TGCANtgcan")
_VALID = re.compile(r"^[ACGT]+$")


def revcomp(seq: str) -> str:
    return seq.translate(_COMPLEMENT)[::-1]


def normalise(seq: str) -> str:
    """Upper-case a sequence and reject anything that is not unambiguous DNA."""
    out = seq.strip().upper()
    if not _VALID.match(out):
        raise ValueError(f"not unambiguous DNA: {seq!r}")
    return out


class GenomeSource(Protocol):
    """
    Forward-strand sequence for a half-open 0-based interval.

    Requests that run off either end of the contig are the caller's problem to
    avoid; an implementation raises rather than silently returning a short
    string, because a short string would shift a context window.
    """

    def fetch(self, chrom: str, start: int, end: int) -> str: ...

    def length(self, chrom: str) -> int: ...


class InMemoryGenome:
    """A dict of contigs. For tests, and for scoring against a single locus."""

    def __init__(self, contigs: dict[str, str]) -> None:
        self._contigs = {k: normalise(v) for k, v in contigs.items()}

    def length(self, chrom: str) -> int:
        try:
            return len(self._contigs[chrom])
        except KeyError:
            raise KeyError(f"no contig {chrom!r}; have {sorted(self._contigs)}") from None

    def fetch(self, chrom: str, start: int, end: int) -> str:
        size = self.length(chrom)
        if start < 0 or end > size or start >= end:
            raise ValueError(f"{chrom}:{start}-{end} outside 0-{size}")
        return self._contigs[chrom][start:end]


class IndexedFasta:
    """
    Random access into a bgzip-free `.fa` using its `.fai` index.

    samtools' index format is five columns -- name, length, byte offset of the
    first base, bases per line, bytes per line -- which is everything needed to
    turn a coordinate into a file offset. Doing it here rather than through pysam
    keeps the repair-outcome path free of a compiled dependency, and the arithmetic
    is small enough to verify by reading it.

    Line-length is assumed uniform within a contig, which is what the format
    guarantees for every line but the last of each record.
    """

    @dataclass(frozen=True)
    class _Record:
        length: int
        offset: int
        line_bases: int
        line_bytes: int

    def __init__(self, fasta: str | Path) -> None:
        self.path = Path(fasta)
        index = self.path.with_suffix(self.path.suffix + ".fai")
        if not index.exists():
            raise FileNotFoundError(
                f"{index} not found; build it with `samtools faidx {self.path}`"
            )
        self._records: dict[str, IndexedFasta._Record] = {}
        for line in index.read_text().splitlines():
            if not line.strip():
                continue
            name, length, offset, line_bases, line_bytes = line.split("\t")[:5]
            self._records[name] = IndexedFasta._Record(
                int(length), int(offset), int(line_bases), int(line_bytes)
            )
        self._handle = self.path.open("rb")

    def close(self) -> None:
        self._handle.close()

    def __enter__(self) -> IndexedFasta:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _record(self, chrom: str) -> IndexedFasta._Record:
        record = self._records.get(chrom)
        if record is None:
            # hg38 ships as both "1" and "chr1" depending on the provider.
            alt = chrom[3:] if chrom.startswith("chr") else f"chr{chrom}"
            record = self._records.get(alt)
        if record is None:
            raise KeyError(f"no contig {chrom!r} in {self.path.name}")
        return record

    def length(self, chrom: str) -> int:
        return self._record(chrom).length

    def fetch(self, chrom: str, start: int, end: int) -> str:
        record = self._record(chrom)
        if start < 0 or end > record.length or start >= end:
            raise ValueError(f"{chrom}:{start}-{end} outside 0-{record.length}")
        # Newlines make the file offset non-linear in the coordinate, so convert
        # through (line, column) rather than adding a constant.
        def offset_of(base: int) -> int:
            line, column = divmod(base, record.line_bases)
            return record.offset + line * record.line_bytes + column

        first, last = offset_of(start), offset_of(end - 1)
        self._handle.seek(first)
        raw = self._handle.read(last - first + 1).decode("ascii")
        return normalise(raw.replace("\n", "").replace("\r", ""))


@dataclass(frozen=True)
class CutSite:
    """
    A resolved blunt cut, and the sequence a repair model reads.

    `cut` is the 0-based forward-strand coordinate of the first base 3' of the
    break *along the forward strand*, so the break lies between `cut - 1` and
    `cut` regardless of which strand the guide sits on. One unambiguous number
    for the break means downstream code never has to re-derive it from the
    strand, which is where this kind of arithmetic usually goes wrong.

    `context` is in the guide's own orientation with the break at `context_cut`,
    which is what inDelphi and FORECasT expect. For a guide on the reverse strand
    it is therefore the reverse complement of the forward-strand window.
    """

    chrom: str
    cut: int
    strand: str
    protospacer: str
    pam: str
    context: str
    context_cut: int
    source: str

    @property
    def left(self) -> str:
        """Sequence 5' of the break, in guide orientation."""
        return self.context[: self.context_cut]

    @property
    def right(self) -> str:
        """Sequence 3' of the break, in guide orientation."""
        return self.context[self.context_cut :]

    @property
    def canonical_pam(self) -> bool:
        return len(self.pam) == 3 and self.pam[1:] == "GG"

    def as_dict(self) -> dict[str, object]:
        return {
            "chrom": self.chrom,
            "cut": self.cut,
            "strand": self.strand,
            "protospacer": self.protospacer,
            "pam": self.pam,
            "canonical_pam": self.canonical_pam,
            "context": self.context,
            "context_cut": self.context_cut,
            "source": self.source,
        }


class CutSiteError(ValueError):
    """A coordinate could not be resolved, or could not be trusted."""


def _build(
    chrom: str,
    protospacer_start: int,
    strand: str,
    genome: GenomeSource,
    flank: int,
    source: str,
) -> CutSite:
    """
    Assemble a CutSite from the forward-strand interval the protospacer occupies.

    `protospacer_start` is the 0-based forward-strand coordinate of the
    protospacer's leftmost base, whichever strand the guide reads. The protospacer
    therefore spans [start, start + 20) on the forward strand, and for a reverse
    guide the guide's own 5' end is at the *right* of that interval.
    """
    end = protospacer_start + PROTOSPACER_LEN
    forward = genome.fetch(chrom, protospacer_start, end)

    if strand == "+":
        protospacer = forward
        pam = genome.fetch(chrom, end, end + 3)
        # Guide position 17 is forward base start+16, so the break sits between
        # start+16 and start+17.
        cut = protospacer_start + CUT_OFFSET_IN_PROTOSPACER
    else:
        protospacer = revcomp(forward)
        pam = revcomp(genome.fetch(chrom, protospacer_start - 3, protospacer_start))
        # Reading right-to-left, guide position 17 is forward base start+3, so
        # the break sits between start+2 and start+3.
        cut = protospacer_start + BASES_3PRIME_OF_CUT

    window = genome.fetch(chrom, cut - flank, cut + flank)
    if strand == "+":
        context, context_cut = window, flank
    else:
        # Reverse-complementing swaps the two arms, and the break stays exactly
        # `flank` bases from the end that is now the start.
        context, context_cut = revcomp(window), flank

    return CutSite(
        chrom=chrom,
        cut=cut,
        strand=strand,
        protospacer=protospacer,
        pam=pam,
        context=context,
        context_cut=context_cut,
        source=source,
    )


# The conventions an annotated "cut position" column plausibly means, as the
# 0-based forward-strand start of the protospacer implied by a 1-based value.
# Each is tried and the one that reproduces the protospacer wins.
def _candidate_starts(pos1: int, strand: str) -> Iterator[tuple[int, str]]:
    pos0 = pos1 - 1
    if strand == "+":
        # Base after cut, counted along the forward strand: the cut is at pos0,
        # and the protospacer starts 17 bases earlier.
        yield pos0 - CUT_OFFSET_IN_PROTOSPACER, "base-after-cut/forward"
        # Some tables give the protospacer's own 5' base instead.
        yield pos0, "protospacer-5prime"
        # Or the base *before* the cut.
        yield pos0 + 1 - CUT_OFFSET_IN_PROTOSPACER, "base-before-cut/forward"
    else:
        # Base after cut counted along the guide: that base is forward pos0, and
        # the guide runs right-to-left, so the protospacer's forward-strand start
        # is 3 bases below it... one past the break at pos0 + 1.
        yield pos0 - BASES_3PRIME_OF_CUT + 1, "base-after-cut/guide"
        # Base after cut counted along the forward strand.
        yield pos0 - BASES_3PRIME_OF_CUT, "base-after-cut/forward"
        # The guide's own 5' base, which on this strand is the interval's right end.
        yield pos0 - PROTOSPACER_LEN + 1, "protospacer-5prime"


def resolve_annotated(
    protospacer: str,
    chrom: str,
    pos1: int,
    strand: str,
    genome: GenomeSource,
    *,
    flank: int = DEFAULT_FLANK,
    require_pam: bool = False,
) -> CutSite:
    """
    Turn a library's own coordinate into a verified cut site.

    Every plausible reading of `pos1` is tried and the one whose genome sequence
    spells `protospacer` is returned. If none does, the coordinate and the
    sequence disagree and that is raised rather than smoothed over: a context
    window built on the wrong convention looks perfectly well-formed.
    """
    protospacer = normalise(protospacer)
    if len(protospacer) != PROTOSPACER_LEN:
        raise CutSiteError(f"expected {PROTOSPACER_LEN}nt protospacer, got {len(protospacer)}")
    if strand not in ("+", "-"):
        raise CutSiteError(f"strand must be + or -, got {strand!r}")

    size = genome.length(chrom)
    tried: list[str] = []
    for start, convention in _candidate_starts(pos1, strand):
        # Need room for the protospacer, its PAM on whichever side, and the flank.
        lo = min(start - 3, start + CUT_OFFSET_IN_PROTOSPACER - flank)
        hi = max(start + PROTOSPACER_LEN + 3, start + BASES_3PRIME_OF_CUT + flank)
        if lo < 0 or hi > size:
            tried.append(f"{convention} (off contig)")
            continue
        site = _build(chrom, start, strand, genome, flank, f"annotated:{convention}")
        if site.protospacer != protospacer:
            tried.append(convention)
            continue
        if require_pam and not site.canonical_pam:
            tried.append(f"{convention} (PAM {site.pam})")
            continue
        return site

    raise CutSiteError(
        f"{chrom}:{pos1}{strand} does not spell {protospacer} under any known "
        f"convention (tried {', '.join(tried)}). Either the coordinate is on a "
        f"different assembly than this genome, or the column means something else."
    )


def resolve_by_search(
    protospacer: str,
    chrom: str,
    start: int,
    end: int,
    genome: GenomeSource,
    *,
    flank: int = DEFAULT_FLANK,
    require_pam: bool = True,
) -> list[CutSite]:
    """
    Find a protospacer by exact match inside a bounded window, both strands.

    This is the path for a library that ships no coordinates at all -- GeCKOv2,
    which is the library of the one real screen in the database. Searching the
    whole genome would need an index; searching the target gene's locus does not,
    and the library row already names the gene. Scope the window from the gene's
    span and the problem becomes small and exact.

    Every match is returned. A 20-mer that occurs twice in the window has no
    single answer, and returning a list makes that visible instead of letting a
    caller take `[0]` and never learn. With `require_pam` a match lacking NGG is
    dropped, which is usually right: a protospacer with no PAM is not a cut site.
    """
    protospacer = normalise(protospacer)
    if len(protospacer) != PROTOSPACER_LEN:
        raise CutSiteError(f"expected {PROTOSPACER_LEN}nt protospacer, got {len(protospacer)}")

    size = genome.length(chrom)
    # Widen so a protospacer overlapping the window edge is still found, and so
    # the PAM and flank of an edge match are readable.
    pad = PROTOSPACER_LEN + flank + 3
    lo, hi = max(0, start - pad), min(size, end + pad)
    if lo >= hi:
        raise CutSiteError(f"empty search window {chrom}:{start}-{end}")
    window = genome.fetch(chrom, lo, hi)

    found: list[CutSite] = []
    for strand, needle in (("+", protospacer), ("-", revcomp(protospacer))):
        at = window.find(needle)
        while at != -1:
            forward_start = lo + at
            room_lo = min(forward_start - 3, forward_start + CUT_OFFSET_IN_PROTOSPACER - flank)
            room_hi = max(
                forward_start + PROTOSPACER_LEN + 3, forward_start + BASES_3PRIME_OF_CUT + flank
            )
            if room_lo >= 0 and room_hi <= size:
                site = _build(chrom, forward_start, strand, genome, flank, "search")
                if not require_pam or site.canonical_pam:
                    found.append(site)
            at = window.find(needle, at + 1)

    found.sort(key=lambda s: (s.cut, s.strand))
    return found

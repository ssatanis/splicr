"""
How each library's stated guide coordinate becomes a 0-based genomic cut index.

Every pooled library publishes its guides' positions, and no two agree on what
the number means. Brunello's "Position of Base After Cut (1-based)" names the
base 3' of the blunt cut; DepMap's `GenomeAlignment` writes the same physical
site 0-based, so the two files differ by one for the same cut. A library whose
offset is guessed produces a repair window shifted by a base or three, which
lands the cut inside the PAM and yields a confident prediction for the wrong
sequence.

These offsets are measured, not assumed. `scripts/data/validate-cutsite-convention.py`
places every guide by searching the assembly for the guide's own sequence and
prints the histogram of (found cut - stated position); a library with a single
clean convention shows one spike, and that spike is its offset. As of the last
run both libraries here show exactly one, with no exceptions:

    brunello   76,441 / 76,441 guides, offset -1, and Brunello's own published
               30 bp Target Context Sequence reproduced for every one of them
    avana      67,225 / 67,225 uniquely-aligning guides, offset 0

STRAND COLUMNS ARE NOT INTERCHANGEABLE EITHER

DepMap's strand is the protospacer's genomic strand. Brunello's "sense" /
"antisense" is relative to the target transcript and agrees with the genome for
50.6% of the library - a coin flip. `genome.place_guide` therefore treats
strand as a tie-break only and never as a filter, so a library added here
cannot break placement by labelling its strand the other way.

ADDING A LIBRARY

Give it an entry with the offset you believe, run the validator, and read the
delta histogram. If it is one spike at zero, the entry is right. If it is one
spike elsewhere, move the offset by that amount. If it is several spikes, the
library does not have a single convention and the rows have to be split before
anything downstream reads them.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CutConvention:
    """What a library's stated position means, and where its strand refers to."""

    #: Added to the library's stated number to get the 0-based genomic cut index.
    cut_offset: int
    #: "genomic" if the strand column describes the protospacer's own strand,
    #: "transcript" if it describes the target transcript (and so is useless
    #: as a placement filter), None if the library states no strand.
    strand: str | None
    #: The column, verbatim, so a reader can check this against the source file.
    stated: str


#: Broad GPP's design tables (Brunello, Brie, Calabrese, Dolcetto ...) all use
#: "Position of Base After Cut (1-based)" with a transcript-relative strand.
BROAD_GPP = CutConvention(-1, "transcript", "Position of Base After Cut (1-based)")

CONVENTIONS: dict[str, CutConvention] = {
    "brunello": BROAD_GPP,
    "brie": BROAD_GPP,
    "avana": CutConvention(0, "genomic", "GenomeAlignment chrom_pos_strand"),
    "humagne": CutConvention(0, "genomic", "GenomeAlignment chrom_pos_strand"),
    "ky": CutConvention(0, "genomic", "GenomeAlignment chrom_pos_strand"),
}

#: Used when a library is not listed. Broad GPP's layout is the most common by
#: far, so it is the least surprising guess - but a guess is exactly what the
#: validator exists to replace, so callers should check before trusting it.
DEFAULT = BROAD_GPP


def convention(slug: str) -> CutConvention:
    return CONVENTIONS.get(slug, DEFAULT)


def is_measured(slug: str) -> bool:
    """False if `convention()` is falling back to the default guess."""
    return slug in CONVENTIONS

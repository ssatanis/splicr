"""
Library detection.

Identification is by sequence-set overlap, never by file name. Candidates are
ranked by coverage, the fraction of the candidate library that was seen,
rather than by raw intersection size. That distinction matters: composite
libraries such as MinLibCas9 borrow guides from four parents, so ranking on
absolute overlap would let a parent outrank the true library, or vice versa.

Controls are excluded from the comparison. Calabrese A, Dolcetto A and
Brunello share the same 496 non-targeting sequences, so control guides carry
no discriminating signal at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import SETTINGS, CountConfig
from .count import CountMatrix, detect_spacer_location, iter_reads, SpacerLocation
from .references import Library, load_all_libraries


@dataclass
class LibraryMatch:
    """
    Two different denominators, deliberately kept apart.

    coverage   = distinct library guides seen / size of the library
    match_rate = probe items explained / probe items

    For a FASTQ a "probe item" is a read, so match_rate is the share of reads
    the library explains. For a count table it is a row. Conflating the two
    produces nonsense: 3,000 distinct guides seen across 120,000 reads is 100%
    of reads explained, not 2.5%.
    """

    slug: str
    name: str
    n_library_guides: int
    n_matched_unique: int      # distinct library sequences observed
    n_matched_probes: int      # probe items (reads or rows) explained
    n_probe: int               # probe items examined
    location: SpacerLocation | None = None

    @property
    def coverage(self) -> float:
        return self.n_matched_unique / self.n_library_guides if self.n_library_guides else 0.0

    @property
    def match_rate(self) -> float:
        return self.n_matched_probes / self.n_probe if self.n_probe else 0.0

    def __repr__(self) -> str:
        return (
            f"{self.name}: {self.match_rate:.1%} of {self.n_probe:,} probes explained, "
            f"{self.n_matched_unique:,} distinct guides seen "
            f"({self.coverage:.1%} of the library)"
        )


@dataclass
class Detection:
    best: LibraryMatch | None
    ranked: list[LibraryMatch]
    confident: bool
    reason: str

    def describe(self) -> str:
        if not self.best:
            return f"No library matched. {self.reason}"
        runner = self.ranked[1] if len(self.ranked) > 1 else None
        line = (
            f"{self.best.name}: {self.best.match_rate:.1%} of probe sequences matched, "
            f"covering {self.best.coverage:.1%} of the library"
        )
        if runner:
            line += f". Next best {runner.name} at {runner.match_rate:.1%}"
        return line


def rank_libraries(
    probe_sequences: set[str],
    libraries: dict[str, Library] | None = None,
) -> list[LibraryMatch]:
    libraries = libraries if libraries is not None else load_all_libraries()
    matches: list[LibraryMatch] = []
    for slug, lib in libraries.items():
        targeting = {g.sequence for g in lib.guides if not g.is_control}
        if not targeting:
            continue
        overlap = probe_sequences & targeting
        matches.append(
            LibraryMatch(
                slug=slug,
                name=lib.name,
                n_library_guides=len(targeting),
                n_matched_unique=len(overlap),
                n_matched_probes=len(overlap),
                n_probe=len(probe_sequences),
            )
        )
    # Coverage first, then how much of the probe it explains.
    matches.sort(key=lambda m: (m.coverage, m.match_rate), reverse=True)
    return matches


def _decide(ranked: list[LibraryMatch]) -> Detection:
    if not ranked or ranked[0].n_matched_probes == 0:
        return Detection(None, ranked, False,
                         "No candidate library shared any guide sequence with the input.")
    best = ranked[0]
    runner = ranked[1] if len(ranked) > 1 else None

    # Confident when the input is well explained and the winner is clearly
    # ahead of the next candidate.
    separated = runner is None or best.match_rate >= runner.match_rate * 2
    explained = best.match_rate >= 0.50
    if explained and separated:
        return Detection(best, ranked, True, "Clear single match.")
    if explained:
        return Detection(best, ranked, False,
                         f"Matched {best.name} but {runner.name if runner else 'another library'} "
                         f"is close; confirm the call.")
    return Detection(best, ranked, False,
                     f"Only {best.match_rate:.1%} of sequences matched the best candidate. "
                     "The library may be absent from the Atlas, or the guide offset may be wrong.")


def detect_from_sequences(sequences: set[str]) -> Detection:
    return _decide(rank_libraries(sequences))


def detect_from_count_table(matrix: CountMatrix) -> Detection:
    """
    Fingerprint a count table.

    Some tables key rows by guide ID rather than sequence, in which case there
    is nothing to match on and we say so instead of guessing.
    """
    candidates = {g.strip().upper() for g in matrix.guide_ids}
    sequences = {c for c in candidates if c and not (set(c) - set("ACGTN")) and 15 <= len(c) <= 34}
    if not sequences:
        return Detection(None, [], False,
                         "Row identifiers are not guide sequences, so the library cannot be "
                         "fingerprinted from this table. Supply the library explicitly.")
    return detect_from_sequences(sequences)


def detect_from_fastq(
    path: Path,
    config: CountConfig = SETTINGS.count,
    libraries: dict[str, Library] | None = None,
) -> Detection:
    """
    Fingerprint a FASTQ.

    The spacer offset and the library identity are entangled: the offset can
    only be found using a library, and the library can only be confirmed once
    the offset is right. We resolve that by trying each candidate's own
    detection independently and keeping the one that explains the most reads.
    """
    libraries = libraries if libraries is not None else load_all_libraries()
    reads = list(iter_reads(path, limit=config.detect_sample_reads))
    if not reads:
        return Detection(None, [], False, f"{path.name} contains no reads.")

    matches: list[LibraryMatch] = []
    for slug, lib in libraries.items():
        location = detect_spacer_location(reads, lib, config)
        targeting = {g.sequence for g in lib.guides if not g.is_control}
        seen: set[str] = set()
        hits = 0
        for r in reads:
            s = location.extract(r)
            if s is not None and s in targeting:
                seen.add(s)
                hits += 1
        matches.append(
            LibraryMatch(
                slug=slug,
                name=lib.name,
                n_library_guides=len(targeting),
                n_matched_unique=len(seen),
                n_matched_probes=hits,
                n_probe=len(reads),
                location=location,
            )
        )

    # For reads, the meaningful ranking is what share of reads was explained.
    matches.sort(key=lambda m: (m.match_rate, m.coverage), reverse=True)
    if not matches or matches[0].n_matched_probes == 0:
        return Detection(None, matches, False,
                         "No library explained any sampled read. Check that these are "
                         "sgRNA amplicon reads and not whole-genome or RNA-seq.")
    best = matches[0]
    runner = matches[1] if len(matches) > 1 else None
    confident = best.match_rate >= 0.5 and (runner is None or best.match_rate >= runner.match_rate * 2)
    reason = "Clear single match." if confident else (
        f"Best candidate {best.name} explained {best.match_rate:.1%} of reads; confirm the call."
    )
    return Detection(best, matches, confident, reason)

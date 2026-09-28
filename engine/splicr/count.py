"""
FASTQ to counts.

The approach is exact-match lookup against the library, with an optional
unambiguous 1-mismatch recovery pass. Reads are collapsed to unique observed
spacers first, so the expensive mismatch search runs once per distinct
sequence rather than once per read.

Two things here are easy to get wrong and both silently destroy a run:

1. The spacer offset. Staggered primers shift it by 0-8 bases, so a fixed
   trim maps roughly one eighth of reads. We locate the spacer by scanning
   for the vector anchor and fall back to an offset histogram built against
   the library itself.

2. Mismatch tolerance. Several libraries contain duplicate or near-duplicate
   sequences. A permissive search assigns those reads arbitrarily, so a
   1-mismatch hit is only accepted when exactly one library guide is within
   that distance.
"""

from __future__ import annotations

import gzip
import io
import csv
from decimal import Decimal, InvalidOperation
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from .config import SETTINGS, VECTOR_ANCHORS, CountConfig
from .references import Library

BASES = ("A", "C", "G", "T")


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def open_maybe_gzip(path: Path) -> io.TextIOBase:
    if str(path).endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="ascii", errors="replace")
    return open(path, "r", encoding="ascii", errors="replace")


def iter_reads(path: Path, limit: int | None = None) -> Iterator[str]:
    """Yield sequence lines from a FASTQ, without validating the whole record."""
    n = 0
    with open_maybe_gzip(path) as fh:
        for i, line in enumerate(fh):
            if i % 4 != 1:
                continue
            yield line.rstrip("\n")
            n += 1
            if limit is not None and n >= limit:
                return


# ---------------------------------------------------------------------------
# Locating the spacer
# ---------------------------------------------------------------------------

@dataclass
class SpacerLocation:
    """How to pull the spacer out of a read."""

    guide_length: int
    anchor: str | None = None          # anchor sequence, when one was found
    anchor_name: str | None = None
    offsets: tuple[int, ...] = ()      # fallback fixed offsets, most common first
    search_window: int = 40            # how far into the read to look for the anchor
    reverse_complement: bool = False
    # The best-scoring anchor found during detection, kept even when a fixed
    # offset wins. A fixed offset slices every read long enough to slice, so it
    # cannot tell a guide amplicon from unrelated sequence. Tallying the anchor
    # separately is what makes "half this sample is not amplicon" visible
    # instead of looking like a low mapping rate with no explanation.
    probe_anchor: str | None = None
    probe_anchor_name: str | None = None

    def has_anchor(self, read: str) -> bool:
        if not self.probe_anchor:
            return False
        if self.reverse_complement:
            read = revcomp(read)
        return read.find(self.probe_anchor, 0,
                         self.search_window + len(self.probe_anchor)) >= 0

    def extract(self, read: str) -> str | None:
        if self.reverse_complement:
            read = revcomp(read)
        if self.anchor:
            idx = read.find(self.anchor, 0, self.search_window + len(self.anchor))
            if idx >= 0:
                start = idx + len(self.anchor)
                spacer = read[start:start + self.guide_length]
                if len(spacer) == self.guide_length:
                    return spacer
                return None
        for off in self.offsets:
            spacer = read[off:off + self.guide_length]
            if len(spacer) == self.guide_length:
                return spacer
        return None

    def describe(self) -> str:
        if self.anchor_name:
            return f"anchor {self.anchor_name} (+{self.guide_length}nt)"
        if self.offsets:
            return f"fixed offset {self.offsets[0]} (+{self.guide_length}nt)"
        return "unresolved"


_COMPLEMENT = str.maketrans("ACGTNacgtn", "TGCANtgcan")


def revcomp(seq: str) -> str:
    return seq.translate(_COMPLEMENT)[::-1]


def detect_spacer_location(
    reads: list[str],
    library: Library,
    config: CountConfig = SETTINGS.count,
) -> SpacerLocation:
    """
    Work out where the spacer sits, using the library as ground truth.

    Tries, in order: each known vector anchor; then every plausible fixed
    offset scored by how many sampled reads map. Also tests the reverse
    complement, because some protocols sequence the other strand.
    """
    guide_length = library.dominant_length
    sequences = library.sequences
    best: tuple[int, SpacerLocation] | None = None
    best_anchor: tuple[int, str, str] | None = None   # hits, sequence, name

    def score(loc: SpacerLocation) -> int:
        hits = 0
        for r in reads:
            s = loc.extract(r)
            if s is not None and s in sequences:
                hits += 1
        return hits

    for rc in (False, True):
        for name, anchor in VECTOR_ANCHORS.items():
            loc = SpacerLocation(guide_length, anchor=anchor, anchor_name=name,
                                 reverse_complement=rc)
            hits = score(loc)
            if best is None or hits > best[0]:
                best = (hits, loc)
            if best_anchor is None or hits > best_anchor[0]:
                best_anchor = (hits, anchor, name)

        # Offset histogram: for every read, find where a library guide starts.
        # This is what recovers unusual backbones with no known anchor.
        histogram: Counter[int] = Counter()
        for r in reads[: min(len(reads), 20_000)]:
            seq = revcomp(r) if rc else r
            for off in range(0, min(len(seq) - guide_length + 1, 60)):
                if seq[off:off + guide_length] in sequences:
                    histogram[off] += 1
                    break
        if histogram:
            offsets = tuple(o for o, _ in histogram.most_common(6))
            loc = SpacerLocation(guide_length, offsets=offsets, reverse_complement=rc)
            hits = score(loc)
            if best is None or hits > best[0]:
                best = (hits, loc)

    assert best is not None
    hits, loc = best
    if best_anchor is not None and best_anchor[0] > 0:
        loc.probe_anchor, loc.probe_anchor_name = best_anchor[1], best_anchor[2]
    rate = hits / max(1, len(reads))
    if rate < config.min_detect_match_rate:
        # Keep the best guess but make the weak signal visible to the caller.
        loc.offsets = loc.offsets or config.fallback_offsets
    return loc


# ---------------------------------------------------------------------------
# Mapping
# ---------------------------------------------------------------------------

def one_mismatch_variants(seq: str) -> Iterator[str]:
    for i, original in enumerate(seq):
        for b in BASES:
            if b != original:
                yield seq[:i] + b + seq[i + 1:]


def resolve_mismatch(seq: str, sequences: set[str], require_unique: bool) -> str | None:
    """Return the unique library sequence within one substitution, if any."""
    found: str | None = None
    for variant in one_mismatch_variants(seq):
        if variant in sequences:
            if found is not None and found != variant:
                return None if require_unique else found
            found = variant
    return found


@dataclass
class SampleCounts:
    """Counting result for one FASTQ (or one column of a count table)."""

    label: str
    counts: dict[str, int] = field(default_factory=dict)   # guide_id -> count
    total_reads: int = 0
    mapped_exact: int = 0
    mapped_mismatch: int = 0
    unmapped: int = 0
    no_spacer: int = 0
    with_anchor: int = 0               # reads carrying the vector anchor
    anchor_name: str | None = None
    location: SpacerLocation | None = None

    @property
    def mapped(self) -> int:
        return self.mapped_exact + self.mapped_mismatch

    @property
    def mapping_rate(self) -> float:
        return self.mapped / self.total_reads if self.total_reads else 0.0

    @property
    def anchor_rate(self) -> float | None:
        """Fraction of reads that look like guide amplicons at all.

        None when no anchor was identified, which is not the same as zero.
        """
        if self.anchor_name is None or not self.total_reads:
            return None
        return self.with_anchor / self.total_reads

    def summary(self) -> str:
        parts = [
            f"{self.label}: {self.total_reads:,} reads",
            f"{self.mapping_rate:.1%} mapped "
            f"({self.mapped_exact:,} exact, {self.mapped_mismatch:,} 1mm)",
        ]
        rate = self.anchor_rate
        if rate is not None:
            parts.append(f"{rate:.1%} carry the {self.anchor_name} anchor")
        if self.no_spacer:
            parts.append(f"{self.no_spacer:,} too short to read a spacer")
        return ", ".join(parts)


def count_fastq(
    path: Path,
    library: Library,
    label: str | None = None,
    config: CountConfig = SETTINGS.count,
    location: SpacerLocation | None = None,
) -> SampleCounts:
    """Count one FASTQ against a library."""
    label = label or path.name
    sequences = library.sequences

    if location is None:
        sample = list(iter_reads(path, limit=config.detect_sample_reads))
        if not sample:
            raise ValueError(f"{path} contains no reads")
        location = detect_spacer_location(sample, library, config)

    # Collapse to unique observed spacers. This is what makes the mismatch
    # pass affordable: it runs per distinct sequence, not per read.
    observed: Counter[str] = Counter()
    total = 0
    no_spacer = 0
    with_anchor = 0
    check_anchor = location.probe_anchor is not None
    for read in iter_reads(path):
        total += 1
        if check_anchor and location.has_anchor(read):
            with_anchor += 1
        spacer = location.extract(read)
        if spacer is None:
            no_spacer += 1
            continue
        observed[spacer] += 1

    counts: Counter[str] = Counter()
    exact = mismatch = unmapped = 0
    for spacer, n in observed.items():
        guide = library.lookup(spacer)
        if guide is not None:
            counts[guide.guide_id] += n
            exact += n
            continue
        if config.allow_mismatch:
            hit = resolve_mismatch(spacer, sequences, config.require_unique_mismatch)
            if hit is not None:
                g = library.lookup(hit)
                if g is not None:
                    counts[g.guide_id] += n
                    mismatch += n
                    continue
        unmapped += n

    # Guides with no reads must appear as explicit zeros: the zero fraction is
    # a QC metric, so a missing row and a zero row are not the same thing.
    full = {g.guide_id: counts.get(g.guide_id, 0) for g in library.guides}

    return SampleCounts(
        label=label,
        counts=full,
        total_reads=total,
        mapped_exact=exact,
        mapped_mismatch=mismatch,
        unmapped=unmapped,
        no_spacer=no_spacer,
        with_anchor=with_anchor,
        anchor_name=location.probe_anchor_name if check_anchor else None,
        location=location,
    )


@dataclass
class CountMatrix:
    """Guide by sample counts, the artifact every later stage reads."""

    library_slug: str
    guide_ids: list[str]
    genes: list[str | None]
    samples: list[str]
    matrix: list[list[int]]           # rows = guides, cols = samples
    per_sample: list[SampleCounts] = field(default_factory=list)

    def column(self, sample: str) -> list[int]:
        j = self.samples.index(sample)
        return [row[j] for row in self.matrix]

    def to_mageck_tsv(self, path: Path) -> Path:
        """
        Write the count table MAGeCK and BAGEL2 both read.
        Columns: sgRNA, Gene, then one per sample.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w") as fh:
            fh.write("sgRNA\tGene\t" + "\t".join(self.samples) + "\n")
            for i, gid in enumerate(self.guide_ids):
                gene = self.genes[i] or "CONTROL"
                fh.write(f"{gid}\t{gene}\t" + "\t".join(str(v) for v in self.matrix[i]) + "\n")
        return path

    @classmethod
    def from_samples(cls, library: Library, samples: list[SampleCounts]) -> "CountMatrix":
        guide_ids = [g.guide_id for g in library.guides]
        genes = [g.gene for g in library.guides]
        matrix = [[s.counts.get(gid, 0) for s in samples] for gid in guide_ids]
        return cls(
            library_slug=library.slug,
            guide_ids=guide_ids,
            genes=genes,
            samples=[s.label for s in samples],
            matrix=matrix,
            per_sample=samples,
        )


def count_table_samples(path: Path) -> list[str]:
    """
    Sample labels from a count table's header, without parsing the body.

    The design has to be validated before anything expensive runs, and for an
    uploaded count table the sample labels only exist in the file. Reading the
    header is cheap; reading a genome-wide table twice is not.
    """
    with (gzip.open(path, "rt", errors="replace") if str(path).endswith(".gz")
          else open(path, "r", errors="replace")) as fh:
        first = fh.readline()
    first = first.replace("\r\n", "\n").replace("\r", "\n").split("\n")[0]
    delim = "\t" if first.count("\t") >= first.count(",") else ","
    return _count_header(next(csv.reader([first], delimiter=delim), []), path)


def _count_header(header: list[str], path: Path) -> list[str]:
    samples = [h.strip() for h in header[2:]]
    if not samples or any(not s for s in samples):
        raise ValueError(f"{path.name}: expected sgRNA, Gene and nonempty sample columns")
    if len(set(samples)) != len(samples):
        raise ValueError(f"{path.name}: duplicate sample labels in count table")
    return samples


def read_count_table(path: Path, library: Library | None = None) -> CountMatrix:
    """
    Read an existing count table (sgRNA, Gene, samples...).

    Used when a lab uploads counts rather than reads, and when checking our
    counts against a published table.
    """
    text_lines = _read_any(path).splitlines()
    if not text_lines:
        raise ValueError(f"{path.name}: empty count table")
    delim = "\t" if text_lines[0].count("\t") >= text_lines[0].count(",") else ","
    reader = csv.reader(text_lines, delimiter=delim)
    header = next(reader)
    samples = _count_header(header, path)

    guide_ids: list[str] = []
    genes: list[str | None] = []
    matrix: list[list[int]] = []
    seen: set[str] = set()
    for f in reader:
        if not f or all(not value.strip() for value in f):
            continue
        where = f"{path.name}: row {reader.line_num}"
        if len(f) != len(header):
            raise ValueError(f"{where}: expected {len(header)} columns, found {len(f)}")
        guide_id = f[0].strip()
        if not guide_id or guide_id in seen:
            raise ValueError(f"{where}: empty or duplicate guide identifier {guide_id!r}")
        seen.add(guide_id)
        guide_ids.append(guide_id)
        gene = f[1].strip()
        genes.append(None if gene.upper() in ("CONTROL", "NA", "") else gene)
        row = []
        for sample, v in zip(samples, f[2:]):
            try:
                value = Decimal(v.strip())
                if not value.is_finite() or value < 0 or value != value.to_integral_value():
                    raise InvalidOperation
                row.append(int(value))
            except (InvalidOperation, ValueError):
                raise ValueError(
                    f"{where}, sample {sample!r}: count {v!r} must be a finite "
                    "nonnegative integer; missing counts cannot be treated as zero"
                ) from None
        matrix.append(row)

    if not matrix:
        raise ValueError(f"{path.name}: count table contains no guide rows")

    return CountMatrix(
        library_slug=library.slug if library else "unknown",
        guide_ids=guide_ids,
        genes=genes,
        samples=samples,
        matrix=matrix,
    )


def _read_any(path: Path) -> str:
    raw = path.read_bytes()
    if str(path).endswith(".gz"):
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")

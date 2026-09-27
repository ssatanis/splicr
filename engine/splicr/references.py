"""
Loading the reference data: libraries, gene sets, guide coordinates and
off-target alignment counts.

Every loader here reads a real downloaded file. Nothing is synthesised.
"""

from __future__ import annotations

import csv
import functools
import gzip
import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from .config import GENESETS_DIR, LIBRARIES_DIR, OFFTARGET_DIR, COORDINATES_DIR

VALID_BASES = set("ACGTN")


def read_text_any(path: Path) -> str:
    """
    Read a text file regardless of line-ending convention.

    Several Broad GPP files (Brunello, Brie, both GeCKOv2 CSVs) use bare CR
    line terminators. `wc -l` returns 0 on those and a naive splitlines on
    "\\n" yields one enormous line, which silently produces an empty library.
    """
    raw = path.read_bytes()
    if path.suffix == ".gz":
        raw = gzip.decompress(raw)
    text = raw.decode("utf-8", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def sniff_delimiter(header: str) -> str:
    return "\t" if header.count("\t") >= header.count(",") else ","


@dataclass
class Guide:
    guide_id: str
    sequence: str
    gene: str | None
    is_control: bool = False
    chrom: str | None = None
    cut_pos: int | None = None
    strand: str | None = None
    perfect_alignments: int | None = None
    mismatch1_alignments: int | None = None

    @property
    def targets_gene(self) -> bool:
        return not self.is_control and bool(self.gene)


@dataclass
class Library:
    slug: str
    name: str
    guides: list[Guide]
    source_file: Path | None = None
    taxid: int = 9606

    _by_sequence: dict[str, Guide] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        # A library can contain the same sequence twice (GeCKOv2 has ~3,950
        # duplicates across A+B). First occurrence wins, deterministically.
        for g in self.guides:
            self._by_sequence.setdefault(g.sequence, g)

    @property
    def sequences(self) -> set[str]:
        return set(self._by_sequence)

    @property
    def guide_lengths(self) -> dict[int, int]:
        out: dict[int, int] = {}
        for g in self.guides:
            out[len(g.sequence)] = out.get(len(g.sequence), 0) + 1
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))

    @property
    def dominant_length(self) -> int:
        return next(iter(self.guide_lengths))

    @property
    def genes(self) -> set[str]:
        return {g.gene for g in self.guides if g.targets_gene and g.gene}

    @property
    def n_controls(self) -> int:
        return sum(1 for g in self.guides if g.is_control)

    def lookup(self, sequence: str) -> Guide | None:
        return self._by_sequence.get(sequence)

    def __len__(self) -> int:
        return len(self.guides)

    def __repr__(self) -> str:
        return (
            f"Library({self.slug!r}, {len(self.guides)} guides, "
            f"{len(self.genes)} genes, {self.n_controls} controls, "
            f"{self.dominant_length}nt)"
        )


# ---------------------------------------------------------------------------
# Library file parsing
#
# There is no single "Broad GPP format". Brunello and Brie ship 11 columns with
# genomic coordinates; Gattinara, Calabrese, Dolcetto and Gouda ship 3 columns
# with none; GeCKOv2 uses its own. Each spec below names the columns it needs
# and the token that marks a control row.
# ---------------------------------------------------------------------------

CONTROL_MARKERS = (
    "non-targeting control",
    "no-target",
    "no_site",
    "one_non-gene_site",
    "neg_control",
    "nontargeting",
    "safe-targeting",
    "control",
)


def looks_like_control(gene: str) -> bool:
    g = (gene or "").strip().lower()
    if not g:
        return True
    return any(g.startswith(m) or g == m for m in CONTROL_MARKERS)


@dataclass(frozen=True)
class LibrarySpec:
    slug: str
    name: str
    filename: str
    seq_col: str
    gene_col: str
    id_col: str | None = None
    taxid: int = 9606
    chrom_col: str | None = None
    pos_col: str | None = None
    strand_col: str | None = None


LIBRARY_SPECS: tuple[LibrarySpec, ...] = (
    LibrarySpec("brunello", "Brunello", "brunello.txt",
                "sgRNA Target Sequence", "Target Gene Symbol",
                chrom_col="Genomic Sequence",
                pos_col="Position of Base After Cut (1-based)",
                strand_col="Strand"),
    LibrarySpec("brie", "Brie", "brie.txt",
                "sgRNA Target Sequence", "Target Gene Symbol", taxid=10090,
                chrom_col="Genomic Sequence",
                pos_col="Position of Base After Cut (1-based)",
                strand_col="Strand"),
    LibrarySpec("gattinara", "Gattinara", "gattinara.txt",
                "Barcode Sequence", "Annotated Gene Symbol"),
    LibrarySpec("calabrese-a", "Calabrese Set A", "calabrese-a.txt",
                "Barcode Sequence", "Annotated Gene Symbol"),
    LibrarySpec("calabrese-b", "Calabrese Set B", "calabrese-b.txt",
                "Barcode Sequence", "Annotated Gene Symbol"),
    LibrarySpec("dolcetto-a", "Dolcetto Set A", "dolcetto-a.txt",
                "Barcode Sequence", "Annotated Gene Symbol"),
    LibrarySpec("dolcetto-b", "Dolcetto Set B", "dolcetto-b.txt",
                "Barcode Sequence", "Annotated Gene Symbol"),
    LibrarySpec("geckov2-a", "GeCKOv2 Set A", "geckov2-a.csv",
                "seq", "gene_id", id_col="UID"),
    LibrarySpec("geckov2-b", "GeCKOv2 Set B", "geckov2-b.csv",
                "seq", "gene_id", id_col="UID"),
    LibrarySpec("gouda", "Gouda", "gouda.txt",
                "Barcode Sequence", "Annotated Gene Symbol", taxid=10090),
    LibrarySpec("mouse-geckov2-a", "Mouse GeCKOv2 Set A", "mouse-geckov2-a.csv",
                "seq", "gene_id", id_col="UID", taxid=10090),
    LibrarySpec("mouse-geckov2-b", "Mouse GeCKOv2 Set B", "mouse-geckov2-b.csv",
                "seq", "gene_id", id_col="UID", taxid=10090),
)


def _parse_delimited(path: Path, spec: LibrarySpec) -> Library:
    text = read_text_any(path)
    lines = [l for l in text.split("\n") if l.strip()]
    if not lines:
        raise ValueError(f"{path.name} is empty after line-ending normalisation")

    delim = sniff_delimiter(lines[0])
    reader = csv.reader(io.StringIO("\n".join(lines)), delimiter=delim)
    header = next(reader)
    index = {name.strip(): i for i, name in enumerate(header)}

    def col(name: str | None) -> int | None:
        if name is None:
            return None
        return index.get(name)

    si, gi = col(spec.seq_col), col(spec.gene_col)
    if si is None or gi is None:
        raise ValueError(
            f"{path.name}: expected columns {spec.seq_col!r} and {spec.gene_col!r}, "
            f"found {header[:12]}"
        )
    ii, ci, pi, sti = col(spec.id_col), col(spec.chrom_col), col(spec.pos_col), col(spec.strand_col)

    guides: list[Guide] = []
    for n, row in enumerate(reader):
        if len(row) <= max(si, gi):
            continue
        seq = row[si].strip().upper()
        if not seq or set(seq) - VALID_BASES:
            continue
        gene = row[gi].strip()
        control = looks_like_control(gene)

        chrom = pos = strand = None
        if ci is not None and ci < len(row):
            # Brunello/Brie store a RefSeq accession here (NC_000019.10),
            # not a chromosome name.
            raw = row[ci].strip()
            chrom = refseq_to_chrom(raw) or (raw or None)
        if pi is not None and pi < len(row):
            try:
                pos = int(row[pi])
            except (ValueError, TypeError):
                pos = None
        if sti is not None and sti < len(row):
            raw = row[sti].strip().lower()
            # Brunello writes the words "sense"/"antisense", not +/-.
            strand = {"sense": "+", "antisense": "-", "+": "+", "-": "-"}.get(raw)

        guides.append(
            Guide(
                guide_id=(row[ii].strip() if ii is not None and ii < len(row) and row[ii].strip()
                          else f"{spec.slug}:{n}"),
                sequence=seq,
                gene=None if control else gene,
                is_control=control,
                chrom=chrom,
                cut_pos=pos,
                strand=strand,
            )
        )

    if not guides:
        raise ValueError(f"{path.name}: parsed 0 guides")
    return Library(spec.slug, spec.name, guides, source_file=path, taxid=spec.taxid)


REFSEQ_CHROM = re.compile(r"^NC_0*(\d+)\.\d+$")


def refseq_to_chrom(value: str) -> str | None:
    """NC_000019.10 -> chr19, NC_000023 -> chrX, NC_000024 -> chrY."""
    m = REFSEQ_CHROM.match((value or "").strip())
    if not m:
        return None
    n = int(m.group(1))
    if n == 23:
        return "chrX"
    if n == 24:
        return "chrY"
    if n == 12920:
        return "chrM"
    if 1 <= n <= 22:
        return f"chr{n}"
    return None


def _parse_xlsx(path: Path, seq_col: str, gene_col: str, id_col: str | None,
                slug: str, name: str, taxid: int) -> Library:
    """TKOv3 ships only as xlsx. Read it without pulling in pandas."""
    try:
        from openpyxl import load_workbook
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "openpyxl is required to read xlsx libraries: "
            "engine/.tools/env/bin/python -m pip install openpyxl"
        ) from exc

    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    header = [str(c).strip() if c is not None else "" for c in next(rows)]
    index = {h: i for i, h in enumerate(header)}
    si, gi = index.get(seq_col), index.get(gene_col)
    if si is None or gi is None:
        raise ValueError(f"{path.name}: expected {seq_col!r}/{gene_col!r}, found {header}")
    ii = index.get(id_col) if id_col else None

    guides: list[Guide] = []
    for n, row in enumerate(rows):
        if row is None or len(row) <= max(si, gi):
            continue
        seq = str(row[si] or "").strip().upper()
        if not seq or set(seq) - VALID_BASES:
            continue
        gene = str(row[gi] or "").strip()
        control = looks_like_control(gene)
        guides.append(
            Guide(
                guide_id=(str(row[ii]).strip() if ii is not None and row[ii] else f"{slug}:{n}"),
                sequence=seq,
                gene=None if control else gene,
                is_control=control,
            )
        )
    wb.close()
    if not guides:
        raise ValueError(f"{path.name}: parsed 0 guides")
    return Library(slug, name, guides, source_file=path, taxid=taxid)


@functools.lru_cache(maxsize=None)
def load_library(slug: str) -> Library:
    """Load one library by slug. Cached: parsing Brunello takes a moment."""
    if slug == "tkov3":
        path = LIBRARIES_DIR / "tkov3.xlsx"
        if not path.exists():
            raise FileNotFoundError(f"{path} not found; run scripts/data/download.sh")
        return _parse_xlsx(path, "SEQUENCE", "GENE", "GUIDE_ID", "tkov3", "TKOv3", 9606)

    spec = next((s for s in LIBRARY_SPECS if s.slug == slug), None)
    if spec is None:
        raise KeyError(f"unknown library {slug!r}")
    path = LIBRARIES_DIR / spec.filename
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; run scripts/data/download.sh")
    return _parse_delimited(path, spec)


def available_libraries() -> list[str]:
    """Slugs whose files are actually present on disk."""
    found = []
    for spec in LIBRARY_SPECS:
        if (LIBRARIES_DIR / spec.filename).exists():
            found.append(spec.slug)
    if (LIBRARIES_DIR / "tkov3.xlsx").exists():
        found.append("tkov3")
    return sorted(found)


def load_all_libraries() -> dict[str, Library]:
    out: dict[str, Library] = {}
    for slug in available_libraries():
        try:
            out[slug] = load_library(slug)
        except Exception as exc:  # a malformed file must not kill detection
            print(f"  warning: could not load library {slug}: {exc}")
    return out


# ---------------------------------------------------------------------------
# Reference gene sets
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=None)
def load_gene_set(name: str) -> frozenset[str]:
    """
    Hart lab reference sets. First column is the symbol, one header line.

    CEGv2 = 684 core essentials, NEGv1 = 927 nonessentials.
    """
    path = GENESETS_DIR / f"{name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; run scripts/data/download.sh")
    lines = read_text_any(path).split("\n")[1:]
    return frozenset(l.split("\t")[0].strip() for l in lines if l.strip())


def essentials(taxid: int = 9606) -> frozenset[str]:
    return load_gene_set("CEGv2" if taxid == 9606 else "CEG_mouse")


def nonessentials(taxid: int = 9606) -> frozenset[str]:
    return load_gene_set("NEGv1" if taxid == 9606 else "NEG_mouse")


# ---------------------------------------------------------------------------
# Off-target alignment counts (Fortin et al. 2019, Genome Biology 20:21)
#
# Per-guide counts of perfect and 1-mismatch genomic alignments. This is the
# evidence behind the promiscuous-guide and multi-gene-guide flags.
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=None)
def load_offtarget(library_slug: str) -> dict[str, tuple[int, int]]:
    """
    sequence -> (perfect_alignments, mismatch1_alignments).

    Returns an empty dict when the table for that library is not on disk, so
    callers degrade to "unknown" rather than failing.
    """
    stem = {
        "brunello": "brunello",
        "geckov2-a": "geckov2",
        "geckov2-b": "geckov2",
        "tkov3": "tkov3",
        "avana": "avana",
    }.get(library_slug)
    if stem is None:
        return {}

    path = OFFTARGET_DIR / f"fortin2019_alignments_{stem}.csv"
    if not path.exists():
        return {}

    text = read_text_any(path)
    lines = [l for l in text.split("\n") if l.strip()]
    if not lines:
        return {}
    delim = sniff_delimiter(lines[0])
    reader = csv.DictReader(io.StringIO("\n".join(lines)), delimiter=delim)

    def pick(names: list[str], fields: list[str]) -> str | None:
        low = {f.lower().strip(): f for f in fields}
        for n in names:
            if n in low:
                return low[n]
        return None

    fields = reader.fieldnames or []
    seq_f = pick(["sequence", "seq", "sgrna", "spacer", "protospacer"], fields)
    perf_f = pick(["n_perfect", "perfect", "nperfect", "n_alignments", "perfect_match"], fields)
    mm_f = pick(["n_mismatch", "mismatch", "n_mismatch1", "one_mismatch"], fields)
    if seq_f is None:
        return {}

    out: dict[str, tuple[int, int]] = {}
    for row in reader:
        seq = (row.get(seq_f) or "").strip().upper()
        if not seq:
            continue
        def num(f: str | None) -> int:
            if not f:
                return 0
            try:
                return int(float(row.get(f) or 0))
            except (ValueError, TypeError):
                return 0
        out[seq] = (num(perf_f), num(mm_f))
    return out


def annotate_offtarget(library: Library) -> int:
    """Attach alignment counts to a library's guides. Returns how many matched."""
    table = load_offtarget(library.slug)
    if not table:
        return 0
    hit = 0
    for g in library.guides:
        counts = table.get(g.sequence)
        if counts:
            g.perfect_alignments, g.mismatch1_alignments = counts
            hit += 1
    return hit


# ---------------------------------------------------------------------------
# DepMap guide maps: hg38 alignment plus nAlignments, the multi-cut flag
# ---------------------------------------------------------------------------

DEPMAP_GUIDE_MAPS = {
    "avana": "AvanaGuideMap.csv",
    "ky": "KYGuideMap.csv",
    "humagne": "HumagneGuideMap.csv",
}


@functools.lru_cache(maxsize=None)
def load_depmap_guide_map(which: str) -> dict[str, dict[str, str]]:
    """
    sgRNA sequence -> row. Columns include GenomeAlignment (hg38),
    Gene ("SYMBOL (entrez)"), nAlignments, UsedByChronos, DropReason.
    """
    filename = DEPMAP_GUIDE_MAPS.get(which)
    if not filename:
        return {}
    for base in (COORDINATES_DIR, Path(str(COORDINATES_DIR).replace("coordinates", "depmap"))):
        path = base / filename
        if path.exists():
            break
    else:
        return {}

    text = read_text_any(path)
    reader = csv.DictReader(io.StringIO(text))
    out: dict[str, dict[str, str]] = {}
    for row in reader:
        seq = (row.get("sgRNA") or row.get("sgrna") or "").strip().upper()
        if seq:
            out[seq] = row
    return out

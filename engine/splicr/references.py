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
    # Measured counts from Fortin's alignment table, or None when this guide is
    # not in it. None means unknown. Never a stand-in value: a flag that reads
    # a number here is entitled to treat it as measured.
    perfect_alignments: int | None = None
    mismatch1_alignments: int | None = None
    genes_hit: int | None = None            # distinct genes hit with no mismatch
    # Set when the guide's GENE is flagged in Fortin's per-gene summary. That
    # summary describes the whole library family, so it says nothing about this
    # particular guide, which is why it is kept separate from the counts above.
    gene_offtarget_flagged: bool = False

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
    # Brie's non-targeting controls ship as their own file rather than as rows
    # in the main table. Without merging them the library looks like it has no
    # controls at all, and every QC check that needs a null distribution has
    # nothing to compare against.
    controls_file: str | None = None
    controls_seq_col: str = "Target Sequence"
    controls_id_col: str | None = "Public ID"


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
                strand_col="Strand",
                controls_file="brie-controls.csv"),
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

    if spec.controls_file:
        guides.extend(_parse_controls(LIBRARIES_DIR / spec.controls_file, spec,
                                      seen={g.sequence for g in guides}))

    return Library(spec.slug, spec.name, guides, source_file=path, taxid=spec.taxid)


def _parse_controls(path: Path, spec: LibrarySpec, seen: set[str]) -> list[Guide]:
    """Non-targeting controls from a sidecar file, skipping any already present."""
    if not path.exists():
        return []
    lines = [l for l in read_text_any(path).split("\n") if l.strip()]
    if not lines:
        return []
    reader = csv.reader(io.StringIO("\n".join(lines)), delimiter=sniff_delimiter(lines[0]))
    header = [h.strip().strip('"') for h in next(reader)]
    index = {name: i for i, name in enumerate(header)}
    si = index.get(spec.controls_seq_col)
    if si is None:
        return []
    ii = index.get(spec.controls_id_col) if spec.controls_id_col else None

    out: list[Guide] = []
    for n, row in enumerate(reader):
        if len(row) <= si:
            continue
        seq = row[si].strip().strip('"').upper()
        if not seq or set(seq) - VALID_BASES or seq in seen:
            continue
        seen.add(seq)
        gid = row[ii].strip().strip('"') if ii is not None and ii < len(row) else ""
        out.append(Guide(guide_id=gid or f"{spec.slug}:control:{n}", sequence=seq,
                         gene=None, is_control=True))
    return out


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
# Off-target data (Fortin et al. 2019, Genome Biology 20:21)
#
# Two file shapes, both real and both useful:
#
#   *_gene_summary_*.csv   one row per GENE, with n.multiplex.guides (guides
#                          that perfectly target more than one gene),
#                          n.mismatch.guides, and a precomputed flag.
#   *_alignments_*.csv     one row per ALIGNMENT, so a guide appears once per
#                          genomic site it hits. Counting per-guide
#                          promiscuity means grouping by sgrna.
#
# The gene summary answers the artifact question directly and is small, so it
# is the default. The alignment files are parsed only when per-guide detail
# is actually needed, because GeCKOv2's is 186 MB.
# ---------------------------------------------------------------------------

# Library slug -> the stem Fortin used. Avana has a gene summary but no
# published alignment file.
_FORTIN_STEM = {
    "brunello": "brunello",
    "geckov2-a": "geckov2",
    "geckov2-b": "geckov2",
    "tkov3": "tkov3",
    "avana": "avana",
}


def _find_fortin(kind: str, stem: str) -> Path | None:
    """Filenames carry an additional-file number (af5, af9), so glob for them."""
    matches = sorted(OFFTARGET_DIR.glob(f"fortin2019_*_{kind}_{stem}.csv"))
    return matches[0] if matches else None


@dataclass
class GeneOffTarget:
    gene: str
    n_guides: int
    n_multiplex_guides: int          # guides perfectly targeting >1 gene
    n_multiplex_exonic: int
    n_mismatch_guides: int
    flagged: bool                    # Fortin's own flag
    flagged_exonic: bool

    @property
    def multiplex_fraction(self) -> float:
        return self.n_multiplex_guides / self.n_guides if self.n_guides else 0.0


@functools.lru_cache(maxsize=None)
def load_gene_offtarget(library_slug: str) -> dict[str, GeneOffTarget]:
    """
    Per-gene off-target summary. Empty when the table is absent, so callers
    degrade to "unknown" rather than failing.
    """
    stem = _FORTIN_STEM.get(library_slug)
    if stem is None:
        return {}
    path = _find_fortin("gene_summary", stem)
    if path is None:
        return {}

    reader = csv.DictReader(io.StringIO(read_text_any(path)))
    out: dict[str, GeneOffTarget] = {}

    def as_int(row: dict, key: str) -> int:
        v = (row.get(key) or "").strip().strip('"')
        try:
            return int(float(v))
        except (ValueError, TypeError):
            return 0

    for row in reader:
        gene = (row.get("gene") or "").strip().strip('"')
        if not gene:
            continue
        out[gene] = GeneOffTarget(
            gene=gene,
            n_guides=as_int(row, "n.guides"),
            n_multiplex_guides=as_int(row, "n.multiplex.guides"),
            n_multiplex_exonic=as_int(row, "n.multiplex.guides.exonic"),
            n_mismatch_guides=as_int(row, "n.mismatch.guides"),
            flagged=(row.get("flag") or "").strip().strip('"').upper() == "YES",
            flagged_exonic=(row.get("flag.exonic") or "").strip().strip('"').upper() == "YES",
        )
    return out


@functools.lru_cache(maxsize=None)
def load_guide_offtarget(library_slug: str) -> dict[str, tuple[int, int, int]]:
    """
    Per-guide alignment counts, derived by grouping the alignment table.

    Returns sequence -> (perfect_sites, one_mismatch_sites, genes_hit_perfectly).

    Counts are over DISTINCT genomic SITES, not table rows. The table lists one
    row per alignment per annotated gene, so a single cut site inside a pair of
    overlapping genes appears twice: 1,950 GeCKOv2 guides are affected, and
    counting rows inflates every one of them.

    A guide is multiplex when perfect_sites > 1. That definition reproduces
    Fortin's own published n.multiplex.guides for 20,872 of 20,872 GeCKOv2 genes,
    exactly, with zero mean difference. Counting distinct gene symbols instead
    matches only 81.7% and overstates by 0.66 guides per gene on average, because
    two overlapping annotations at one cut site are one cut, not two.

    GeCKOv2's alignment file is 186 MB, so this streams rather than loading it.
    """
    stem = _FORTIN_STEM.get(library_slug)
    if stem is None:
        return {}
    path = _find_fortin("alignments", stem)
    if path is None:
        return {}

    perfect: dict[str, set[tuple[str, str]]] = {}
    mismatch: dict[str, set[tuple[str, str]]] = {}
    genes: dict[str, set[str]] = {}

    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            seq = (row.get("sgrna") or "").strip().strip('"').upper()
            if not seq:
                continue
            try:
                n_mm = int(float(row.get("n.mismatches") or 0))
            except (ValueError, TypeError):
                continue
            site = ((row.get("chr") or "").strip(), (row.get("start") or "").strip())
            if n_mm == 0:
                perfect.setdefault(seq, set()).add(site)
                symbols = (row.get("gene_symbol") or "").strip().strip('"')
                if symbols and symbols != "NA":
                    genes.setdefault(seq, set()).update(
                        s for s in symbols.split(";") if s and s != "NA"
                    )
            elif n_mm == 1:
                mismatch.setdefault(seq, set()).add(site)

    return {
        seq: (len(perfect.get(seq, ())), len(mismatch.get(seq, ())),
              len(genes.get(seq, ())))
        for seq in set(perfect) | set(mismatch) | set(genes)
    }


def annotate_offtarget(library: Library, per_guide: bool = True) -> int:
    """
    Attach off-target counts to a library's guides.

    per_guide=True reads the alignment table for measured per-guide counts. It
    is the default because a flag that names a guide has to be about that guide:
    the gene summary is computed over the whole library family, so a GeCKOv2 Set
    A screen inherits counts over all six A+B guides and a claim of "4 of 6 of
    your guides" is then wrong about a screen that ran three.

    per_guide=False only marks which genes Fortin flagged, in
    `gene_offtarget_flagged`, and writes no counts at all.

    Returns the number of guides given measured counts.
    """
    summary = load_gene_offtarget(library.slug)
    for g in library.guides:
        entry = summary.get(g.gene) if g.gene else None
        g.gene_offtarget_flagged = bool(entry and entry.flagged)

    if not per_guide:
        return 0

    table = load_guide_offtarget(library.slug)
    if not table:
        return 0
    hit = 0
    for g in library.guides:
        counts = table.get(g.sequence)
        if counts:
            g.perfect_alignments, g.mismatch1_alignments, g.genes_hit = counts
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

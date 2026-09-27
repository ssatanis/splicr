"""
Reading BioGRID ORCS.

ORCS ships as one gzipped tarball per organism. Inside are N per-screen
tab files plus a single screen index that carries the 38 columns of
annotation (cell line, library, phenotype, significance criteria). The index
is not a separate download; it is a member of the archive. That fact cost an
hour of looking for it, so it is written down in
data/references/orcs/SOURCES.txt as well as here.

Four things in this format are easy to get wrong and each one produces a
wrong number rather than an error:

1. Duplicate (SCREEN_ID, OFFICIAL_SYMBOL) keys. 60,162 keys in the human
   release carry more than one row, 150,271 rows in total across 1,463 of
   1,952 screens, and 148,157 of those rows differ in payload rather than
   being exact duplicates. The cause is TSS-level libraries: CRISPRi and
   CRISPRa target transcription start sites, so a gene with several
   annotated TSSs gets one row per TSS. 6,522 of those groups disagree with
   themselves on HIT. Anything that keys on the symbol has to collapse them
   deliberately, and the Atlas schema does exactly that
   (atlas.screen_hits is keyed on (screen_id, gene_symbol)). See
   collapse_rows for the rule and what it records.

2. IDENTIFIER_ID is not a global identifier. It is an Entrez gene id only
   for IDENTIFIER_TYPE == ENTREZ_GENE (99.02% of rows). UNKNOWN rows carry a
   synthetic "<n>U" and AMBIGUOUS rows a "<n>A", and those are unique only
   inside one screen file. Joining on it across screens silently merges
   unrelated genes.

3. Hit-list-only deposits. 141 human screens have SCORES_SIZE ==
   NUMBER_OF_HITS: the authors deposited only the genes they called, not the
   whole library. Every row in those files is a hit. Counting them in a hit
   rate inflates the numerator and the denominator in different proportions
   and makes ordinary genes look like frequent hitters, so
   usable_background exists to keep them out of the statistics while leaving
   them queryable.

4. "-" is the null. It appears in every column, including the numeric SCORE
   columns and CONDITION_DOSAGE. float("-") raises, and a bare
   ``except: 0.0`` would turn a missing score into a measured zero, so
   _number returns None and the caller has to deal with it.

Row counts quoted above are measured from release 2.0.18 by one streaming
pass over data/references/orcs/orcs-human.tar.gz, not taken from BioGRID's
documentation. They are cross-checked against the index: the per-screen
SCORES_SIZE column sums to exactly 26,333,098 rows and NUMBER_OF_HITS to
exactly 1,777,315 HIT == YES rows.

The AssayBench leakage boundary lives in splicr.orcs_safe and is NOT
enforced here: this module is the format layer and knows nothing about
benchmarks. Enforcement belongs where screens are selected, which for the
Atlas is splicr.atlas and scripts/data/ingest-orcs.py.
"""

from __future__ import annotations

import csv
import re
import tarfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

from .config import ORCS_DIR

#: The release these parsers were written against and verified on. Present in
#: every member filename, so a mismatch is detectable rather than silent.
RELEASE = "2.0.18"

#: BioGRID writes this single character where a value is absent, in every
#: column and every file.
NULL = "-"

#: Member filenames look like BIOGRID-ORCS-SCREEN_1246-2.0.18.screen.tab.txt.
SCREEN_FILE_RE = re.compile(r"SCREEN_(\d+)-([\d.]+)\.screen\.tab\.txt$")

#: ... and the index is the one member that is not a screen file.
INDEX_FILE_RE = re.compile(r"SCREEN_INDEX-([\d.]+)\.index\.tab\.txt$")

#: Columns of a per-screen file, in order. Checked rather than assumed: a
#: release that adds a SCORE.6 would otherwise shift HIT one place left and
#: every hit call would come from a score column.
SCREEN_COLUMNS = (
    "SCREEN_ID", "IDENTIFIER_ID", "IDENTIFIER_TYPE", "OFFICIAL_SYMBOL", "ALIASES",
    "ORGANISM_ID", "ORGANISM_OFFICIAL", "SCORE.1", "SCORE.2", "SCORE.3", "SCORE.4",
    "SCORE.5", "HIT", "SOURCE",
)

#: A screen must measure at least this many genes to be usable as a
#: genome-wide background for hit-frequency statistics. Our own threshold,
#: chosen because it separates the two clear modes of the SCORES_SIZE
#: distribution: sub-pool and focused libraries sit in the hundreds, whole
#: genome deposits at 17k-20k. 1,413 of the 1,952 human screens clear it.
MIN_BACKGROUND_GENES = 5_000

#: BioGRID's LIBRARY_TYPE to the public.modality enum used by the database.
#: The four values present in the human release are CRISPRn (1,823 screens),
#: CRISPRa (75), CRISPRi (48) and a base-editing knockout (6). The right hand
#: side is exactly the public.modality enum from
#: supabase/migrations/20260926000200_schemas_types_helpers.sql, so an insert
#: cannot fail on a value this module invented.
MODALITY_BY_LIBRARY_TYPE = {
    "CRISPRn": "knockout",
    "CRISPRi": "crispri",
    "CRISPRa": "crispra",
    "Cytosine Base Editing-Mediated Gene KnockOut": "base_edit",
}

#: LIBRARY_TYPE values whose libraries target transcription start sites, so a
#: gene legitimately appears once per annotated TSS. Used only to explain a
#: duplicate group, never to decide whether to collapse it: 1,463 screens
#: have duplicates and only 123 are CRISPRi/a, so the effect is not confined
#: to them.
TSS_LIBRARY_TYPES = frozenset({"CRISPRi", "CRISPRa"})


class OrcsFormatError(RuntimeError):
    """The file is not in the ORCS format this module was written against."""


# ---------------------------------------------------------------------------
# Small typed readers. "-" is the null in every column.
# ---------------------------------------------------------------------------

def _text(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip()
    return None if not v or v == NULL else v


def _number(value: str | None) -> float | None:
    """
    A SCORE column, or None.

    Never returns 0.0 for an unparseable cell. A score of zero is a
    measurement and several ORCS analyses (log10 corrected p-value, CERES,
    L2FC) can legitimately produce one, so manufacturing zeros here would
    put fabricated measurements into the Atlas.
    """
    v = _text(value)
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        # Seen in the wild: "NA", "Inf", "1.2e-5 " with stray whitespace, and
        # thousands separators. Inf parses, the rest does not and stays None.
        return None


def _integer(value: str | None) -> int | None:
    n = _number(value)
    return int(n) if n is not None else None


def _boolean(value: str | None) -> bool | None:
    """Yes/No columns. Anything else is unknown, not False."""
    v = _text(value)
    if v is None:
        return None
    low = v.lower()
    if low in ("yes", "y", "true", "1"):
        return True
    if low in ("no", "n", "false", "0"):
        return False
    return None


_YEAR_RE = re.compile(r"\((\d{4})\)")


def _year(author: str | None) -> int | None:
    """AUTHOR is formatted "Wang T (2014)", which is the only year in the index."""
    if not author:
        return None
    m = _YEAR_RE.search(author)
    return int(m.group(1)) if m else None


_NON_ALNUM = re.compile(r"[^A-Z0-9]")


def normalise_cell_line(name: str | None) -> str | None:
    """
    A cell-line name reduced to a joinable key.

    BioGRID uses Cellosaurus punctuation ("K-562", "HAP-1", "hTERT-RPE1")
    while a lab uploading a screen types "K562" or "RPE1". Matching on the
    raw strings finds nothing, which is how the Atlas would end up reporting
    zero comparable screens for the most screened cell line in the release.
    Dropping every non-alphanumeric character and upper-casing collapses both
    conventions onto one key. It does not resolve genuine synonyms
    (hTERT-RPE1 vs RPE-1 hTERT), which is what atlas.cell_models aliases are
    for once a screen is in the database.
    """
    if not name:
        return None
    key = _NON_ALNUM.sub("", name.upper())
    return key or None


# ---------------------------------------------------------------------------
# The screen index
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class OrcsScreen:
    """One row of the ORCS screen index: everything known about a screen."""

    screen_id: int
    source_id: str | None = None          # a PubMed id for SOURCE_TYPE pubmed
    source_type: str | None = None
    author: str | None = None
    screen_name: str | None = None
    scores_size: int | None = None         # gene rows in the per-screen file
    full_size: int | None = None
    full_size_available: bool | None = None
    number_of_hits: int | None = None
    analysis: str | None = None            # MaGeCK, CERES, BAGEL, ...
    significance_indicator: str | None = None
    significance_criteria: str | None = None
    throughput: str | None = None
    screen_type: str | None = None         # Negative Selection, Positive, ...
    screen_format: str | None = None       # Pool, Array, in vivo
    experimental_setup: str | None = None  # Timecourse, Drug Exposure, ...
    duration: str | None = None
    condition_name: str | None = None
    condition_dosage: str | None = None
    moi: str | None = None
    library: str | None = None
    library_type: str | None = None        # CRISPRn / CRISPRi / CRISPRa / base editing
    library_methodology: str | None = None
    enzyme: str | None = None
    cell_line: str | None = None
    cell_type: str | None = None
    phenotype: str | None = None           # one of 27 controlled terms
    score_col_count: int | None = None
    score_types: tuple[str | None, ...] = ()   # what SCORE.1..5 actually measure
    organism_id: int | None = None
    organism_official: str | None = None
    notes: str | None = None
    source: str | None = None
    screen_rationale: str | None = None
    release: str = RELEASE

    # --- derived ----------------------------------------------------------

    @property
    def pmid(self) -> str | None:
        return self.source_id if (self.source_type or "").lower() == "pubmed" else None

    @property
    def year(self) -> int | None:
        return _year(self.author)

    @property
    def modality(self) -> str | None:
        """The public.modality value, or None when LIBRARY_TYPE is unrecognised."""
        return MODALITY_BY_LIBRARY_TYPE.get(self.library_type or "")

    @property
    def cell_line_key(self) -> str | None:
        return normalise_cell_line(self.cell_line)

    @property
    def is_hit_list_only(self) -> bool:
        """
        The deposit contains only the called genes, not the whole library.

        Detected as SCORES_SIZE == NUMBER_OF_HITS, which holds for 141 human
        screens: the 135 whose SIGNIFICANCE_INDICATOR is "All Significant"
        plus 6 more that declare a criteria string but still deposited only
        hits. A screen like this cannot contribute a denominator to a hit
        rate. Zero-hit screens are excluded from the test because 0 == 0 is
        not evidence of a hit-list deposit.
        """
        if not self.scores_size or not self.number_of_hits:
            return False
        return self.scores_size == self.number_of_hits

    @property
    def usable_background(self) -> bool:
        """Big enough, and a real library rather than a hit list, to be a background."""
        return (
            self.scores_size is not None
            and self.scores_size >= MIN_BACKGROUND_GENES
            and not self.is_hit_list_only
        )

    @property
    def targets_tss(self) -> bool:
        return (self.library_type or "") in TSS_LIBRARY_TYPES

    def describe(self) -> str:
        bits = [f"ORCS {self.screen_id}"]
        if self.cell_line:
            bits.append(self.cell_line)
        if self.library_type:
            bits.append(self.library_type)
        if self.condition_name:
            bits.append(self.condition_name)
        if self.phenotype:
            bits.append(self.phenotype)
        if self.author:
            bits.append(self.author)
        return ", ".join(bits)

    def as_row(self) -> dict:
        """Flat dict for parquet or a database insert. Derived fields included."""
        return {
            "screen_id": self.screen_id,
            "release": self.release,
            "source_id": self.source_id,
            "source_type": self.source_type,
            "pmid": self.pmid,
            "author": self.author,
            "year": self.year,
            "screen_name": self.screen_name,
            "scores_size": self.scores_size,
            "full_size": self.full_size,
            "full_size_available": self.full_size_available,
            "number_of_hits": self.number_of_hits,
            "analysis": self.analysis,
            "significance_indicator": self.significance_indicator,
            "significance_criteria": self.significance_criteria,
            "throughput": self.throughput,
            "screen_type": self.screen_type,
            "screen_format": self.screen_format,
            "experimental_setup": self.experimental_setup,
            "duration": self.duration,
            "condition_name": self.condition_name,
            "condition_dosage": self.condition_dosage,
            "moi": self.moi,
            "library": self.library,
            "library_type": self.library_type,
            "library_methodology": self.library_methodology,
            "modality": self.modality,
            "enzyme": self.enzyme,
            "cell_line": self.cell_line,
            "cell_line_key": self.cell_line_key,
            "cell_type": self.cell_type,
            "phenotype": self.phenotype,
            "score_col_count": self.score_col_count,
            "score_1_type": self.score_types[0] if len(self.score_types) > 0 else None,
            "score_2_type": self.score_types[1] if len(self.score_types) > 1 else None,
            "score_3_type": self.score_types[2] if len(self.score_types) > 2 else None,
            "score_4_type": self.score_types[3] if len(self.score_types) > 3 else None,
            "score_5_type": self.score_types[4] if len(self.score_types) > 4 else None,
            "organism_id": self.organism_id,
            "organism_official": self.organism_official,
            "notes": self.notes,
            "source": self.source,
            "screen_rationale": self.screen_rationale,
            "is_hit_list_only": self.is_hit_list_only,
            "usable_background": self.usable_background,
            "targets_tss": self.targets_tss,
        }


def parse_index_row(row: dict[str, str]) -> OrcsScreen:
    """One index row to an OrcsScreen. The leading column is "#SCREEN_ID"."""
    sid = _integer(row.get("SCREEN_ID") or row.get("#SCREEN_ID"))
    if sid is None:
        raise OrcsFormatError(f"index row has no SCREEN_ID: {list(row)[:4]}")
    return OrcsScreen(
        screen_id=sid,
        source_id=_text(row.get("SOURCE_ID")),
        source_type=_text(row.get("SOURCE_TYPE")),
        author=_text(row.get("AUTHOR")),
        screen_name=_text(row.get("SCREEN_NAME")),
        scores_size=_integer(row.get("SCORES_SIZE")),
        full_size=_integer(row.get("FULL_SIZE")),
        full_size_available=_boolean(row.get("FULL_SIZE_AVAILABLE")),
        number_of_hits=_integer(row.get("NUMBER_OF_HITS")),
        analysis=_text(row.get("ANALYSIS")),
        significance_indicator=_text(row.get("SIGNIFICANCE_INDICATOR")),
        significance_criteria=_text(row.get("SIGNIFICANCE_CRITERIA")),
        throughput=_text(row.get("THROUGHPUT")),
        screen_type=_text(row.get("SCREEN_TYPE")),
        screen_format=_text(row.get("SCREEN_FORMAT")),
        experimental_setup=_text(row.get("EXPERIMENTAL_SETUP")),
        duration=_text(row.get("DURATION")),
        condition_name=_text(row.get("CONDITION_NAME")),
        condition_dosage=_text(row.get("CONDITION_DOSAGE")),
        moi=_text(row.get("MOI")),
        library=_text(row.get("LIBRARY")),
        library_type=_text(row.get("LIBRARY_TYPE")),
        library_methodology=_text(row.get("LIBRARY_METHODOLOGY")),
        enzyme=_text(row.get("ENZYME")),
        cell_line=_text(row.get("CELL_LINE")),
        cell_type=_text(row.get("CELL_TYPE")),
        phenotype=_text(row.get("PHENOTYPE")),
        score_col_count=_integer(row.get("SCORE_COL_COUNT")),
        score_types=tuple(_text(row.get(f"SCORE.{i}_TYPE")) for i in range(1, 6)),
        organism_id=_integer(row.get("ORGANISM_ID")),
        organism_official=_text(row.get("ORGANISM_OFFICIAL")),
        notes=_text(row.get("NOTES")),
        source=_text(row.get("SOURCE")),
        screen_rationale=_text(row.get("SCREEN_RATIONALE")),
    )


def read_index(path: Path | str | None = None, species: str = "human") -> dict[int, OrcsScreen]:
    """
    The screen index, keyed by screen id.

    Reads the extracted copy under data/references/orcs/index/ by default,
    which is why nothing downstream has to decompress 752 MB to read 1.3 MB
    of annotation.
    """
    p = Path(path) if path else (ORCS_DIR / "index" / f"{species}.index.tab.txt")
    if not p.exists():
        raise FileNotFoundError(
            f"{p} missing. Extract it from the archive: "
            f"tar -xzf orcs-{species}.tar.gz -O BIOGRID-ORCS-SCREEN_INDEX-{RELEASE}"
            f".index.tab.txt > {p}"
        )
    with p.open(newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        if reader.fieldnames:
            # DictReader keeps the '#' from '#SCREEN_ID'. Strip it once here
            # so parse_index_row does not have to know about it.
            reader.fieldnames = [f.lstrip("#") for f in reader.fieldnames]
        out: dict[int, OrcsScreen] = {}
        for row in reader:
            screen = parse_index_row(row)
            out[screen.screen_id] = screen
    if not out:
        raise OrcsFormatError(f"{p} parsed to zero screens")
    return out


# ---------------------------------------------------------------------------
# Per-screen gene rows
# ---------------------------------------------------------------------------

@dataclass
class OrcsGene:
    """
    One gene in one screen, after duplicate rows have been collapsed.

    n_rows is how many file rows produced this gene. Above 1 means the
    library measured the gene more than once, which for a TSS-targeting
    library is expected. disagreed records that those rows did not agree on
    HIT, which matters because a reader of is_hit is entitled to know the
    call was not unanimous in the source.
    """

    screen_id: int
    symbol: str
    identifier_id: str | None = None
    identifier_type: str | None = None
    aliases: tuple[str, ...] = ()
    is_hit: bool = False
    scores: tuple[float | None, ...] = ()
    n_rows: int = 1
    disagreed: bool = False

    @property
    def score1(self) -> float | None:
        return self.scores[0] if self.scores else None

    @property
    def entrez_id(self) -> int | None:
        """
        The Entrez id, or None.

        Only ENTREZ_GENE rows carry one. UNKNOWN rows hold a synthetic "48U"
        and AMBIGUOUS rows a "12A", unique within one screen file and
        meaningless across files, so returning them as an Entrez id would
        create cross-screen collisions between unrelated genes.
        """
        if self.identifier_type != "ENTREZ_GENE" or not self.identifier_id:
            return None
        try:
            return int(self.identifier_id)
        except ValueError:
            return None


@dataclass
class ScreenTable:
    """A parsed per-screen file, plus what the parse had to deal with."""

    screen_id: int
    genes: list[OrcsGene] = field(default_factory=list)
    n_raw_rows: int = 0
    n_dropped_no_symbol: int = 0
    n_dropped_short_row: int = 0
    n_duplicate_groups: int = 0
    n_duplicate_rows: int = 0
    n_disagreeing_groups: int = 0
    identifier_types: dict[str, int] = field(default_factory=dict)
    organism_ids: set[int] = field(default_factory=set)

    @property
    def n_genes(self) -> int:
        return len(self.genes)

    @property
    def n_hits(self) -> int:
        return sum(1 for g in self.genes if g.is_hit)

    def summary(self) -> str:
        bits = [f"screen {self.screen_id}: {self.n_genes:,} genes, {self.n_hits:,} hits",
                f"from {self.n_raw_rows:,} rows"]
        if self.n_duplicate_groups:
            bits.append(f"{self.n_duplicate_groups:,} symbols appeared more than once "
                        f"({self.n_duplicate_rows:,} rows, "
                        f"{self.n_disagreeing_groups:,} disagreeing on HIT)")
        if self.n_dropped_no_symbol:
            bits.append(f"{self.n_dropped_no_symbol:,} rows had no symbol")
        if self.n_dropped_short_row:
            bits.append(f"{self.n_dropped_short_row:,} rows were short of columns")
        return "; ".join(bits)


def collapse_rows(rows: list[OrcsGene]) -> OrcsGene:
    """
    Collapse several rows for one (screen, symbol) into one gene.

    The rule, and why:

    * is_hit is the OR over the rows. HIT is the original authors' own call,
      and for a TSS-level library a gene whose strongest TSS passed the
      authors' threshold is a gene the authors called. Taking the AND would
      silently unfind hits that are in the paper; taking a majority would
      depend on how many TSSs happen to be annotated.
    * The representative row, which supplies the scores and the identifier,
      is a hit row when there is one, and among the candidates the row with
      the largest |SCORE.1|. Direction cannot be used because SCORE.1 means
      something different in every screen (SCORE.1_TYPE in the index spans
      log10 corrected p-value, CERES score, Bayes factor, L2FC), so
      magnitude is the only cross-screen-safe tiebreak. Ties break on the
      identifier so the result does not depend on file order.
    * disagreed is set when the rows did not all agree on HIT. 6,522 groups
      in the human release are like this.

    Nothing is averaged. Averaging scores whose units differ per screen, and
    which within one screen belong to different TSSs, would produce a number
    that is not a measurement of anything.
    """
    if len(rows) == 1:
        return rows[0]

    hit_rows = [r for r in rows if r.is_hit]
    candidates = hit_rows or rows

    def rank(r: OrcsGene) -> tuple[float, str]:
        s = r.score1
        # None sorts last: a row with no score is never preferred over one
        # that has a measurement.
        return (-abs(s) if s is not None else float("inf"), r.identifier_id or "")

    best = sorted(candidates, key=rank)[0]
    return OrcsGene(
        screen_id=best.screen_id,
        symbol=best.symbol,
        identifier_id=best.identifier_id,
        identifier_type=best.identifier_type,
        aliases=best.aliases,
        is_hit=bool(hit_rows),
        scores=best.scores,
        n_rows=len(rows),
        disagreed=bool(hit_rows) and len(hit_rows) != len(rows),
    )


def parse_screen_text(text: str, screen_id: int | None = None) -> ScreenTable:
    """
    Parse one per-screen file.

    Takes text rather than a path because the normal source is a member of a
    752 MB tarball that is read as a stream and never lands on disk.
    """
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    # Find the header. Leading blank lines have been seen in hand-edited
    # copies of these files, and an off-by-one header turns every column into
    # the wrong column.
    header_idx = next((i for i, l in enumerate(lines) if l.strip()), None)
    if header_idx is None:
        raise OrcsFormatError(f"screen {screen_id}: file is empty")

    columns = [c.strip().lstrip("#") for c in lines[header_idx].split("\t")]
    index = {c: i for i, c in enumerate(columns)}
    missing = [c for c in SCREEN_COLUMNS if c not in index]
    if missing:
        raise OrcsFormatError(
            f"screen {screen_id}: expected ORCS {RELEASE} columns, missing {missing}. "
            f"Got {columns}"
        )

    i_sid = index["SCREEN_ID"]
    i_ident, i_itype = index["IDENTIFIER_ID"], index["IDENTIFIER_TYPE"]
    i_sym, i_alias = index["OFFICIAL_SYMBOL"], index["ALIASES"]
    i_org = index["ORGANISM_ID"]
    i_scores = [index[f"SCORE.{n}"] for n in range(1, 6)]
    i_hit = index["HIT"]
    widest = max([i_hit, i_org, i_alias] + i_scores)

    table = ScreenTable(screen_id=screen_id if screen_id is not None else -1)
    groups: dict[str, list[OrcsGene]] = {}
    order: list[str] = []

    for line in lines[header_idx + 1:]:
        if not line.strip():
            continue
        f = line.split("\t")
        table.n_raw_rows += 1
        if len(f) <= widest:
            # A row short of columns would otherwise read HIT out of a score
            # column, or IndexError. Count it rather than guessing.
            table.n_dropped_short_row += 1
            continue

        symbol = _text(f[i_sym])
        if symbol is None:
            table.n_dropped_no_symbol += 1
            continue

        itype = _text(f[i_itype])
        table.identifier_types[itype or "MISSING"] = \
            table.identifier_types.get(itype or "MISSING", 0) + 1
        org = _integer(f[i_org])
        if org is not None:
            table.organism_ids.add(org)

        row_sid = _integer(f[i_sid])
        aliases = _text(f[i_alias])
        gene = OrcsGene(
            screen_id=row_sid if row_sid is not None else table.screen_id,
            symbol=symbol,
            identifier_id=_text(f[i_ident]),
            identifier_type=itype,
            aliases=tuple(a for a in (aliases.split("|") if aliases else []) if a),
            is_hit=(_text(f[i_hit]) or "").upper() == "YES",
            scores=tuple(_number(f[i]) for i in i_scores),
        )
        if symbol not in groups:
            groups[symbol] = []
            order.append(symbol)
        groups[symbol].append(gene)

    if table.screen_id == -1:
        # Recover the id from the rows when the caller did not supply it.
        for sym in order:
            table.screen_id = groups[sym][0].screen_id
            break

    for sym in order:
        rows = groups[sym]
        if len(rows) > 1:
            table.n_duplicate_groups += 1
            table.n_duplicate_rows += len(rows)
        merged = collapse_rows(rows)
        if merged.disagreed:
            table.n_disagreeing_groups += 1
        table.genes.append(merged)

    return table


def parse_screen_file(path: Path | str) -> ScreenTable:
    """Parse a per-screen file that has already been extracted to disk."""
    p = Path(path)
    m = SCREEN_FILE_RE.search(p.name)
    sid = int(m.group(1)) if m else None
    return parse_screen_text(p.read_text(encoding="utf-8", errors="replace"), sid)


# ---------------------------------------------------------------------------
# The archive
# ---------------------------------------------------------------------------

def archive_path(species: str = "human") -> Path:
    return ORCS_DIR / f"orcs-{species}.tar.gz"


def extract_index(archive: Path | str, out: Path | str | None = None) -> Path:
    """
    Pull the screen index out of an archive and write it beside it.

    Reads the tarball as a stream and stops at the index member, so this
    costs a few seconds rather than the minutes a full decompression takes.
    """
    arc = Path(archive)
    dest = Path(out) if out else (arc.parent / "index" / f"{arc.stem.split('.')[0]}.index.tab.txt")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(arc, "r|gz") as tf:
        for member in tf:
            if not member.isfile() or not INDEX_FILE_RE.search(member.name):
                continue
            src = tf.extractfile(member)
            if src is None:
                continue
            dest.write_bytes(src.read())
            return dest
    raise OrcsFormatError(f"{arc} contains no SCREEN_INDEX member")


def iter_archive(
    archive: Path | str,
    screen_ids: Iterable[int] | None = None,
    skip_ids: Iterable[int] | None = None,
) -> Iterator[tuple[int, str]]:
    """
    Yield (screen_id, file text) for every screen file in an archive.

    Opened in streaming mode ("r|gz"), which is the difference between one
    sequential decompression and one per member: tarfile's seekable "r:gz"
    mode re-reads the gzip stream from the start for each random access, and
    on a 752 MB archive with 1,952 members that is the gap between minutes
    and hours. The cost is that members arrive in archive order and cannot be
    revisited, so a caller wanting a specific screen still pays for the whole
    stream up to it.

    screen_ids restricts what is yielded; skip_ids removes ids from it. Both
    are applied before the member is decompressed, so filtering is cheap.
    The release in each filename is checked against RELEASE and a mismatch
    raises, because a silent release change is how column drift gets in.
    """
    wanted = frozenset(int(i) for i in screen_ids) if screen_ids is not None else None
    unwanted = frozenset(int(i) for i in skip_ids) if skip_ids is not None else frozenset()
    seen_release: str | None = None

    with tarfile.open(Path(archive), "r|gz") as tf:
        for member in tf:
            if not member.isfile():
                continue
            m = SCREEN_FILE_RE.search(member.name)
            if not m:
                continue                      # the index member, handled separately
            sid, release = int(m.group(1)), m.group(2)
            if seen_release is None:
                seen_release = release
                if release != RELEASE:
                    raise OrcsFormatError(
                        f"{archive} is ORCS release {release}, these parsers were "
                        f"written against {RELEASE}. Check the column layout before "
                        f"ingesting: a new SCORE column shifts HIT."
                    )
            if sid in unwanted or (wanted is not None and sid not in wanted):
                continue
            src = tf.extractfile(member)
            if src is None:
                continue
            yield sid, src.read().decode("utf-8", errors="replace")


def iter_archive_tables(
    archive: Path | str,
    screen_ids: Iterable[int] | None = None,
    skip_ids: Iterable[int] | None = None,
) -> Iterator[ScreenTable]:
    """iter_archive, parsed."""
    for sid, text in iter_archive(archive, screen_ids, skip_ids):
        yield parse_screen_text(text, sid)


def read_one_screen(screen_id: int, archive: Path | str | None = None) -> ScreenTable:
    """
    One screen out of the archive.

    Convenient but not cheap: the stream has to run to that member. Use
    iter_archive_tables when you want more than a couple.
    """
    arc = Path(archive) if archive else archive_path()
    for table in iter_archive_tables(arc, screen_ids=[screen_id]):
        return table
    raise KeyError(f"screen {screen_id} is not in {arc}")

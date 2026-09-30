"""
Learn a guide library SplicR does not hold, from the paper's own supplementary files.

THE BOTTLENECK THIS REMOVES

`runner._probe_reads` streams a run's first 200k reads and fingerprints them
against every library in `data/references/libraries`. When nothing matches, the
study stops: no library means no count matrix, and a screen using a custom
library - which is most of the interesting ones - is filed for review and never
analysed. SplicR holds 13 libraries. The literature has hundreds.

But the library is almost always published. It is Supplementary Table S1 of the
paper, or a file sitting in the GEO series' own supplementary directory. This
module goes and gets it.

THE LLM PROPOSES, THE READS DISPOSE

An LLM reading spreadsheets to decide what a column means is exactly the kind
of component that fails silently and confidently. So it is never trusted, and
it is not on the critical path:

  finding the table      deterministic. A column of 19-21 nt ACGT strings that
                         are mostly distinct is a guide column; nothing else in
                         a supplementary workbook looks like that. Regex beats a
                         language model here on cost, latency and reliability.

  naming the gene column deterministic first (header match, then "the column
                         whose values repeat in groups of 4-10 alongside
                         distinct guides"), LLM only when that is ambiguous.

  choosing among files   LLM helps most here. A series may have 40 supplementary
                         files and the library may be "Table_S3.xlsx" sheet 2.
                         A deterministic scan tries them all, which is fine but
                         slow; the LLM reorders the queue.

  ACCEPTING THE RESULT   never the LLM. An extracted library is registered only
                         if it explains the actual sequencing reads better than
                         anything SplicR already holds, measured by the same
                         `detect.rank_libraries` used everywhere else. That is a
                         gate nothing can talk its way past: a hallucinated
                         column yields sequences that match no read, and a
                         match rate near zero.

So the worst case for a wrong LLM answer is a wasted download, never a wrong
library in the database. And with no LLM configured at all the deterministic
path runs alone and still works; `extract()` reports which path found it.

WHAT IS DELIBERATELY NOT DONE

No attempt to reconstruct a library from the reads themselves. Assembling
consensus spacers from a FASTQ is possible and produces a plausible-looking
library with no gene assignments, which is worse than useless: it would let a
screen through with guides labelled by nothing. If the library is not published,
the study goes to review as it does now.
"""

from __future__ import annotations

import io
import json
import os
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from ..references import Guide, Library, looks_like_control

#: A spacer is 19-21 nt of unambiguous DNA. Cas12a libraries use 20-23; the
#: upper bound is loose because a table sometimes stores the spacer with its
#: cloning overhang, which `_trim_overhang` strips.
GUIDE_RE = re.compile(r"^[ACGTacgt]{19,25}$")
#: Cloning adapters seen prepended to spacers in published tables. Stripped
#: only when doing so leaves a canonical-length spacer for most of the column.
OVERHANGS = ("CACCG", "CACC", "ACCG", "TTGTGGAAAGGACGAAACACCG")

GEO_SUPPL = "https://ftp.ncbi.nlm.nih.gov/geo/series/{stub}/{acc}/suppl/"
PMC_OA = "https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id={pmcid}"

TABLE_SUFFIXES = (".csv", ".tsv", ".txt", ".xlsx", ".xls", ".zip", ".gz")
#: A supplementary file bigger than this is not a guide table; genome-wide
#: libraries are ~10 MB as text and ~5 MB as xlsx.
MAX_FILE_BYTES = 200 * 1024 * 1024


@dataclass
class ColumnChoice:
    """Which columns were taken as the guide and the gene, and who decided."""

    guide_column: str
    gene_column: str | None
    #: "deterministic" or "llm". Recorded per library so a reader can tell
    #: which extractions leaned on a model.
    decided_by: str = "deterministic"
    confidence: float = 1.0
    note: str = ""


@dataclass
class Candidate:
    """One table found inside one supplementary file."""

    url: str
    member: str                 # file name inside a zip, or sheet name, or ""
    n_rows: int
    columns: ColumnChoice
    guides: list[Guide] = field(default_factory=list)
    #: Rows dropped because their spacer already appeared. Real libraries have
    #: these - GeCKOv2 Set A lists 1,433 spacers twice, mostly under two
    #: aliases of one gene - so it is counted rather than treated as an error.
    duplicate_rows: int = 0
    #: Of those, how many carried a *different* gene label, where keeping the
    #: first row silently discards the second. Surfaced because a high number
    #: means the table is not one guide per row and should be looked at.
    conflicting_duplicates: int = 0

    @property
    def describe(self) -> str:
        where = f"{Path(self.url).name}" + (f" [{self.member}]" if self.member else "")
        return (f"{where}: {len(self.guides):,} guides from column "
                f"{self.columns.guide_column!r}"
                + (f", genes from {self.columns.gene_column!r}" if self.columns.gene_column
                   else ", NO GENE COLUMN"))


@dataclass
class Extraction:
    """The outcome, including the failures, because those are what get fixed."""

    accession: str
    accepted: Candidate | None = None
    #: Read match rate the accepted library achieved, from `detect`.
    match_rate: float = 0.0
    coverage: float = 0.0
    #: Every candidate considered and why it lost. A study that fails here is
    #: triaged from this list, so it holds the near misses too.
    rejected: list[tuple[str, str]] = field(default_factory=list)
    files_seen: int = 0
    used_llm: bool = False
    note: str = ""

    @property
    def ok(self) -> bool:
        return self.accepted is not None


# --- finding the files -----------------------------------------------------

def geo_supplementary_urls(accession: str, timeout: float = 30.0) -> list[str]:
    """
    Files in a GEO series' own supplementary directory.

    GEO puts the series accession in a bucket named by blanking its last three
    digits: GSE145743 lives under GSE145nnn. There is no API for the listing,
    so the directory index is parsed.
    """
    import urllib.request

    acc = accession.strip().upper()
    if not acc.startswith("GSE"):
        return []
    stub = acc[:-3] + "nnn" if len(acc) > 6 else acc
    base = GEO_SUPPL.format(stub=stub, acc=acc)
    try:
        with urllib.request.urlopen(base, timeout=timeout) as r:
            html = r.read().decode("utf-8", "replace")
    except Exception:  # noqa: BLE001 - a series with no supplement 404s here
        return []
    names = re.findall(r'href="([^"?/][^"]*)"', html)
    return [base + n for n in names if n.lower().endswith(TABLE_SUFFIXES)]


def pmc_supplementary_urls(pmcid: str, timeout: float = 30.0) -> list[str]:
    """
    Supplementary files for a paper, via PMC's Open Access service.

    Only works for open-access deposits. A paywalled paper's supplement is not
    reachable and the study falls back to whatever GEO carries, which is the
    common case anyway: authors deposit the library with the data more often
    than they leave it only in the PDF.
    """
    import urllib.request
    import xml.etree.ElementTree as ET

    if not pmcid:
        return []
    pmcid = pmcid if pmcid.upper().startswith("PMC") else f"PMC{pmcid}"
    try:
        with urllib.request.urlopen(PMC_OA.format(pmcid=pmcid), timeout=timeout) as r:
            root = ET.fromstring(r.read())
    except Exception:  # noqa: BLE001
        return []
    urls = []
    for link in root.iter("link"):
        href = link.get("href") or ""
        if href.startswith("ftp://"):
            href = "https://" + href[len("ftp://"):]
        if href:
            urls.append(href)
    return urls


# --- reading whatever was found --------------------------------------------

def _trim_overhang(values: list[str]) -> tuple[list[str], str]:
    """
    Strip a cloning adapter if one is on nearly every sequence.

    Published tables often give the oligo as ordered, not the spacer. Removing
    a constant 4-5 nt prefix is the difference between a library that matches
    reads and one that matches nothing, but removing it when it is genuinely
    part of the spacer corrupts the library. So it is stripped only when the
    prefix is on >90% of rows and stripping leaves 19-21 nt.
    """
    for oh in sorted(OVERHANGS, key=len, reverse=True):
        hit = [v for v in values if v.upper().startswith(oh)]
        if len(hit) < 0.9 * len(values):
            continue
        trimmed = [v[len(oh):] if v.upper().startswith(oh) else v for v in values]
        lengths = {len(t) for t in trimmed}
        if lengths and max(lengths) <= 21 and min(lengths) >= 19:
            return trimmed, oh
    return values, ""


def _col_values(df, i: int) -> list[str]:
    """
    The i-th column's non-empty values, addressed by position.

    Labels cannot be used: a supplementary table with two blank header cells
    produces two identically-named columns, and `df[name]` then returns a
    DataFrame rather than a Series. Blank header cells are common enough that
    this is a normal input, not a corrupt one.
    """
    col = df.iloc[:, i]
    return [t for t in (str(v).strip() for v in col.tolist())
            if t and t.lower() != "nan"]


def find_guide_column_idx(df) -> tuple[int | None, str, float]:
    """
    The column of spacers, by what the values are rather than what they are called.

    Returns (column, overhang_stripped, fraction_of_rows_that_look_like_guides).
    Scored on: values match the spacer pattern, they are mostly distinct, and
    their lengths agree. A gene-name column fails the pattern; a barcode column
    fails on length agreement or on being wholly distinct at the wrong length.
    """
    best, best_score, best_oh = None, 0.0, ""
    for i in range(df.shape[1]):
        values = _col_values(df, i)
        if len(values) < 50:
            continue
        values, oh = _trim_overhang(values)
        hits = [v for v in values if GUIDE_RE.match(v)]
        frac = len(hits) / len(values)
        if frac < 0.9:
            continue
        lengths = {}
        for v in hits:
            lengths[len(v)] = lengths.get(len(v), 0) + 1
        dominant = max(lengths.values()) / len(hits)
        distinct = len(set(hits)) / len(hits)
        # A real library is one length and nearly all distinct sequences.
        score = frac * dominant * distinct
        if score > best_score:
            best, best_score, best_oh = i, score, oh
    return best, best_oh, best_score


def find_guide_column(df) -> tuple[object | None, str, float]:
    """`find_guide_column_idx`, reported by column label for readability."""
    i, oh, score = find_guide_column_idx(df)
    return (None if i is None else df.columns[i]), oh, score


def find_gene_column_idx(df, guide_idx: int | None) -> tuple[int | None, float, str]:
    """
    The column naming each guide's target.

    Header match first, because published tables overwhelmingly use one of a
    dozen names. Failing that, the shape of the data: a gene column repeats
    each value a handful of times (one per guide targeting that gene) while the
    guide column does not repeat at all.
    """
    named = ("gene", "gene symbol", "gene_symbol", "target gene", "target_gene",
             "target gene symbol", "symbol", "annotated gene symbol", "gene name",
             "gene_name", "target", "targetgene", "hgnc", "gene id", "geneid")
    for i, col in enumerate(df.columns):
        if i != guide_idx and str(col).strip().lower() in named:
            return i, 1.0, "header"

    n = len(df)
    best, best_score = None, 0.0
    for i in range(df.shape[1]):
        if i == guide_idx:
            continue
        values = _col_values(df, i)
        if len(values) < 0.5 * n:
            continue
        uniq = len(set(values))
        if uniq < 100 or uniq > 0.8 * len(values):
            continue        # too few distinct to be genes, or too many to repeat
        per = len(values) / uniq
        if not 1.5 <= per <= 15:
            continue        # libraries carry roughly 2-12 guides per gene
        # Gene symbols are short alphanumeric tokens, not sentences or numbers.
        looks = sum(1 for v in values[:500] if re.match(r"^[A-Za-z][A-Za-z0-9._-]{1,19}$", v))
        score = (looks / min(500, len(values))) * min(1.0, per / 6)
        if score > best_score:
            best, best_score = i, score
    return best, best_score, "shape"


def find_gene_column(df, guide_col) -> tuple[object | None, float, str]:
    """`find_gene_column_idx`, taking and reporting column labels."""
    cols = list(df.columns)
    guide_idx = cols.index(guide_col) if guide_col in cols else None
    i, score, how = find_gene_column_idx(df, guide_idx)
    return (None if i is None else df.columns[i]), score, how


def tables_from_bytes(name: str, blob: bytes):
    """Yield (member, DataFrame) for every table inside one downloaded file."""
    import pandas as pd

    low = name.lower()
    try:
        if low.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                for member in z.namelist():
                    if member.lower().endswith(TABLE_SUFFIXES) and not member.endswith("/"):
                        with z.open(member) as fh:
                            yield from ((f"{member}:{m}" if m else member, d)
                                        for m, d in tables_from_bytes(member, fh.read()))
            return
        if low.endswith(".gz"):
            import gzip
            yield from tables_from_bytes(low[:-3], gzip.decompress(blob))
            return
        if low.endswith((".xlsx", ".xls")):
            book = pd.read_excel(io.BytesIO(blob), sheet_name=None, dtype=str)
            for sheet, df in book.items():
                yield sheet, _promote_header(df)
            return
        text = blob.decode("utf-8", "replace")
        sep = "\t" if text[:4096].count("\t") > text[:4096].count(",") else ","
        yield "", _promote_header(pd.read_csv(io.StringIO(text), sep=sep, dtype=str,
                                              on_bad_lines="skip", low_memory=False))
    except Exception:  # noqa: BLE001 - an unreadable supplement is a skip, not a failure
        return


def _looks_like_a_header(name) -> bool:
    """
    Is this column label something an author wrote, or a placeholder?

    pandas gives an integer label when a file has no header row at all, and
    "Unnamed: N" when a header row exists but that cell was blank. The first
    means a header row may be hiding in the data; the second means there is
    genuinely no name for that column and nothing to promote.
    """
    text = str(name).strip()
    if not text or text.lower() == "nan":
        return False
    if text.isdigit():
        return False
    return not re.match(r"^Unnamed:\s*\d+$", text)


def _promote_header(df):
    """
    Published tables often carry a title row or two above the real header.

    Promotion is decided by the column *labels*, not by whether a guide column
    can be found: the spacers are readable either way, and reading them under
    the label `0` loses the gene column, which is matched by name. So a header
    row is looked for only when the current label of the guide column is a
    placeholder, and it is promoted only if it supplies a real name.
    """
    if df is None or df.empty:
        return df
    idx, _oh, score = find_guide_column_idx(df)
    if idx is not None and score > 0.5 and _looks_like_a_header(df.columns[idx]):
        return df
    # Every row in the window is tried and the best kept, rather than the
    # first that qualifies. Promoting the title row also "works" -- the spacers
    # are still there and the title is still a plausible label -- but it leaves
    # the real header sitting in the data as one non-guide value. The true
    # header is the row that maximises the fraction of the column that looks
    # like a spacer, and ties break toward the row closest to the data.
    best = None
    for i in range(min(5, len(df))):
        trial = df.iloc[i + 1:].reset_index(drop=True)
        trial.columns = _unique_labels(df.iloc[i].tolist())
        j, _o, s = find_guide_column_idx(trial)
        if j is None or s <= 0.5 or not _looks_like_a_header(trial.columns[j]):
            continue
        if best is None or (s, i) > best[0]:
            best = ((s, i), trial)
    return best[1] if best else df


def _unique_labels(values) -> list[str]:
    """Blank header cells repeat; pandas tolerates it but label access does not."""
    out, seen = [], {}
    for n, v in enumerate(values):
        name = str(v).strip()
        if not name or name.lower() == "nan":
            name = f"Unnamed: {n}"
        if name in seen:
            seen[name] += 1
            name = f"{name}.{seen[name]}"
        else:
            seen[name] = 0
        out.append(name)
    return out


def _download(url: str, timeout: float = 120.0) -> bytes | None:
    import urllib.request

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SplicR/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            length = int(r.headers.get("Content-Length") or 0)
            if length > MAX_FILE_BYTES:
                return None
            return r.read(MAX_FILE_BYTES + 1)
    except Exception:  # noqa: BLE001
        return None


def candidate_from_table(url: str, member: str, df) -> Candidate | None:
    """Turn one table into a candidate library, or decide it is not one."""
    guide_idx, overhang, score = find_guide_column_idx(df)
    if guide_idx is None or score < 0.5:
        return None
    gene_idx, gene_score, how = find_gene_column_idx(df, guide_idx)
    guide_col = df.columns[guide_idx]
    gene_col = df.columns[gene_idx] if gene_idx is not None else None

    seqs = [str(v).strip().upper() for v in df.iloc[:, guide_idx].tolist()]
    genes = ([str(v).strip() for v in df.iloc[:, gene_idx].tolist()]
             if gene_idx is not None else [""] * len(seqs))

    guides: list[Guide] = []
    seen: dict[str, str] = {}
    duplicates = conflicting = 0
    stem = Path(url).stem
    for i, seq in enumerate(seqs):
        if overhang and seq.startswith(overhang):
            seq = seq[len(overhang):]
        if not GUIDE_RE.match(seq):
            continue
        gene_label = (genes[i] if i < len(genes) else "").strip()
        if seq in seen:
            # One sequence is one row in a count matrix, so the first wins.
            duplicates += 1
            if gene_label and seen[seq] and gene_label != seen[seq]:
                conflicting += 1
            continue
        seen[seq] = gene_label
        gene = gene_label
        if gene.lower() in ("nan", "none", ""):
            gene = ""
        control = bool(gene) and looks_like_control(gene)
        guides.append(Guide(guide_id=f"{stem}:{i}", sequence=seq,
                            gene=None if (not gene or control) else gene,
                            is_control=control))
    if len(guides) < 500:
        return None     # too small to be a screening library
    return Candidate(url, member, len(df),
                     ColumnChoice(str(guide_col), str(gene_col) if gene_col else None,
                                  "deterministic", min(score, gene_score or score),
                                  f"gene column by {how}"
                                  + (f"; stripped {overhang}" if overhang else "")),
                     guides, duplicate_rows=duplicates, conflicting_duplicates=conflicting)


# --- ordering the queue, optionally with a model ---------------------------

def llm_available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def rank_files(urls: list[str], accession: str, title: str = "") -> tuple[list[str], bool]:
    """
    Order the supplementary files by how likely each is to be the library.

    The deterministic ordering is a filename heuristic and it is usually right:
    a file called `GSE123_sgRNA_library.xlsx` is the library. When a key is
    configured the model reorders the list instead, which helps on the studies
    where the filenames say nothing ("Table_S3.xlsx", "media-1.xlsx"). The
    model only permutes a list it was given; it cannot add a URL, so the worst
    a bad answer costs is that the right file is tried later.
    """
    def score(u: str) -> float:
        n = Path(u).name.lower()
        s = 0.0
        for kw, w in (("sgrna", 5), ("guide", 5), ("library", 4), ("grna", 4),
                      ("spacer", 3), ("oligo", 2), ("crispr", 1), ("table", 1),
                      ("s1", 1), ("supplementary", 0.5)):
            if kw in n:
                s += w
        for kw in ("counts", "readcount", "rpkm", "tpm", "expression", "deseq",
                   "mageck", "results", "hits", "readme", "matrix"):
            if kw in n:
                s -= 3
        if n.endswith((".xlsx", ".xls")):
            s += 1
        return s

    ordered = sorted(urls, key=score, reverse=True)
    if not llm_available() or len(urls) < 3:
        return ordered, False
    picked = _llm_rank(ordered, accession, title)
    # Checked here as well as inside `_llm_rank`, because this is the boundary
    # where the model's answer is consumed: a reordering that drops a file
    # could silently discard the one that was the library.
    if picked and sorted(picked) == sorted(ordered):
        return picked, True
    return ordered, False


def _llm_rank(urls: list[str], accession: str, title: str) -> list[str] | None:
    """Ask a model to reorder the filenames. Returns None on any problem."""
    try:
        import json
        import urllib.request

        prompt = (
            "A CRISPR screening study deposited these supplementary files. Exactly one of "
            "them is most likely to contain the sgRNA library table: the list of guide "
            "spacer sequences and the gene each targets.\n\n"
            f"Study: {accession}\nTitle: {title or 'unknown'}\n\nFiles:\n"
            + "\n".join(f"{i}. {Path(u).name}" for i, u in enumerate(urls))
            + "\n\nReply with only a JSON array of the indices, most likely first. "
              "Include every index exactly once.")
        body = json.dumps({
            "model": "claude-opus-5", "max_tokens": 1000,
            "messages": [{"role": "user", "content": prompt}]}).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages", data=body,
            headers={"content-type": "application/json",
                     "x-api-key": os.environ["ANTHROPIC_API_KEY"],
                     "anthropic-version": "2023-06-01"})
        with urllib.request.urlopen(req, timeout=60) as r:
            text = json.load(r)["content"][0]["text"]
        order = json.loads(re.search(r"\[.*\]", text, re.S).group(0))
        # A permutation of the input, or nothing. This is what stops a model
        # inventing a URL or silently dropping the file that was the answer.
        if sorted(order) != list(range(len(urls))):
            return None
        return [urls[i] for i in order]
    except Exception:  # noqa: BLE001 - the model is an optimisation, never a requirement
        return None


# --- the gate --------------------------------------------------------------

def verify(candidate: Candidate, read_sequences: set[str],
           incumbent_rate: float = 0.0) -> tuple[bool, float, float, str]:
    """
    Does this candidate explain the study's own reads better than what we hold?

    This is the only thing that decides whether a library is real. It uses the
    same `detect.rank_libraries` the rest of the pipeline uses, so an extracted
    library is held to the identical standard as a curated one.

    `read_sequences` are spacers parsed out of the run's first reads;
    `incumbent_rate` is the best match rate any library already in SplicR
    achieved on them. A candidate must beat both an absolute floor and the
    incumbent, so a near-duplicate of a library we already have cannot displace
    it on noise.
    """
    from ..detect import rank_libraries

    lib = as_library(candidate, slug="candidate", name="candidate")
    ranked = rank_libraries(read_sequences, {"candidate": lib})
    if not ranked:
        return False, 0.0, 0.0, "no match computed"
    m = ranked[0]
    if m.match_rate < MIN_MATCH_RATE:
        return False, m.match_rate, m.coverage, (
            f"explains {m.match_rate:.1%} of reads, floor is {MIN_MATCH_RATE:.0%}")
    if m.coverage < MIN_COVERAGE:
        return False, m.match_rate, m.coverage, (
            f"only {m.coverage:.1%} of its guides were seen, floor is {MIN_COVERAGE:.0%}; "
            "this looks like a fragment of the real library")
    if m.match_rate < incumbent_rate + MIN_MARGIN:
        return False, m.match_rate, m.coverage, (
            f"{m.match_rate:.1%} does not beat the library SplicR already holds "
            f"({incumbent_rate:.1%}) by {MIN_MARGIN:.0%}")
    return True, m.match_rate, m.coverage, f"explains {m.match_rate:.1%} of reads"


#: A real library explains most of a screen's reads. Below half and something
#: is wrong: the wrong table, a fragment, or the wrong study.
MIN_MATCH_RATE = 0.50
#: And the reads should hit most of the library. A table that matches reads but
#: whose guides are mostly never seen is a superset (a whole-paper oligo list)
#: rather than the library that was screened.
MIN_COVERAGE = 0.20
#: Margin over whatever SplicR already holds, so noise cannot displace a
#: curated library.
MIN_MARGIN = 0.10


def as_library(candidate: Candidate, slug: str, name: str, taxid: int = 9606) -> Library:
    return Library(slug=slug, name=name, guides=candidate.guides, taxid=taxid)


# --- the whole thing -------------------------------------------------------

def extract(accession: str, read_sequences: set[str], pmcid: str = "",
            title: str = "", incumbent_rate: float = 0.0,
            max_files: int = 25) -> Extraction:
    """
    Find, parse and verify the library for `accession`.

    `read_sequences` are spacers from the study's own reads and are what makes
    the result trustworthy; without them nothing can be accepted, and the
    function says so rather than registering an unverified library.
    """
    out = Extraction(accession)
    if not read_sequences:
        out.note = "no read sequences supplied; a library cannot be verified without them"
        return out

    urls = geo_supplementary_urls(accession) + pmc_supplementary_urls(pmcid)
    seen_urls: set[str] = set()
    urls = [u for u in urls if not (u in seen_urls or seen_urls.add(u))]
    if not urls:
        out.note = "no supplementary files found in GEO or PMC"
        return out
    urls, out.used_llm = rank_files(urls, accession, title)

    for url in urls[:max_files]:
        blob = _download(url)
        out.files_seen += 1
        if blob is None:
            out.rejected.append((Path(url).name, "could not download, or too large"))
            continue
        found_any = False
        for member, df in tables_from_bytes(url, blob):
            if df is None or len(df) < 500:
                continue
            cand = candidate_from_table(url, member, df)
            if cand is None:
                continue
            found_any = True
            ok, rate, cov, why = verify(cand, read_sequences, incumbent_rate)
            if ok:
                out.accepted, out.match_rate, out.coverage = cand, rate, cov
                out.note = f"{cand.describe}; {why}"
                return out
            out.rejected.append((f"{Path(url).name}[{member}]", why))
        if not found_any:
            out.rejected.append((Path(url).name, "no table with a guide-shaped column"))

    out.note = (f"checked {out.files_seen} supplementary file(s); none produced a library "
                f"that explains the reads")
    return out


# --- reading spacers when no library is known ------------------------------

def spacers_from_reads(reads: list[str], guide_len: int = 20,
                       min_yield: float = 0.20) -> tuple[set[str], str]:
    """
    Pull spacers out of reads without knowing the library.

    `detect.detect_spacer_location` cannot help here: it finds the offset by
    checking extracted sequences against a library's guides, and the whole
    problem is that there is no library to check against. So the spacer is
    located by the vector instead, which is constant across libraries:

      1. the constant sequence immediately 5' of the spacer (`VECTOR_ANCHORS`),
         found anywhere in the read, since staggered primers shift it
      2. failing that, each documented fixed offset, scored without a library
         by what a spacer population looks like - unambiguous DNA, and highly
         diverse. A constant region extracts cleanly too but yields almost no
         distinct sequences, and that is what separates them.

    Returns the spacers and a description of how they were found. The set is
    only used to *verify* a candidate library, so a slightly impure extraction
    is harmless: junk spacers lower every candidate's match rate equally and
    the floor still has to be cleared.
    """
    from ..config import SETTINGS, VECTOR_ANCHORS

    if not reads:
        return set(), "no reads"

    def diversity(seqs: list[str]) -> float:
        return len(set(seqs)) / len(seqs) if seqs else 0.0

    best: tuple[float, set[str], str] = (0.0, set(), "nothing matched")
    for name, anchor in VECTOR_ANCHORS.items():
        got = []
        for r in reads:
            i = r.find(anchor)
            if i < 0:
                continue
            s = r[i + len(anchor): i + len(anchor) + guide_len]
            if len(s) == guide_len and not set(s) - set("ACGT"):
                got.append(s)
        rate = len(got) / len(reads)
        if rate < min_yield:
            continue
        score = rate * min(1.0, diversity(got) / 0.5)
        if score > best[0]:
            best = (score, set(got), f"anchor {name} in {rate:.1%} of reads")
    if best[0] > 0:
        return best[1], best[2]

    for offset in SETTINGS.count.fallback_offsets:
        got = [r[offset: offset + guide_len] for r in reads]
        got = [s for s in got if len(s) == guide_len and not set(s) - set("ACGT")]
        rate = len(got) / len(reads)
        if rate < min_yield:
            continue
        div = diversity(got)
        # A constant vector region extracts perfectly and is nearly all one
        # sequence; a spacer population is mostly distinct.
        if div < 0.10:
            continue
        score = rate * div
        if score > best[0]:
            best = (score, set(got), f"fixed offset {offset}, {rate:.1%} of reads, "
                                     f"{div:.0%} distinct")
    return best[1], best[2]


def spacers_from_run(run, n: int = 200_000) -> tuple[set[str], str]:
    """`spacers_from_reads` over a run's first reads, without a full download."""
    from .fetch import NotYetAvailable, sample_reads

    url = next((u for u in run.fastq_urls if not re.search(r"_2\.f(ast)?q", u)), None)
    if url is None:
        raise NotYetAvailable(f"{run.run}: no read-1 FASTQ")
    return spacers_from_reads(sample_reads(url, n=n))


# --- registration ----------------------------------------------------------

def slug_for(accession: str) -> str:
    """A learned library is named for the study it was learned from."""
    return f"learned-{accession.strip().lower()}"


def register_learned(extraction: Extraction, name: str = "", taxid: int = 9606) -> Path:
    """
    Write an accepted library where `references.load_library` will find it.

    Two files: a canonical 3-column TSV that needs no per-library spec, and a
    JSON manifest recording exactly where it came from - the file, the sheet,
    the columns, whether a model chose them, and the read match rate it had to
    clear. A learned library is loaded with `Library.learned` set, so nothing
    downstream can report it as though it shipped with SplicR.
    """
    from ..references import LEARNED_DIR

    if not extraction.ok:
        raise ValueError("refusing to register an extraction that was not accepted")
    cand = extraction.accepted
    slug = slug_for(extraction.accession)
    LEARNED_DIR.mkdir(parents=True, exist_ok=True)
    tsv = LEARNED_DIR / f"{slug}.tsv"
    with open(tsv, "w", encoding="utf-8") as fh:
        fh.write("guide_id\tsequence\tgene\n")
        for g in cand.guides:
            fh.write(f"{g.guide_id}\t{g.sequence}\t{g.gene or ''}\n")
    targeting = sum(1 for g in cand.guides if not g.is_control)
    genes = {g.gene for g in cand.guides if g.gene}
    manifest = {
        "slug": slug,
        "name": name or f"Custom library ({extraction.accession})",
        "taxid": taxid,
        "learned": True,
        "accession": extraction.accession,
        "source_url": cand.url,
        "source_member": cand.member,
        "guide_column": cand.columns.guide_column,
        "gene_column": cand.columns.gene_column,
        "columns_decided_by": cand.columns.decided_by,
        "column_note": cand.columns.note,
        "file_ranking_used_llm": extraction.used_llm,
        "n_guides": len(cand.guides),
        "n_targeting": targeting,
        "n_controls": len(cand.guides) - targeting,
        "n_genes": len(genes),
        "duplicate_rows_dropped": cand.duplicate_rows,
        "duplicate_rows_with_a_different_gene": cand.conflicting_duplicates,
        "verified_match_rate": round(extraction.match_rate, 4),
        "verified_coverage": round(extraction.coverage, 4),
        "verification": (f"accepted only after explaining {extraction.match_rate:.1%} of this "
                         f"study's own reads, against a {MIN_MATCH_RATE:.0%} floor"),
        "files_considered": extraction.files_seen,
        "rejected": [{"file": f, "why": w} for f, w in extraction.rejected],
    }
    (LEARNED_DIR / f"{slug}.json").write_text(json.dumps(manifest, indent=2) + "\n")
    # load_library is lru_cached and may hold a miss for this slug from the
    # probe that triggered the extraction.
    _clear_library_cache()
    return tsv


def _clear_library_cache() -> None:
    from ..references import load_library

    try:
        load_library.cache_clear()
    except AttributeError:
        pass


def learn_library_for(accession: str, run, pmcid: str = "", title: str = "",
                      incumbent_rate: float = 0.0) -> Extraction:
    """
    The whole Phase-2 path for one study: read its reads, find its library.

    Called when read fingerprinting matched nothing SplicR holds. On success
    the library is on disk and `references.available_libraries()` includes it,
    so the caller can re-probe and carry on counting.
    """
    spacers, how = spacers_from_run(run)
    if not spacers:
        out = Extraction(accession)
        out.note = f"could not read spacers from {run.run}: {how}"
        return out
    out = extract(accession, spacers, pmcid=pmcid, title=title,
                  incumbent_rate=incumbent_rate)
    out.note = f"{out.note} (spacers by {how})"
    if out.ok:
        register_learned(out)
    return out


def pmid_to_pmcid(pmids: list[str], timeout: float = 30.0) -> str:
    """
    First PMC id for these PubMed ids, via NCBI's ID converter.

    A study's supplement is reachable through PMC only for open-access
    deposits, so this returns "" often and that is normal, not a failure.
    """
    import json as _json
    import urllib.parse
    import urllib.request

    ids = [p.strip() for p in pmids if p and p.strip()]
    if not ids:
        return ""
    q = urllib.parse.urlencode({"ids": ",".join(ids[:10]), "format": "json",
                                "tool": "splicr", "email": "engine@splicr.bio"})
    try:
        url = f"https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?{q}"
        with urllib.request.urlopen(url, timeout=timeout) as r:
            for rec in _json.load(r).get("records", []):
                if rec.get("pmcid"):
                    return rec["pmcid"]
    except Exception:  # noqa: BLE001 - no PMC id is a normal outcome
        return ""
    return ""

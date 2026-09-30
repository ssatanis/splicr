"""
Was there coding sequence at the cut, in the transcript the cell actually makes?

THE FAILURE THIS DESCRIBES

A guide is designed against exon 2. The cell line predominantly expresses a
transcript that skips exon 2. Cas9 cuts, the cut is repaired, and the protein
the cell was relying on is untouched, because the edited sequence was never in
it. The screen records a guide that did nothing, the gene looks less essential
than it is, and if the other guides for that gene behaved the same way the
target is discarded.

WHY THIS IS A DIFFERENT KIND OF CLAIM FROM REPAIR PREDICTION

`repair` predicts how a break was resolved, and that prediction does not
survive contact with a 21-day pooled screen: Cas9 re-cuts an in-frame-repaired
site until the frame shifts or the site is destroyed, so the per-cut in-frame
fraction is integrated away. Measured on 67,225 Avana guides against DepMap's
empirical Chronos efficacy, predicted frameshift explains 0.02% of the
variance - real at n=67k, useless.

Isoform evasion is not a prediction about repair and re-cutting does not
rescue it. Cut a constitutively-skipped exon a thousand times and the expressed
protein is unchanged, because the sequence being cut is not in it. It is a
statement about what the transcript contains, checkable against annotation.

That makes it a better-founded claim. It does not make it a true one, and this
module is written to be tested the same way the repair model was, on the same
instrument, against thresholds fixed in advance. See
`engine/research/isoform/PREREGISTRATION.md`.

THE TWO VERSIONS, AND WHICH ONE YOU ARE GETTING

    annotation-only   what fraction of a gene's protein-coding transcripts
                      contain the cut, and whether it lands in their coding
                      sequence. Needs only the Ensembl GTF, applies to every
                      guide and every cell line at once, and is what
                      `inclusion()` returns.

    cell-line-aware   the same fraction weighted by how much of each transcript
                      that particular line actually expresses. This is the full
                      claim - "THIS line skips the exon" - and it needs
                      transcript-level RNA-seq. DepMap's 26Q1 drop on disk is
                      the partial Chronos-only Figshare release and has
                      gene-level TPM only, so `inclusion()` reports
                      `expression_weighted=False` and the annotation-only
                      number. When a transcript-level matrix is supplied it
                      reports the weighted one and says so. The distinction is
                      carried in the result rather than in a comment, because
                      the two numbers mean different things and only one of
                      them supports the sentence labs care about.
"""

from __future__ import annotations

import functools
import gzip
from bisect import bisect_right
from dataclasses import dataclass, field
from pathlib import Path

from ..config import ANNOTATION_DIR, REFERENCE_DIR

GTF = ANNOTATION_DIR / "Homo_sapiens.GRCh38.116.chr.gtf.gz"
EXON_CACHE = REFERENCE_DIR / "derived" / "ensembl116_pc_exons_9606.parquet"

#: Only transcripts that encode a protein can carry a knockout, so a cut in a
#: retained-intron or NMD-target isoform is not evidence the protein survived.
CODING_BIOTYPE = 'transcript_biotype "protein_coding"'


@dataclass(frozen=True)
class Inclusion:
    """How much of a gene's coding output contains the cut site."""

    gene: str
    chrom: str
    cut_pos: int
    #: Protein-coding transcripts annotated for this gene.
    n_transcripts: int
    #: Of those, how many have an exon covering the cut.
    n_exonic: int
    #: Of those, how many have the cut inside their coding sequence (not UTR).
    n_coding: int
    #: n_coding / n_transcripts, or the expression-weighted version when
    #: transcript abundances were supplied. This is the number to use.
    coding_fraction: float
    #: n_exonic / n_transcripts, on the same basis.
    exonic_fraction: float
    #: True only if transcript-level expression was supplied and used.
    expression_weighted: bool = False
    #: Set when the gene or the position could not be resolved.
    note: str = ""
    #: Transcripts covering the cut, for a reader who wants to see them.
    covering: tuple[str, ...] = field(default_factory=tuple)

    @property
    def evaded(self) -> bool:
        """
        True when most of the gene's coding output does not contain the cut.

        0.5 is a reporting threshold, not a discovery: a guide whose cut is
        absent from more than half of what the gene makes is the case worth
        surfacing to a reader. Whether it predicts anything is what the
        benchmark decides, and the benchmark uses `coding_fraction` directly
        rather than this flag.
        """
        return self.n_transcripts > 0 and self.coding_fraction < 0.5

    @property
    def constitutive(self) -> bool:
        """The cut is in the coding sequence of every transcript the gene makes."""
        return self.n_transcripts > 0 and self.n_coding == self.n_transcripts


def build_exon_cache(gtf: Path = GTF, out: Path = EXON_CACHE) -> Path:
    """
    One row per exon of every protein-coding transcript, with its CDS overlap.

    `protein.build_cds_cache` keeps MANE Select only, because a codon index
    needs one canonical frame. This cache is the opposite: it needs every
    transcript, because the question is how many of them differ.
    """
    import pandas as pd

    rows: list[tuple] = []
    with gzip.open(gtf, "rt") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            f = line.rstrip("\n").split("\t")
            if len(f) < 9 or f[2] not in ("exon", "CDS") or CODING_BIOTYPE not in f[8]:
                continue
            attrs = f[8]
            rows.append((
                _attr(attrs, "gene_name") or _attr(attrs, "gene_id") or "",
                _attr(attrs, "transcript_id") or "",
                f"chr{f[0]}" if not f[0].startswith("chr") else f[0],
                int(f[3]) - 1,          # GTF is 1-based inclusive; store 0-based
                int(f[4]),              # half-open end
                f[2] == "CDS",
            ))
    df = pd.DataFrame(rows, columns=["gene", "transcript", "chrom", "start", "end", "is_cds"])
    df = df[df.gene.ne("") & df.transcript.ne("")]
    # Sorted at build time so the reader can slice a gene's rows by offset and
    # never group: loading 5.7M rows through a pandas groupby took 89 seconds,
    # which is not a thing a pipeline stage can do.
    df = df.sort_values(["gene", "transcript", "start"], kind="stable").reset_index(drop=True)
    # Transcript ids are 278k distinct strings repeated 20x each; as a category
    # the reader gets integer codes it can count with bincount.
    df["transcript"] = df.transcript.astype("category")
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, compression="zstd", index=False)
    return out


def _attr(attrs: str, key: str) -> str | None:
    i = attrs.find(key + ' "')
    if i < 0:
        return None
    j = attrs.index('"', i + len(key) + 2)
    return attrs[i + len(key) + 2: j]


@functools.lru_cache(maxsize=1)
def _index():
    """
    Flat column arrays plus a gene -> row-range map.

    Every exon and CDS interval of every protein-coding transcript is one row,
    sorted by gene. A lookup slices that gene's rows and works on them with
    numpy; nothing is grouped, and nothing per-transcript is built in Python
    until a gene is actually asked for. Loading is ~2 s against the 89 s a
    groupby over the same rows cost.
    """
    import numpy as np
    import pandas as pd

    if not EXON_CACHE.exists():
        build_exon_cache()
    df = pd.read_parquet(EXON_CACHE)
    gene = df.gene.to_numpy()
    # Rows are sorted by gene, so each gene occupies one contiguous block.
    names, first = np.unique(gene, return_index=True)
    order = np.argsort(first)
    names, first = names[order], first[order]
    last = np.append(first[1:], len(gene))
    spans = {n: (int(a), int(b)) for n, a, b in zip(names, first, last)}
    return {
        "spans": spans,
        "chrom": df.chrom.to_numpy(),
        "tcode": df.transcript.cat.codes.to_numpy(),
        "start": df.start.to_numpy(),
        "end": df.end.to_numpy(),
        "is_cds": df.is_cds.to_numpy(),
        "tname": np.asarray(df.transcript.cat.categories),
    }


def inclusion(gene: str, chrom: str, cut_pos: int,
              expression: dict[str, float] | None = None) -> Inclusion:
    """
    How much of `gene`'s coding output contains the cut at `chrom:cut_pos`.

    `expression` maps transcript id to abundance in one cell line (TPM, or any
    non-negative quantity). Supply it and the fractions become expression
    weighted, which is the claim that names a cell line; omit it and they are
    plain transcript counts, which is a claim about the annotation only. The
    returned `expression_weighted` says which you got.
    """
    import numpy as np

    idx = _index()
    span = idx["spans"].get(gene)
    if span is None:
        return Inclusion(gene, chrom, cut_pos, 0, 0, 0, float("nan"), float("nan"),
                         note=f"{gene} has no protein-coding transcript in Ensembl 116")
    lo, hi = span
    if idx["chrom"][lo] != chrom:
        return Inclusion(gene, chrom, cut_pos, 0, 0, 0, float("nan"), float("nan"),
                         note=f"{gene} is on {idx['chrom'][lo]}, cut is on {chrom}")

    tcode = idx["tcode"][lo:hi]
    covers = (idx["start"][lo:hi] <= cut_pos) & (cut_pos < idx["end"][lo:hi])
    is_cds = idx["is_cds"][lo:hi]

    all_t = np.unique(tcode)
    exonic_t = np.unique(tcode[covers & ~is_cds])
    coding_t = np.unique(tcode[covers & is_cds])

    if expression is None:
        weights = None
        total = float(len(all_t))
        w_exonic = float(len(exonic_t))
        w_coding = float(len(coding_t))
    else:
        names = idx["tname"]
        weights = np.array([max(0.0, float(expression.get(names[c], 0.0))) for c in all_t])
        total = float(weights.sum())
        by_code = dict(zip(all_t.tolist(), weights.tolist()))
        w_exonic = sum(by_code.get(int(c), 0.0) for c in exonic_t)
        w_coding = sum(by_code.get(int(c), 0.0) for c in coding_t)

    covering = tuple(idx["tname"][c] for c in exonic_t)
    if total <= 0:
        # Every transcript at zero: the gene is not expressed in this line at
        # all, which is a different statement from "the exon is skipped" and
        # must not be reported as evasion.
        return Inclusion(gene, chrom, cut_pos, len(all_t), len(exonic_t), len(coding_t),
                         float("nan"), float("nan"), True,
                         note="gene not expressed in this sample; inclusion undefined",
                         covering=covering)
    return Inclusion(
        gene, chrom, cut_pos,
        n_transcripts=int(len(all_t)), n_exonic=int(len(exonic_t)), n_coding=int(len(coding_t)),
        coding_fraction=w_coding / total,
        exonic_fraction=w_exonic / total,
        expression_weighted=expression is not None,
        covering=covering)


def inclusion_many(guides, expression: dict[str, float] | None = None) -> list[Inclusion]:
    """`guides` is an iterable of (gene, chrom, cut_pos). Shares one index load."""
    _index()
    return [inclusion(g, c, p, expression) for g, c, p in guides]

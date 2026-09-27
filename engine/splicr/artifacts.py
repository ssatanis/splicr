"""
Artifact flagging.

A hit can be statistically strong and still not be biology. Six things
routinely produce that, and each gets its own flag with the evidence behind
it rather than a single opaque penalty:

  copy_number_cluster   Guides in an amplified region deplete because of DNA
                        damage from multiple cuts, not because the gene
                        matters. Unexpressed genes in amplified regions score
                        as lethal (Aguirre 2016, Munoz 2016).
  single_guide          One guide carries the gene-level effect while the
                        others are flat. Usually off-target or toxic.
  promiscuous_guide     The guide has many perfect genomic matches, so its
                        signal cannot be attributed to the annotated gene.
  multi_gene_guide      The guide perfectly targets more than one gene. About
                        5.4% of Avana guides do (Fortin 2019).
  frequent_hitter       The gene hits across many unrelated screens. Real, but
                        not specific to this condition.
  low_representation    The guide was poorly represented in the plasmid pool,
                        which produces more extreme and more variable effects
                        (BMC Genomics 2026).

Every flag carries `evidence`, a dict the report renders as the one-line
reason. A flag without evidence is not worth showing.
"""

from __future__ import annotations

import csv
import functools
import io
import math
import statistics as st
from dataclasses import dataclass, field
from pathlib import Path

from .config import DEPMAP_DIR, SETTINGS, ArtifactThresholds
from .hits import GeneResult, HitTable
from .references import (Guide, Library, GeneOffTarget, annotate_offtarget,
                         load_gene_offtarget, read_text_any)

Severity = str  # "info" | "warn" | "critical"


@dataclass
class Flag:
    flag: str
    severity: Severity
    message: str
    evidence: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "flag": self.flag,
            "severity": self.severity,
            "message": self.message,
            "evidence": self.evidence,
        }


# ---------------------------------------------------------------------------
# External reference: DepMap common essentials and copy number
# ---------------------------------------------------------------------------

def _strip_entrez(label: str) -> str:
    """DepMap writes gene labels as 'SYMBOL (1234)'."""
    return label.split(" (")[0].strip()


@functools.lru_cache(maxsize=1)
def depmap_common_essentials() -> frozenset[str]:
    """
    Genes DepMap infers as pan-essential.

    Definition: a gene ranked above a dependency cutoff in at least 90% of
    cell lines, where the cutoff comes from the central minimum of the
    distribution of each gene's rank in its 90th-percentile least dependent
    line.
    """
    for name in ("CRISPRInferredCommonEssentials.csv", "AchillesCommonEssentialControls.csv"):
        path = DEPMAP_DIR / name
        if not path.exists():
            continue
        rows = read_text_any(path).split("\n")
        return frozenset(_strip_entrez(r) for r in rows[1:] if r.strip())
    return frozenset()


@functools.lru_cache(maxsize=1)
def _cn_header() -> list[str]:
    path = DEPMAP_DIR / "OmicsCNGene.csv"
    if not path.exists():
        return []
    with path.open() as fh:
        return next(csv.reader(fh))


def copy_number_for_model(model_id: str) -> dict[str, float]:
    """
    Relative copy number per gene for one cell line.

    DepMap's OmicsCNGene is LINEAR relative copy ratio, not log2, from 24Q2
    onward. Treating it as log2 would put every amplification threshold in
    the wrong place, so nothing here transforms it.

    The file is ~860 MB, so this streams and stops at the matching row rather
    than loading the matrix.
    """
    path = DEPMAP_DIR / "OmicsCNGene.csv"
    if not path.exists() or not model_id:
        return {}
    header = _cn_header()
    if not header:
        return {}
    genes = [_strip_entrez(h) for h in header[1:]]

    with path.open() as fh:
        reader = csv.reader(fh)
        next(reader, None)
        for row in reader:
            if row and row[0] == model_id:
                out: dict[str, float] = {}
                for gene, value in zip(genes, row[1:]):
                    if value:
                        try:
                            out[gene] = float(value)
                        except ValueError:
                            continue
                return out
    return {}


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

def check_single_guide(
    gene: GeneResult,
    thresholds: ArtifactThresholds = SETTINGS.artifacts,
) -> Flag | None:
    share = gene.max_guide_share
    if share is None or share < thresholds.single_guide_share:
        return None
    return Flag(
        flag="single_guide",
        severity="critical" if share > 0.8 else "warn",
        message=f"One guide carries {share:.0%} of the gene-level signal.",
        evidence={
            "max_guide_share": round(share, 3),
            "n_guides": len(gene.guide_lfcs),
            "guide_lfcs": [round(v, 3) for v in gene.guide_lfcs],
            "threshold": thresholds.single_guide_share,
        },
    )


def check_guide_disagreement(gene: GeneResult) -> Flag | None:
    agreement = gene.guide_agreement
    if agreement is None or agreement >= 0.75 or len(gene.guide_lfcs) < 3:
        return None
    return Flag(
        flag="single_guide",
        severity="warn",
        message=(
            f"Only {agreement:.0%} of guides move in the same direction as the "
            "gene-level effect."
        ),
        evidence={
            "guide_agreement": round(agreement, 3),
            "guide_lfcs": [round(v, 3) for v in gene.guide_lfcs],
        },
    )


def check_multi_gene_guides(
    entry: GeneOffTarget | None,
    guides: list[Guide] | None = None,
) -> Flag | None:
    """
    Guides that perfectly target more than one gene.

    When a guide cuts two genes, the gene-level call cannot be attributed to
    either of them. Fortin 2019 found 5.4% of Avana guides do this, affecting
    about 2,000 genes.

    Counted over the guides this screen actually used, whenever those guides
    carry measured alignment counts. Fortin's per-gene summary is computed over
    a whole library family, so on a GeCKOv2 Set A screen it reports all six A+B
    guides and "4 of 6 of your guides" is wrong about a screen that ran three.
    Falling back to the summary is better than silence, but it says so.
    """
    measured = [g for g in (guides or []) if g.perfect_alignments is not None]
    if measured:
        # More than one perfect cut site, which is Fortin's own definition. It
        # reproduces their published per-gene counts exactly across all 20,872
        # GeCKOv2 genes; counting distinct gene symbols matches only 81.7%.
        multi = [g for g in measured if (g.perfect_alignments or 0) > 1]
        if not multi:
            return None
        fraction = len(multi) / len(measured)
        return Flag(
            flag="multi_gene_guide",
            severity="critical" if fraction >= 0.5 else "warn",
            message=(
                f"{len(multi)} of this screen's {len(measured)} guides for the gene "
                "perfectly target another gene as well, so this call may belong to "
                "the neighbour."
            ),
            evidence={
                "n_multiplex_guides": len(multi),
                "n_guides": len(measured),
                "multiplex_fraction": round(fraction, 3),
                "guides": [{"sequence": g.sequence,
                            "perfect_sites": g.perfect_alignments,
                            "genes_hit": g.genes_hit} for g in multi[:6]],
                "basis": "measured per guide in the screened library",
                "source": "Fortin et al., Genome Biology 2019",
            },
        )

    if entry is None or entry.n_multiplex_guides <= 0:
        return None
    fraction = entry.multiplex_fraction
    return Flag(
        flag="multi_gene_guide",
        severity="warn",
        message=(
            f"{entry.n_multiplex_guides} of the {entry.n_guides} guides this library "
            "family carries for the gene perfectly target another gene as well. This "
            "screen's own guides were not in the alignment table, so it is not known "
            "how many of them are affected."
        ),
        evidence={
            "n_multiplex_guides": entry.n_multiplex_guides,
            "n_multiplex_exonic": entry.n_multiplex_exonic,
            "n_guides": entry.n_guides,
            "multiplex_fraction": round(fraction, 3),
            "basis": "library-family summary, not this screen's guides",
            "source": "Fortin et al., Genome Biology 2019",
        },
    )


def check_promiscuous(
    entry: GeneOffTarget | None,
    guides: list[Guide] | None = None,
) -> Flag | None:
    """
    Guides with additional near-identical genomic matches.

    Counted over this screen's own guides where the alignment table covers them,
    for the same reason as the multi-gene check. Fortin's per-gene flag is the
    fallback, and it accounts for both multi-gene targeting and single-mismatch
    off-targets.
    """
    measured = [g for g in (guides or []) if g.mismatch1_alignments is not None]
    if measured:
        loose = [g for g in measured if (g.mismatch1_alignments or 0) > 0]
        if not loose:
            return None
        return Flag(
            flag="promiscuous_guide",
            severity="warn",
            message=(
                f"{len(loose)} of this screen's {len(measured)} guides for the gene "
                "have single-mismatch matches elsewhere in the genome."
            ),
            evidence={
                "n_mismatch_guides": len(loose),
                "n_guides": len(measured),
                "guides": [{"sequence": g.sequence,
                            "mismatch1_alignments": g.mismatch1_alignments}
                           for g in loose[:6]],
                "basis": "measured per guide in the screened library",
                "source": "Fortin et al., Genome Biology 2019",
            },
        )

    if entry is None or not entry.flagged:
        return None
    return Flag(
        flag="promiscuous_guide",
        severity="info",
        message=(
            f"{entry.n_mismatch_guides} of the {entry.n_guides} guides this library "
            "family carries for the gene have single-mismatch matches elsewhere in "
            "the genome."
            + (" At least one is exonic." if entry.flagged_exonic else "")
            + " This screen's own guides were not in the alignment table."
        ),
        evidence={
            "n_mismatch_guides": entry.n_mismatch_guides,
            "n_guides": entry.n_guides,
            "flag_exonic": entry.flagged_exonic,
            "basis": "library-family summary, not this screen's guides",
            "source": "Fortin et al., Genome Biology 2019",
        },
    )


def check_frequent_hitter(
    gene_symbol: str,
    atlas_hit_rate: float | None,
    thresholds: ArtifactThresholds = SETTINGS.artifacts,
) -> Flag | None:
    common = depmap_common_essentials()
    if gene_symbol in common:
        return Flag(
            flag="frequent_hitter",
            severity="info",
            message="Pan-essential in DepMap: real, but not specific to this condition.",
            evidence={"source": "DepMap CRISPRInferredCommonEssentials", "pan_essential": True},
        )
    if atlas_hit_rate is not None and atlas_hit_rate > thresholds.frequent_hitter_rate:
        return Flag(
            flag="frequent_hitter",
            severity="info",
            message=f"Hits in {atlas_hit_rate:.0%} of unrelated screens in the Atlas.",
            evidence={"atlas_hit_rate": round(atlas_hit_rate, 3),
                      "threshold": thresholds.frequent_hitter_rate},
        )
    return None


def check_copy_number(
    gene_symbol: str,
    cn: dict[str, float],
    neighbourhood: list[tuple[str, float]],
    thresholds: ArtifactThresholds = SETTINGS.artifacts,
) -> Flag | None:
    """
    Copy-number artifact, using external CN when the cell line is known.

    `neighbourhood` is (gene, lfc) for genes near this one on the chromosome,
    which is what turns "this gene is amplified" into "this whole segment is
    dropping out together".
    """
    value = cn.get(gene_symbol)
    if value is None or value < thresholds.cn_amplification_threshold:
        return None

    depleted_neighbours = [g for g, lfc in neighbourhood if lfc < -0.5]
    evidence = {
        "relative_copy_number": round(value, 2),
        "threshold": thresholds.cn_amplification_threshold,
        "neighbours_examined": len(neighbourhood),
        "neighbours_depleted": len(depleted_neighbours),
        "neighbour_genes": [g for g, _ in neighbourhood][:8],
        "source": "DepMap OmicsCNGene (linear relative CN)",
    }
    if len(depleted_neighbours) >= thresholds.cn_cluster_min_genes:
        return Flag(
            flag="copy_number_cluster",
            severity="critical",
            message=(
                f"Sits in a region at {value:.1f} copies, and "
                f"{len(depleted_neighbours)} neighbouring genes drop out with it."
            ),
            evidence=evidence,
        )
    return Flag(
        flag="copy_number_cluster",
        severity="warn",
        message=f"Sits in a region at {value:.1f} copies.",
        evidence=evidence,
    )


def check_positional_cluster(
    gene_symbol: str,
    neighbourhood: list[tuple[str, float]],
    genome_median: float,
    thresholds: ArtifactThresholds = SETTINGS.artifacts,
) -> Flag | None:
    """
    Copy-number artifact detected from the screen alone, with no CN data.

    This is CRISPRcleanR's idea in miniature: a run of neighbouring genes all
    depleting together along a chromosome is a property of the locus, not of
    any one gene. Used when the cell line is unknown or absent from DepMap.
    """
    if len(neighbourhood) < thresholds.cn_cluster_min_genes:
        return None
    values = [lfc for _, lfc in neighbourhood]
    depleted = [v for v in values if v < genome_median - 0.5]
    if len(depleted) < thresholds.cn_cluster_min_genes:
        return None
    if len(depleted) / len(values) < 0.6:
        return None
    return Flag(
        flag="copy_number_cluster",
        severity="warn",
        message=(
            f"{len(depleted)} of {len(values)} neighbouring genes on this chromosome "
            "deplete together, which points to a locus effect rather than this gene."
        ),
        evidence={
            "neighbours_depleted": len(depleted),
            "neighbours_examined": len(values),
            "median_neighbour_lfc": round(st.median(values), 3),
            "genome_median_lfc": round(genome_median, 3),
            "method": "positional clustering; no external copy number was available",
        },
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def _gene_positions(library: Library) -> dict[str, tuple[str, int]]:
    """Gene -> (chrom, median cut position) from the library's own coordinates."""
    buckets: dict[str, list[tuple[str, int]]] = {}
    for g in library.guides:
        if g.targets_gene and g.chrom and g.cut_pos and g.gene:
            buckets.setdefault(g.gene, []).append((g.chrom, g.cut_pos))
    out: dict[str, tuple[str, int]] = {}
    for gene, entries in buckets.items():
        chrom = st.mode([c for c, _ in entries])
        positions = [p for c, p in entries if c == chrom]
        out[gene] = (chrom, int(st.median(positions)))
    return out


def _neighbourhoods(
    positions: dict[str, tuple[str, int]],
    lfc: dict[str, float],
    window: int,
) -> dict[str, list[tuple[str, float]]]:
    """For each gene, the nearest `window` genes on the same chromosome."""
    by_chrom: dict[str, list[tuple[int, str]]] = {}
    for gene, (chrom, pos) in positions.items():
        if gene in lfc:
            by_chrom.setdefault(chrom, []).append((pos, gene))
    for entries in by_chrom.values():
        entries.sort()

    out: dict[str, list[tuple[str, float]]] = {}
    half = max(1, window // 2)
    for chrom, entries in by_chrom.items():
        for i, (_, gene) in enumerate(entries):
            lo, hi = max(0, i - half), min(len(entries), i + half + 1)
            out[gene] = [
                (g, lfc[g]) for _, g in entries[lo:hi] if g != gene and g in lfc
            ]
    return out


def flag_artifacts(
    hits: HitTable,
    library: Library,
    model_id: str | None = None,
    atlas_hit_rates: dict[str, float] | None = None,
    thresholds: ArtifactThresholds = SETTINGS.artifacts,
) -> dict[str, list[Flag]]:
    """
    Flag every gene in the hit table.

    model_id is a DepMap ModelID (ACH-######). When supplied and present in
    OmicsCNGene, copy-number flagging uses measured CN; otherwise it falls
    back to positional clustering from the screen alone.
    """
    offtarget = load_gene_offtarget(library.slug)
    # Attach measured per-guide alignment counts so the off-target flags can be
    # about this screen's own guides. Both loaders are cached, so the large
    # alignment table is parsed once per process.
    n_annotated = annotate_offtarget(library)
    if n_annotated:
        print(f"      off-target: measured counts for {n_annotated:,} of "
              f"{len(library.guides):,} guides")

    guides_by_gene: dict[str, list[Guide]] = {}
    for g in library.guides:
        if g.targets_gene and g.gene:
            guides_by_gene.setdefault(g.gene, []).append(g)

    lfc = {name: g.lfc for name, g in hits.genes.items() if g.lfc is not None}
    genome_median = st.median(lfc.values()) if lfc else 0.0
    positions = _gene_positions(library)
    neighbourhoods = _neighbourhoods(positions, lfc, thresholds.cn_cluster_window)

    cn = copy_number_for_model(model_id) if model_id else {}

    out: dict[str, list[Flag]] = {}
    for name, gene in hits.genes.items():
        flags: list[Flag] = []

        f = check_single_guide(gene, thresholds)
        if f:
            flags.append(f)
        else:
            f = check_guide_disagreement(gene)
            if f:
                flags.append(f)

        entry = offtarget.get(name)
        own_guides = guides_by_gene.get(name, [])
        f = check_multi_gene_guides(entry, own_guides)
        if f:
            flags.append(f)
        f = check_promiscuous(entry, own_guides)
        if f:
            flags.append(f)

        f = check_frequent_hitter(name, (atlas_hit_rates or {}).get(name), thresholds)
        if f:
            flags.append(f)

        neighbourhood = neighbourhoods.get(name, [])
        if cn:
            f = check_copy_number(name, cn, neighbourhood, thresholds)
        else:
            f = check_positional_cluster(name, neighbourhood, genome_median, thresholds)
        if f:
            flags.append(f)

        if flags:
            out[name] = flags
    return out


def summarise_flags(flags: dict[str, list[Flag]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for gene_flags in flags.values():
        for f in gene_flags:
            counts[f.flag] = counts.get(f.flag, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))

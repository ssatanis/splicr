"""
When a gene's call rests on guides that disagree, say so.

THE PROBLEM THIS IS FOR

Four guides target a gene. One depletes hard, three do nothing. The gene's
mean lands near zero, the hit caller returns nothing, and the target is
dropped. The opposite happens too: three deplete, one does not, and nobody
looks at why. Either way the number that reaches the reader is a mean over
reagents of unequal and unknown quality, reported without its spread.

WHAT THIS MODULE DOES NOT DO, AND WHY NOT

It does not re-weight or filter the counts. That was the obvious fix, it was
tested on the largest data available, and it loses:

  - predicted frameshift explains 0.02% of the variance in DepMap's empirical
    per-guide efficacy (Spearman +0.0108 over 67,225 Avana guides; plain GC
    content scores +0.0839, eight times better)
  - annotation-only isoform inclusion is flat within multi-transcript genes
    (-0.0018, p=0.66, n=62,581)
  - weighting per-gene means by ANY of those priors - including RS3, which
    genuinely predicts efficacy at +0.122 - degrades essential/non-essential
    separation on the large majority of 100 individually-scored screens
  - filtering rather than weighting loses too: excluding low-inclusion guides
    moved median NNMD the wrong way and helped on 35 of 100 screens

The reason is arithmetic, not biology. A gene has about four guides.
Down-weighting one shrinks the effective sample size before it removes any
bias, and a prior correlated at 0.1 with the truth is far too noisy to pay
that back. The bar for a per-guide prior is not "real" but "strong", and
nothing tested clears it. See engine/research/{frameshift,isoform}/.

So this module changes no number. It reports three things that are arithmetic
on the data already there, and one thing that is annotation:

  spread        how much the guides disagree, against the spread this screen
                shows for genes of the same size. A gene is only discordant
                relative to its own experiment's noise.
  fragility     whether the call survives dropping one guide. This is a
                sensitivity statement and makes no claim about WHICH guide is
                right - that is exactly the claim the measurements above say
                cannot be supported.
  measured      per-guide efficacy where it has been MEASURED (DepMap Chronos,
                JACKS), never predicted. An empirical estimate of what a guide
                did beats a prediction of what it should have done, and when
                no measurement exists the field is empty rather than modelled.
  domain        which part of the protein each guide cuts, from `protein.py`
                and ultimately from UniProt's curated residue annotation. This
                is interpretation for a reader deciding what to test next, and
                it is not evidence about the screen.


It does not say "structural vulnerability confirmed". A handful of guides
converging on one annotated feature is consistent with the effect depending on
that region and does not establish it: guides that cut near each other share
chromatin, copy number, off-target neighbourhoods and often exons, so their fold
changes are correlated for reasons that have nothing to do with the domain. The
response says what was observed, gives the test, and names the confound.

It also changes no measurement. Re-weighting and filtering guides by predicted
quality were both tested on the largest data available and both made gene calls
worse; see engine/research/{frameshift,isoform}/ and the module docstring of
splicr/validate/domain_report.py.

A fragile call is not a rescued target. It is a call whose evidence is thinner
than a single number suggests, and the honest action is to look, not to
recompute.
"""

from __future__ import annotations

import math
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

#: A guide is counted as "supporting depletion" below this log2 fold change.
#: Not a hit threshold - a per-guide descriptive cut, used only to say how many
#: of a gene's guides point the same way.
DEPLETION_LFC = -0.5
#: A gene's call is reported fragile when leaving out one guide moves the mean
#: across the caller's threshold. Default matches the descriptive cut above.
FRAGILITY_THRESHOLD = -0.5

#: A gene's guides are called discordant when their standard deviation is this
#: many times the median standard deviation of same-size genes in the same
#: screen. Relative, because the comparison only means anything within one
#: experiment: an absolute variance cut would call every gene in a noisy screen
#: discordant and no gene in a quiet one.
DISCORDANT_SPREAD_RATIO = 2.0

#: Fewer guides than this and there is no disagreement to report: a two-guide
#: standard deviation is one number about one difference, and one guide is not a
#: disagreement at all.
MIN_GUIDES = 2


def _loo_means(lfcs: np.ndarray) -> np.ndarray:
    """Mean with each element left out, without an n^2 loop."""
    total = lfcs.sum()
    return (total - lfcs) / (len(lfcs) - 1)


def worklist(frame, efficacy: dict[str, float] | None = None,
             efficacy_source: str = "", annotate: bool = False,
             chrom_col: str = "chrom", cut_col: str = "cut_pos",
             gene_col: str = "gene_symbol", lfc_col: str = "lfc",
             guide_col: str = "guide_key", seq_col: str = "sequence",
             min_guides: int = MIN_GUIDES,
             depletion_lfc: float = DEPLETION_LFC) -> list["DisagreementReport"]:
    """
    One report per gene in `frame`, worst disagreement first.

    `frame` has one row per guide, with at least a gene, a guide key and a fold
    change. Every report is built by `build_report`, the same function the service
    API and the pipeline call, so a gene cannot be described one way offline and
    another way in the console.

    `efficacy` maps a guide key to a MEASURED efficacy: pass DepMap's Chronos
    `guide_efficacy` or JACKS output, never a predicted score, and name it in
    `efficacy_source` so the report says where it came from.

    `annotate=True` resolves each guide's cut to a residue, which reaches UniProt
    on a cache miss. It is off by default because a genome-wide frame would make
    thousands of network calls; turn it on for a shortlist.
    """
    df = frame.dropna(subset=[gene_col, lfc_col]).copy()
    baseline, n_baseline_genes = spread_baseline(
        (str(getattr(r, gene_col)), float(getattr(r, lfc_col)))
        for r in df.itertuples(index=False))

    provenance = Provenance(
        reference_versions=REFERENCE_VERSIONS if annotate else {},
        measurement_source=f"per-guide fold changes in the supplied frame's {lfc_col!r} column",
    )
    reports: list[DisagreementReport] = []
    for gene, grp in df.groupby(gene_col, sort=False):
        if len(grp) < min_guides:
            continue
        rows: list[GuideEvidence] = []
        for i, r in enumerate(grp.itertuples(index=False)):
            key = str(getattr(r, guide_col, f"{gene}:{i}"))
            lfc = float(getattr(r, lfc_col))
            measured = (efficacy or {}).get(key)
            rows.append(GuideEvidence(
                guide_key=key, sequence=str(getattr(r, seq_col, "") or "") or None,
                log2_fold_change=lfc, residual=0.0, depleted=lfc <= depletion_lfc,
                measured_efficacy=measured,
                efficacy_source=efficacy_source if measured is not None else None,
            ))
        if annotate:
            _annotate(gene, grp, rows, chrom_col, cut_col)
        reports.append(build_report(
            str(gene), rows, ensembl_gene_id=None, uniprot_accession=None,
            mane_transcript=None, n_residues=None, depletion_lfc=depletion_lfc,
            baseline=baseline or None, baseline_n_genes=n_baseline_genes or None,
            provenance=provenance))

    # Fragile genes first, then by how much the guides disagree: this is a
    # worklist, and the top of it should be what a reader looks at first.
    reports.sort(key=lambda r: (not r.fragile, -(r.spread_vs_screen or 0.0)))
    return reports


def _annotate(gene, grp, rows: list["GuideEvidence"], chrom_col: str, cut_col: str) -> None:
    """
    Attach protein-level context in place. Interpretation, not evidence.

    Every failure mode writes its own reason into `note` and leaves the residue
    empty, because "not looked up", "no verified cut position" and "resolved but
    no annotated feature covers it" are three different statements and a reader
    deciding what to test next needs to know which one applies.
    """
    from . import protein

    for row, r in zip(rows, grp.itertuples(index=False)):
        chrom = getattr(r, chrom_col, None)
        cut = getattr(r, cut_col, None)
        if not chrom or cut is None or cut != cut:      # NaN
            row.note = "the frame records no verified cut position"
            continue
        try:
            located = protein.locate(str(gene), str(chrom), int(cut))
        except Exception as exc:  # noqa: BLE001 - annotation must never fail a report
            row.note = f"annotation unavailable: {type(exc).__name__}: {exc}"
            continue
        if located is None:
            row.note = "no MANE Select CDS covers this cut"
            continue
        row.protein_residue = located.residue
        row.cds_fraction = round(located.fraction, 6) if located.n_residues else None
        row.in_last_exon = located.in_last_exon
        try:
            features = protein.domains_at(str(gene), located.residue)
        except Exception as exc:  # noqa: BLE001
            row.note = f"feature lookup unavailable: {type(exc).__name__}: {exc}"
            continue
        row.features_hit = list(features)
        row.annotation_evidence = "curated" if features else "cds_only"
        if not features:
            row.note = "the residue resolved; no curated UniProt feature covers it"
    protein.flush_features()


def summarise(reports: list["DisagreementReport"], limit: int = 20) -> str:
    """The worklist, as text."""
    fragile = [r for r in reports if r.fragile]
    lines = [
        f"{len(reports):,} genes with >=2 guides; {len(fragile):,} have a call that does "
        f"not survive dropping one guide.",
        "",
        "Nothing below is re-scored. Weighting and filtering guides by predicted quality",
        "were both tested and both made gene calls worse; see engine/research/.",
        "",
    ]
    for r in reports[:limit]:
        lines.append(r.summary)
        for g in r.guides:
            eff = (f"  efficacy {g.measured_efficacy:.2f} ({g.efficacy_source})"
                   if g.measured_efficacy is not None else "  efficacy not measured")
            where = ""
            if g.cds_fraction is not None:
                where = f"  at {g.cds_fraction:.0%} of CDS"
                if g.in_last_exon:
                    where += " (last exon)"
            feat = f"  hits {', '.join(g.features_hit)}" if g.features_hit else ""
            lines.append(f"    {g.guide_key:22s} log2FC {g.log2_fold_change:+6.2f}"
                         f"{eff}{where}{feat}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Persisted per-guide protein context
#
# The console's deep dive shows where each guide cut. That mapping needs the
# Ensembl MANE Select CDS and UniProt's curated residue features, both of which
# live in the engine's reference set, so it is resolved once here - at analysis
# time, against a named release - and stored beside the measurement. A reader
# then sees a recorded value with its provenance rather than whatever a live
# lookup happens to return today.
# ---------------------------------------------------------------------------

#: The releases a stored annotation was resolved against. Written into every
#: row so an old report keeps saying which references produced it.
REFERENCE_VERSIONS: dict[str, str] = {
    "assembly": "GRCh38",
    "ensembl": "116",
    "transcript_set": "MANE Select",
    "features": "UniProt reviewed (Swiss-Prot), residue features",
}


def annotate_guides(effects, library, genes: set[str] | None = None,
                    annotate_protein: bool = True,
                    depletion_lfc: float = DEPLETION_LFC) -> list[GuideEvidence]:
    """
    Attach library coordinates to every guide effect and protein context to some.

    `effects` are `hits.GuideEffect` rows. `library` is the `references.Library`
    the comparison was counted against; its guides carry the verified cut
    coordinates. `genes` restricts the protein lookup to a shortlist, because
    resolving a gene with no cached UniProt entry is a network call and a
    genome-wide run would make twenty thousand of them. Guides outside the
    shortlist keep their measurement and coordinates and say, in `note`, that the
    protein context was not requested - which is different from having looked and
    found nothing.

    Nothing here changes a measurement. A guide whose cut cannot be placed in the
    MANE CDS keeps `annotation_evidence = "none"` and an empty residue.
    """
    from . import protein

    by_key = {g.guide_id: g for g in library.guides}
    wanted = None if genes is None else {str(g).upper() for g in genes}
    out: list[GuideEvidence] = []
    for effect in effects:
        guide = by_key.get(effect.guide_key)
        chrom = guide.chrom if guide else None
        cut = guide.cut_pos if guide else None
        row = dict(
            guide_key=effect.guide_key, gene=effect.gene,
            sequence=guide.sequence if guide else None,
            log2_fold_change=effect.lfc if effect.lfc is not None else float("nan"),
            residual=0.0,
            depleted=bool(effect.lfc is not None and effect.lfc <= depletion_lfc),
            p_value=effect.p_value, fdr=effect.fdr,
            control_mean=effect.control_mean, treatment_mean=effect.treatment_mean,
            chromosome=chrom, cut_position=cut,
            strand=guide.strand if guide else None,
        )
        if not annotate_protein or (wanted is not None and effect.gene.upper() not in wanted):
            out.append(GuideEvidence(**row, note="protein context not requested for this gene"))
            continue
        if guide is None:
            out.append(GuideEvidence(**row, note="guide id is not in the library this run counted against"))
            continue
        if not chrom or cut is None:
            out.append(GuideEvidence(**row, note="the library records no verified cut position"))
            continue
        try:
            located = protein.locate(effect.gene, str(chrom), int(cut))
        except Exception as exc:  # noqa: BLE001 - annotation never fails a run
            out.append(GuideEvidence(**row, note=f"annotation unavailable: {type(exc).__name__}: {exc}"))
            continue
        if located is None:
            out.append(GuideEvidence(**row, note="no MANE Select CDS covers this cut"))
            continue
        accession, _ = protein.feature_records(effect.gene)
        features = protein.domains_at(effect.gene, located.residue)
        out.append(GuideEvidence(
            **row,
            uniprot_accession=accession,
            mane_transcript=located.transcript,
            protein_residue=located.residue,
            n_residues=located.n_residues,
            cds_fraction=round(located.fraction, 6) if located.n_residues else None,
            in_last_exon=located.in_last_exon,
            features_hit=list(features),
            annotation_evidence="curated" if features else "cds_only",
            note="" if features else "the residue resolved; no curated UniProt feature covers it",
        ))
    protein.flush_features()
    return out


class GuideEvidence(BaseModel):
    """
    One guide: what was measured, where it cut, and what is known about there.

    The same object all the way through. It is what `annotate_guides` produces,
    what `db.write_guide_effects` stores, what the recorded route reads back and
    what `build_report` reports. There is deliberately no second per-guide type:
    a measurement that has to be copied between representations is a measurement
    that can be copied onto the wrong guide.
    """

    model_config = ConfigDict(extra="forbid")

    guide_key: str
    #: The gene this guide targets, as the caller named it.
    gene: str | None = None
    sequence: str | None = None
    log2_fold_change: float
    #: Deviation from this gene's own mean. This is the disagreement.
    residual: float
    depleted: bool
    p_value: float | None = None
    fdr: float | None = None
    chromosome: str | None = None
    cut_position: int | None = None
    strand: str | None = None
    #: Measured, never predicted. Null outside the screens where an empirical
    #: per-guide efficacy exists, which is the common case.
    measured_efficacy: float | None = None
    efficacy_source: str | None = None
    #: Normalised counts MAGeCK reported for this guide, when it reported them.
    control_mean: float | None = None
    treatment_mean: float | None = None
    uniprot_accession: str | None = None
    mane_transcript: str | None = None
    n_residues: int | None = None
    protein_residue: int | None = None
    cds_fraction: float | None = None
    in_last_exon: bool | None = None
    features_hit: list[str] = Field(default_factory=list)
    annotation_evidence: Literal["curated", "cds_only", "none"] = "none"
    #: Why there is no protein context, when there is none.
    note: str = ""


class Concordance(BaseModel):
    """
    Whether the guides that moved cut somewhere the ones that did not, did not.

    `status` is an observation, never a conclusion:

      shared_feature   every annotated depleting guide cuts one curated feature,
                       and no annotated non-depleting guide cuts it
      spans_features   the depleting guides cut more than one curated feature
      overlapping      a non-depleting guide cuts the same feature as a
                       depleting one
      no_features      the protein context was looked up and no curated feature
                       covers any resolved cut
      not_evaluable    it was looked up, and too few guides resolved to a residue
                       to build the table
      not_evaluated    it was never looked up for this gene. Different from
                       no_features, and the console says so differently: one is an
                       absence of annotation, the other an absence of a lookup.
    """

    model_config = ConfigDict(extra="forbid")

    status: Literal["shared_feature", "spans_features", "overlapping",
                    "no_features", "not_evaluable", "not_evaluated"]
    feature: str | None = None
    n_depleting_annotated: int
    n_other_annotated: int
    #: Fisher exact two-sided p for the 2x2 table, when it can be built.
    fisher_p: float | None = None
    #: The smallest p this table could have produced at these margins. When it is
    #: not small, no arrangement of these guides could have been evidence.
    fisher_p_floor: float | None = None
    interpretation: str
    #: The reason a small p here is weaker than it looks.
    confound: str = (
        "Guides cutting the same region share chromatin state, copy number, exon "
        "and off-target neighbourhood, so their fold changes are correlated for "
        "reasons independent of the annotated feature. The table treats them as "
        "independent and therefore overstates the evidence."
    )


class Provenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    coordinate_system: str = "1-based residue index of the MANE Select transcript"
    reference_versions: dict[str, str]
    #: Where the fold changes came from.
    measurement_source: str
    #: Present on the recorded route; absent on the stateless one.
    annotated_at: str | None = None


class DisagreementReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gene_symbol: str
    ensembl_gene_id: str | None = None
    uniprot_accession: str | None = None
    mane_transcript: str | None = None
    n_residues: int | None = None

    n_guides: int
    mean_log2_fold_change: float
    median_log2_fold_change: float
    n_depleting: int
    depletion_lfc: float
    #: Standard deviation of this gene's guide fold changes.
    spread: float | None = None
    #: That spread over the median spread of same-size genes in this screen.
    #: Null when the screen's other guides were not supplied.
    spread_vs_screen: float | None = None
    spread_baseline_n_genes: int | None = None
    discordant: bool
    #: Worst and best gene mean over the leave-one-out subsets.
    leave_one_out_min: float
    leave_one_out_max: float
    fragile: bool
    pivotal_guide: str | None = None

    guides: list[GuideEvidence]
    concordance: Concordance
    summary: str
    provenance: Provenance


# ---------------------------------------------------------------------------
# The calculation
# ---------------------------------------------------------------------------

def spread_baseline(rows) -> tuple[dict[int, float], int]:
    """
    Median within-gene standard deviation per guide count, for one screen.

    `rows` is any iterable of (gene, log2 fold change) pairs covering the whole
    screen. Keyed by guide count because a two-guide standard deviation is not
    comparable with a ten-guide one. Returns the map and how many genes it was
    computed over, so a reader can see when the baseline itself is thin.

    A gene's guides must be judged discordant against the experiment they came
    from: a noisy screen makes every gene look discordant, and dividing by the
    screen's own typical spread for that guide count removes it.
    """
    by_gene: dict[str, list[float]] = {}
    for gene, lfc in rows:
        by_gene.setdefault(gene, []).append(lfc)
    per_size: dict[int, list[float]] = {}
    for values in by_gene.values():
        if len(values) < MIN_GUIDES:
            continue
        per_size.setdefault(len(values), []).append(float(np.std(values, ddof=1)))
    out = {}
    for size, sds in per_size.items():
        median = float(np.median(sds))
        if median > 0:
            out[size] = median
    return out, len(by_gene)


def _fisher_exact_two_sided(a: int, b: int, c: int, d: int) -> float:
    """
    Two-sided Fisher exact p for [[a, b], [c, d]], by summing tables.

    Written out rather than imported so the whole test is visible next to the
    caveat that qualifies it. Exact, and the tables here are tiny.
    """
    def log_choose(n: int, k: int) -> float:
        if k < 0 or k > n:
            return -math.inf
        return math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)

    row1, row2 = a + b, c + d
    col1, total = a + c, a + b + c + d
    if total == 0 or row1 == 0 or row2 == 0 or col1 == 0 or col1 == total:
        return 1.0

    def prob(x: int) -> float:
        return math.exp(log_choose(row1, x) + log_choose(row2, col1 - x) - log_choose(total, col1))

    observed = prob(a)
    lo, hi = max(0, col1 - row2), min(row1, col1)
    # 1e-9 absorbs floating-point error on tables that are equally probable.
    return min(1.0, sum(prob(x) for x in range(lo, hi + 1) if prob(x) <= observed * (1 + 1e-9)))


def _fisher_p_floor(row1: int, row2: int, col1: int) -> float:
    """The smallest two-sided p attainable at these margins."""
    total = row1 + row2
    lo, hi = max(0, col1 - row2), min(row1, col1)
    best = 1.0
    for x in range(lo, hi + 1):
        best = min(best, _fisher_exact_two_sided(x, row1 - x, col1 - x, total - row1 - col1 + x))
    return best


def _concordance(guides: list[GuideEvidence], *, requested: bool = True) -> Concordance:
    """The 2x2 table, when the annotation supports building one."""
    if not requested:
        return Concordance(
            status="not_evaluated", n_depleting_annotated=0, n_other_annotated=0,
            interpretation=(
                "The protein context was not resolved for this gene in this run, so "
                "there is no statement here about which part of the protein the "
                "effect might depend on. Nothing was looked for and nothing was "
                "ruled out."),
        )
    annotated = [g for g in guides if g.annotation_evidence == "curated"]
    depleting = [g for g in annotated if g.depleted]
    other = [g for g in annotated if not g.depleted]
    counts = (len(depleting), len(other))
    if not annotated or not depleting:
        return Concordance(
            status="no_features" if guides and not annotated else "not_evaluable",
            n_depleting_annotated=counts[0], n_other_annotated=counts[1],
            interpretation=(
                "No curated UniProt feature covers any resolved cut, so nothing can "
                "be said about which part of the protein the effect depends on."
                if guides and not annotated else
                "Too few guides resolved to an annotated residue to compare where "
                "the guides that moved cut against where the others did."),
        )

    shared = set(depleting[0].features_hit)
    for g in depleting[1:]:
        shared &= set(g.features_hit)
    if not shared:
        return Concordance(
            status="spans_features", n_depleting_annotated=counts[0],
            n_other_annotated=counts[1],
            interpretation=(
                "The guides that depleted cut different curated features and share "
                "none, so the effect is not localised to one annotated region by "
                "this evidence."),
        )

    feature = sorted(shared)[0]
    overlapping = [g for g in other if feature in set(g.features_hit)]
    a = len(depleting)                              # depleting, cuts the feature
    b = 0                                           # depleting, does not
    c = len(overlapping)                            # other, cuts it
    d = len(other) - len(overlapping)               # other, does not
    p = _fisher_exact_two_sided(a, b, c, d)
    floor = _fisher_p_floor(a + b, c + d, a + c)
    if overlapping:
        return Concordance(
            status="overlapping", feature=feature,
            n_depleting_annotated=counts[0], n_other_annotated=counts[1],
            fisher_p=round(p, 6), fisher_p_floor=round(floor, 6),
            interpretation=(
                f"{len(overlapping)} of the {len(other)} guides that did not deplete "
                f"also cut {feature}, so cutting it is not what separates the two "
                "groups."),
        )
    return Concordance(
        status="shared_feature", feature=feature,
        n_depleting_annotated=counts[0], n_other_annotated=counts[1],
        fisher_p=round(p, 6), fisher_p_floor=round(floor, 6),
        interpretation=(
            f"Every guide that depleted cuts {feature} and none of the "
            f"{len(other)} that did not deplete cuts it. That is consistent with "
            "the effect depending on this region. It does not establish it: with "
            f"{a + b + c + d} annotated guides the smallest two-sided Fisher p this "
            f"table could reach is {floor:.3g}."),
    )


def _summary(report: DisagreementReport) -> str:
    """One paragraph, stating evidence rather than a conclusion."""
    call = "depleting" if report.mean_log2_fold_change <= report.depletion_lfc else "not depleting"
    parts = [
        f"{report.gene_symbol}: mean log2 fold change "
        f"{report.mean_log2_fold_change:+.2f} over {report.n_guides} guides ({call}); "
        f"{report.n_depleting} of {report.n_guides} deplete individually."
    ]
    if report.fragile and report.pivotal_guide:
        moved = (report.leave_one_out_min
                 if report.mean_log2_fold_change > report.depletion_lfc
                 else report.leave_one_out_max)
        parts.append(
            f"The call is fragile: dropping {report.pivotal_guide} moves the mean to "
            f"{moved:+.2f}, across the {report.depletion_lfc:+.1f} threshold.")
    if report.spread_vs_screen is not None:
        parts.append(
            f"These guides disagree {report.spread_vs_screen:.1f} times as much as the "
            f"typical {report.n_guides}-guide gene in this screen.")
    elif report.spread is not None:
        parts.append(
            f"Their standard deviation is {report.spread:.2f}; the screen's own spread "
            "for genes of this size was not supplied, so there is nothing to compare "
            "it against.")
    parts.append(report.concordance.interpretation)
    return " ".join(parts)


def build_report(gene_symbol: str, guides: list[GuideEvidence], *,
                 ensembl_gene_id: str | None,
                 uniprot_accession: str | None,
                 mane_transcript: str | None,
                 n_residues: int | None,
                 depletion_lfc: float,
                 baseline: dict[int, float] | None,
                 baseline_n_genes: int | None,
                 provenance: Provenance,
                 protein_context_requested: bool = True) -> DisagreementReport:
    """Assemble the report from already-annotated guide rows. Changes no number."""
    values = np.array([g.log2_fold_change for g in guides], dtype=float)
    mean = float(values.mean())
    for row in guides:
        row.residual = float(row.log2_fold_change - mean)
    loo = (values.sum() - values) / (len(values) - 1)
    called = mean <= depletion_lfc
    flips = (loo <= depletion_lfc) != called
    sd = float(values.std(ddof=1)) if len(values) > 1 else None
    reference = (baseline or {}).get(len(values))
    ratio = (sd / reference) if (sd is not None and reference) else None

    report = DisagreementReport(
        gene_symbol=gene_symbol, ensembl_gene_id=ensembl_gene_id,
        uniprot_accession=uniprot_accession, mane_transcript=mane_transcript,
        n_residues=n_residues,
        n_guides=len(guides), mean_log2_fold_change=round(mean, 6),
        median_log2_fold_change=round(float(np.median(values)), 6),
        n_depleting=int((values <= depletion_lfc).sum()),
        depletion_lfc=depletion_lfc,
        spread=None if sd is None else round(sd, 6),
        spread_vs_screen=None if ratio is None else round(ratio, 4),
        spread_baseline_n_genes=baseline_n_genes,
        discordant=bool(ratio is not None and ratio >= DISCORDANT_SPREAD_RATIO),
        leave_one_out_min=round(float(loo.min()), 6),
        leave_one_out_max=round(float(loo.max()), 6),
        fragile=bool(flips.any()),
        pivotal_guide=guides[int(np.argmax(flips))].guide_key if flips.any() else None,
        guides=sorted(guides, key=lambda g: g.log2_fold_change),
        concordance=_concordance(guides, requested=protein_context_requested),
        summary="",
        provenance=provenance,
    )
    report.summary = _summary(report)
    return report

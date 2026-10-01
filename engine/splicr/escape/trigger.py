"""
When is a target's phenotype weaker than it should have been?

WHY "log2FC NEAR ZERO" IS NOT THE QUESTION

A gene sitting at zero is the normal state of almost every gene in a screen. What
makes zero interesting is an expectation that it should not have been zero, and an
expectation needs three things a fold change does not carry:

  1. a reason to expect depletion at all. A gene the cell does not express cannot
     be knocked out of a job it is not doing, and an enrichment screen has no
     reason to deplete anything.
  2. a screen that could have measured depletion if it were there. If this
     experiment's own known-essential genes did not deplete either, the gene's zero
     is the screen's zero, and calling it escape blames biology for a failed
     experiment.
  3. a scale. "Weak" only means something against the depletion this screen
     actually produced for genes that should deplete, which differs by library,
     timepoint, coverage and cell line by more than any fixed cut would survive.

So the trigger is: a gene that an independent source says should deplete, in a
screen that demonstrably could have measured depletion, sitting well above that
screen's own distribution of essential-gene effects, on guide evidence that is not
itself the explanation.

WHAT IT REFUSES TO FLAG

  - any gene in a screen whose QC failed, or whose essential and non-essential
    controls did not separate. The gate is checked first and reported first.
  - any gene whose own call is fragile, or whose guides disagree more than this
    screen's norm. Then the honest finding is "the evidence for this gene is thinner
    than one number suggests" - which the guide-disagreement report already says -
    and escape is not the parsimonious explanation.
  - any gene not expressed in the model, when expression is known.
  - any gene with too few guides to say anything.

Each refusal is returned with its reason rather than as an empty result, because
"this screen cannot support the question" and "this gene met the bar and nothing is
unexpected" are different answers.

NO p-VALUE IS PRODUCED

There is no null hypothesis here worth testing. What is reported is where the gene
sits in this screen's own essential-effect distribution, as a percentile with the
number of essentials it was computed over, plus the gene's own guide spread. Those
are descriptions a reader can check. A p-value would imply a sampling model for
"genes that should have depleted", and there is not one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Verdict = Literal["unexpectedly_weak", "as_expected", "not_eligible"]

#: A gene must be above this quantile of the screen's own essential-gene effect
#: distribution to count as unexpectedly weak. 0.9 means: of the genes this screen
#: should have depleted, nine in ten depleted more than this one did. It is a
#: descriptive cut on a measured distribution, not a significance threshold, and it
#: is reported with every result.
WEAK_QUANTILE = 0.9

#: Below this many reference essentials measured in the screen, the distribution
#: they define is too thin to place a gene in, and the screen is not eligible.
MIN_REFERENCE_ESSENTIALS = 50

#: The screen's own separation between essential and non-essential controls must
#: reach this. NNMD is (median(essential) - median(non-essential)) / MAD
#: (non-essential); the engine's QC already computes it and the repository's pass
#: bar is -1.25. A screen that cannot separate the two cannot support this question
#: at all.
MIN_NNMD_MAGNITUDE = 1.25

#: Fewer guides than this and there is nothing to say about the gene.
MIN_GUIDES = 3

#: log1p(TPM) at or above which a gene counts as expressed. DepMap's convention.
EXPRESSED_LOG1P_TPM = 0.693


@dataclass(frozen=True)
class ScreenContext:
    """What has to be true of the experiment before the question can be asked."""

    #: The screen's own recorded QC verdict: pass, warn or fail.
    qc_verdict: str
    #: Whether this contrast was declared a loss-of-function fitness endpoint
    #: against a library reference. Nothing else has a reason to deplete essentials.
    fitness_contrast: bool
    #: Essential/non-essential separation, as the engine's QC recorded it.
    nnmd: float | None
    #: Effects of the reference essential genes this screen measured. The scale.
    reference_essential_effects: tuple[float, ...] = ()
    #: Names the report prints so a reader can see which reference was used.
    essential_set: str = ""
    screen_label: str = ""

    def ineligible_reason(self) -> str | None:
        if not self.fitness_contrast:
            return ("this contrast is not a declared loss-of-function fitness endpoint "
                    "against a library reference, so no gene in it is expected to deplete")
        if self.qc_verdict == "fail":
            return ("this screen's QC failed, so a gene that did not deplete is not "
                    "evidence about biology")
        if self.nnmd is None:
            return ("this screen recorded no essential/non-essential separation, so "
                    "there is no way to know it could have measured depletion")
        if abs(self.nnmd) < MIN_NNMD_MAGNITUDE:
            return (f"this screen's essential and non-essential controls separate at NNMD "
                    f"{self.nnmd:+.2f}, short of {MIN_NNMD_MAGNITUDE:.2f}; it could not "
                    f"reliably measure depletion")
        if len(self.reference_essential_effects) < MIN_REFERENCE_ESSENTIALS:
            return (f"only {len(self.reference_essential_effects)} reference essential genes "
                    f"were measured, fewer than the {MIN_REFERENCE_ESSENTIALS} needed to "
                    f"place a gene in this screen's own depletion distribution")
        return None


@dataclass(frozen=True)
class GeneObservation:
    """What this screen recorded for one gene, and what is known about it."""

    gene: str
    symbol: str = ""
    #: The gene-level effect the run recorded.
    lfc: float | None = None
    n_guides: int | None = None
    #: From the stored guide-disagreement report. When the call turns on one guide,
    #: thin evidence is the parsimonious explanation and escape is not.
    fragile: bool = False
    #: Guide spread over this screen's own spread for genes of the same size.
    spread_vs_screen: float | None = None
    #: log1p(TPM) in this model, when it is known. None means unknown, not absent.
    expression_log1p_tpm: float | None = None
    #: Why an independent source expects this gene to deplete here.
    expectation_source: str = ""
    expected_to_deplete: bool = False


@dataclass(frozen=True)
class Assessment:
    """One gene's answer, with the reason whichever way it went."""

    gene: str
    symbol: str
    verdict: Verdict
    reason: str
    #: Where the gene sits in this screen's own essential-effect distribution, as a
    #: fraction. 0.95 means it depleted less than 95% of them.
    percentile_among_essentials: float | None = None
    n_reference_essentials: int | None = None
    #: The effect at the cut, so the comparison is inspectable.
    weak_threshold_lfc: float | None = None
    observed_lfc: float | None = None
    quantile: float = WEAK_QUANTILE
    provenance: dict[str, str] = field(default_factory=dict)

    @property
    def flagged(self) -> bool:
        return self.verdict == "unexpectedly_weak"

    def statement(self) -> str:
        name = self.symbol or self.gene
        if self.verdict == "not_eligible":
            return f"{name}: not assessed. {self.reason}"
        if self.verdict == "as_expected":
            return f"{name}: nothing unexpected. {self.reason}"
        return f"{name}: weaker than expected. {self.reason}"


def _quantile(values: tuple[float, ...], q: float) -> float:
    """Linear-interpolation quantile, without pulling in numpy for one number."""
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = q * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def assess(observation: GeneObservation, context: ScreenContext,
           quantile: float = WEAK_QUANTILE) -> Assessment:
    """
    Is this gene's phenotype weaker than this screen and this gene's biology imply?

    Eligibility is checked in the order a reader would: the experiment first, then
    the reagents, then the gene. An answer is never returned without the reason.
    """
    provenance = {
        "essential_set": context.essential_set or "not recorded",
        "expectation_source": observation.expectation_source or "not recorded",
        "screen": context.screen_label or "not recorded",
        "quantile": f"{quantile:.2f}",
        "nnmd": "not recorded" if context.nnmd is None else f"{context.nnmd:+.3f}",
    }
    ineligible = context.ineligible_reason()
    if ineligible:
        return Assessment(observation.gene, observation.symbol, "not_eligible",
                          ineligible, provenance=provenance)

    if not observation.expected_to_deplete:
        return Assessment(
            observation.gene, observation.symbol, "not_eligible",
            "no independent source says this gene is expected to deplete in this "
            "context, so a weak phenotype is not unexpected",
            provenance=provenance)
    if observation.lfc is None:
        return Assessment(observation.gene, observation.symbol, "not_eligible",
                          "this run recorded no gene-level effect for it",
                          provenance=provenance)
    if observation.n_guides is not None and observation.n_guides < MIN_GUIDES:
        return Assessment(
            observation.gene, observation.symbol, "not_eligible",
            f"{observation.n_guides} guide(s) measured it, fewer than the {MIN_GUIDES} "
            f"needed to say anything about the gene",
            provenance=provenance)
    if (observation.expression_log1p_tpm is not None
            and observation.expression_log1p_tpm < EXPRESSED_LOG1P_TPM):
        return Assessment(
            observation.gene, observation.symbol, "not_eligible",
            f"the model does not express it (log1p(TPM) "
            f"{observation.expression_log1p_tpm:.2f}), so there was no function to remove",
            provenance=provenance)
    if observation.fragile:
        return Assessment(
            observation.gene, observation.symbol, "not_eligible",
            "this gene's call does not survive dropping one guide, so thin reagent "
            "evidence explains the result without invoking any escape mechanism; read "
            "the guide-disagreement report first",
            provenance=provenance)
    if (observation.spread_vs_screen is not None and observation.spread_vs_screen >= 2.0):
        return Assessment(
            observation.gene, observation.symbol, "not_eligible",
            f"its guides disagree {observation.spread_vs_screen:.1f} times as much as the "
            f"typical gene of this size in this screen, so the gene-level number is not a "
            f"stable description of what happened; read the guide-disagreement report first",
            provenance=provenance)

    effects = context.reference_essential_effects
    threshold = _quantile(effects, quantile)
    weaker_than = sum(1 for value in effects if value < observation.lfc)
    percentile = weaker_than / len(effects)
    shared = dict(
        percentile_among_essentials=round(percentile, 4),
        n_reference_essentials=len(effects),
        weak_threshold_lfc=round(threshold, 4),
        observed_lfc=round(observation.lfc, 4),
        quantile=quantile,
        provenance=provenance,
    )
    if observation.lfc <= threshold:
        return Assessment(
            observation.gene, observation.symbol, "as_expected",
            (f"it depleted to {observation.lfc:+.2f}, within the range this screen produced "
             f"for the {len(effects)} reference essentials it measured "
             f"({percentile:.0%} of them depleted more)"),
            **shared)
    return Assessment(
        observation.gene, observation.symbol, "unexpectedly_weak",
        (f"{observation.expectation_source or 'an independent source'} expects it to "
         f"deplete here, and it sits at {observation.lfc:+.2f} while "
         f"{percentile:.0%} of the {len(effects)} reference essentials this screen measured "
         f"depleted more than that (the {quantile:.0%} cut is {threshold:+.2f}). "
         f"That is a gap worth explaining, not an explanation"),
        **shared)


def assess_all(observations: list[GeneObservation], context: ScreenContext,
               quantile: float = WEAK_QUANTILE) -> list[Assessment]:
    """
    Every gene assessed, weakest-relative-to-expectation first.

    Genes that were not eligible are kept in the list rather than dropped: a caller
    that only saw the flags would not know how many genes the gate excluded, or why.
    """
    results = [assess(observation, context, quantile) for observation in observations]
    order = {"unexpectedly_weak": 0, "as_expected": 1, "not_eligible": 2}
    return sorted(results, key=lambda a: (
        order[a.verdict],
        -(a.percentile_among_essentials if a.percentile_among_essentials is not None else -1),
        a.symbol or a.gene,
    ))


def summarise(assessments: list[Assessment], limit: int = 20) -> str:
    """The worklist, as text, with the gate's own counts."""
    flagged = [a for a in assessments if a.flagged]
    expected = [a for a in assessments if a.verdict == "as_expected"]
    skipped = [a for a in assessments if a.verdict == "not_eligible"]
    lines = [
        f"{len(assessments):,} genes assessed: {len(flagged):,} weaker than expected, "
        f"{len(expected):,} as expected, {len(skipped):,} not eligible.",
        "",
        "A gene here is a gap to explain, not an escape mechanism. Nothing in this",
        "assessment names a cause; escape/evidence.py ranks candidate causes and",
        "labels every one of them a hypothesis.",
        "",
    ]
    for assessment in assessments[:limit]:
        lines.append(assessment.statement())
    if skipped:
        lines += ["", "Why genes were not eligible:"]
        reasons: dict[str, int] = {}
        for assessment in skipped:
            key = assessment.reason.split(",")[0].split(";")[0]
            reasons[key] = reasons.get(key, 0) + 1
        for reason, count in sorted(reasons.items(), key=lambda item: -item[1]):
            lines.append(f"    {count:5d}  {reason}")
    return "\n".join(lines)

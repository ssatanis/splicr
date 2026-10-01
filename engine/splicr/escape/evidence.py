"""
Paralog compensation, as a ranked hypothesis with its evidence itemised.

THE CLAIM THIS MODULE REFUSES TO MAKE

"Gene Y buffered Gene X" is a causal statement. Establishing it needs a paired
perturbation: knock out both and show the phenotype appears. Nothing in a
single-gene screen, a paralogy table or an expression matrix can substitute for
that experiment, and the literature is full of compensation claims that rest on
exactly the substitution this module declines to make - the paralog is expressed,
therefore it compensated.

Expression is the weakest channel here, not the strongest. A paralog can be
abundant and do something else entirely; it can be scarce and still be sufficient,
because a knockout only needs a little of the right activity. So expression is one
of six channels, it is reported with its own value and its own limitation, and it
cannot on its own move a hypothesis above "weak".

THE SIX CHANNELS

    paralogy        how strong the duplication claim is, and whether two
                    independent sources agree on it (escape/paralogs.py)
    expression      is the candidate expressed in this model at all
                    (DepMap expression_tpm_log1p)
    conditional     does the candidate become selectively important in models
                    where the target is lost or inactive
                    (DepMap gene_effect, split by the target's own state)
    pathway         do the two genes sit in an overlapping functional program
                    (Reactome, via the knowledge graph)
    complex         are they interacting partners, which for a duplicate pair is
                    weak evidence of interchangeable subunits
                    (STRING physical links, via the knowledge graph)
    validation      has a paired perturbation actually been run
                    (the workspace's own Truth Loop records)

WHY THE CHANNELS ARE NOT SUMMED INTO A SCORE

A weighted sum of six correlated, differently-scaled, differently-trustworthy
quantities produces a number nobody can interpret and that no outcome data
calibrates. What is reported instead is: each channel's own value, whether it was
available at all, and one ordered label - strong, moderate, weak, insufficient -
whose rule is written out below in full and printed with the result. The label is a
decision aid with a stated rule, not a probability.

THE CONDITIONAL-DEPENDENCY CHANNEL IS THE INFORMATIVE ONE

It is the only channel that asks a counterfactual question: across DepMap models,
is the candidate more essential where the target is already broken? That is the
signature compensation would leave. It is computed as a difference of medians with
a cluster bootstrap interval over cell lines, because the models are the
independent unit and a per-gene t-test over thousands of correlated measurements
would manufacture significance. When too few models carry the target's loss, the
channel reports insufficient models rather than a number.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

Availability = Literal["available", "insufficient_data", "unavailable", "not_evaluated"]
Strength = Literal["strong", "moderate", "weak", "insufficient"]

#: A model counts as expressing a gene above this log1p(TPM). DepMap's own
#: convention for "expressed" is about 1 TPM, i.e. log1p(1) = 0.693.
EXPRESSED_LOG1P_TPM = 0.693

#: Chronos gene effect at or below this is a dependency. DepMap's own convention.
DEPENDENT_GENE_EFFECT = -0.5

#: Fewer models than this on either side of the target's state and the conditional
#: channel reports insufficient models. Ten is already thin; it is the floor at
#: which a cluster bootstrap over cell lines says anything at all, and the count is
#: always reported beside the result so a reader can discount it.
MIN_MODELS_PER_ARM = 10

#: Bootstrap resamples for the conditional channel's interval. Cell lines are the
#: resampling unit.
BOOTSTRAP_RESAMPLES = 2000
BOOTSTRAP_SEED = 20260930


@dataclass(frozen=True)
class Channel:
    """One line of evidence, with what it is and what it cannot say."""

    name: str
    availability: Availability
    #: True only when the channel was available AND points towards the hypothesis.
    supports: bool
    #: What was measured, in words a reader can check against the value.
    statement: str
    #: The measured quantity, when there is one. None is None.
    value: float | None = None
    #: Interval on `value`, when the channel computes one.
    interval: tuple[float, float] | None = None
    #: How many independent units the value rests on.
    n_units: int | None = None
    unit: str = ""
    source: str = ""
    #: What this channel cannot establish, always stated.
    limitation: str = ""


@dataclass(frozen=True)
class Hypothesis:
    """One target and one candidate paralog, with every channel reported."""

    target: str
    candidate: str
    target_symbol: str = ""
    candidate_symbol: str = ""
    model: str = ""
    channels: tuple[Channel, ...] = ()
    #: True only when a paired perturbation of both genes has been recorded.
    direct_causal_evidence: bool = False
    provenance: dict[str, str] = field(default_factory=dict)

    def channel(self, name: str) -> Channel | None:
        return next((c for c in self.channels if c.name == name), None)

    @property
    def supporting(self) -> tuple[str, ...]:
        return tuple(c.name for c in self.channels if c.supports)

    @property
    def available(self) -> tuple[str, ...]:
        return tuple(c.name for c in self.channels if c.availability == "available")

    @property
    def missing(self) -> tuple[str, ...]:
        return tuple(c.name for c in self.channels if c.availability != "available")

    @property
    def strength(self) -> Strength:
        """
        The ordered label, by a rule written out here and printed with the result.

            insufficient  paralogy itself is unavailable, or nothing but paralogy
                          and expression could be evaluated
            weak          paralogy holds, but the conditional-dependency channel
                          did not support it or could not be evaluated
            moderate      paralogy and conditional dependency both support it
            strong        those two, plus at least one of pathway or complex
                          overlap, and the candidate is expressed in this model

        Expression alone never lifts a hypothesis, at any level: a paralog being
        abundant is not evidence that it took over, and treating it as evidence is
        the specific mistake this module exists to avoid.
        """
        paralogy = self.channel("paralogy")
        if paralogy is None or not paralogy.supports:
            return "insufficient"
        informative = {"conditional_dependency", "pathway_overlap",
                       "complex_membership", "paired_validation"}
        if not informative & set(self.available):
            return "insufficient"
        conditional = self.channel("conditional_dependency")
        if conditional is None or not conditional.supports:
            return "weak"
        overlap = any(self.channel(name) and self.channel(name).supports  # type: ignore[union-attr]
                      for name in ("pathway_overlap", "complex_membership"))
        expressed = bool(self.channel("expression") and self.channel("expression").supports)  # type: ignore[union-attr]
        return "strong" if overlap and expressed else "moderate"

    def statement(self) -> str:
        """The sentence the console prints. A hypothesis, named as one."""
        target = self.target_symbol or self.target
        candidate = self.candidate_symbol or self.candidate
        where = f" in {self.model}" if self.model else ""
        if self.strength == "insufficient":
            return (
                f"There is not enough evidence to raise paralog compensation by "
                f"{candidate} as a hypothesis for {target}{where}. "
                f"{len(self.available)} of {len(self.channels)} channels could be "
                f"evaluated: {', '.join(self.missing) or 'none missing'} "
                f"{'was' if len(self.missing) == 1 else 'were'} not.")
        lead = (f"Paralog compensation by {candidate} is a {self.strength} hypothesis for "
                f"{target}{where}.")
        support = (f" Supported by {len(self.supporting)} of "
                   f"{len(self.available)} evaluated channels: "
                   f"{', '.join(self.supporting)}.")
        causal = (" A paired perturbation of both genes has been recorded, so this is "
                  "no longer only a hypothesis; read that record for what it showed."
                  if self.direct_causal_evidence else
                  " No paired perturbation of both genes has been recorded, so nothing "
                  "here establishes that it compensated. The experiment that would is "
                  "the dual knockout.")
        return lead + support + causal


# ---------------------------------------------------------------------------
# The channels
# ---------------------------------------------------------------------------

def paralogy_channel(lookup, candidate: str) -> Channel:
    """How strong is the duplication claim, and do two sources agree on it."""
    if not lookup.covered:
        return Channel(
            name="paralogy", availability="unavailable", supports=False,
            statement=lookup.note or "the pinned paralog build does not cover this gene",
            source=", ".join(lookup.releases) or "no paralog build",
            limitation="Without a paralogy call there is no hypothesis to evaluate.")
    claims = [p for p in lookup.paralogs if p.paralog == candidate]
    if not claims:
        return Channel(
            name="paralogy", availability="available", supports=False,
            statement=f"the build covers this gene and does not call {candidate} a paralog",
            n_units=0, unit="paralogy claims",
            source=", ".join(lookup.releases),
            limitation="Absence from one build is not proof the genes are unrelated.")
    channels = sorted({p.channel for p in claims})
    both = candidate in lookup.agreeing()
    return Channel(
        name="paralogy", availability="available", supports=True,
        statement=("; ".join(p.strength for p in claims)
                   + (". Two independent sources agree on this pair."
                      if both else ". One source names this pair.")),
        n_units=len(channels), unit="independent sources",
        source=", ".join(lookup.releases),
        limitation=("A paralogy call is a statement about sequence or curation, not "
                    "about whether the two proteins are functionally interchangeable "
                    "in this cell."),
    )


def expression_channel(values: dict[str, float] | None, candidate: str,
                       model: str, source: str) -> Channel:
    """Is the candidate expressed in this model at all."""
    if values is None:
        return Channel(
            name="expression", availability="unavailable", supports=False,
            statement="no expression matrix was available for this model",
            source=source,
            limitation="Expression is in any case the weakest channel here.")
    value = values.get(candidate)
    if value is None:
        return Channel(
            name="expression", availability="insufficient_data", supports=False,
            statement=f"{candidate} is not measured in this model's expression profile",
            source=source,
            limitation="Not measured is not the same as not expressed.")
    expressed = value >= EXPRESSED_LOG1P_TPM
    return Channel(
        name="expression", availability="available", supports=expressed,
        statement=(f"expressed at log1p(TPM) {value:.2f}"
                   f"{'' if expressed else ', below the ' f'{EXPRESSED_LOG1P_TPM:.2f} cut for expressed'}"
                   f" in {model}"),
        value=round(value, 4), n_units=1, unit="model", source=source,
        limitation=("Abundance is not evidence of compensation. A paralog can be "
                    "abundant and do something else, or scarce and sufficient. This "
                    "channel can only rule the candidate out, never in."),
    )


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def _bootstrap_difference(lost: list[float], intact: list[float],
                          resamples: int = BOOTSTRAP_RESAMPLES,
                          seed: int = BOOTSTRAP_SEED) -> tuple[float, float]:
    """
    Percentile interval on the difference of medians, resampling cell lines.

    The cell line is the independent unit. Resampling the measurements instead
    would treat one model's several thousand gene readings as independent samples
    and shrink the interval to nothing.
    """
    import numpy as np

    rng = np.random.default_rng(seed)
    a = np.asarray(lost, dtype=float)
    b = np.asarray(intact, dtype=float)
    draws = np.empty(resamples, dtype=float)
    for index in range(resamples):
        draws[index] = (
            np.median(rng.choice(a, size=a.size, replace=True))
            - np.median(rng.choice(b, size=b.size, replace=True))
        )
    return float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))


def conditional_dependency_channel(
    candidate_effect_by_model: dict[str, float] | None,
    target_lost_models: set[str] | None,
    target_intact_models: set[str] | None,
    source: str,
    min_models: int = MIN_MODELS_PER_ARM,
) -> Channel:
    """
    Is the candidate more essential where the target is already broken?

    This is the channel that asks the counterfactual question, so it is also the
    one with the most ways to be wrong. Two are handled explicitly. The arms must
    each hold enough models, or nothing is reported. And the interval is
    bootstrapped over cell lines, because they are the unit, which usually makes it
    wide - honestly wide, rather than narrow and meaningless.
    """
    limitation = (
        "Models where a gene is lost differ from models where it is intact in many "
        "ways besides that gene - lineage, mutational load, copy number - so a "
        "difference here is an association across cell lines and not a "
        "demonstration that losing the target creates the dependency."
    )
    if candidate_effect_by_model is None or target_lost_models is None:
        return Channel(
            name="conditional_dependency", availability="unavailable", supports=False,
            statement="no dependency matrix and target-state split were available",
            source=source, limitation=limitation)
    lost = [candidate_effect_by_model[m] for m in sorted(target_lost_models)
            if m in candidate_effect_by_model]
    intact = [candidate_effect_by_model[m] for m in sorted(target_intact_models or ())
              if m in candidate_effect_by_model]
    if len(lost) < min_models or len(intact) < min_models:
        return Channel(
            name="conditional_dependency", availability="insufficient_data", supports=False,
            statement=(f"{len(lost)} models with the target lost and {len(intact)} with it "
                       f"intact also measure the candidate; {min_models} of each are needed"),
            n_units=len(lost) + len(intact), unit="cell line models", source=source,
            limitation=limitation)
    difference = _median(lost) - _median(intact)
    low, high = _bootstrap_difference(lost, intact)
    # Supports the hypothesis only when the candidate is MORE essential (more
    # negative Chronos effect) where the target is lost, and the interval excludes
    # zero. A point estimate on its own is not evidence.
    supports = bool(difference < 0 and high < 0)
    return Channel(
        name="conditional_dependency", availability="available", supports=supports,
        statement=(f"median Chronos gene effect {difference:+.3f} lower where the target is "
                   f"lost ({_median(lost):+.3f} against {_median(intact):+.3f}); "
                   f"95% cell-line bootstrap [{low:+.3f}, {high:+.3f}]"
                   f"{'' if supports else ', which includes zero or points the other way'}"),
        value=round(difference, 4), interval=(round(low, 4), round(high, 4)),
        n_units=len(lost) + len(intact), unit="cell line models", source=source,
        limitation=limitation)


def pathway_channel(shared: tuple[str, ...] | None, source: str) -> Channel:
    """Do the two genes sit in an overlapping functional program."""
    limitation = ("Sharing a pathway annotation says the two genes act in the same "
                  "program, not that either can replace the other in it.")
    if shared is None:
        return Channel(name="pathway_overlap", availability="unavailable", supports=False,
                       statement="no pathway annotation was available", source=source,
                       limitation=limitation)
    return Channel(
        name="pathway_overlap", availability="available", supports=bool(shared),
        statement=(f"{len(shared)} shared pathway(s): {', '.join(shared[:3])}"
                   + (f" and {len(shared) - 3} more" if len(shared) > 3 else "")
                   if shared else "no shared pathway annotation"),
        n_units=len(shared), unit="pathways", source=source, limitation=limitation)


def complex_channel(interacts: bool | None, score: float | None, source: str) -> Channel:
    """Are they physical interaction partners."""
    limitation = ("For a duplicate pair, interacting is weak evidence: paralogous "
                  "subunits of one complex often interact, and so do proteins that "
                  "cannot substitute for each other at all.")
    if interacts is None:
        return Channel(name="complex_membership", availability="unavailable", supports=False,
                       statement="no interaction evidence was available", source=source,
                       limitation=limitation)
    return Channel(
        name="complex_membership", availability="available", supports=bool(interacts),
        statement=(f"a physical interaction is recorded, confidence {score:.0f}"
                   if interacts and score is not None else
                   "a physical interaction is recorded" if interacts else
                   "no physical interaction is recorded"),
        value=score, n_units=1 if interacts else 0, unit="interaction records",
        source=source, limitation=limitation)


def validation_channel(records: list[dict] | None, source: str) -> Channel:
    """Has a paired perturbation of both genes actually been run and recorded."""
    limitation = ("Only a recorded paired perturbation can establish compensation. "
                  "Everything above is consistent with it and none of it shows it.")
    if records is None:
        return Channel(name="paired_validation", availability="not_evaluated", supports=False,
                       statement="the workspace's validation records were not read",
                       source=source, limitation=limitation)
    decided = [r for r in records if r.get("result") in ("validated", "did_not_validate")]
    if not decided:
        return Channel(
            name="paired_validation", availability="insufficient_data", supports=False,
            statement=(f"{len(records)} recorded attempt(s), none with a decided result"
                       if records else "no paired perturbation of these two genes is recorded"),
            n_units=len(records), unit="recorded experiments", source=source,
            limitation=limitation)
    confirmed = [r for r in decided if r["result"] == "validated"]
    return Channel(
        name="paired_validation", availability="available", supports=bool(confirmed),
        statement=(f"{len(confirmed)} of {len(decided)} decided paired perturbations "
                   f"produced the predicted phenotype"),
        n_units=len(decided), unit="decided experiments", source=source,
        limitation=("A validation record is one laboratory's result in one model; it "
                    "does not generalise on its own."))


def build_hypothesis(*, target: str, candidate: str, channels: list[Channel],
                     target_symbol: str = "", candidate_symbol: str = "",
                     model: str = "", provenance: dict[str, str] | None = None) -> Hypothesis:
    """Assemble a hypothesis from channels that were already evaluated."""
    validation = next((c for c in channels if c.name == "paired_validation"), None)
    return Hypothesis(
        target=target, candidate=candidate,
        target_symbol=target_symbol, candidate_symbol=candidate_symbol,
        model=model, channels=tuple(channels),
        direct_causal_evidence=bool(validation and validation.availability == "available"),
        provenance=dict(provenance or {}),
    )


def rank(hypotheses: list[Hypothesis]) -> list[Hypothesis]:
    """
    Strongest first, then by how many channels supported it, then by name.

    Ties break on the name so the order is deterministic: a worklist that reorders
    between two identical runs is a worklist a reader cannot cite.
    """
    order = {"strong": 0, "moderate": 1, "weak": 2, "insufficient": 3}
    return sorted(hypotheses,
                  key=lambda h: (order[h.strength], -len(h.supporting),
                                 -len(h.available), h.candidate))


def summarise(hypotheses: list[Hypothesis], limit: int = 10) -> str:
    """The ranked hypotheses, as text."""
    ranked = rank(hypotheses)
    lines = [
        f"{len(ranked)} paralog-compensation hypotheses, strongest first.",
        "",
        "None of these is a finding. A hypothesis becomes a result when a paired",
        "perturbation of both genes is run and recorded; until then the strength",
        "label is a reading order, not a probability.",
        "",
    ]
    for hypothesis in ranked[:limit]:
        lines.append(hypothesis.statement())
        for channel in hypothesis.channels:
            mark = "+" if channel.supports else ("-" if channel.availability == "available" else "?")
            lines.append(f"    {mark} {channel.name:24s} {channel.statement}")
        lines.append("")
    return "\n".join(lines)


def is_finite(value: float | None) -> bool:
    return value is not None and math.isfinite(value)

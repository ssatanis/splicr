"""
The Escape analysis: from one screen's recorded results to ranked hypotheses.

The order is the order a reader would take, and each step can stop the next:

  1. Is this screen able to answer the question at all? QC, contrast type and the
     screen's own essential/non-essential separation decide it, and a screen that
     fails is reported as unable rather than analysed anyway. (trigger.py)
  2. Which genes are weaker than an independent source says they should be, judged
     against this screen's own depletion distribution? (trigger.py)
  3. For each of those, which paralogs are candidates at all, from the pinned
     paralog build? (paralogs.py)
  4. For each candidate, what do the six evidence channels say? (context.py,
     evidence.py)
  5. Rank the hypotheses and say, for every one, what would settle it.

Nothing here decides that a paralog compensated. The output is a worklist of
hypotheses with their evidence itemised and their missing channels named, and the
experiment that would settle each one is a paired perturbation that has not been
run. When the workspace has run one, the validation channel says so and the
statement changes accordingly.

EVERY CANDIDATE IS EVALUATED, AND THE REPORT IS WHAT IS CAPPED

A gene in a large HGNC group can have twenty candidate paralogs. An earlier version
capped the list *before* evaluating it, ordered by the strength of the paralogy
claim. That looked reasonable and was not: when only the HGNC channel is built,
every candidate has the same claim strength, so the order fell through to a sort on
Ensembl id and the cap could drop the best candidate on alphabetical grounds. Run
on ARID1A it evaluated JARID2, ARID4A and KDM5D and never looked at ARID1B.

So candidates are evaluated first and the report is what gets shortened. The
evaluation ceiling exists only to bound the work on a gene with a very large family,
and when it bites the report says how many candidates it never reached.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import context as cx
from . import evidence as ev
from . import paralogs as pl
from . import trigger as tg

#: Candidate paralogs reported per target, after all of them have been ranked.
MAX_CANDIDATES = 6

#: Hard ceiling on how many candidates are evaluated for one target. Only reached
#: by genes in a very large family; when it bites, the count not reached is
#: reported. Each candidate costs one dependency query and one bootstrap.
EVALUATION_CEILING = 25


@dataclass(frozen=True)
class TargetResult:
    """One flagged target, its hypotheses, and what was not evaluated."""

    assessment: tg.Assessment
    hypotheses: tuple[ev.Hypothesis, ...] = ()
    #: Candidates the paralog build named that the evaluation ceiling never reached.
    candidates_not_evaluated: int = 0
    #: Candidates evaluated but not shown, because the report is capped.
    candidates_not_shown: int = 0
    note: str = ""

    @property
    def leading(self) -> ev.Hypothesis | None:
        return self.hypotheses[0] if self.hypotheses else None

    def statement(self) -> str:
        if not self.hypotheses:
            return f"{self.assessment.statement()} {self.note}".strip()
        leading = self.hypotheses[0]
        tail = ""
        if self.candidates_not_shown:
            tail += (f" {self.candidates_not_shown} weaker candidate paralog(s) were "
                     f"evaluated and are not shown here.")
        if self.candidates_not_evaluated:
            tail += (f" {self.candidates_not_evaluated} further candidate paralog(s) were "
                     f"not evaluated at all.")
        return f"{self.assessment.statement()} {leading.statement()}{tail}"


@dataclass(frozen=True)
class ScreenResult:
    """The whole analysis, including what the gate refused and why."""

    screen: str
    eligible: bool
    reason: str = ""
    assessments: tuple[tg.Assessment, ...] = ()
    targets: tuple[TargetResult, ...] = ()
    provenance: dict[str, str] = field(default_factory=dict)

    @property
    def flagged(self) -> int:
        return sum(1 for a in self.assessments if a.flagged)

    def summary(self) -> str:
        if not self.eligible:
            return (f"{self.screen}: this screen cannot support an escape analysis. "
                    f"{self.reason}")
        lines = [
            f"{self.screen}: {self.flagged} of {len(self.assessments)} assessed genes are "
            f"weaker than expected; {len(self.targets)} have a candidate paralog.",
            "",
            "Every line below is a hypothesis. A paired perturbation of the two genes is",
            "what would settle it, and none has been run unless the validation channel",
            "says so.",
            "",
        ]
        for target in self.targets:
            lines.append(target.statement())
            leading = target.leading
            if leading is not None:
                for channel in leading.channels:
                    mark = ("+" if channel.supports
                            else "-" if channel.availability == "available" else "?")
                    lines.append(f"    {mark} {channel.name:24s} {channel.statement}")
            lines.append("")
        return "\n".join(lines)


def _candidate_order(lookup: pl.Lookup) -> list[str]:
    """
    Candidates, strongest paralogy claim first.

    This is not a ranking of hypotheses and must not be read as one: nothing here
    has looked at any evidence channel. It only decides which candidates are
    evaluated first, and therefore which are reached at all on a gene whose family
    is larger than the evaluation ceiling. Within a tier the order is by identifier,
    which is arbitrary - which is exactly why the ceiling is 25 rather than 6.
    """
    agreeing = set(lookup.agreeing())
    within = {p.paralog for p in lookup.paralogs
              if p.channel == "ensembl_compara" and p.relation == "within_species_paralog"}

    def key(gene: str) -> tuple:
        return (0 if gene in agreeing else 1,
                0 if gene in within else 1,
                gene)

    return sorted(lookup.partners, key=key)


def hypotheses_for(target: str, *, model_id: str = "", symbol: str = "",
                   symbol_of=None, validations=None,
                   ceiling: int = EVALUATION_CEILING) -> tuple[list[ev.Hypothesis], int, str]:
    """
    Every candidate paralog of one target, evaluated on all six channels, ranked.

    `symbol_of` maps a canonical gene id to a display symbol; `validations` maps a
    (target, candidate) pair to the workspace's own recorded paired perturbations,
    or is None when the workspace was not read.

    Returns the ranked hypotheses, how many candidates the evaluation ceiling never
    reached, and a note when there is nothing to evaluate. Shortening the list for
    display is the caller's job: dropping a candidate before evaluating it is how
    the best one gets lost.
    """
    lookup = pl.paralogs_of(target)
    if not lookup.covered:
        return [], 0, lookup.note
    ordered = _candidate_order(lookup)
    if not ordered:
        return [], 0, ("the paralog build covers this gene and records no paralog, so "
                       "compensation by a duplicate is not a candidate explanation")
    chosen, excluded = ordered[:ceiling], max(0, len(ordered) - ceiling)

    state = cx.target_state(target)
    expression = cx.expression_in_model(chosen, model_id) if model_id else None
    reference = cx.REFERENCE_NOTE
    provenance = {
        "paralog_build": ", ".join(lookup.releases) or "none",
        "references": reference,
        "target_state": state.note,
    }

    out: list[ev.Hypothesis] = []
    for candidate in chosen:
        pathways = cx.shared_pathways(target, candidate)
        interacts = cx.interaction(target, candidate)
        channels = [
            ev.paralogy_channel(lookup, candidate),
            ev.expression_channel(expression, candidate, model_id or "this model", reference),
            ev.conditional_dependency_channel(
                cx.gene_effect_by_model(candidate) if state.available else None,
                set(state.lost) if state.available else None,
                set(state.intact) if state.available else None,
                reference),
            ev.pathway_channel(pathways, "Reactome, through the knowledge graph"),
            ev.complex_channel(interacts[0] if interacts else None,
                               interacts[1] if interacts else None,
                               "STRING v12.0 physical links, through the knowledge graph"),
            ev.validation_channel(
                None if validations is None else validations.get((target, candidate), []),
                "the workspace's own recorded outcomes"),
        ]
        out.append(ev.build_hypothesis(
            target=target, candidate=candidate,
            target_symbol=symbol or target,
            candidate_symbol=(symbol_of or {}).get(candidate, candidate),
            model=model_id, channels=channels, provenance=provenance))
    return ev.rank(out), excluded, ""


def analyse(observations: list[tg.GeneObservation], screen: tg.ScreenContext, *,
            model_id: str = "", symbol_of=None, validations=None,
            max_candidates: int = MAX_CANDIDATES,
            ceiling: int = EVALUATION_CEILING) -> ScreenResult:
    """The whole analysis for one screen."""
    ineligible = screen.ineligible_reason()
    provenance = {
        "essential_set": screen.essential_set or "not recorded",
        "model": model_id or "not recorded",
        "references": cx.REFERENCE_NOTE,
        "paralog_build": ", ".join(pl.store().releases) or "none",
        "weak_quantile": f"{tg.WEAK_QUANTILE:.2f}",
    }
    if ineligible:
        return ScreenResult(screen.screen_label or "screen", False, ineligible,
                            provenance=provenance)

    assessments = tg.assess_all(observations, screen)
    targets: list[TargetResult] = []
    for assessment in assessments:
        if not assessment.flagged:
            continue
        found, unreached, note = hypotheses_for(
            assessment.gene, model_id=model_id, symbol=assessment.symbol,
            symbol_of=symbol_of, validations=validations, ceiling=ceiling)
        shown = found[:max_candidates]
        targets.append(TargetResult(
            assessment, tuple(shown), unreached,
            max(0, len(found) - len(shown)), note))
    return ScreenResult(screen.screen_label or "screen", True, "",
                        tuple(assessments), tuple(targets), provenance)

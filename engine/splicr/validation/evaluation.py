"""
The metrics that are allowed to be a claim, and the ones that are not.

NOT ACCURACY

If 25% of candidates validate, a model that says "no" to everything is 75%
accurate and has found nothing. Accuracy is not reported by anything in this
file.

What is reported:

    precision@k            of the k we said to validate, how many did
    lift                   precision@k against each baseline's precision@k
    hits per budget        confirmed discoveries for k follow-up experiments
    cost per confirmation  validations spent per confirmed hit
    abstention             how often the gate declined, which is a feature
    McNemar on discordance the paired test, on the only candidates that carry
                           information about which ranking is better

THE SELECTION-BIAS TRAP

A lab ranks 200 candidates, validates its favourite 5, and 4 come back positive.
"80% accurate" is not a statement about the ranking: it is a statement about the
5 the lab already liked. Only the candidates where two strategies *disagree*
carry information about which strategy is better, which is why `mcnemar` takes
discordant pairs and why `precision_at_k` refuses a cohort with no recorded arm
unless the caller passes `allow_unstratified=True` and accepts the label on the
result.

THE UNIT OF UNCERTAINTY

A laboratory, not a candidate. Two hundred outcomes from one lab are one
observation of how that lab validates things. `cluster_interval` from
`research_protocol` is reused here rather than reimplemented, so the bootstrap
that reports a prospective interval is the same code the retrospective
benchmark already uses.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Mapping, Sequence

import numpy as np

from ..research_protocol import cluster_interval
from .baselines import Ranking
from .calibration import wilson


class EvaluationError(ValueError):
    """A comparison the cohort cannot support."""


@dataclass(frozen=True)
class PrecisionAtK:
    strategy: str
    k: int
    #: Candidates among the top k that have a decided outcome. The denominator.
    n_decided: int
    n_validated: int
    precision: float | None
    lower: float | None
    upper: float | None
    #: Top-k slots with no outcome recorded at all. Not failures.
    n_untested: int
    stratified: bool

    def as_dict(self) -> dict:
        return asdict(self)

    def sentence(self) -> str:
        if self.precision is None:
            return (f"{self.strategy}: none of the top {self.k} has a decided "
                    f"outcome yet, so no rate is stated.")
        tail = ("" if self.stratified else
                " This cohort was not rank-stratified, so the rate describes the "
                "candidates that happened to be tested.")
        return (f"{self.strategy}: {self.n_validated} of {self.n_decided} decided "
                f"candidates in the top {self.k} validated "
                f"({self.precision:.0%}, 95% CI {self.lower:.0%}-{self.upper:.0%})."
                + (f" {self.n_untested} of the {self.k} were not tested." if self.n_untested else "")
                + tail)


def precision_at_k(ranking: Ranking, labels: Sequence[int | None], k: int, *,
                   stratified: bool = False) -> PrecisionAtK:
    """
    Of the top k this strategy proposed, the share that validated.

    `labels` is 1, 0 or None per candidate, in candidate order. None means no
    decided outcome: it leaves the denominator rather than entering it as a
    failure, and the count of untested slots is reported so a reader can see how
    much of the top k the number actually covers.
    """
    if k < 1:
        raise EvaluationError("k must be at least 1")
    chosen = ranking.top(k)
    decided = [labels[i] for i in chosen if labels[i] is not None]
    n_validated = int(sum(1 for v in decided if v == 1))
    if not decided:
        return PrecisionAtK(ranking.label, k, 0, 0, None, None, None,
                            len(chosen), stratified)
    low, high = wilson(n_validated, len(decided))
    return PrecisionAtK(ranking.label, k, len(decided), n_validated,
                        n_validated / len(decided), low, high,
                        len(chosen) - len(decided), stratified)


@dataclass(frozen=True)
class Lift:
    strategy: str
    comparator: str
    k: int
    strategy_precision: float | None
    comparator_precision: float | None
    #: Ratio and difference. Both, because 68% vs 41% is more legible as
    #: "1.6 times" to a buyer and as "+27 points" to a reviewer.
    ratio: float | None
    difference: float | None

    def as_dict(self) -> dict:
        return asdict(self)

    def sentence(self) -> str:
        if self.ratio is None:
            return (f"No lift stated at k = {self.k}: one of the two strategies "
                    f"has no decided outcome in its top {self.k}.")
        return (f"At {self.k} follow-up experiments, {self.strategy} validated "
                f"{self.strategy_precision:.0%} against {self.comparator_precision:.0%} "
                f"for {self.comparator} — {self.ratio:.2f} times as many, "
                f"{self.difference:+.0%} in absolute terms.")


def lift(strategy: PrecisionAtK, comparator: PrecisionAtK) -> Lift:
    if strategy.k != comparator.k:
        raise EvaluationError("lift compares the same budget on both sides")
    if strategy.precision is None or comparator.precision is None:
        return Lift(strategy.strategy, comparator.strategy, strategy.k,
                    strategy.precision, comparator.precision, None, None)
    #: A comparator precision of exactly 0 has no finite ratio. Reporting the
    #: difference alone is the honest move; an infinite lift is not a number a
    #: reader can use.
    ratio = (strategy.precision / comparator.precision
             if comparator.precision > 0 else None)
    return Lift(strategy.strategy, comparator.strategy, strategy.k,
                strategy.precision, comparator.precision, ratio,
                strategy.precision - comparator.precision)


@dataclass(frozen=True)
class Budget:
    strategy: str
    k: int
    confirmed: int
    n_decided: int
    n_untested: int
    #: Validations spent per confirmed hit. None when nothing was confirmed:
    #: dividing by zero confirmations is not "infinite cost", it is no estimate.
    cost_per_confirmation: float | None

    def as_dict(self) -> dict:
        return asdict(self)

    def sentence(self) -> str:
        if self.confirmed == 0:
            return (f"{self.strategy}: {self.n_decided} validations spent of a "
                    f"{self.k} budget, no confirmed hit, so no cost per "
                    f"confirmation is stated.")
        return (f"{self.strategy}: {self.confirmed} confirmed hits from "
                f"{self.n_decided} validations at a budget of {self.k}, "
                f"{self.cost_per_confirmation:.1f} validations per confirmation.")


def hits_per_budget(ranking: Ranking, labels: Sequence[int | None], k: int) -> Budget:
    """
    Confirmed discoveries for a fixed number of follow-up experiments.

    This is the metric a laboratory understands immediately, because it is
    denominated in bench weeks. The numerator counts confirmations only; the
    untested slots are reported separately and never scored either way.
    """
    chosen = ranking.top(k)
    decided = [labels[i] for i in chosen if labels[i] is not None]
    confirmed = int(sum(1 for v in decided if v == 1))
    return Budget(ranking.label, k, confirmed, len(decided),
                  len(chosen) - len(decided),
                  len(decided) / confirmed if confirmed else None)


@dataclass(frozen=True)
class Discordance:
    k: int
    n_concordant: int
    n_discordant: int
    #: In the strategy's top k and not the comparator's, and vice versa.
    strategy_only_confirmed: int
    strategy_only_decided: int
    comparator_only_confirmed: int
    comparator_only_decided: int
    excess_confirmations: float | None
    p_value: float | None
    statistic: float | None
    because: str

    def as_dict(self) -> dict:
        return asdict(self)


def mcnemar(strategy: Ranking, comparator: Ranking, labels: Sequence[int | None],
            k: int) -> Discordance:
    """
    The paired test on the candidates the two rankings disagree about.

    Concordant candidates — in both top-k lists — carry no information about
    which ranking is better, so they are counted and excluded. The test is the
    exact binomial on the discordant confirmations rather than the chi-square
    approximation, because at the sample sizes this study will actually have
    (a dozen discordant candidates per screen) the approximation is wrong.
    """
    from scipy.stats import binomtest

    a, b = set(strategy.top(k)), set(comparator.top(k))
    concordant = a & b
    only_a, only_b = sorted(a - b), sorted(b - a)
    a_decided = [labels[i] for i in only_a if labels[i] is not None]
    b_decided = [labels[i] for i in only_b if labels[i] is not None]
    a_confirmed = int(sum(1 for v in a_decided if v == 1))
    b_confirmed = int(sum(1 for v in b_decided if v == 1))
    n = a_confirmed + b_confirmed
    if n == 0:
        return Discordance(k, len(concordant), len(only_a) + len(only_b),
                           a_confirmed, len(a_decided), b_confirmed, len(b_decided),
                           None, None, None,
                           "No discordant candidate was confirmed on either side, "
                           "so the paired test has nothing to work with.")
    result = binomtest(a_confirmed, n, 0.5, alternative="two-sided")
    return Discordance(
        k, len(concordant), len(only_a) + len(only_b),
        a_confirmed, len(a_decided), b_confirmed, len(b_decided),
        float(a_confirmed - b_confirmed), float(result.pvalue), float(a_confirmed),
        f"Of {n} confirmed discordant candidates, {a_confirmed} came from "
        f"{strategy.label} and {b_confirmed} from {comparator.label}; exact "
        f"binomial p = {result.pvalue:.4g}. The {len(concordant)} candidates both "
        f"strategies chose are excluded, because they cannot distinguish them.")


# ---------------------------------------------------------------------------
# Comparing two arms of one round
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ArmRate:
    """One arm's confirmation rate, with its denominator and its interval."""

    arm: str
    n_drawn: int
    n_recorded: int
    n_decided: int
    n_validated: int
    rate: float | None
    lower: float | None
    upper: float | None

    @property
    def cost_per_confirmation(self) -> float | None:
        """Validations spent per confirmed hit. None when nothing confirmed."""
        return self.n_decided / self.n_validated if self.n_validated else None

    def as_dict(self) -> dict:
        return {**asdict(self), "cost_per_confirmation": self.cost_per_confirmation}


def arm_rate(arm: str, labels: Sequence[int | None], n_drawn: int) -> ArmRate:
    """
    The share of this arm's decided candidates that validated.

    Pending and inconclusive leave the denominator: the first has no answer yet
    and the second is not a "no". The count of drawn-but-undecided candidates is
    reported separately so a reader can see how much of the arm the rate covers.
    """
    decided = [v for v in labels if v is not None]
    validated = sum(1 for v in decided if v == 1)
    if not decided:
        return ArmRate(arm, n_drawn, len(labels), 0, 0, None, None, None)
    low, high = wilson(validated, len(decided))
    return ArmRate(arm, n_drawn, len(labels), len(decided), validated,
                   validated / len(decided), low, high)


@dataclass(frozen=True)
class ArmDifference:
    """
    Two arms compared, with a Newcombe interval on the difference.

    The arms of a round are disjoint: a candidate several strategies wanted is
    assigned once, so this is a comparison of two independent proportions and
    not a paired one. Newcombe's method composes the two Wilson intervals, which
    behaves at the small denominators a real round has - a normal approximation
    on 5 of 7 against 3 of 8 is not an interval anybody should quote.
    """

    arm: str
    comparator: str
    rate: float | None
    comparator_rate: float | None
    difference: float | None
    lower: float | None
    upper: float | None
    #: True when the interval excludes zero, which is the only thing this test
    #: is entitled to say.
    separated: bool

    def as_dict(self) -> dict:
        return asdict(self)

    def sentence(self) -> str:
        if self.difference is None:
            return (f"No comparison yet: {self.arm} or {self.comparator} has no "
                    f"decided outcome.")
        direction = "more" if self.difference >= 0 else "fewer"
        return (f"{self.arm} confirmed {abs(self.difference):.0%} {direction} of its "
                f"candidates than {self.comparator} "
                f"({self.rate:.0%} against {self.comparator_rate:.0%}), "
                f"95% interval {self.lower:+.0%} to {self.upper:+.0%}"
                + (". The interval excludes zero." if self.separated
                   else ". The interval includes zero, so this round does not "
                        "separate them."))


def compare_arms(a: ArmRate, b: ArmRate) -> ArmDifference:
    """Newcombe's score interval for the difference of two proportions."""
    if a.rate is None or b.rate is None:
        return ArmDifference(a.arm, b.arm, a.rate, b.rate, None, None, None, False)
    difference = a.rate - b.rate
    lower = difference - np.sqrt((a.rate - a.lower) ** 2 + (b.upper - b.rate) ** 2)
    upper = difference + np.sqrt((a.upper - a.rate) ** 2 + (b.rate - b.lower) ** 2)
    lower, upper = float(max(-1.0, lower)), float(min(1.0, upper))
    return ArmDifference(a.arm, b.arm, a.rate, b.rate, float(difference),
                         lower, upper, lower > 0 or upper < 0)


@dataclass(frozen=True)
class Abstention:
    n_candidates: int
    n_estimated: int
    n_declined: int
    coverage: float
    reasons: dict[str, int]

    def as_dict(self) -> dict:
        return asdict(self)

    def sentence(self) -> str:
        was = "was" if self.n_declined == 1 else "were"
        return (f"A probability was available for {self.n_estimated} of "
                f"{self.n_candidates} candidates ({self.coverage:.0%}). "
                f"{self.n_declined} {was} declined as outside the calibrated "
                f"cohort, which is the gate working rather than failing.")


def abstention(availabilities: Sequence[object]) -> Abstention:
    """How often the gate declined, and why. Reported as a strength."""
    total = len(availabilities)
    reasons: dict[str, int] = {}
    estimated = 0
    for item in availabilities:
        if getattr(item, "available", False):
            estimated += 1
        else:
            reason = str(getattr(item, "reason", "unknown"))
            reasons[reason] = reasons.get(reason, 0) + 1
    return Abstention(total, estimated, total - estimated,
                      estimated / total if total else 0.0, reasons)


def by_laboratory(values: Sequence[float], labs: Sequence[str], *,
                  repeats: int = 10000, seed: int = 20261003) -> dict:
    """
    A cluster bootstrap over laboratories.

    Delegates to the same `cluster_interval` the retrospective benchmark uses,
    so a prospective interval and a retrospective one are computed by one
    implementation. One laboratory returns no interval rather than a
    meaningless one, which is that function's documented behaviour.
    """
    return cluster_interval(values, labs, repeats=repeats, seed=seed)


@dataclass(frozen=True)
class Comparison:
    """Everything the evaluation panel shows, for one budget."""

    k: int
    strategy: PrecisionAtK
    baselines: tuple[PrecisionAtK, ...]
    lifts: tuple[Lift, ...]
    budgets: tuple[Budget, ...]
    discordance: tuple[Discordance, ...]

    def as_dict(self) -> dict:
        return {
            "k": self.k,
            "strategy": self.strategy.as_dict(),
            "strategy_sentence": self.strategy.sentence(),
            "baselines": [b.as_dict() for b in self.baselines],
            "lifts": [{**l.as_dict(), "sentence": l.sentence()} for l in self.lifts],
            "budgets": [{**b.as_dict(), "sentence": b.sentence()} for b in self.budgets],
            "discordance": [d.as_dict() for d in self.discordance],
        }


def compare(strategy: Ranking, baselines: Mapping[str, Ranking],
            labels: Sequence[int | None], k: int, *,
            stratified: bool = False) -> Comparison:
    """SplicR against every baseline at one budget, with the paired test."""
    mine = precision_at_k(strategy, labels, k, stratified=stratified)
    theirs = tuple(precision_at_k(r, labels, k, stratified=stratified)
                   for r in baselines.values())
    return Comparison(
        k, mine, theirs,
        tuple(lift(mine, other) for other in theirs),
        (hits_per_budget(strategy, labels, k),) +
        tuple(hits_per_budget(r, labels, k) for r in baselines.values()),
        tuple(mcnemar(strategy, r, labels, k) for r in baselines.values()))

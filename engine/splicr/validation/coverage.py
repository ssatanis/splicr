"""
The gate. The only thing in this package allowed to say "yes, print a number".

WHAT IT IS FOR

Train mostly on 2D cancer lines, genome-wide knockout, viability. Then somebody
uploads primary brain organoids, CRISPRa, a differentiation phenotype. A model
will happily return 0.82 for that candidate, because a model always returns
something. Printing it would be the single worst thing this product could do:
it would be a confident number about an experiment the cohort cannot speak to,
and once a lab has spent twenty validations on it, the trust is gone.

So a probability is available only inside a stratum that the validation cohort
actually covers, and "covers" is counted, not assumed:

    at least MIN_STRATUM_OUTCOMES decided outcomes in the stratum
    from at least MIN_STRATUM_LABS laboratories
    across at least MIN_STRATUM_SCREENS primary screens

and, globally, before any stratum is open at all:

    at least MIN_NETWORK_OUTCOMES decided outcomes
    from at least MIN_NETWORK_LABS laboratories
    with a held-out-laboratory evaluation on record

Three laboratories is the floor for the stratum because two cannot distinguish a
real effect from one laboratory's house style, and the cluster bootstrap over
two clusters has no between-cluster information to work with.

WHAT A STRATUM IS

(question, assay class, modality, phenotype family, model type). The question is
in the key because the four questions never share a number: a cohort that can
support an independent-guide probability for 2D knockout fitness screens says
nothing about pharmacologic translation in the same context, and the gate has to
be able to open one and keep the other shut.

Strata fall back along a declared ladder, not by similarity: model type first
(the coarsest thing to give up), then phenotype family, then modality. Each
fallback is reported, so the console can say the estimate came from a broader
cohort than the exact experiment.

WHAT THE GATE REFUSES TO DO

It never returns a number with a caveat. `Unavailable` has no probability field.
A caller that wants to print something has to handle both branches, which means
no code path can accidentally render a fallback value as a measurement.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Iterable, Mapping, Sequence

from .endpoints import QUESTIONS
from .outcomes import MODALITIES, MODEL_TYPES, PHENOTYPE_FAMILIES, OutcomeRecord

#: Per-stratum floors.
MIN_STRATUM_OUTCOMES = 40
MIN_STRATUM_LABS = 3
MIN_STRATUM_SCREENS = 5
#: Network-wide floors, checked before any stratum opens.
MIN_NETWORK_OUTCOMES = 100
MIN_NETWORK_LABS = 3
#: A cohort where this share of records disagree with their own endpoint is a
#: data-quality problem, not a calibration cohort.
MAX_DISAGREEMENT_RATE = 0.15

#: The order in which stratum dimensions are surrendered when the exact stratum
#: is too thin. Declared rather than searched, so the same candidate always
#: falls back the same way and the fallback is explainable.
FALLBACK_LADDER: tuple[str, ...] = ("model_type", "phenotype_family", "modality")

ANY = "*"


@dataclass(frozen=True)
class Stratum:
    question: str
    assay_class: str
    modality: str
    phenotype_family: str
    model_type: str

    def __post_init__(self) -> None:
        if self.question not in QUESTIONS:
            raise ValueError(f"unknown question {self.question!r}")
        for value, allowed, what in (
            (self.modality, MODALITIES, "modality"),
            (self.phenotype_family, PHENOTYPE_FAMILIES, "phenotype family"),
            (self.model_type, MODEL_TYPES, "model type"),
        ):
            if value != ANY and value not in allowed:
                raise ValueError(f"unknown {what} {value!r}")

    @property
    def key(self) -> str:
        return "|".join((self.question, self.assay_class, self.modality,
                         self.phenotype_family, self.model_type))

    def relaxed(self, dimension: str) -> "Stratum":
        return Stratum(**{**asdict(self), dimension: ANY})

    def describe(self) -> str:
        parts = []
        if self.modality != ANY:
            parts.append(self.modality.replace("_", " "))
        if self.assay_class != ANY:
            parts.append(self.assay_class.replace("_", " "))
        if self.phenotype_family != ANY:
            parts.append(f"{self.phenotype_family.replace('_', ' ')} phenotype")
        if self.model_type != ANY:
            parts.append(f"in {self.model_type.replace('_', ' ')}s")
        return ", ".join(parts) if parts else "any context"

    def as_dict(self) -> dict:
        return asdict(self)


def stratum_of(outcome: OutcomeRecord) -> Stratum | None:
    """The stratum an outcome belongs to, or None when it bears on no question."""
    if outcome.question is None:
        return None
    c = outcome.context
    return Stratum(outcome.question, c.assay_class, c.modality,
                   c.phenotype_family, c.model_type)


def stratum_for(question: str, context: Mapping[str, object]) -> Stratum:
    """The stratum a candidate would be scored in, from a context mapping."""
    return Stratum(
        question,
        str(context.get("assay_class") or "other"),
        str(context.get("modality") or "knockout"),
        str(context.get("phenotype_family") or "fitness"),
        str(context.get("model_type") or "cancer_cell_line"),
    )


@dataclass(frozen=True)
class StratumCount:
    stratum: Stratum
    n_decided: int
    n_validated: int
    n_failed: int
    n_inconclusive: int
    n_pending: int
    n_labs: int
    n_studies: int
    n_screens: int
    labs: tuple[str, ...]

    @property
    def open(self) -> bool:
        return (self.n_decided >= MIN_STRATUM_OUTCOMES
                and self.n_labs >= MIN_STRATUM_LABS
                and self.n_screens >= MIN_STRATUM_SCREENS)

    def shortfall(self) -> list[str]:
        missing: list[str] = []
        if self.n_decided < MIN_STRATUM_OUTCOMES:
            missing.append(f"{self.n_decided} of {MIN_STRATUM_OUTCOMES} decided outcomes")
        if self.n_labs < MIN_STRATUM_LABS:
            missing.append(f"{self.n_labs} of {MIN_STRATUM_LABS} laboratories")
        if self.n_screens < MIN_STRATUM_SCREENS:
            missing.append(f"{self.n_screens} of {MIN_STRATUM_SCREENS} primary screens")
        return missing

    def as_dict(self) -> dict:
        return {
            "stratum": self.stratum.as_dict(), "key": self.stratum.key,
            "describe": self.stratum.describe(),
            "n_decided": self.n_decided, "n_validated": self.n_validated,
            "n_failed": self.n_failed, "n_inconclusive": self.n_inconclusive,
            "n_pending": self.n_pending, "n_labs": self.n_labs,
            "n_studies": self.n_studies, "n_screens": self.n_screens,
            "open": self.open, "shortfall": self.shortfall(),
        }


@dataclass(frozen=True)
class Available:
    """The gate is open for this stratum. Carries the cohort that opened it."""

    stratum: Stratum
    matched: Stratum
    relaxed: tuple[str, ...]
    n_decided: int
    n_labs: int
    n_screens: int

    available = True

    @property
    def exact(self) -> bool:
        return not self.relaxed

    def cohort_sentence(self) -> str:
        where = self.matched.describe()
        base = (f"Calibrated on {self.n_decided} independent validation outcomes "
                f"from {self.n_screens} screens and {self.n_labs} "
                f"{'laboratory' if self.n_labs == 1 else 'laboratories'}, {where}")
        if self.relaxed:
            given_up = ", ".join(d.replace("_", " ") for d in self.relaxed)
            base += (f". This is a broader cohort than the experiment: {given_up} "
                     f"did not have enough outcomes on its own")
        return base + "."

    def as_dict(self) -> dict:
        return {"available": True, "exact": self.exact,
                "stratum": self.stratum.as_dict(), "matched": self.matched.as_dict(),
                "matched_key": self.matched.key,
                "relaxed": list(self.relaxed),
                "n_decided": self.n_decided, "n_labs": self.n_labs,
                "n_screens": self.n_screens,
                "cohort_sentence": self.cohort_sentence()}


@dataclass(frozen=True)
class Unavailable:
    """
    The gate is shut. There is no probability field on this object, on purpose.

    `reason` is a machine code and `because` is the sentence the console shows.
    Both name the shortfall rather than saying "insufficient data", because a
    lab that reads "3 of 5 primary screens" knows what would change it.
    """

    stratum: Stratum
    reason: str
    because: str
    shortfall: tuple[str, ...] = ()
    nearest: StratumCount | None = None

    available = False

    def as_dict(self) -> dict:
        return {"available": False, "stratum": self.stratum.as_dict(),
                "stratum_key": self.stratum.key,
                "describe": self.stratum.describe(),
                "reason": self.reason, "because": self.because,
                "shortfall": list(self.shortfall),
                "nearest": self.nearest.as_dict() if self.nearest else None}


Availability = Available | Unavailable


@dataclass
class CoverageTable:
    """Every stratum the cohort covers, plus the relaxed roll-ups above them."""

    counts: dict[str, StratumCount] = field(default_factory=dict)
    network_decided: int = 0
    network_labs: int = 0
    network_screens: int = 0
    disagreement_rate: float = 0.0
    #: Set only when a held-out-laboratory evaluation has actually been run and
    #: recorded. Until then the network-level gate stays shut whatever the counts
    #: say, because an uncheckable model is not a calibrated one.
    holdout_evaluated: bool = False
    holdout_note: str = "no held-out-laboratory evaluation is on record"

    # -- building ---------------------------------------------------------

    @classmethod
    def from_outcomes(cls, outcomes: Iterable[OutcomeRecord], *,
                      disagreement_rate: float = 0.0,
                      holdout_evaluated: bool = False,
                      holdout_note: str | None = None) -> "CoverageTable":
        rows = list(outcomes)
        table = cls(disagreement_rate=disagreement_rate,
                    holdout_evaluated=holdout_evaluated)
        if holdout_note is not None:
            table.holdout_note = holdout_note
        elif holdout_evaluated:
            table.holdout_note = "held-out-laboratory evaluation on record"

        buckets: dict[str, list[OutcomeRecord]] = {}
        for outcome in rows:
            base = stratum_of(outcome)
            if base is None:
                continue
            #: Every outcome is counted in its exact stratum and in each
            #: relaxed roll-up, so a fallback lookup is a dictionary hit rather
            #: than a scan, and the two can never disagree.
            for stratum in _expand(base):
                buckets.setdefault(stratum.key, []).append(outcome)

        keyed = {s.key: s for outcome in rows if (b := stratum_of(outcome))
                 for s in _expand(b)}
        for key, members in buckets.items():
            table.counts[key] = _count(keyed[key], members)

        decided = [o for o in rows if o.decided and o.question is not None]
        table.network_decided = len(decided)
        table.network_labs = len({o.lab_id for o in decided if o.lab_id})
        table.network_screens = len({o.screen_id for o in decided if o.screen_id})
        return table

    # -- the gate ---------------------------------------------------------

    def network_shortfall(self) -> list[str]:
        missing: list[str] = []
        if self.network_decided < MIN_NETWORK_OUTCOMES:
            missing.append(
                f"{self.network_decided} of {MIN_NETWORK_OUTCOMES} decided outcomes "
                f"across the whole network")
        if self.network_labs < MIN_NETWORK_LABS:
            missing.append(
                f"{self.network_labs} of {MIN_NETWORK_LABS} contributing laboratories")
        if not self.holdout_evaluated:
            missing.append(self.holdout_note)
        if self.disagreement_rate > MAX_DISAGREEMENT_RATE:
            missing.append(
                f"a recorded-outcome disagreement rate of {self.disagreement_rate:.0%}, "
                f"above the {MAX_DISAGREEMENT_RATE:.0%} this gate allows")
        return missing

    @property
    def network_open(self) -> bool:
        return not self.network_shortfall()

    def availability(self, stratum: Stratum) -> Availability:
        """Whether a probability may be stated for this stratum, and why not."""
        blocked = self.network_shortfall()
        if blocked:
            return Unavailable(
                stratum, "network_not_calibrated",
                "No validation probability is available anywhere yet. "
                "Still outstanding: " + "; ".join(blocked) + ".",
                tuple(blocked), self.counts.get(stratum.key))

        ladder: list[tuple[Stratum, tuple[str, ...]]] = [(stratum, ())]
        relaxed: list[str] = []
        current = stratum
        for dimension in FALLBACK_LADDER:
            if getattr(current, dimension) == ANY:
                continue
            current = current.relaxed(dimension)
            relaxed.append(dimension)
            ladder.append((current, tuple(relaxed)))

        for candidate, given_up in ladder:
            count = self.counts.get(candidate.key)
            if count is not None and count.open:
                return Available(stratum, candidate, given_up,
                                 count.n_decided, count.n_labs, count.n_screens)

        exact = self.counts.get(stratum.key)
        broadest = self.counts.get(ladder[-1][0].key)
        nearest = exact or broadest
        shortfall = tuple(nearest.shortfall()) if nearest else (
            f"0 of {MIN_STRATUM_OUTCOMES} decided outcomes",
            f"0 of {MIN_STRATUM_LABS} laboratories",
            f"0 of {MIN_STRATUM_SCREENS} primary screens",
        )
        return Unavailable(
            stratum, "out_of_domain",
            "No validation probability is available for this experiment. It is "
            "outside the contexts the validation cohort covers well enough: "
            + "; ".join(shortfall) +
            ", counting the broadest cohort this experiment can fall back to.",
            shortfall, nearest)

    def open_strata(self) -> list[StratumCount]:
        return sorted((c for c in self.counts.values() if c.open),
                      key=lambda c: (-c.n_decided, c.stratum.key))

    def as_dict(self) -> dict:
        return {
            "schema": "splicr.validation-coverage.v1",
            "thresholds": {
                "min_stratum_outcomes": MIN_STRATUM_OUTCOMES,
                "min_stratum_labs": MIN_STRATUM_LABS,
                "min_stratum_screens": MIN_STRATUM_SCREENS,
                "min_network_outcomes": MIN_NETWORK_OUTCOMES,
                "min_network_labs": MIN_NETWORK_LABS,
                "max_disagreement_rate": MAX_DISAGREEMENT_RATE,
            },
            "network": {
                "n_decided": self.network_decided, "n_labs": self.network_labs,
                "n_screens": self.network_screens,
                "disagreement_rate": self.disagreement_rate,
                "holdout_evaluated": self.holdout_evaluated,
                "holdout_note": self.holdout_note,
                "open": self.network_open,
                "shortfall": self.network_shortfall(),
            },
            "strata": [c.as_dict() for c in
                       sorted(self.counts.values(),
                              key=lambda c: (-c.n_decided, c.stratum.key))],
        }


def _expand(stratum: Stratum) -> list[Stratum]:
    """A stratum and every roll-up reachable by surrendering ladder dimensions."""
    out = [stratum]
    current = stratum
    for dimension in FALLBACK_LADDER:
        if getattr(current, dimension) == ANY:
            continue
        current = current.relaxed(dimension)
        out.append(current)
    return out


def _count(stratum: Stratum, members: Sequence[OutcomeRecord]) -> StratumCount:
    by_result = {"validated": 0, "failed": 0, "inconclusive": 0, "pending": 0}
    for o in members:
        by_result[o.result] += 1
    decided = [o for o in members if o.decided]
    labs = sorted({o.lab_id for o in decided if o.lab_id})
    return StratumCount(
        stratum=stratum,
        n_decided=len(decided),
        n_validated=by_result["validated"], n_failed=by_result["failed"],
        n_inconclusive=by_result["inconclusive"], n_pending=by_result["pending"],
        n_labs=len(labs),
        n_studies=len({o.study_id for o in decided if o.study_id}),
        n_screens=len({o.screen_id for o in decided if o.screen_id}),
        labs=tuple(labs))

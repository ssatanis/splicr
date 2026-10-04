"""
The network: four heads, one gate, and one call a caller makes.

WHY FOUR HEADS AND NOT ONE NUMBER

    Will the screen hit reproduce?           an independent perturbation, same model
    Is the effect target-specific?           an orthogonal perturbation of the target
    Will it translate to another model?       another line, organoid or context
    Will pharmacologic targeting reproduce?   a selective compound

These are four different experiments with four different failure modes and they
do not share a probability. PRKDC in doi:10.1158/0008-5472.CAN-24-0775 is the
standing example: individual gRNAs reduced organoid growth, and LTURM34 and
AZD7648 showed no potent activity at the tested concentrations. One number
covering both would be a number about neither.

So `fit` builds a head per question, each with its own model, its own
calibrator, its own coverage table and its own held-out-laboratory evaluation,
and `estimate` returns a mapping from question to Estimate-or-Unavailable. A
head with no outcomes is simply absent, and asking it returns Unavailable with
the reason, not a fallback from a neighbouring head.

THE ORDER OF OPERATIONS, WHICH IS THE WHOLE DESIGN

    1. split by laboratory into train / calibrate / test
    2. choose a model on laboratory-grouped folds of train
    3. fit it on train
    4. cross-fit the calibrator inside train: out-of-fold scores from
       laboratory-grouped folds, so no outcome is calibrated by a model that
       saw it, and then refit the chosen calibrator on all of those out-of-fold
       scores
    5. measure calibration and discrimination on test, laboratories neither the
       model nor the calibrator has ever seen
    6. count coverage per stratum from the whole cohort
    7. open the gate only where every count clears its floor

Step 4 is the one everybody gets wrong in two different directions. Fitting the
calibrator on in-sample training scores produces a reliability curve that looks
perfect and means nothing. Holding whole laboratories back for calibration on
top of the test laboratories is the overcorrection: with seven contributing
laboratories it leaves a calibration set too small to fit a calibrator on, and
the head refuses rather than existing. Cross-fitting inside the training
laboratories is the thing that is both honest and affordable.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence

import numpy as np

from . import SCHEMA_VERSION
from . import features as F
from .calibration import (
    CalibrationError, CalibrationMetrics, CalibratorChoice, metrics as calibration_metrics,
    select_calibrator, wilson,
)
from .coverage import (
    Available, CoverageTable, Stratum, Unavailable, stratum_for, stratum_of,
)
from .endpoints import QUESTIONS, QUESTION_LABEL, QUESTION_SENTENCE
from .evaluation import abstention
from .models import FitError, MODELS, Selection, select_model
from .outcomes import OutcomeRecord, count_cohort, endpoint_disagreements, for_question
from .splits import Holdout, LeakageError, lab_holdout

#: Below this many evidence channels recorded for at least one outcome, a fit
#: would succeed on a wall of NaN and learn nothing. Refusing is the only safe
#: behaviour, because a model that learned nothing still returns a number.
MIN_INFORMATIVE_CHANNELS = 8


#: A calibrated probability is never certainty. 100% would assert that an
#: experiment cannot fail, and 0% that it cannot succeed, and no finite cohort
#: evidences either. Anything that rounds to the edge is printed as a bound, in
#: this one place, so no surface can format its way around it.
CERTAINTY_FLOOR = 0.005
CERTAINTY_CEILING = 0.995


def format_probability(p: float) -> str:
    """One formatter, so no view can print a certainty this package cannot hold."""
    if not np.isfinite(p):
        return "not available"
    if p >= CERTAINTY_CEILING:
        return ">99%"
    if p <= CERTAINTY_FLOOR:
        return "<1%"
    return f"{p:.0%}"


@dataclass(frozen=True)
class Estimate:
    """
    A calibrated probability, and everything a reader needs to judge it.

    There is no way to construct one of these without a cohort: `availability`
    is a required field and `network.estimate` only builds an Estimate on the
    Available branch. The sentence is assembled here rather than in the console,
    so no surface can print the number without the clause that makes it a
    scientific claim.
    """

    question: str
    gene: str
    probability: float
    lower: float
    upper: float
    availability: Available
    #: Per-family contribution to the log-odds, or None for a tree model.
    contributions: Mapping[str, float] | None
    #: What the model could not read for this candidate.
    missing_channels: tuple[str, ...]
    #: Group levels the model had never seen, so no lab-specific adjustment
    #: was applied.
    unseen_groups: Mapping[str, tuple[str, ...]]
    model_version: str
    #: 'none', 'upper' or 'lower'. See `Head.bound` for why a probability is
    #: ever censored, and what the sentence says when it is.
    bounded: str = "none"
    bound_note: str = ""

    #: Mirrors `Available.available`, so a caller can branch on one attribute
    #: across every return value of `estimate` without knowing which class it
    #: got. `evaluation.abstention` counts on exactly this.
    available = True

    @property
    def display(self) -> str:
        return format_probability(self.probability)

    @property
    def interval_display(self) -> str:
        return (f"95% calibration interval {format_probability(self.lower)} to "
                f"{format_probability(self.upper)}")

    @property
    def sentence(self) -> str:
        lead = {"upper": "At least ", "lower": "At most "}.get(self.bounded, "")
        return (f"{lead}{self.display} {QUESTION_SENTENCE[self.question]}, "
                f"{self.interval_display}.")

    @property
    def cohort_sentence(self) -> str:
        return self.availability.cohort_sentence()

    def as_dict(self) -> dict:
        return {
            "available": True,
            "question": self.question,
            "question_label": QUESTION_LABEL[self.question],
            "gene": self.gene,
            "probability": self.probability,
            "lower": self.lower, "upper": self.upper,
            "display": self.display,
            "interval_display": self.interval_display,
            "sentence": self.sentence,
            "cohort_sentence": self.cohort_sentence,
            "coverage": self.availability.as_dict(),
            "contributions": (dict(self.contributions)
                              if self.contributions is not None else None),
            "missing_channels": list(self.missing_channels),
            "unseen_groups": {k: list(v) for k, v in self.unseen_groups.items()},
            "model_version": self.model_version,
            "bounded": self.bounded,
            "bound_note": self.bound_note,
        }


@dataclass(frozen=True)
class HeadEvaluation:
    """How one head performed on laboratories it was never fitted on."""

    holdout: Holdout
    test: CalibrationMetrics
    calibration: CalibratorChoice
    selection: Selection
    n_train: int
    n_calibration: int
    n_test: int
    #: How the calibration scores were obtained, in words, because "calibrated
    #: on 310 outcomes" means something different for a held-out laboratory and
    #: for cross-fitted folds.
    calibration_source: str = ""

    def as_dict(self) -> dict:
        return {
            "holdout": self.holdout.as_dict(),
            "test": self.test.as_dict(),
            "calibration": self.calibration.as_dict(),
            "calibration_source": self.calibration_source,
            "model_selection": self.selection.as_dict(),
            "n_train": self.n_train, "n_calibration": self.n_calibration,
            "n_test": self.n_test,
            "headline": (
                f"On {self.n_test} outcomes from "
                f"{len(self.holdout.test_groups)} laboratories the model never saw: "
                f"Brier {self.test.brier:.3f} against {self.test.brier_base_rate:.3f} "
                f"for always predicting the base rate, calibration slope "
                f"{self.test.fit.slope:.2f}, intercept {self.test.fit.intercept:+.2f}."),
        }


@dataclass
class Head:
    """One question's model, calibrator, coverage and evaluation."""

    question: str
    model_name: str
    model: Any
    calibrator: Any
    coverage: CoverageTable
    evaluation: HeadEvaluation | None
    n_outcomes: int
    n_decided: int
    n_labs: int
    fitted_at: str
    #: The lowest and highest calibrated probability the calibration cohort
    #: actually contains. Outside it the fitted curve is an extrapolation: there
    #: is no outcome at that level to have calibrated it against.
    evidenced_low: float = 0.0
    evidenced_high: float = 1.0

    def bound(self, p: float) -> tuple[float, str, str]:
        """
        Censor a probability to the range the calibration cohort evidences.

        A model can be confident past the edge of its evidence. If the most
        extreme calibrated probability in the cohort was 0.94, then 0.98 is the
        fitted curve extrapolating, and "98%" would be a sharper claim than any
        outcome supports. The honest statement is "at least 94%", which is what
        this returns, together with the reason.

        The number is censored rather than refused because the candidates a lab
        most wants a number for are exactly the ones at the top of the range,
        and "no estimate available for your best hit" would be useless. The
        sentence changes, so the censoring is visible rather than silent.
        """
        if p > self.evidenced_high:
            return (self.evidenced_high, "upper",
                    f"The model put this candidate above every probability the "
                    f"calibration cohort contains (highest "
                    f"{format_probability(self.evidenced_high)}), so the estimate is "
                    f"reported as a floor rather than extrapolating the fitted curve.")
        if p < self.evidenced_low:
            return (self.evidenced_low, "lower",
                    f"The model put this candidate below every probability the "
                    f"calibration cohort contains (lowest "
                    f"{format_probability(self.evidenced_low)}), so the estimate is "
                    f"reported as a ceiling rather than extrapolating the fitted curve.")
        return (p, "none", "")

    def score(self, X: np.ndarray, groups: Mapping[str, Sequence[str | None]] | None
              ) -> np.ndarray:
        return self.model.predict_proba(X, groups)

    def probability(self, X: np.ndarray,
                    groups: Mapping[str, Sequence[str | None]] | None) -> np.ndarray:
        return self.calibrator.transform(self.score(X, groups))

    @property
    def version(self) -> str:
        """
        A content-addressed version string.

        Everything that could change a printed number is in the hash: the
        model, the calibrator, the feature spec, and the number of decided
        outcomes behind it. Two estimates with the same version string were
        produced by the same machine from the same cohort.
        """
        payload = {
            "question": self.question,
            "model": self.model.manifest(),
            "calibrator": self.calibrator.manifest(),
            "feature_spec": F.spec_hash(),
            "n_decided": self.n_decided,
            "evidenced": [self.evidenced_low, self.evidenced_high],
        }
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
        return f"{SCHEMA_VERSION}+{self.question}+{digest[:12]}"

    def as_dict(self) -> dict:
        return {
            "question": self.question,
            "question_label": QUESTION_LABEL[self.question],
            "model": self.model_name,
            "model_manifest": self.model.manifest(),
            "version": self.version,
            "n_outcomes": self.n_outcomes, "n_decided": self.n_decided,
            "n_labs": self.n_labs, "fitted_at": self.fitted_at,
            "evidenced_low": self.evidenced_low,
            "evidenced_high": self.evidenced_high,
            "evaluation": self.evaluation.as_dict() if self.evaluation else None,
            "coverage": self.coverage.as_dict(),
        }


@dataclass(frozen=True)
class HeadRefusal:
    """Why a head could not be fitted. Kept, so the console can say so."""

    question: str
    reason: str
    because: str
    n_outcomes: int
    n_decided: int
    n_labs: int

    def as_dict(self) -> dict:
        return {**asdict(self), "question_label": QUESTION_LABEL[self.question]}


class ValidationNetwork:
    """
    The fitted network, or the honest absence of one.

    A network with no heads is a perfectly valid object and is what SplicR has
    today. `estimate` on it returns Unavailable for all four questions with the
    reason naming what is outstanding, which is exactly what the console shows.
    """

    def __init__(self, heads: Mapping[str, Head] | None = None,
                 refusals: Mapping[str, HeadRefusal] | None = None,
                 cohort: Mapping[str, Any] | None = None):
        self.heads: dict[str, Head] = dict(heads or {})
        self.refusals: dict[str, HeadRefusal] = dict(refusals or {})
        self.cohort: dict[str, Any] = dict(cohort or {})

    # -- fitting -----------------------------------------------------------

    @classmethod
    def fit(cls, outcomes: Sequence[OutcomeRecord], *,
            n_calibration_labs: int = 0, n_test_labs: int = 2,
            seed: int = 20261003,
            when: datetime | None = None) -> "ValidationNetwork":
        rows = list(outcomes)
        disagreements = endpoint_disagreements(rows)
        counts = count_cohort(rows)
        rate = len(disagreements) / counts.n_decided if counts.n_decided else 0.0
        moment = (when or datetime.now(timezone.utc)).astimezone(timezone.utc)

        heads: dict[str, Head] = {}
        refusals: dict[str, HeadRefusal] = {}
        for question in QUESTIONS:
            subset = for_question(rows, question)
            built = _fit_head(question, subset, rows,
                              n_calibration_labs=n_calibration_labs,
                              n_test_labs=n_test_labs, seed=seed,
                              disagreement_rate=rate, when=moment)
            if isinstance(built, Head):
                heads[question] = built
            else:
                refusals[question] = built

        return cls(heads, refusals, {
            "schema": "splicr.validation-cohort-summary.v1",
            "fitted_at": moment.isoformat(),
            "counts": counts.as_dict(),
            "disagreement_rate": rate,
            "n_disagreements": len(disagreements),
            "disagreements": disagreements[:50],
            "feature_spec": F.spec_manifest(),
        })

    # -- estimating --------------------------------------------------------

    def estimate(self, candidate: Mapping[str, Any], *,
                 questions: Sequence[str] = QUESTIONS,
                 groups: Mapping[str, Sequence[str | None]] | None = None
                 ) -> dict[str, Estimate | Unavailable]:
        """
        Estimate every requested question for one candidate.

        The gate is consulted first, and a shut gate short-circuits: the model
        is not even asked, so there is no number in memory for a later code path
        to find and render. This is deliberate. A function that computes a
        probability and then decides not to show it leaves that probability
        sitting in a variable, and sooner or later somebody logs it.
        """
        gene = str(candidate.get("gene") or "")
        context = candidate.get("context") or {}
        vector = F.build_vector(candidate)
        X = F.design_matrix([vector])
        missing = tuple(name for name in F.FEATURE_NAMES
                        if not np.isfinite(vector.get(name, np.nan)))

        out: dict[str, Estimate | Unavailable] = {}
        for question in questions:
            stratum = stratum_for(question, context)
            head = self.heads.get(question)
            if head is None:
                refusal = self.refusals.get(question)
                out[question] = Unavailable(
                    stratum, "head_not_fitted",
                    refusal.because if refusal else
                    f"No model is fitted for {QUESTION_LABEL[question].lower()}, "
                    f"because no validation outcome of that kind has been recorded.")
                continue
            availability = head.coverage.availability(stratum)
            if not isinstance(availability, Available):
                out[question] = availability
                continue
            raw = float(head.probability(X, groups)[0])
            p, bounded, bound_note = head.bound(raw)
            #: The interval is the binomial uncertainty of the stratum's own
            #: observed rate at this many outcomes, not a posterior from the
            #: model. It answers "how finely can a cohort this size resolve a
            #: probability", which is the uncertainty a reader can check.
            low, high = _estimate_interval(p, availability.n_decided)
            contributions = head.model.contributions(X)[0]
            out[question] = Estimate(
                question=question, gene=gene, probability=p, lower=low, upper=high,
                availability=availability,
                contributions=contributions.get("by_family"),
                missing_channels=missing,
                unseen_groups={k: tuple(v) for k, v in
                               (head.model.unseen_groups(groups).items()
                                if groups else {}.items())},
                model_version=head.version,
                bounded=bounded, bound_note=bound_note)
        return out

    def estimate_many(self, candidates: Sequence[Mapping[str, Any]], *,
                      questions: Sequence[str] = QUESTIONS,
                      groups: Mapping[str, Sequence[str | None]] | None = None
                      ) -> list[dict[str, Estimate | Unavailable]]:
        return [self.estimate(c, questions=questions, groups=groups)
                for c in candidates]

    # -- reading -----------------------------------------------------------

    @property
    def fitted(self) -> bool:
        return bool(self.heads)

    def status(self) -> dict:
        """What the console's network page reads. Every head, fitted or not."""
        return {
            "schema": "splicr.validation-network-status.v1",
            "fitted": self.fitted,
            "n_heads": len(self.heads),
            "cohort": self.cohort,
            "heads": {q: self.heads[q].as_dict() for q in sorted(self.heads)},
            "refusals": {q: self.refusals[q].as_dict() for q in sorted(self.refusals)},
            "questions": [
                {"question": q, "label": QUESTION_LABEL[q],
                 "sentence": QUESTION_SENTENCE[q],
                 "fitted": q in self.heads,
                 "because": (None if q in self.heads
                             else self.refusals[q].because if q in self.refusals
                             else "No outcome of this kind has been recorded.")}
                for q in QUESTIONS
            ],
        }

    def abstention_over(self, candidates: Sequence[Mapping[str, Any]],
                        question: str) -> dict:
        """How often the gate declined across a candidate list, and why."""
        results = [self.estimate(c, questions=(question,))[question]
                   for c in candidates]
        return abstention(results).as_dict()


def _estimate_interval(p: float, n: int) -> tuple[float, float]:
    """
    A 95% interval around a calibrated probability, from the cohort's size.

    Wilson on n * p successes out of n, which is the interval a reader would
    compute from "this many outcomes at about this rate". It widens as the
    cohort shrinks, which is the behaviour that stops a 40-outcome stratum from
    printing 79% as if it were 79 ± 2.
    """
    if n <= 0:
        return (0.0, 1.0)
    successes = int(round(p * n))
    return wilson(successes, n)


def _out_of_fold_scores(X: np.ndarray, y: np.ndarray,
                        groups: Mapping[str, Sequence[str | None]],
                        train: Sequence[int], model_name: str, *,
                        seed: int) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    Score every training outcome with a model fitted without its laboratory.

    This is the cross-fitting step. Each fold holds out whole laboratories,
    a model of the chosen kind is fitted on the rest, and the held-out rows are
    scored. A fold the model cannot be fitted on contributes no scores rather
    than in-sample ones, and if too few survive the caller's calibrator
    selection refuses on its own minimum.
    """
    from .splits import grouped_folds as _folds

    rows = list(train)
    labs = [str(groups["lab"][i]) for i in rows]
    folds = _folds(labs, n_folds=5, seed=seed, what="lab")
    sub = lambda idx: {k: [groups[k][rows[i]] for i in idx] for k in groups}
    scores: list[float] = []
    targets: list[int] = []
    keep_labs: list[str] = []
    for fold in folds:
        inner_train = [rows[i] for i in fold.train]
        inner_test = [rows[i] for i in fold.test]
        if not inner_train or not inner_test:
            continue
        if y[inner_train].min() == y[inner_train].max():
            continue
        inner_groups = {k: [groups[k][i] for i in inner_train] for k in groups}
        try:
            fitted = MODELS[model_name]().fit(X[inner_train], y[inner_train], inner_groups)
            p = fitted.predict_proba(
                X[inner_test], {k: [groups[k][i] for i in inner_test] for k in groups})
        except (FitError, ValueError):
            continue
        scores.extend(float(v) for v in p)
        targets.extend(int(v) for v in y[inner_test])
        keep_labs.extend(str(groups["lab"][i]) for i in inner_test)
    if not scores:
        raise FitError("no laboratory-grouped fold of the training set could be fitted")
    return np.asarray(scores, dtype=float), np.asarray(targets, dtype=int), keep_labs


def _fit_head(question: str, subset: Sequence[OutcomeRecord],
              everything: Sequence[OutcomeRecord], *,
              n_calibration_labs: int, n_test_labs: int, seed: int,
              disagreement_rate: float, when: datetime) -> Head | HeadRefusal:
    counts = count_cohort(subset)
    refuse = lambda reason, because: HeadRefusal(
        question, reason, because, counts.total, counts.n_decided, counts.n_labs)

    decided = [o for o in subset if o.decided]
    if not decided:
        return refuse(
            "no_outcomes",
            f"No decided outcome bears on {QUESTION_LABEL[question].lower()} yet. "
            f"{counts.total} record(s) of this kind exist, {counts.pending} still "
            f"at the bench.")
    if any(o.lab_id is None for o in decided):
        unattributed = sum(1 for o in decided if o.lab_id is None)
        return refuse(
            "unattributed_outcomes",
            f"{unattributed} of {len(decided)} decided outcomes have no "
            f"laboratory recorded, so no held-out-laboratory evaluation is "
            f"possible. Attribute them or exclude them deliberately.")

    labs = [o.lab_id for o in decided]
    try:
        holdout = lab_holdout(labs, n_calibration=n_calibration_labs,
                              n_test=n_test_labs, seed=seed)
    except LeakageError as exc:
        return refuse("too_few_labs", str(exc))

    vectors = [F.build_vector({**o.evidence, "gene": o.gene,
                               "context": o.context.as_dict()})
               for o in decided]
    #: An outcome's `evidence` is the frozen candidate as the pipeline shaped
    #: it: {hit, qc, flags, artifacts, context, ...}. A cohort imported with a
    #: different shape produces vectors that are entirely NaN, and a fit on
    #: those does not fail - it succeeds and learns nothing, which is far worse
    #: than refusing. So the completeness is measured and a cohort that carries
    #: almost no evidence is refused with the channels it did manage to read.
    completeness = F.completeness(vectors)
    informative = sum(1 for share in completeness.values() if share > 0.0)
    if informative < MIN_INFORMATIVE_CHANNELS:
        best = sorted(completeness.items(), key=lambda kv: -kv[1])[:5]
        return refuse(
            "evidence_missing",
            f"only {informative} of {len(F.FEATURE_NAMES)} evidence channels were "
            f"recorded for any outcome, below the {MIN_INFORMATIVE_CHANNELS} this "
            f"model needs. The best covered were "
            f"{', '.join(f'{name} ({share:.0%})' for name, share in best if share > 0) or 'none'}. "
            f"Check that each outcome's frozen evidence has the shape the "
            f"pipeline writes: hit, qc, flags, artifacts and context.")

    X = F.design_matrix(vectors)
    y = np.asarray([o.label for o in decided], dtype=int)
    groups = {
        "lab": [o.lab_id for o in decided],
        "study": [o.study_id or f"study-unknown:{o.lab_id}" for o in decided],
        "assay": [o.context.assay_class for o in decided],
    }
    sub = lambda rows, mapping: {k: [v[i] for i in rows] for k, v in mapping.items()}

    train = list(holdout.train)
    calibration = list(holdout.calibration)
    test = list(holdout.test)
    try:
        selection = select_model(X[train], y[train], sub(train, groups), unit="lab")
        model = MODELS[selection.chosen]().fit(X[train], y[train], sub(train, groups))
    except (FitError, LeakageError, ValueError) as exc:
        return refuse("model_not_fitted", f"No model could be fitted: {exc}")

    #: Out-of-fold scores for the calibrator. Every training outcome is scored
    #: by a model fitted without its laboratory, so the score-to-probability
    #: mapping is estimated on predictions that are genuinely out of sample
    #: without spending a whole laboratory on it. When a separate calibration
    #: laboratory was requested, its own in-sample-free scores are used instead.
    if calibration:
        try:
            cal_scores = model.predict_proba(X[calibration], sub(calibration, groups))
            cal_y = y[calibration]
            cal_labs = [groups["lab"][i] for i in calibration]
            cal_how = (f"a separate held-out calibration laboratory "
                       f"({', '.join(holdout.calibration_groups)})")
        except ValueError as exc:
            return refuse("not_calibrated", f"the calibration set could not be scored: {exc}")
    else:
        try:
            cal_scores, cal_y, cal_labs = _out_of_fold_scores(
                X, y, groups, train, selection.chosen, seed=seed)
        except (FitError, LeakageError, ValueError) as exc:
            return refuse(
                "not_calibrated",
                f"out-of-fold scores for calibration could not be produced: {exc}")
        cal_how = (f"out-of-fold scores across {len(holdout.train_groups)} "
                   f"laboratory-grouped folds of the training set")

    try:
        choice = select_calibrator(cal_scores, cal_y, cal_labs)
    except (CalibrationError, LeakageError) as exc:
        return refuse(
            "not_calibrated",
            f"A model was fitted but no calibrator could be, from {cal_how}: {exc}")

    try:
        test_metrics = calibration_metrics(
            choice.calibrator.transform(model.predict_proba(X[test], sub(test, groups))),
            y[test])
    except CalibrationError as exc:
        return refuse("not_evaluated",
                      f"A calibrated model exists but could not be evaluated on a "
                      f"held-out laboratory: {exc}")

    #: Coverage counts the whole cohort for this question, pending and
    #: inconclusive included in the per-stratum breakdown but only decided
    #: outcomes in the counts that open the gate.
    coverage = CoverageTable.from_outcomes(
        [o for o in subset if stratum_of(o) is not None],
        disagreement_rate=disagreement_rate,
        holdout_evaluated=True,
        holdout_note=(f"held-out-laboratory evaluation on record: "
                      f"{len(test)} outcomes from "
                      f"{len(holdout.test_groups)} laboratories"))

    #: The range of calibrated probabilities the calibration cohort contains.
    #: Computed from the out-of-fold (or held-out) scores the calibrator was
    #: fitted on, which is the only set that evidences the mapping.
    evidenced = choice.calibrator.transform(cal_scores)
    return Head(question=question, model_name=selection.chosen, model=model,
                calibrator=choice.calibrator, coverage=coverage,
                evaluation=HeadEvaluation(holdout, test_metrics, choice, selection,
                                          len(train), len(cal_y), len(test),
                                          cal_how),
                n_outcomes=counts.total, n_decided=counts.n_decided,
                n_labs=counts.n_labs, fitted_at=when.isoformat(),
                evidenced_low=float(np.min(evidenced)),
                evidenced_high=float(np.max(evidenced)))

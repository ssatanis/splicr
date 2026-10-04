"""
Two models, and the boring one goes first.

WHY A LOGISTIC MODEL IS THE DEFAULT

With a hundred outcomes from eight laboratories, a deep model has more
parameters than facts. Worse, it cannot tell a reader why the estimate moved,
and this product's whole proposition is that the reader can check the reasoning.

So the first model is a hierarchical logistic regression:

    logit P(validated) = b0 + b'x + u_lab + u_study + u_assay

with the group effects shrunk toward zero by a ridge penalty whose strength is
estimated from the data. That shrinkage is what makes the model usable on a
laboratory it has never seen: an unseen group contributes u = 0, which is the
population average rather than a guess, and the model says so.

The second model is a gradient-boosted tree, which reads NaN natively and finds
interactions the linear model cannot. It is fitted, evaluated and then used only
if it wins on held-out laboratories. `select_model` is where that comparison
happens, and it is deliberately not a free choice made per screen.

WHAT NEITHER MODEL DOES

Neither one outputs a probability that anybody is allowed to print. They output
a score. Turning a score into a probability is `calibration`'s job and printing
one is `coverage`'s decision, and keeping those three apart is the difference
between a calibrated estimate and a decorative percentage.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Mapping, Sequence

import numpy as np

from . import features as F
from .splits import assert_no_leakage, grouped_folds, normalise_groups

#: Below this many decided outcomes nothing is fitted at all. Not a soft
#: warning: `fit` raises. A model fitted on 12 outcomes would produce a number,
#: and the number would be noise wearing a percent sign.
MIN_FIT_OUTCOMES = 30
#: And the outcomes have to come from more than one place, or the "model" is a
#: description of one laboratory's habits.
MIN_FIT_GROUPS = 3


class FitError(ValueError):
    """A cohort that cannot support a fit, said out loud."""


# ---------------------------------------------------------------------------
# Shared preparation
# ---------------------------------------------------------------------------

@dataclass
class Standardiser:
    """
    Centre and scale the value columns; leave the indicators alone.

    The imputed mean is stored, not recomputed at predict time, because a
    candidate scored today must be placed against the cohort the model was
    fitted on and not against whatever happens to be in the current batch.
    """

    mean: np.ndarray = field(default_factory=lambda: np.zeros(0))
    scale: np.ndarray = field(default_factory=lambda: np.ones(0))
    n_value_columns: int = 0

    def fit(self, X: np.ndarray) -> "Standardiser":
        n_values = len(F.FEATURE_NAMES)
        values = X[:, :n_values]
        finite = np.isfinite(values)
        #: nanmean over a column nobody recorded warns and returns NaN. Counting
        #: the finite entries first says the same thing without the warning, and
        #: a channel with no observations centres on 0 and contributes nothing.
        counts = finite.sum(axis=0)
        totals = np.where(finite, values, 0.0).sum(axis=0)
        mean = np.where(counts > 0, totals / np.maximum(counts, 1), 0.0)
        centred = np.where(np.isfinite(values), values, mean) - mean
        scale = centred.std(axis=0, ddof=0)
        #: A constant column has no spread. Dividing by its zero would produce
        #: NaN coefficients and poison the whole fit, so it is scaled by 1 and
        #: contributes nothing, which is exactly what a constant should do.
        scale = np.where(scale > 1e-12, scale, 1.0)
        self.mean, self.scale, self.n_value_columns = mean, scale, n_values
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        n = self.n_value_columns
        values = X[:, :n]
        filled = np.where(np.isfinite(values), values, self.mean)
        out = X.astype(float).copy()
        out[:, :n] = (filled - self.mean) / self.scale
        indicators = out[:, n:]
        out[:, n:] = np.where(np.isfinite(indicators), indicators, 1.0)
        return out

    def as_dict(self) -> dict:
        return {"mean": self.mean.tolist(), "scale": self.scale.tolist(),
                "n_value_columns": self.n_value_columns}


def _group_codes(groups: Sequence[str | None], *, what: str) -> tuple[np.ndarray, list[str]]:
    labels = normalise_groups(groups, what=what)
    unique, inverse = np.unique(np.asarray(labels), return_inverse=True)
    return inverse.astype(np.int64), [str(u) for u in unique]


def _check_cohort(y: np.ndarray, groups: Sequence[str | None]) -> None:
    if y.size < MIN_FIT_OUTCOMES:
        raise FitError(
            f"{y.size} decided outcomes is below the {MIN_FIT_OUTCOMES} this model "
            f"requires. Nothing was fitted.")
    if y.min() == y.max():
        raise FitError(
            "every outcome in this cohort has the same result, so there is nothing "
            "to learn and no probability to calibrate.")
    n_groups = len({str(g).strip() for g in groups if g is not None and str(g).strip()})
    if n_groups < MIN_FIT_GROUPS:
        raise FitError(
            f"outcomes come from {n_groups} group(s); {MIN_FIT_GROUPS} are required "
            f"before a fit describes anything other than one laboratory.")


# ---------------------------------------------------------------------------
# Hierarchical logistic regression
# ---------------------------------------------------------------------------

@dataclass
class HierarchicalLogistic:
    """
    Penalised logistic regression with shrunk random intercepts.

    Fitted by iteratively reweighted least squares on the joint design
    [features | lab dummies | study dummies | assay dummies], with an L2 penalty
    of `ridge` on the feature coefficients and a separate penalty per group
    family. The group penalties are re-estimated between IRLS rounds from the
    spread of the current effects, which is the ECME step for a variance
    component and keeps a laboratory with four outcomes from acquiring an
    intercept of its own.
    """

    ridge: float = 1.0
    max_iter: int = 60
    tol: float = 1e-7
    #: Group families modelled as random intercepts, in this order.
    group_kinds: tuple[str, ...] = ("lab", "study", "assay")

    standardiser: Standardiser = field(default_factory=Standardiser)
    intercept: float = 0.0
    beta: np.ndarray = field(default_factory=lambda: np.zeros(0))
    group_levels: dict[str, list[str]] = field(default_factory=dict)
    group_effects: dict[str, np.ndarray] = field(default_factory=dict)
    group_variance: dict[str, float] = field(default_factory=dict)
    n_fit: int = 0
    converged: bool = False
    algorithm: str = "hierarchical_logistic_irls"

    # -- fitting -----------------------------------------------------------

    def fit(self, X: np.ndarray, y: Sequence[int],
            groups: Mapping[str, Sequence[str | None]]) -> "HierarchicalLogistic":
        target = np.asarray(y, dtype=float)
        primary = groups.get("lab") or groups.get("study")
        if primary is None:
            raise FitError("a hierarchical fit needs at least a lab or study grouping")
        _check_cohort(target, primary)

        design = [self.standardiser.fit(X).transform(X)]
        blocks: list[tuple[str, int, int]] = []
        self.group_levels, self.group_effects, self.group_variance = {}, {}, {}
        offset = design[0].shape[1]
        for kind in self.group_kinds:
            raw = groups.get(kind)
            if raw is None:
                continue
            codes, levels = _group_codes(raw, what=kind)
            #: A family with a single level is collinear with the intercept and
            #: contributes nothing but an unidentifiable parameter.
            if len(levels) < 2:
                continue
            dummies = np.zeros((len(codes), len(levels)), dtype=float)
            dummies[np.arange(len(codes)), codes] = 1.0
            design.append(dummies)
            blocks.append((kind, offset, offset + len(levels)))
            offset += len(levels)
            self.group_levels[kind] = levels
        if not blocks:
            raise FitError(
                "no grouping had two or more levels, so no hierarchy could be fitted")

        A = np.hstack([np.ones((X.shape[0], 1))] + design)
        n_features = design[0].shape[1]
        penalty = np.zeros(A.shape[1])
        penalty[1:1 + n_features] = self.ridge
        for kind, lo, hi in blocks:
            self.group_variance[kind] = 1.0
            penalty[1 + lo:1 + hi] = 1.0

        coef = np.zeros(A.shape[1])
        self.converged = False
        for _ in range(self.max_iter):
            eta = A @ coef
            #: Clipped before the exponential. An unclipped logit of -800 is a
            #: silent overflow and the weights come back as zeros.
            p = 1.0 / (1.0 + np.exp(-np.clip(eta, -30.0, 30.0)))
            w = np.maximum(p * (1.0 - p), 1e-8)
            z = eta + (target - p) / w
            WA = A * w[:, None]
            H = A.T @ WA + np.diag(penalty)
            rhs = A.T @ (w * z)
            try:
                step = np.linalg.solve(H, rhs)
            except np.linalg.LinAlgError:
                step = np.linalg.lstsq(H, rhs, rcond=None)[0]
            delta = float(np.max(np.abs(step - coef)))
            coef = step
            # Re-estimate each group family's variance from its own spread.
            for kind, lo, hi in blocks:
                u = coef[1 + lo:1 + hi]
                variance = float(max(np.mean(u * u), 1e-4))
                self.group_variance[kind] = variance
                penalty[1 + lo:1 + hi] = 1.0 / variance
            if delta < self.tol:
                self.converged = True
                break

        self.intercept = float(coef[0])
        self.beta = coef[1:1 + n_features].copy()
        for kind, lo, hi in blocks:
            self.group_effects[kind] = coef[1 + lo:1 + hi].copy()
        self.n_fit = int(X.shape[0])
        return self

    # -- prediction --------------------------------------------------------

    def _linear(self, X: np.ndarray,
                groups: Mapping[str, Sequence[str | None]] | None) -> np.ndarray:
        if self.beta.size == 0:
            raise FitError("this model has not been fitted")
        eta = self.intercept + self.standardiser.transform(X) @ self.beta
        if groups:
            for kind, levels in self.group_levels.items():
                raw = groups.get(kind)
                if raw is None:
                    continue
                effects = self.group_effects[kind]
                index = {name: i for i, name in enumerate(levels)}
                #: An unseen group gets 0, which is the population average.
                #: `unseen_groups` reports which, so the console can say that
                #: this estimate did not use a laboratory-specific adjustment.
                eta = eta + np.asarray(
                    [effects[index[str(g).strip()]] if str(g).strip() in index else 0.0
                     for g in raw], dtype=float)
        return eta

    def decision_function(self, X: np.ndarray,
                          groups: Mapping[str, Sequence[str | None]] | None = None
                          ) -> np.ndarray:
        return self._linear(X, groups)

    def predict_proba(self, X: np.ndarray,
                      groups: Mapping[str, Sequence[str | None]] | None = None
                      ) -> np.ndarray:
        """
        The model's own uncalibrated output.

        Named `predict_proba` because that is the protocol sklearn and the
        calibrators expect. It is not a validation probability and nothing in
        this package prints it.
        """
        return 1.0 / (1.0 + np.exp(-np.clip(self._linear(X, groups), -30.0, 30.0)))

    def unseen_groups(self, groups: Mapping[str, Sequence[str | None]]) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for kind, levels in self.group_levels.items():
            raw = groups.get(kind)
            if raw is None:
                continue
            known = set(levels)
            missing = sorted({str(g).strip() for g in raw if str(g).strip() not in known})
            if missing:
                out[kind] = missing
        return out

    # -- explanation -------------------------------------------------------

    def contributions(self, X: np.ndarray) -> list[dict]:
        """
        Per-family contribution to the log-odds, for one or more candidates.

        Each family's contribution is the sum of its columns' standardised value
        times coefficient, so the numbers add up to the linear predictor minus
        the intercept and group effects. This is the thing that lets the console
        answer "why did the estimate move", and it is exact rather than
        approximated, which is why the linear model is the default.
        """
        Z = self.standardiser.transform(X)
        out: list[dict] = []
        for i in range(Z.shape[0]):
            terms = Z[i] * self.beta
            per_family: dict[str, float] = {family: 0.0 for family in F.FAMILIES}
            per_column: dict[str, float] = {}
            for j, column in enumerate(F.COLUMNS):
                family = F.family_of(column)
                if family is not None:
                    per_family[family] += float(terms[j])
                per_column[column] = float(terms[j])
            out.append({"intercept": self.intercept,
                        "total": float(self.intercept + terms.sum()),
                        "by_family": per_family,
                        "by_column": per_column})
        return out

    def coefficients(self) -> list[dict]:
        return [{"column": column, "family": F.family_of(column),
                 "coefficient": float(self.beta[j])}
                for j, column in enumerate(F.COLUMNS)]

    # -- identity ----------------------------------------------------------

    def manifest(self) -> dict:
        payload = {
            "algorithm": self.algorithm,
            "feature_spec_hash": F.spec_hash(),
            "ridge": self.ridge,
            "intercept": self.intercept,
            "beta": self.beta.tolist(),
            "standardiser": self.standardiser.as_dict(),
            "group_levels": {k: list(v) for k, v in sorted(self.group_levels.items())},
            "group_effects": {k: v.tolist() for k, v in sorted(self.group_effects.items())},
            "group_variance": dict(sorted(self.group_variance.items())),
            "n_fit": self.n_fit,
            "converged": self.converged,
        }
        payload["manifest_hash"] = hashlib.sha256(
            json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
        return payload


# ---------------------------------------------------------------------------
# Gradient-boosted trees
# ---------------------------------------------------------------------------

@dataclass
class GradientBoosted:
    """
    HistGradientBoostingClassifier, with NaN read as a split rather than filled.

    Shallow and heavily regularised on purpose: this is fitted on hundreds of
    outcomes, not millions. If it does not beat the linear model on held-out
    laboratories, `select_model` does not use it.
    """

    max_depth: int = 3
    max_iter: int = 200
    learning_rate: float = 0.05
    min_samples_leaf: int = 10
    l2_regularization: float = 1.0
    random_state: int = 20261003
    model: object | None = None
    n_fit: int = 0
    #: Columns the fitting cohort actually recorded. A channel observed for no
    #: candidate is dropped rather than passed to the learner as a wall of NaN,
    #: which sklearn's histogram binner cannot bin.
    usable: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=bool))
    algorithm: str = "hist_gradient_boosting"

    def fit(self, X: np.ndarray, y: Sequence[int],
            groups: Mapping[str, Sequence[str | None]]) -> "GradientBoosted":
        from sklearn.ensemble import HistGradientBoostingClassifier

        target = np.asarray(y, dtype=int)
        primary = groups.get("lab") or groups.get("study")
        if primary is None:
            raise FitError("a fit needs at least a lab or study grouping")
        _check_cohort(target.astype(float), primary)
        self.model = HistGradientBoostingClassifier(
            max_depth=self.max_depth, max_iter=self.max_iter,
            learning_rate=self.learning_rate, min_samples_leaf=self.min_samples_leaf,
            l2_regularization=self.l2_regularization,
            early_stopping=False, random_state=self.random_state)
        #: Only the value columns. The missing indicators are redundant for a
        #: learner that splits on NaN directly, and feeding both lets the tree
        #: reconstruct the indicator and overfit absence.
        values = X[:, :len(F.FEATURE_NAMES)]
        self.usable = np.isfinite(values).any(axis=0)
        if not self.usable.any():
            raise FitError("no evidence channel was recorded for any candidate")
        self.model.fit(values[:, self.usable], target)
        self.n_fit = int(X.shape[0])
        return self

    def predict_proba(self, X: np.ndarray,
                      groups: Mapping[str, Sequence[str | None]] | None = None
                      ) -> np.ndarray:
        if self.model is None:
            raise FitError("this model has not been fitted")
        values = X[:, :len(F.FEATURE_NAMES)]
        return self.model.predict_proba(values[:, self.usable])[:, 1]

    def decision_function(self, X: np.ndarray,
                          groups: Mapping[str, Sequence[str | None]] | None = None
                          ) -> np.ndarray:
        p = np.clip(self.predict_proba(X, groups), 1e-9, 1 - 1e-9)
        return np.log(p / (1 - p))

    def unseen_groups(self, groups: Mapping[str, Sequence[str | None]]) -> dict[str, list[str]]:
        #: The tree has no group terms, so every group is equally unseen and
        #: equally used. Returning {} would imply it adjusted for the lab.
        return {}

    def contributions(self, X: np.ndarray) -> list[dict]:
        #: Deliberately not approximated. A per-family number from a tree would
        #: be a post-hoc attribution presented in the same place as the linear
        #: model's exact decomposition, and a reader could not tell which they
        #: were looking at.
        return [{"intercept": None, "total": None, "by_family": None,
                 "by_column": None,
                 "note": "A boosted tree does not decompose into per-family "
                         "contributions. Fit the hierarchical model for that."}
                for _ in range(X.shape[0])]

    def manifest(self) -> dict:
        payload = {
            "algorithm": self.algorithm,
            "feature_spec_hash": F.spec_hash(),
            "max_depth": self.max_depth, "max_iter": self.max_iter,
            "learning_rate": self.learning_rate,
            "min_samples_leaf": self.min_samples_leaf,
            "l2_regularization": self.l2_regularization,
            "random_state": self.random_state, "n_fit": self.n_fit,
            "usable_columns": [F.FEATURE_NAMES[i]
                               for i in np.flatnonzero(self.usable).tolist()],
        }
        payload["manifest_hash"] = hashlib.sha256(
            json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
        return payload


MODELS = {"hierarchical_logistic": HierarchicalLogistic, "gradient_boosted": GradientBoosted}


# ---------------------------------------------------------------------------
# Choosing between them
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Selection:
    chosen: str
    scores: dict[str, float]
    n_folds: int
    unit: str
    because: str

    def as_dict(self) -> dict:
        return {"chosen": self.chosen, "log_loss_by_model": self.scores,
                "n_folds": self.n_folds, "unit": self.unit, "because": self.because}


def _log_loss(p: np.ndarray, y: np.ndarray) -> float:
    q = np.clip(p, 1e-12, 1 - 1e-12)
    return float(-np.mean(y * np.log(q) + (1 - y) * np.log(1 - q)))


def select_model(X: np.ndarray, y: Sequence[int],
                 groups: Mapping[str, Sequence[str | None]], *,
                 unit: str = "lab", n_folds: int = 5,
                 seed: int = 20261003) -> Selection:
    """
    Fit every model on grouped folds and keep the one with the best held-out
    log loss. Log loss rather than AUROC, because the thing being chosen will be
    calibrated and then printed as a probability, and AUROC is blind to whether
    the probabilities are any good.

    A model that cannot be fitted on a fold loses that fold rather than the
    whole comparison, and the reason is carried in `because`.
    """
    target = np.asarray(y, dtype=float)
    primary = groups.get(unit) or groups.get("lab") or groups.get("study")
    if primary is None:
        raise FitError(f"model selection needs a {unit} grouping")
    folds = grouped_folds(primary, n_folds=n_folds, seed=seed, what=unit)
    losses: dict[str, list[float]] = {name: [] for name in MODELS}
    notes: list[str] = []
    for fold in folds:
        train, test = list(fold.train), list(fold.test)
        if len(train) == 0 or len(test) == 0:
            continue
        if target[train].min() == target[train].max():
            notes.append(f"fold {fold.index} had one class in training")
            continue
        sub = lambda rows: {k: [v[i] for i in rows] for k, v in groups.items()}
        assert_no_leakage(sub(train).get(unit, []), sub(test).get(unit, []), what=unit)
        for name, factory in MODELS.items():
            try:
                fitted = factory().fit(X[train], target[train].astype(int), sub(train))
                p = fitted.predict_proba(X[test], sub(test))
            except (FitError, ValueError) as exc:
                notes.append(f"{name} could not fit fold {fold.index}: {exc}")
                continue
            losses[name].append(_log_loss(p, target[test]))
    scored = {name: float(np.mean(v)) for name, v in losses.items() if v}
    if not scored:
        raise FitError("no model could be fitted on any fold: " + "; ".join(notes[:3]))
    chosen = min(scored, key=scored.__getitem__)
    margin = (sorted(scored.values())[1] - scored[chosen]) if len(scored) > 1 else None
    because = (f"{chosen} had the lowest held-out log loss across {len(folds)} "
               f"{unit}-grouped folds" +
               (f", by {margin:.4f} nats" if margin is not None else "") + ".")
    if notes:
        because += " Notes: " + "; ".join(notes[:3]) + "."
    return Selection(chosen, scored, len(folds), unit, because)

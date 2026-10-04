"""
Turning a score into a probability, and measuring whether it is one.

THE DISTINCTION THAT MATTERS

Ranking tells you A is above B. Calibration tells you that when the number says
70%, about 70% of them validate. Those are different properties and a model can
have the first without the second: a well-ranked score squashed into [0.9, 1.0]
orders candidates perfectly and lies about every one of them.

Everything printed as a percentage in this product comes out of this file, and
it comes out of a calibrator fitted on a cohort that was not used to fit the
model and not used to test it.

WHY THREE CALIBRATORS

Isotonic regression is the usual recommendation and is wrong at this scale: it
is nonparametric, it needs hundreds of outcomes before its steps stop being
noise, and it cannot extrapolate past the calibration set's range. Platt
scaling is two parameters and works at n = 60 but assumes a sigmoid shape.
Beta calibration is three parameters and relaxes that assumption while staying
parametric.

So all three are fitted and the one with the best *grouped* cross-validated log
loss wins. Grouped, because a calibrator chosen on rows will choose isotonic
every time by memorising the calibration laboratory.

WHAT A RELIABILITY CURVE OWES ITS READER

A bin count. "Predicted 70%, observed 68%" over n = 4 is not evidence of
anything, and a curve drawn without its counts invites exactly that reading.
Every bin here carries n and a Wilson interval, and a bin below MIN_BIN_N is
returned with `sparse = True` so the console can draw it differently rather
than silently averaging it in.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Mapping, Protocol, Sequence

import numpy as np

from .splits import grouped_folds

#: Below this many decided outcomes no calibrator is fitted. A mapping from
#: score to probability estimated on 20 outcomes is a mapping from score to
#: that sample's accidents.
MIN_CALIBRATION_N = 60
#: Isotonic needs more than the parametric calibrators before its steps mean
#: anything, so it is not even a candidate below this.
MIN_ISOTONIC_N = 200
#: A reliability bin with fewer than this is drawn as sparse and never quoted.
MIN_BIN_N = 10

Z95 = 1.959963984540054


class Calibrator(Protocol):
    name: str

    def fit(self, scores: Sequence[float], y: Sequence[int]) -> "Calibrator": ...
    def transform(self, scores: Sequence[float]) -> np.ndarray: ...
    def manifest(self) -> dict: ...


def _logit(p: np.ndarray, eps: float = 1e-9) -> np.ndarray:
    q = np.clip(np.asarray(p, dtype=float), eps, 1 - eps)
    return np.log(q / (1 - q))


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(np.asarray(x, dtype=float), -30.0, 30.0)))


def _irls(A: np.ndarray, y: np.ndarray, *, ridge: float = 1e-6,
          max_iter: int = 100, tol: float = 1e-10) -> np.ndarray:
    coef = np.zeros(A.shape[1])
    penalty = np.full(A.shape[1], ridge)
    for _ in range(max_iter):
        eta = A @ coef
        p = _sigmoid(eta)
        w = np.maximum(p * (1 - p), 1e-9)
        z = eta + (y - p) / w
        H = A.T @ (A * w[:, None]) + np.diag(penalty)
        rhs = A.T @ (w * z)
        try:
            step = np.linalg.solve(H, rhs)
        except np.linalg.LinAlgError:
            step = np.linalg.lstsq(H, rhs, rcond=None)[0]
        if float(np.max(np.abs(step - coef))) < tol:
            coef = step
            break
        coef = step
    return coef


# ---------------------------------------------------------------------------

@dataclass
class PlattCalibrator:
    """Logistic recalibration of the score's logit. Two parameters."""

    name: str = "platt"
    a: float = 1.0
    b: float = 0.0
    n_fit: int = 0

    def fit(self, scores: Sequence[float], y: Sequence[int]) -> "PlattCalibrator":
        x = _logit(np.asarray(scores, dtype=float))
        target = np.asarray(y, dtype=float)
        coef = _irls(np.column_stack([np.ones_like(x), x]), target)
        self.b, self.a = float(coef[0]), float(coef[1])
        self.n_fit = int(target.size)
        return self

    def transform(self, scores: Sequence[float]) -> np.ndarray:
        return _sigmoid(self.b + self.a * _logit(np.asarray(scores, dtype=float)))

    def manifest(self) -> dict:
        return {"calibrator": self.name, "a": self.a, "b": self.b, "n_fit": self.n_fit}


@dataclass
class BetaCalibrator:
    """
    Beta calibration: logistic in log p and log(1-p) separately.

    Three parameters, so it can represent a mapping that is steeper at one end
    than the other, which a two-parameter sigmoid cannot. Kull, Silva Filho and
    Flach's family; fitted here by the same IRLS as Platt.
    """

    name: str = "beta"
    a: float = 1.0
    b: float = 1.0
    c: float = 0.0
    n_fit: int = 0

    def fit(self, scores: Sequence[float], y: Sequence[int]) -> "BetaCalibrator":
        p = np.clip(np.asarray(scores, dtype=float), 1e-9, 1 - 1e-9)
        target = np.asarray(y, dtype=float)
        A = np.column_stack([np.ones_like(p), np.log(p), -np.log(1 - p)])
        coef = _irls(A, target)
        self.c, self.a, self.b = float(coef[0]), float(coef[1]), float(coef[2])
        self.n_fit = int(target.size)
        return self

    def transform(self, scores: Sequence[float]) -> np.ndarray:
        p = np.clip(np.asarray(scores, dtype=float), 1e-9, 1 - 1e-9)
        return _sigmoid(self.c + self.a * np.log(p) - self.b * np.log(1 - p))

    def manifest(self) -> dict:
        return {"calibrator": self.name, "a": self.a, "b": self.b, "c": self.c,
                "n_fit": self.n_fit}


@dataclass
class IsotonicCalibrator:
    """
    Monotone step function by pool-adjacent-violators.

    Clipped to the calibration set's own range at both ends, because an isotonic
    fit has nothing to say about a score beyond the scores it saw and
    extrapolating a step function is inventing a value.
    """

    name: str = "isotonic"
    x: np.ndarray = field(default_factory=lambda: np.zeros(0))
    v: np.ndarray = field(default_factory=lambda: np.zeros(0))
    n_fit: int = 0

    def fit(self, scores: Sequence[float], y: Sequence[int]) -> "IsotonicCalibrator":
        from sklearn.isotonic import IsotonicRegression

        s = np.asarray(scores, dtype=float)
        target = np.asarray(y, dtype=float)
        fitted = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip").fit(s, target)
        grid = np.unique(s)
        self.x, self.v = grid, np.asarray(fitted.predict(grid), dtype=float)
        self.n_fit = int(target.size)
        return self

    def transform(self, scores: Sequence[float]) -> np.ndarray:
        if self.x.size == 0:
            raise ValueError("this calibrator has not been fitted")
        return np.interp(np.asarray(scores, dtype=float), self.x, self.v,
                         left=float(self.v[0]), right=float(self.v[-1]))

    def manifest(self) -> dict:
        return {"calibrator": self.name, "n_knots": int(self.x.size),
                "x_min": float(self.x[0]) if self.x.size else None,
                "x_max": float(self.x[-1]) if self.x.size else None,
                "n_fit": self.n_fit}


CALIBRATORS: dict[str, type] = {
    "platt": PlattCalibrator,
    "beta": BetaCalibrator,
    "isotonic": IsotonicCalibrator,
}


class CalibrationError(ValueError):
    """A cohort that cannot license a probability."""


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def log_loss(p: Sequence[float], y: Sequence[int]) -> float:
    q = np.clip(np.asarray(p, dtype=float), 1e-12, 1 - 1e-12)
    t = np.asarray(y, dtype=float)
    return float(-np.mean(t * np.log(q) + (1 - t) * np.log(1 - q)))


def brier(p: Sequence[float], y: Sequence[int]) -> float:
    return float(np.mean((np.asarray(p, dtype=float) - np.asarray(y, dtype=float)) ** 2))


def wilson(successes: int, n: int) -> tuple[float, float]:
    """A 95% interval that is exactly 0 or 1 at the edges rather than near it."""
    if n <= 0:
        return (0.0, 1.0)
    phat = successes / n
    denominator = 1 + (Z95 * Z95) / n
    centre = phat + (Z95 * Z95) / (2 * n)
    spread = Z95 * np.sqrt(phat * (1 - phat) / n + (Z95 * Z95) / (4 * n * n))
    lower = 0.0 if successes == 0 else max(0.0, (centre - spread) / denominator)
    upper = 1.0 if successes == n else min(1.0, (centre + spread) / denominator)
    return (float(lower), float(upper))


@dataclass(frozen=True)
class Bin:
    lower: float
    upper: float
    label: str
    n: int
    predicted: float | None
    observed: float | None
    observed_lower: float | None
    observed_upper: float | None
    validated: int
    #: True when this bin has too few outcomes to be read as a measurement.
    sparse: bool

    def as_dict(self) -> dict:
        return asdict(self)


DEFAULT_EDGES: tuple[float, ...] = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)


def reliability(p: Sequence[float], y: Sequence[int], *,
                edges: Sequence[float] = DEFAULT_EDGES) -> list[Bin]:
    """
    The reliability curve, with every bin's denominator attached.

    An empty bin is still returned, with n = 0 and null predicted/observed, so
    that a console drawing the curve shows a gap where there is no evidence
    instead of interpolating across it.
    """
    probs = np.asarray(p, dtype=float)
    target = np.asarray(y, dtype=float)
    if probs.shape != target.shape:
        raise CalibrationError("probabilities and outcomes must be the same length")
    bins: list[Bin] = []
    cuts = list(edges)
    for i in range(len(cuts) - 1):
        lo, hi = cuts[i], cuts[i + 1]
        last = i == len(cuts) - 2
        mask = (probs >= lo) & ((probs <= hi) if last else (probs < hi))
        n = int(mask.sum())
        validated = int(target[mask].sum()) if n else 0
        label = f"{int(round(lo * 100))}-{int(round(hi * 100))}%"
        if n == 0:
            bins.append(Bin(lo, hi, label, 0, None, None, None, None, 0, True))
            continue
        low, high = wilson(validated, n)
        bins.append(Bin(lo, hi, label, n, float(probs[mask].mean()),
                        validated / n, low, high, validated, n < MIN_BIN_N))
    return bins


def expected_calibration_error(bins: Sequence[Bin]) -> float | None:
    """Weighted mean absolute gap between predicted and observed, over non-empty bins."""
    used = [b for b in bins if b.n > 0 and b.predicted is not None and b.observed is not None]
    total = sum(b.n for b in used)
    if total == 0:
        return None
    return float(sum(b.n * abs(b.predicted - b.observed) for b in used) / total)


@dataclass(frozen=True)
class CalibrationFit:
    """A fitted logistic recalibration of the probabilities, as a diagnostic."""

    slope: float
    intercept: float
    n: int

    @property
    def verdict(self) -> str:
        """
        What the slope and intercept say, in words.

        Slope 1 and intercept 0 is perfect. A slope below 1 means the
        probabilities are too extreme (overconfident); above 1, too timid. The
        intercept is the overall level: positive means the cohort validated more
        often than the numbers said.
        """
        parts: list[str] = []
        if abs(self.slope - 1.0) < 0.15:
            parts.append("the spread of the probabilities is about right")
        elif self.slope < 1.0:
            parts.append("the probabilities are more extreme than the outcomes warrant")
        else:
            parts.append("the probabilities are less extreme than the outcomes warrant")
        if abs(self.intercept) < 0.2:
            parts.append("and the overall level matches")
        elif self.intercept > 0:
            parts.append("and the cohort validated more often than the numbers said")
        else:
            parts.append("and the cohort validated less often than the numbers said")
        return ", ".join(parts) + "."

    def as_dict(self) -> dict:
        return {"slope": self.slope, "intercept": self.intercept, "n": self.n,
                "verdict": self.verdict}


def calibration_fit(p: Sequence[float], y: Sequence[int]) -> CalibrationFit:
    x = _logit(np.asarray(p, dtype=float))
    target = np.asarray(y, dtype=float)
    coef = _irls(np.column_stack([np.ones_like(x), x]), target)
    return CalibrationFit(float(coef[1]), float(coef[0]), int(target.size))


@dataclass(frozen=True)
class CalibrationMetrics:
    n: int
    n_validated: int
    base_rate: float
    log_loss: float
    brier: float
    ece: float | None
    fit: CalibrationFit
    bins: tuple[Bin, ...]
    #: Brier of always predicting the base rate. A model that cannot beat this
    #: has learned nothing, and the console says so rather than drawing a curve.
    brier_base_rate: float

    @property
    def beats_base_rate(self) -> bool:
        return self.brier < self.brier_base_rate

    def as_dict(self) -> dict:
        return {
            "n": self.n, "n_validated": self.n_validated, "base_rate": self.base_rate,
            "log_loss": self.log_loss, "brier": self.brier, "ece": self.ece,
            "brier_base_rate": self.brier_base_rate,
            "beats_base_rate": self.beats_base_rate,
            "fit": self.fit.as_dict(),
            "bins": [b.as_dict() for b in self.bins],
        }


def metrics(p: Sequence[float], y: Sequence[int], *,
            edges: Sequence[float] = DEFAULT_EDGES) -> CalibrationMetrics:
    probs = np.asarray(p, dtype=float)
    target = np.asarray(y, dtype=float)
    if probs.size == 0:
        raise CalibrationError("no outcomes to measure calibration against")
    base = float(target.mean())
    bins = reliability(probs, target, edges=edges)
    return CalibrationMetrics(
        n=int(target.size), n_validated=int(target.sum()), base_rate=base,
        log_loss=log_loss(probs, target), brier=brier(probs, target),
        ece=expected_calibration_error(bins), fit=calibration_fit(probs, target),
        bins=tuple(bins),
        brier_base_rate=float(np.mean((base - target) ** 2)))


# ---------------------------------------------------------------------------
# Choosing a calibrator
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CalibratorChoice:
    name: str
    calibrator: object
    scores: dict[str, float]
    n_folds: int
    n_fit: int
    because: str

    def as_dict(self) -> dict:
        return {"chosen": self.name, "log_loss_by_calibrator": self.scores,
                "n_folds": self.n_folds, "n_fit": self.n_fit,
                "because": self.because,
                "parameters": self.calibrator.manifest()}

    def hash(self) -> str:
        return hashlib.sha256(json.dumps(
            self.as_dict(), sort_keys=True, allow_nan=False).encode()).hexdigest()


def select_calibrator(scores: Sequence[float], y: Sequence[int],
                      groups: Sequence[str | None], *,
                      n_folds: int = 5, seed: int = 20261003,
                      unit: str = "lab") -> CalibratorChoice:
    """
    Fit each eligible calibrator on grouped folds and keep the best log loss.

    Raises rather than returning an uncalibrated fallback below
    MIN_CALIBRATION_N. A silent fallback is how an uncalibrated score ends up
    rendered as a percentage: the call succeeds, nothing downstream knows, and
    the number looks the same as a real one.
    """
    s = np.asarray(scores, dtype=float)
    target = np.asarray(y, dtype=float)
    if s.size != target.size:
        raise CalibrationError("scores and outcomes must be the same length")
    if target.size < MIN_CALIBRATION_N:
        raise CalibrationError(
            f"{target.size} decided outcomes is below the {MIN_CALIBRATION_N} required "
            f"to fit a calibrator. No probability can be stated.")
    if target.min() == target.max():
        raise CalibrationError(
            "every outcome in the calibration set has the same result, so no "
            "mapping from score to probability is identifiable.")

    eligible = {name: cls for name, cls in CALIBRATORS.items()
                if name != "isotonic" or target.size >= MIN_ISOTONIC_N}
    folds = grouped_folds(groups, n_folds=n_folds, seed=seed, what=unit)
    losses: dict[str, list[float]] = {name: [] for name in eligible}
    notes: list[str] = []
    for fold in folds:
        train, test = list(fold.train), list(fold.test)
        if not train or not test or target[train].min() == target[train].max():
            notes.append(f"fold {fold.index} could not be used")
            continue
        for name, cls in eligible.items():
            try:
                fitted = cls().fit(s[train], target[train].astype(int))
                losses[name].append(log_loss(fitted.transform(s[test]), target[test]))
            except (ValueError, np.linalg.LinAlgError) as exc:
                notes.append(f"{name} failed on fold {fold.index}: {exc}")
    scored = {name: float(np.mean(v)) for name, v in losses.items() if v}
    if not scored:
        raise CalibrationError("no calibrator could be fitted on any fold: " +
                               "; ".join(notes[:3]))
    chosen = min(scored, key=scored.__getitem__)
    final = eligible[chosen]().fit(s, target.astype(int))
    skipped = sorted(set(CALIBRATORS) - set(eligible))
    because = (f"{chosen} had the lowest log loss across {len(folds)} {unit}-grouped "
               f"folds, then was refitted on all {target.size} decided outcomes.")
    if skipped:
        because += (f" {', '.join(skipped)} was not a candidate: it needs at least "
                    f"{MIN_ISOTONIC_N} outcomes and this cohort has {target.size}.")
    return CalibratorChoice(chosen, final, scored, len(folds), int(target.size), because)

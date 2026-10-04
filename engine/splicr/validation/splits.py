"""
Splits that do not leak, and refuse to pretend they didn't.

THE TRAP THIS FILE EXISTS FOR

One publication can contribute five hundred candidates. Split those rows at
random and the model has already seen the experiment it is being tested on: the
same screen, the same library, the same batch, the same cell line, the same
QC. The resulting number is a measurement of memorisation.

So nothing here splits rows. Everything splits groups, and the group is named:

    lab      the unit for the headline claim. "Does SplicR work in a laboratory
             it has never trained on" is the question a customer asks, and it is
             the only question a lab-held-out split can answer.
    study    the minimum defensible unit. Two screens from one campaign share
             batch and personnel.
    time     the honest one. A model fitted on 2027 and tested on 2026 has seen
             the future, whatever the group structure says.

`assert_no_leakage` is called by the fitting code itself rather than left to a
caller's discipline, and it raises. A warning would be ignored by exactly the
code paths that need it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np


class LeakageError(AssertionError):
    """A split that put the same group on both sides of the line."""


@dataclass(frozen=True)
class Fold:
    index: int
    train: tuple[int, ...]
    test: tuple[int, ...]
    train_groups: tuple[str, ...]
    test_groups: tuple[str, ...]

    def as_dict(self) -> dict:
        return {"index": self.index, "n_train": len(self.train), "n_test": len(self.test),
                "n_train_groups": len(self.train_groups),
                "n_test_groups": len(self.test_groups),
                "test_groups": list(self.test_groups)}


def assert_no_leakage(train_groups: Iterable[str], test_groups: Iterable[str],
                      *, what: str = "group") -> None:
    shared = set(train_groups) & set(test_groups)
    if shared:
        raise LeakageError(
            f"{len(shared)} {what}(s) appear in both train and test: "
            f"{sorted(shared)[:5]}{' ...' if len(shared) > 5 else ''}")


def normalise_groups(groups: Sequence[str | None], *, what: str = "group") -> list[str]:
    """
    Group labels, with a missing one refused rather than invented.

    A row with no lab is not its own lab. Giving it a synthetic id would make a
    cohort of 40 unattributed outcomes look like 40 independent laboratories,
    which is the exact overstatement the cluster bootstrap exists to prevent.
    """
    out: list[str] = []
    for i, g in enumerate(groups):
        text = "" if g is None else str(g).strip()
        if not text:
            raise LeakageError(
                f"row {i} has no {what}, so it cannot be placed in a grouped split. "
                f"Attribute it or exclude it deliberately.")
        out.append(text)
    return out


def grouped_folds(groups: Sequence[str | None], *, n_folds: int = 5,
                  seed: int = 20261003, what: str = "group") -> list[Fold]:
    """
    K folds over whole groups, balanced by group size, largest group first.

    Greedy balancing rather than a random partition, because with eight
    laboratories of wildly different sizes a random partition routinely puts
    most of the data in one fold and then reports a confidence interval from it.
    """
    labels = normalise_groups(groups, what=what)
    unique, inverse = np.unique(np.asarray(labels), return_inverse=True)
    if len(unique) < 2:
        raise LeakageError(
            f"a grouped split needs at least 2 {what}s; this cohort has {len(unique)}")
    k = min(n_folds, len(unique))
    sizes = np.bincount(inverse, minlength=len(unique))
    rng = np.random.default_rng(seed)
    order = np.lexsort((rng.random(len(unique)), -sizes))
    buckets: list[list[int]] = [[] for _ in range(k)]
    loads = np.zeros(k, dtype=np.int64)
    for g in order:
        target = int(np.argmin(loads))
        buckets[target].append(int(g))
        loads[target] += int(sizes[g])

    folds: list[Fold] = []
    for i, bucket in enumerate(buckets):
        test_groups = tuple(sorted(str(unique[g]) for g in bucket))
        test_mask = np.isin(inverse, bucket)
        train_groups = tuple(sorted(set(map(str, unique)) - set(test_groups)))
        assert_no_leakage(train_groups, test_groups, what=what)
        folds.append(Fold(i,
                          tuple(np.flatnonzero(~test_mask).tolist()),
                          tuple(np.flatnonzero(test_mask).tolist()),
                          train_groups, test_groups))
    return folds


@dataclass(frozen=True)
class Holdout:
    """One train / calibrate / test partition, with the groups it used named."""

    train: tuple[int, ...]
    calibration: tuple[int, ...]
    test: tuple[int, ...]
    train_groups: tuple[str, ...]
    calibration_groups: tuple[str, ...]
    test_groups: tuple[str, ...]
    unit: str

    def as_dict(self) -> dict:
        return {
            "unit": self.unit,
            "n_train": len(self.train), "n_calibration": len(self.calibration),
            "n_test": len(self.test),
            "train_groups": list(self.train_groups),
            "calibration_groups": list(self.calibration_groups),
            "test_groups": list(self.test_groups),
        }


def lab_holdout(groups: Sequence[str | None], *, n_calibration: int = 0,
                n_test: int = 2, seed: int = 20261003,
                unit: str = "lab") -> Holdout:
    """
    Whole laboratories held back for the test, and optionally for calibration.

    `n_calibration = 0` is the default and is what the network uses. Holding
    whole laboratories back for calibration as well as for the test sounds
    stricter and is in practice worse: with seven contributing laboratories it
    spends a seventh of the cohort on a calibration set that is then too small
    to fit a calibrator on at all, which is exactly the failure this default
    exists to avoid.

    Instead the calibrator is cross-fitted inside the training laboratories —
    out-of-fold scores from laboratory-grouped folds, so every training outcome
    contributes to the calibration while none of them is calibrated by a model
    that saw it. The test laboratories stay untouched by both steps, which is
    the property that matters: calibrating on the test set is how a reliability
    curve comes out perfect and means nothing.

    Pass a positive `n_calibration` when the cohort is large enough to afford a
    separate calibration laboratory and the extra strictness is wanted.
    """
    labels = normalise_groups(groups, what=unit)
    unique = np.unique(np.asarray(labels))
    #: Two training groups minimum, because the calibrator is cross-fitted over
    #: laboratory-grouped folds of the training set and one group cannot be
    #: folded.
    need = n_calibration + n_test + 2
    if len(unique) < need:
        raise LeakageError(
            f"a {unit}-held-out evaluation with {n_calibration} calibration and "
            f"{n_test} test {unit}s needs at least {need} {unit}s "
            f"({n_test} held out, {n_calibration} for calibration and 2 to fold "
            f"the cross-fitted calibration over); this cohort has {len(unique)}")
    if n_test < 1:
        raise LeakageError("a held-out evaluation needs at least one test group")
    rng = np.random.default_rng(seed)
    shuffled = list(rng.permutation(unique))
    test_groups = tuple(sorted(str(g) for g in shuffled[:n_test]))
    calibration_groups = tuple(sorted(str(g) for g in shuffled[n_test:n_test + n_calibration]))
    train_groups = tuple(sorted(str(g) for g in shuffled[n_test + n_calibration:]))
    assert_no_leakage(train_groups, test_groups, what=unit)
    assert_no_leakage(train_groups, calibration_groups, what=unit)
    assert_no_leakage(calibration_groups, test_groups, what=unit)
    arr = np.asarray(labels)
    pick = lambda names: tuple(np.flatnonzero(np.isin(arr, list(names))).tolist())
    return Holdout(pick(train_groups), pick(calibration_groups), pick(test_groups),
                   train_groups, calibration_groups, test_groups, unit)


def time_holdout(times: Sequence[str | None], groups: Sequence[str | None],
                 *, train_before: str, test_from: str,
                 unit: str = "study") -> Holdout:
    """
    A temporal split, with the group check still applied.

    The dates bound the partition and the groups keep it honest: a study that
    straddles the cutoff would otherwise appear on both sides, and a temporal
    split that leaks a study is no better than a random one.
    """
    labels = normalise_groups(groups, what=unit)
    stamps = ["" if t is None else str(t) for t in times]
    if any(not s for s in stamps):
        raise LeakageError("a temporal split needs a date on every row")
    train = tuple(i for i, s in enumerate(stamps) if s < train_before)
    test = tuple(i for i, s in enumerate(stamps) if s >= test_from)
    middle = tuple(i for i in range(len(stamps)) if i not in set(train) | set(test))
    train_groups = tuple(sorted({labels[i] for i in train}))
    test_groups = tuple(sorted({labels[i] for i in test}))
    calibration_groups = tuple(sorted({labels[i] for i in middle}))
    assert_no_leakage(train_groups, test_groups, what=unit)
    return Holdout(train, middle, test, train_groups, calibration_groups, test_groups,
                   f"time+{unit}")

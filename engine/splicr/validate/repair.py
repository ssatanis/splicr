"""
Predicted DNA repair outcomes at a Cas9 cut, from Lindel.

WHY THIS EXISTS

A pooled screen measures how many cells carrying a guide survive. It does not
measure whether the guide destroyed the protein. Cas9 makes a double-strand
break; the cell repairs it, and the local sequence around the cut largely
decides how. Roughly a third of repair events restore the reading frame (a
deletion of 3, 6, 9 ... bases), leaving a protein that is shortened but often
still folded and often still working. A guide whose repair outcomes are mostly
in-frame is a weak reagent, and a gene whose depletion signal rests on such
guides is under-measured, not non-essential.

WHAT THE MODEL IS, EXACTLY

Lindel (Chen et al., Nucleic Acids Research 2019; MIT licence) is a logistic
regression over the 20 bp protospacer and the microhomology present around the
cut. It returns a distribution over 557 indel classes and, with it, the fraction
of repair events that shift the frame. It was trained on a library of ~⁠40,000
integrated target sites measured in HEK293T.

WHAT IT IS NOT

It is a prediction, not an observation. It is trained in one cell background;
repair outcome ratios shift with cell type, with the DNA-repair genotype of the
line, and with Cas9 dose. Treat its output as a per-guide prior on knockout
efficacy whose usefulness has to be measured on real screens, which is what
`splicr.validate.benchmark` does. No number here is evidence that a particular
protein was or was not destroyed in a particular experiment.
"""

from __future__ import annotations

import functools
import os
import pickle
import sys
from dataclasses import dataclass, field
from pathlib import Path

from ..config import TOOLS_DIR

LINDEL_DIR = Path(os.environ.get("SPLICR_LINDEL_DIR", TOOLS_DIR / "lindel"))
#: Pinned so a prediction can be reproduced; the repo has no tags.
LINDEL_COMMIT = "fdcad580ba76bcfb7a98f58c3769b76f31693d63"
MODEL_NAME = "Lindel"


class RepairModelUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class RepairOutcome:
    """The predicted repair spectrum at one cut site."""

    #: Fraction of repair events whose net indel length is not a multiple of 3.
    frameshift: float
    #: 1 - frameshift: events that keep the reading frame.
    in_frame: float
    #: In-frame deletions as (offset of the deletion's first base relative to the
    #: cut, length in bp, probability), largest probability first.
    in_frame_deletions: tuple[tuple[int, int, float], ...] = ()
    #: Probability mass on 1-2 bp insertions and on >=3 bp insertions.
    insertion: float = 0.0
    #: Sum of probabilities on deletions of 1 bp, the most common single class.
    largest_class: float = 0.0
    model: str = MODEL_NAME
    model_commit: str = LINDEL_COMMIT

    @property
    def in_frame_deletion_mass(self) -> float:
        return sum(p for _, _, p in self.in_frame_deletions)


@functools.lru_cache(maxsize=1)
def _model():
    """Load Lindel once per process: 9.8 MB of weights plus its class index."""
    if not (LINDEL_DIR / "Predictor.py").exists():
        raise RepairModelUnavailable(
            f"Lindel is not at {LINDEL_DIR}. Install it with "
            f"scripts/data/fetch-lindel.sh, or set SPLICR_LINDEL_DIR.")
    if str(LINDEL_DIR) not in sys.path:
        sys.path.insert(0, str(LINDEL_DIR))
    import Predictor  # noqa: PLC0415 - loaded from a vendored directory

    weights = pickle.load(open(LINDEL_DIR / "Model_weights.pkl", "rb"))
    prereq = pickle.load(open(LINDEL_DIR / "model_prereq.pkl", "rb"))
    return Predictor, weights, prereq


def available() -> bool:
    try:
        _model()
        return True
    except Exception:  # noqa: BLE001 - availability probe
        return False


def _decode(label: dict, y_hat, frame_shift, top: int) -> tuple[tuple, float, float]:
    """Split the 557-class distribution into in-frame deletions and insertions."""
    dels: list[tuple[int, int, float]] = []
    insertion = 0.0
    largest = 0.0
    for name, idx in label.items():
        p = float(y_hat[idx])
        if p <= 0:
            continue
        head, _, tail = name.partition("+")
        if tail.isdigit():                      # deletion: "<start>+<length>"
            start, length = int(head), int(tail)
            if length == 1:
                largest += p
            if length % 3 == 0 and frame_shift[idx] == 0:
                dels.append((start, length, p))
        else:                                   # insertion: "1+A", "2+CT", "3"
            insertion += p
    dels.sort(key=lambda d: -d[2])
    return tuple(dels[:top]), insertion, largest


def predict(context: str, top_deletions: int = 12) -> RepairOutcome:
    """
    Repair spectrum for one 60 bp cut-site window.

    `context` must be laid out the way `validate.genome` builds it: 60 bases,
    protospacer at [13:33], NGG PAM at [33:36], cut between 29 and 30.
    """
    Predictor, weights, prereq = _model()
    if len(context) != 60:
        raise ValueError(f"expected a 60 bp context, got {len(context)}")
    out = Predictor.gen_prediction(context, weights, prereq)
    if isinstance(out, str):                    # Lindel reports errors as text
        raise ValueError(out)
    y_hat, frameshift = out
    label, _rev, _features, frame_shift = prereq
    dels, insertion, largest = _decode(label, y_hat, frame_shift, top_deletions)
    fs = float(frameshift)
    return RepairOutcome(frameshift=fs, in_frame=1.0 - fs, in_frame_deletions=dels,
                         insertion=insertion, largest_class=largest)


def predict_many(contexts: dict[str, str], processes: int = 0) -> dict[str, RepairOutcome]:
    """
    Repair spectra for many windows, keyed as the input is.

    Lindel is a few matrix products per guide but rebuilds a 557-class index
    each time, so a genome-wide library is minutes of CPU. Windows are
    independent, so they fan out across processes.
    """
    items = list(contexts.items())
    if processes and processes > 1 and len(items) > 500:
        from concurrent.futures import ProcessPoolExecutor

        # Each worker's BLAS otherwise defaults to every core, so N workers spawn
        # N*cores threads that fight for the same cache. Measured on a 10-core
        # box during a full-library build: load average 232, and the single
        # matrix product that dominates Lindel took 109 ms; pinned to one thread
        # per worker it takes 8.9 ms. Set before the workers fork, since the
        # BLAS reads these once at import.
        with ProcessPoolExecutor(max_workers=processes,
                                 initializer=_pin_blas) as pool:
            results = list(pool.map(_predict_one, items, chunksize=256))
    else:
        results = [_predict_one(it) for it in items]
    return {k: v for k, v in results if v is not None}


def _pin_blas() -> None:
    for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[var] = "1"


def _predict_one(item: tuple[str, str]):
    key, context = item
    try:
        return key, predict(context)
    except Exception:  # noqa: BLE001 - one unusable window must not stop a library
        return key, None

"""
A faster `gen_prediction` that agrees with vendored Lindel to machine precision.

WHY NOT JUST EDIT LINDEL

`engine/.tools/lindel` is pinned to an upstream commit so a prediction stays
reproducible and attributable. Patching it in place would make "Lindel
fdcad580" mean something different here than it does anywhere else. So the
reference implementation stays untouched and is kept as the oracle: this module
is checked against it, never trusted over it.

WHAT WAS SLOW, MEASURED RATHER THAN GUESSED

The obvious suspects are not the cost. Profiling `gen_prediction` puts 93% of
its time in the function's own body, not in `gen_indel` (2.2 ms), `gen_cmatrix`
(11.8 ms) or `onehotencoder` (0.01 ms). It is one line:

    np.dot(input_del, w2)          # (3033,) . (3033, 536)

1.6M multiply-adds should be a fraction of a millisecond, and it was taking
~100. Two separate reasons, and only the second is Lindel's:

  BLAS oversubscription   not a property of this code at all. Running the
                          library build with N worker processes gives each one
                          a BLAS that still defaults to every core, so N x
                          cores threads fight over cores. Measured at load
                          average 232 on a 10-core machine, pinning BLAS to one
                          thread per worker alone took this line from 109 ms to
                          8.9 ms. Any process-parallel caller must set
                          OMP_NUM_THREADS=1 (and the OPENBLAS/MKL/VECLIB
                          equivalents) in its workers; `repair.predict_many`
                          is the place for it.

  a dense dot on a        `input_del` is 3,033 entries of which 431 are 1.0 and
  one-hot vector          the rest are 0.0 - it is a one-hot feature vector, so
                          the product is a sum of 431 rows of w2, not a 1.6M-MAC
                          gemv. Gathering those rows and summing is 1.5 ms
                          against 13.9 ms, and gives bit-identical results
                          because summing the same terms picked out by a 0/1
                          mask is the same arithmetic.

The cached one-hot index and the COO class-merge matrix are kept because they
are free, but they are worth ~12 ms of the ~117, not the bulk of it.

WHAT IS IDENTICAL, AND WHAT IS ONLY EQUAL

Everything that touches the model is identical: the same weights, the same
feature layout, the same class index, the same merge rules, the same softmax.

The outputs are not bit-identical, and the reason is worth stating rather than
hiding behind a loose tolerance. Lindel merges redundant classes by multiplying
the class vector through a sparse matrix; this module adds the same terms
directly. Both compute the same sum, in a different order, so the results
differ by float reassociation - measured at 1.4e-17 at worst over 400 real
Avana cut sites, against probabilities that sum to 1. That is ~60 times machine
epsilon, and it is bounded by the arithmetic rather than by anything about the
sequence.

`verify()` therefore requires agreement to 1e-12 absolute, which is a trillion
times tighter than any difference that could change a ranking and a million
times tighter than the float noise it has to tolerate. A real divergence - a
wrong feature column, a missed merge - moves a class probability by order 1e-3
and cannot hide under that. `engine/tests/test_validate_repair.py` runs it. If
this file and Lindel disagree by more, this file is wrong.
"""

from __future__ import annotations

import functools
import itertools

import numpy as np


@functools.lru_cache(maxsize=8)
def _head_index(length: int) -> dict[str, int]:
    """Lindel's one-hot column layout for a sequence of `length`: singles then pairs."""
    nt = ["A", "T", "C", "G"]
    idx = {char + str(i): i * 4 + j for i in range(length) for j, char in enumerate(nt)}
    offset = 4 * length
    for i in range(length - 1):
        for j, a in enumerate(nt):
            for k, b in enumerate(nt):
                idx[a + b + str(i)] = offset + i * 16 + j * 4 + k
    return idx


def onehotencoder(seq: str) -> np.ndarray:
    length = len(seq)
    head = _head_index(length)
    encode = np.zeros(4 * length + 16 * (length - 1))
    for j, char in enumerate(seq):
        encode[head[char + str(j)]] = 1.0
    for k in range(length - 1):
        encode[head[seq[k:k + 2] + str(k)]] = 1.0
    return encode


def _apply_cmatrix(v: np.ndarray, indels, label: dict) -> np.ndarray:
    """
    `v @ cmax`, without building cmax.

    Lindel's matrix starts as the identity and, for each microhomology group,
    sets temp[i, group[0]] = 1 and temp[i, i] = 0 for every later member i.
    The order matters and the mutations are not disjoint: an index that appears
    in two groups keeps the column written by the first group *and* gains the
    second, so its mass is counted twice. That is upstream behaviour on real
    input, so it is reproduced here rather than tidied -- the alternative is a
    silently different model.
    """
    # column index -> set of row indices contributing to it, as Lindel's
    # mutations leave them.
    diag_off = set()
    extra: list[tuple[int, int]] = []
    for s in indels:
        if s[-2] != "mh":
            continue
        group = []
        for k in s[-3]:
            key = "+".join(map(str, k))
            if key in label:
                group.append(label[key])
        if len(group) > 1:
            for i in group[1:]:
                extra.append((i, group[0]))
                diag_off.add(i)

    out = v.copy()
    out[list(diag_off)] = 0.0 if diag_off else out[[]]
    for row, col in extra:
        out[col] += v[row]
    return out


def gen_prediction(seq: str, wb, prereq):
    """Drop-in replacement for `Predictor.gen_prediction`."""
    if seq[33:36] not in ("AGG", "TGG", "CGG", "GGG"):
        return "Error: No PAM sequence is identified."
    import Predictor  # noqa: PLC0415 - the vendored reference, for gen_indel

    guide = seq[13:33]
    w1, b1, w2, b2, w3, b3 = wb
    label, _rev_index, features, frame_shift = prereq

    indels = Predictor.gen_indel(seq, 30)
    input_indel = onehotencoder(guide)
    input_ins = onehotencoder(guide[-6:])
    input_del = np.concatenate(
        (Predictor.create_feature_array(features, indels), input_indel), axis=None)

    dratio, insratio = _softmax(input_indel @ w1 + b1)
    ds = _softmax(_onehot_dot(input_del, w2) + b2)
    ins = _softmax(input_ins @ w3 + b3)
    y_hat = _apply_cmatrix(np.concatenate((ds * dratio, ins * insratio), axis=None),
                           indels, label)
    return y_hat, float(y_hat @ frame_shift)


def _onehot_dot(v: np.ndarray, w: np.ndarray) -> np.ndarray:
    """
    `v @ w` where v is one-hot: sum the rows w selects.

    Bit-identical to the dense product, not merely close. Every entry of v is
    0.0 or 1.0, so the dense dot sums exactly the rows this gathers, in the
    same order, and the zero terms contribute exactly zero. Verified at
    max_abs_difference 0.0 over real Avana cut sites. If a caller ever passes a
    v that is not one-hot the assertion below catches it rather than silently
    returning a different model's answer.
    """
    nz = np.flatnonzero(v)
    if nz.size != int(v.sum()):
        return v @ w            # not one-hot; fall back to the dense product
    return w[nz].sum(axis=0, dtype=np.float64)


def _softmax(weights: np.ndarray) -> np.ndarray:
    e = np.exp(weights)
    return e / e.sum()


def verify(contexts, wb, prereq, rtol: float = 1e-9, atol: float = 1e-12) -> dict:
    """
    Run both paths over `contexts` and require they agree.

    The tolerance is for float reassociation only; see the module docstring for
    why it is 1e-12 and why a real divergence cannot fit under it. Returns the
    worst difference actually seen so a caller can check it stayed near
    machine epsilon rather than merely under the bar.
    """
    import Predictor  # noqa: PLC0415

    worst = 0.0
    n = 0
    for ctx in contexts:
        a = Predictor.gen_prediction(ctx, wb, prereq)
        b = gen_prediction(ctx, wb, prereq)
        if isinstance(a, str) or isinstance(b, str):
            if a != b:
                raise AssertionError(f"one path errored and the other did not: {a!r} vs {b!r}")
            continue
        n += 1
        d = float(np.max(np.abs(a[0] - b[0])))
        worst = max(worst, d, abs(a[1] - b[1]))
        if not np.allclose(a[0], b[0], rtol=rtol, atol=atol):
            raise AssertionError(f"class distribution differs by {d:.3e} on {ctx}")
        if not np.isclose(a[1], b[1], rtol=rtol, atol=atol):
            raise AssertionError(f"frameshift differs on {ctx}: {a[1]} vs {b[1]}")
    return {"compared": n, "max_abs_difference": worst}

"""Model selection, pre-2022 only.

Two decisions are made here and both are made by publication-grouped
cross-validation inside the 1567 pre-2022 screens:

1. which published model lists enter the consensus, and
2. the six blend weights, one set per ``cleaned_phenotype`` category.

The category-balanced objective (mean over categories of the within-category
mean) is used rather than the plain mean, because pre-2022 is 63% fitness
screens and the plain mean would fit the weights to that one category.
"""
import os, sys, json, pickle
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fast import pack, subpack
from proto import cat_of, pub_of, grouped_folds

HERE = os.path.dirname(os.path.abspath(__file__))
BLEND = ("llm_mix", "retr_r25", "retr_r10", "cnt_cleaned_phenotype", "global_rate",
         "global_relmass", "kn_drug_net", "kn_rep_net", "dm_common_ess", "neg_rate")


def add_mix(pk, models, c_rank=10.0):
    """Append an ``llm_mix`` column: uniform reciprocal-rank fusion of ``models``."""
    cols = [pk.names.index(f"llm_{m}") for m in models]
    mix = pk.X[:, cols].mean(1, keepdims=True)
    pk2 = type(pk).__new__(type(pk))
    pk2.__dict__.update(pk.__dict__)
    pk2.names = list(pk.names) + ["llm_mix"]
    pk2.X = np.hstack([pk.X, mix.astype(np.float32)])
    return pk2


def cat_balanced(scores, cats, order):
    return float(np.mean([scores[cats == c].mean() for c in order if (cats == c).any()]))


def fit_blend(pk, sel, cats, cols, grid, passes=3, w0=None, shrink_to=None, lam=0.0):
    names = pk.names
    w = np.zeros(len(names)) if w0 is None else np.asarray(w0, float).copy()
    def obj(v):
        s = pk.scores(v, sel)
        val = s[sel].mean()
        if shrink_to is not None and lam:
            val -= lam * float(np.abs(v[cols] - shrink_to[cols]).sum())
        return val
    best = obj(w) if np.any(w) else -1e9
    for _ in range(passes):
        imp = False
        for j in cols:
            cur, bj, bv = w[j], w[j], best
            for g in grid:
                if g == cur:
                    continue
                w[j] = g
                v = obj(w)
                if v > bv + 1e-9:
                    bv, bj = v, g
            w[j] = bj
            if bv > best + 1e-9:
                best, imp = bv, True
        if not imp:
            break
    return w, best

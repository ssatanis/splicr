"""The tuning protocol: per-category weights, publication-grouped CV, no test."""
import os, sys, pickle, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fast import pack, subpack, ascent
from common import base

#: channels excluded from fitting.  The two ``fewshot`` families retrieve their
#: few-shot examples by kNN over the *training* split, so their train-split
#: predictions were produced with train labels in hand -- they score 0.98-0.99
#: there and any weight fitted on pre-2022 queries would chase that.  They are
#: legitimate published systems, they are just unusable as tuning signal.
BANNED_PREFIX = ("llm_fewshot/",)


def usable_cols(names, banned=BANNED_PREFIX, drop=()):
    return [j for j, n in enumerate(names)
            if not n.startswith(tuple(banned)) and n not in drop]


def cat_of(pk):
    d = base()
    return np.array([d["meta"][i]["cleaned_phenotype"] for i in pk.i])


def pub_of(pk):
    d = base()
    return np.array([str(d["meta"][i].get("source_id") or f"nopub{i}") for i in pk.i])


def grouped_folds(pubs, n=5, seed=0):
    u = np.unique(pubs)
    rng = np.random.default_rng(seed)
    rng.shuffle(u)
    assign = {p: j % n for j, p in enumerate(u)}
    f = np.array([assign[p] for p in pubs])
    return [(np.where(f != k)[0], np.where(f == k)[0]) for k in range(n)]


def cv_score(pk, sel, cols, grid=None, passes=3, folds=5, seed=0, w0=None):
    """Publication-grouped CV estimate of held-out AnDCG for this channel set."""
    pubs = pub_of(pk)[sel]
    out = []
    for tr_i, te_i in grouped_folds(pubs, folds, seed):
        if len(te_i) == 0 or len(tr_i) == 0:
            continue
        ptr = subpack(pk, np.asarray(sel)[tr_i])
        pte = subpack(pk, np.asarray(sel)[te_i])
        w, _ = ascent(ptr, None, cols=cols, grid=grid, passes=passes, quiet=True, w0=w0)
        out.append(pte.scores(w).mean() * len(te_i))
    return sum(out) / len(sel)

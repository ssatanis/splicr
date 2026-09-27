"""Coordinate-ascent weight search, fitted by leave-one-publication-out."""
import os, sys, pickle, time, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import base, split_idx
from features import score_all, score_pool
HERE = os.path.dirname(os.path.abspath(__file__))

def load(which):
    return pickle.load(open(os.path.join(HERE, "cache", f"feat_{which}.pkl"), "rb"))

def cats(recs):
    d = base()
    return np.array([d["meta"][r["i"]]["cleaned_phenotype"] for r in recs])

def ascent(recs, names, w0=None, grid=None, passes=4, seed=0, order=None, log=True,
           weightsum=None, quiet=False):
    w = np.zeros(len(names)) if w0 is None else np.asarray(w0, float).copy()
    grid = grid if grid is not None else [0.0, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4]
    base_s = score_all(recs, w)
    best = base_s.mean() if w.any() else -1.0
    rng = np.random.default_rng(seed)
    for p in range(passes):
        idxs = order if order is not None else list(range(len(names)))
        improved = False
        for j in idxs:
            cur = w[j]; bj, bv = cur, best
            for g in grid:
                if g == cur:
                    continue
                w[j] = g
                v = score_all(recs, w).mean()
                if v > bv + 1e-9:
                    bv, bj = v, g
            w[j] = bj
            if bv > best + 1e-9:
                best = bv; improved = True
        if not quiet:
            print(f"  pass {p}: {best:.5f}  nonzero={int((w!=0).sum())}", flush=True)
        if not improved:
            break
    return w, best

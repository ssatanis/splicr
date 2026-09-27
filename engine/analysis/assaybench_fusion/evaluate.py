"""The single scoring pass: fit on pre-2022, score every split once, compare.

Reads ``cache/scheme.json`` (written by ``final_fit.py``, which chose the
scheme by publication-grouped cross-validation on pre-2022 screens only) and
produces ``results_fusion.json`` plus the tables in
``data/references/assaybench/RESULTS.md``.
"""
import sys, os, json, pickle, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fast import pack, subpack
from proto import cat_of, pub_of, grouped_folds
from final_fit import fit, BLEND
from common import base, split_idx, score_vec, K, DISC
from core import uni

HERE = os.path.dirname(os.path.abspath(__file__))


def paired(a, b, n=10000, seed=0):
    rng = np.random.default_rng(seed)
    d = np.asarray(a) - np.asarray(b)
    idx = rng.integers(0, len(d), (n, len(d)))
    bs = d[idx].mean(1)
    return float(d.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def fit_final(tr, cols, cats, per_category, shrink):
    wg, _ = fit(tr, np.arange(tr.n), cols)
    out = {"__global__": wg}
    if per_category:
        for c in sorted(set(cats)):
            sel = np.where(cats == c)[0]
            if len(sel) < 12:
                out[c] = wg
                continue
            w, _ = fit(tr, sel, cols, w0=wg, passes=2)
            out[c] = (1 - shrink) * w + shrink * wg
    return out


def apply(pk, wmap, cats):
    s = np.zeros(pk.n)
    for c in sorted(set(cats)):
        sel = np.where(cats == c)[0]
        w = wmap.get(c, wmap["__global__"])
        s[sel] = pk.scores(w, sel)[sel]
    return s


def published_scores(split, densified):
    """Every published system, scored on one split, shipped or densified."""
    u = uni(); d = base()
    idx = split_idx(split)
    out = {}
    for model, per in d["preds"].items():
        vals, names = [], []
        for i in idx:
            p = per.get(i)
            if p is None:
                continue
            lib = dict(zip(u.ulib[i], u.rel[i]))
            g = u.remap[p]
            rels = []
            if densified:
                for x in g:
                    if x >= 0 and x in lib:
                        rels.append(lib[x])
                    if len(rels) >= K:
                        break
            else:
                for pos, x in enumerate(g[:K]):
                    if x >= 0 and x in lib:
                        rels.append(lib[x])
            t = d["targets"][i]
            if t["idcg"] == 0:
                vals.append(0.0); names.append(i); continue
            r = np.asarray(rels[:K], np.float32)
            obs = float(r @ DISC[: len(r)]) / t["idcg"]
            vals.append(max((obs - t["rand"]) / t["denom"], 0.0)); names.append(i)
        if vals:
            out[model] = (np.asarray(vals), np.asarray(names))
    return out

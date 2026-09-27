"""LambdaRank over the channel bank.

A linear blend cannot say "trust the model consensus on an infection screen but
the essentials ordering on a fitness screen".  The context columns (``ctx_*``)
plus a tree model can, and the routing is learned from pre-2022 screens with
publication-grouped folds rather than written by hand.
"""
import os, sys, pickle
import numpy as np
import lightgbm as lgb
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fast import pack, subpack
from proto import pub_of, cat_of, grouped_folds, usable_cols
from common import DISC, K

HERE = os.path.dirname(os.path.abspath(__file__))
NLAB = 8


def labels(rel):
    """Graded 0..NLAB-1 labels from the screen's own relevance vector."""
    y = np.zeros(len(rel), np.int32)
    pos = rel > 0
    if pos.any():
        r = rel[pos]
        q = np.clip(np.ceil(r / max(r.max(), 1e-9) * (NLAB - 1)), 1, NLAB - 1)
        y[pos] = q.astype(np.int32)
    return y


def make_ds(pk, sel, cols, cap=400, seed=0):
    """Rows for LightGBM: all positives plus a capped random sample of negatives."""
    rng = np.random.default_rng(seed)
    Xs, ys, grp, wt = [], [], [], []
    for j in sel:
        a, b = pk.off[j], pk.off[j + 1]
        rel = pk.rel[a:b]
        y = labels(rel)
        pos = np.where(y > 0)[0]
        neg = np.where(y == 0)[0]
        if len(neg) > cap:
            neg = rng.choice(neg, cap, replace=False)
        if len(pos) > cap:
            pos = pos[np.argsort(-rel[pos])[:cap]]
        idx = np.concatenate([pos, neg])
        if len(idx) < 5 or len(pos) == 0:
            continue
        Xs.append(pk.X[a:b][idx][:, cols]); ys.append(y[idx]); grp.append(len(idx))
    if not Xs:
        return None
    return np.vstack(Xs), np.concatenate(ys), np.array(grp)


PARAMS = dict(objective="lambdarank", metric="ndcg", ndcg_eval_at=[100],
              lambdarank_truncation_level=120, learning_rate=0.05,
              num_leaves=31, min_data_in_leaf=200, feature_fraction=0.7,
              bagging_fraction=0.8, bagging_freq=1, lambda_l2=5.0,
              label_gain=[float(2 ** i - 1) for i in range(NLAB)],
              verbosity=-1, num_threads=8)


def train(pk, sel, cols, rounds=400, params=None, seed=0):
    ds = make_ds(pk, sel, cols, seed=seed)
    X, y, g = ds
    d = lgb.Dataset(X, label=y, group=g, free_raw_data=False)
    p = dict(PARAMS); p.update(params or {}); p["seed"] = seed
    return lgb.train(p, d, num_boost_round=rounds)


def predict_scores(model, pk, cols, sel=None):
    s = model.predict(pk.X[:, cols])
    out = np.zeros(pk.n)
    rng = range(pk.n) if sel is None else sel
    for j in rng:
        a, b = pk.off[j], pk.off[j + 1]
        if pk.idcg[j] == 0:
            continue
        sj = s[a:b]; rj = pk.rel[a:b]
        m = b - a
        top = (np.argpartition(-sj, K - 1)[:K] if m > K else np.arange(m))
        top = top[np.argsort(-sj[top], kind="stable")]
        obs = float(rj[top] @ DISC[: len(top)]) / pk.idcg[j]
        v = (obs - pk.rand[j]) / pk.den[j]
        out[j] = v if v > 0 else 0.0
    return out

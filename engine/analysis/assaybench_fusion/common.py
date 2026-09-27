"""Shared loading and fast AnDCG@100 for the fusion experiments."""
import os, sys, pickle, re
import numpy as np
from scipy import sparse
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, ENGINE)
K = 100
DISC = 1.0 / np.log2(np.arange(2, 20000 + 2))

_BASE = None
def base():
    global _BASE
    if _BASE is None:
        _BASE = pickle.load(open(os.path.join(HERE, "cache", "base.pkl"), "rb"))
        d = _BASE
        d["split"] = np.array([m["yearfold0"] for m in d["meta"]])
        d["G"] = len(d["genes"])
        d["gidx"] = {g: i for i, g in enumerate(d["genes"])}
    return _BASE

def split_idx(name):
    d = base()
    if name == "pre2022":
        return np.where((d["split"] == "train") | (d["split"] == "validation"))[0]
    return np.where(d["split"] == name)[0]

def andcg_from_order(i, order_rel):
    """AnDCG@100 given the relevances of the ranked in-library genes (top first)."""
    t = base()["targets"][i]
    if t["idcg"] == 0:
        obs = 0.0
    else:
        r = order_rel[:K]
        obs = float(np.dot(r, DISC[: len(r)])) / t["idcg"]
    return max((obs - t["rand"]) / t["denom"], 0.0)

def score_vec(i, s, tiebreak=None):
    """AnDCG@100 for a score vector aligned with lib[i] (higher = ranked earlier)."""
    d = base()
    rel = d["rel"][i]
    if tiebreak is None:
        order = np.argsort(-s, kind="stable")[:K] if len(s) > K else np.argsort(-s, kind="stable")
        if len(s) > 4 * K:
            top = np.argpartition(-s, K)[:K]
            order = top[np.lexsort((top, -s[top]))]
    else:
        order = np.lexsort((-tiebreak, -s))[:K]
    return andcg_from_order(i, rel[order])

def evaluate(fn, idx, **kw):
    """fn(i) -> score vector aligned with lib[i]; returns per-screen AnDCG array."""
    return np.array([score_vec(i, fn(i), **kw) for i in idx])

def paired(a, b, n=4000, seed=0):
    rng = np.random.default_rng(seed)
    dlt = a - b
    bs = rng.choice(dlt, (n, len(dlt))).mean(1)
    return dlt.mean(), np.percentile(bs, 2.5), np.percentile(bs, 97.5)

def build_mats():
    """Sparse screen x gene matrices: positive relevance, hit indicator, negative indicator, measured."""
    d = base()
    n, G = len(d["lib"]), d["G"]
    rows, cols, pos, neg = [], [], [], []
    for i, (l, r) in enumerate(zip(d["lib"], d["rel"])):
        rows.append(np.full(len(l), i, np.int32)); cols.append(l)
        pos.append(np.maximum(r, 0)); neg.append((r < 0).astype(np.float32))
    rows = np.concatenate(rows); cols = np.concatenate(cols)
    M = sparse.csr_matrix((np.ones(len(rows), np.float32), (rows, cols)), shape=(n, G))
    P = sparse.csr_matrix((np.concatenate(pos), (rows, cols)), shape=(n, G)); P.eliminate_zeros()
    H = P.copy(); H.data[:] = 1.0
    N = sparse.csr_matrix((np.concatenate(neg), (rows, cols)), shape=(n, G)); N.eliminate_zeros()
    return dict(M=M, P=P, H=H, N=N)

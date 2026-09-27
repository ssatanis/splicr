"""Retrieve donor screens with the model lists used as pseudo-labels.

The oracle picks one donor screen per query *with hindsight* and more than
doubles the frequency prior, so screen-to-screen transfer carries information
that a stratum-averaged counter throws away.  The missing piece has always been
the similarity function.  A published model's 100-gene guess for the query is a
label-free stand-in for the query's own hit set, so a donor screen whose *real*
hits look like the query's *predicted* hits is a donor worth copying from.
"""
import sys, os, numpy as np; sys.path.insert(0,'.')
from scipy import sparse
from core import uni
from common import base, split_idx, K, DISC, score_vec

MODELS = ("gemini-3-pro", "gpt-5.4", "gemini-3-flash", "gemini-3.1-pro", "gpt-5-mini",
          "gpt-5.2", "claude-opus-4.5", "claude-sonnet-4.5", "gpt-oss-120b", "GLM-5",
          "Kimi-K2.5", "qwen3-235b-a22b-2507", "deepseek-v3.2", "qwen3.5-397b-a17b",
          "biomni-a1-claude-4", "gepa/gemini-3-flash")


def query_vectors(models=MODELS, c=10.0):
    """Q[i, g] = sum_m 1/(c + rank_m(g)) -- the pseudo-label vector for each screen."""
    u = uni(); d = base()
    rows, cols, vals = [], [], []
    for mi, m in enumerate(models):
        pr = d["preds"].get(m, {})
        for i, p in pr.items():
            if p is None or not len(p):
                continue
            g = u.remap[p]
            keep = g >= 0
            g = g[keep]; r = np.arange(len(p))[keep]
            rows.append(np.full(len(g), i, np.int32)); cols.append(g)
            vals.append((1.0 / (c + r)).astype(np.float32))
    Q = sparse.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))),
                          shape=(u.n, u.U))
    return Q


def donor_matrix(rows, binary=False):
    u = uni()
    D = (u.H if binary else u.Rel)[rows].tocsr().astype(np.float32)
    return D

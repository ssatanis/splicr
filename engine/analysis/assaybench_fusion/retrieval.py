"""Pseudo-label screen retrieval and donor-hit transfer.

Similarity is computed between the query's *predicted* hit vector (published
model lists, reciprocal-rank weighted) and each donor screen's *measured* hit
profile, with IDF weighting so that common essentials -- which every fitness
screen shares -- stop dominating the cosine and screen-specific biology decides
the neighbours.

Transfer is a shrunk conditional rate over the retrieved donors:

    score(g) = (sum_j w_j rel_j(g) + m * prior(g)) / (sum_j w_j measured_j(g) + m)

which is the same estimator as the stratified prior, with a soft, query-specific
stratum in place of a metadata bucket.
"""
import os, sys
import numpy as np
from scipy import sparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import uni
from common import base, split_idx
from pseudo import query_vectors, MODELS


class Retriever:
    def __init__(self, donor_rows, idf_pow=1.0, models=MODELS, rrf_c=10.0, Q=None):
        u = uni()
        self.u = u
        self.donor = np.asarray(sorted(donor_rows), np.int64)
        self.Q = query_vectors(models, rrf_c) if Q is None else Q
        D = u.Rel[self.donor].tocsr().astype(np.float32)
        self.M = u.M[self.donor].tocsr().astype(np.float32)
        df = np.asarray((D > 0).sum(0)).ravel().astype(np.float32)
        N = len(self.donor)
        self.idf = (np.log((N + 1.0) / (df + 1.0)) ** idf_pow).astype(np.float32)
        self.D = D
        Dw = D.multiply(self.idf[None, :]).tocsr()
        self.Dn = _l2(Dw)
        self.pub = u.pub[self.donor]
        pooled = float(D.sum()) / max(float(self.M.sum()), 1.0)
        self.prior = np.asarray(((u.H[self.donor].sum(0) + 20.0 * pooled) /
                                 (self.M.sum(0) + 20.0))).ravel().astype(np.float32)

    def sims(self, query_rows):
        Qq = self.Q[np.asarray(query_rows)].tocsr().multiply(self.idf[None, :]).tocsr()
        return (_l2(Qq) @ self.Dn.T).toarray()

    def transfer(self, sim_row, lib, k=25, power=3.0, m=8.0, drop=None, use_rel=True):
        s = sim_row.copy()
        if drop is not None:
            s[drop] = -1.0
        kk = min(k, len(s))
        top = np.argpartition(-s, kk - 1)[:kk]
        w = np.maximum(s[top], 0.0) ** power
        if w.sum() <= 0:
            return self.prior[lib]
        src = self.D if use_rel else self.u.H[self.donor].tocsr()
        num = np.asarray((w[None, :] @ src[top].toarray()) if False else
                         sparse.csr_matrix(w.reshape(1, -1)).dot(src[top]).todense()).ravel()
        den = np.asarray(sparse.csr_matrix(w.reshape(1, -1)).dot(self.M[top]).todense()).ravel()
        scale = w.sum()
        return ((num[lib] + m * scale / max(kk, 1) * self.prior[lib]) /
                (den[lib] + m * scale / max(kk, 1)))


def _l2(A):
    n = np.sqrt(np.maximum(np.asarray(A.multiply(A).sum(1)).ravel(), 1e-12))
    return A.multiply((1.0 / n)[:, None]).tocsr()

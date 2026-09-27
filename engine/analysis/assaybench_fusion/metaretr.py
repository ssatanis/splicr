"""Metadata-only screen retrieval, for the variant that uses no model lists.

The pseudo-label retriever in ``retrieval.py`` keys on the published model
predictions.  That is legitimate but it inherits those models' knowledge of
post-2021 literature, so SplicR also reports an *atlas-only* number, and that
number needs a retriever built from the screen description alone: character and
word n-grams over the metadata fields, TF-IDF, cosine.
"""
import os, sys
import numpy as np
from scipy import sparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import uni
from sklearn.feature_extraction.text import TfidfVectorizer

FIELDS = ("phenotype", "screen_rationale", "condition_name", "condition_clause",
          "notes", "cell_line", "cell_type", "experimental_setup",
          "library_methodology", "library_type", "screen_type", "cleaned_phenotype")


def texts():
    u = uni()
    return [" | ".join(str(m.get(f) or "") for f in FIELDS) for m in u.meta]


class MetaRetriever:
    def __init__(self, donor_rows):
        u = uni()
        self.u = u
        self.donor = np.asarray(sorted(donor_rows), np.int64)
        txt = texts()
        self.vw = TfidfVectorizer(sublinear_tf=True, min_df=2, ngram_range=(1, 2),
                                  stop_words="english")
        self.vc = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5),
                                  sublinear_tf=True, min_df=3, max_features=200000)
        fit_on = [txt[i] for i in self.donor]
        Aw = self.vw.fit_transform(fit_on); Ac = self.vc.fit_transform(fit_on)
        self.Dw = sparse.hstack([Aw, Ac]).tocsr()
        self.Dw = _l2(self.Dw)
        self.txt = txt
        D = u.Rel[self.donor].tocsr().astype(np.float32)
        self.D = D
        self.M = u.M[self.donor].tocsr().astype(np.float32)
        pooled = float(D.sum()) / max(float(self.M.sum()), 1.0)
        self.prior = np.asarray(((u.H[self.donor].sum(0) + 20.0 * pooled) /
                                (self.M.sum(0) + 20.0))).ravel().astype(np.float32)
        self.pub = u.pub[self.donor]

    def sims(self, rows):
        t = [self.txt[i] for i in rows]
        Q = sparse.hstack([self.vw.transform(t), self.vc.transform(t)]).tocsr()
        return (_l2(Q) @ self.Dw.T).toarray()

    def transfer(self, srow, lib, k=25, power=3.0, m=8.0, drop=None):
        s = srow.copy()
        if drop is not None:
            s[drop] = -1.0
        kk = min(k, len(s))
        top = np.argpartition(-s, kk - 1)[:kk]
        w = np.maximum(s[top], 0.0) ** power
        if w.sum() <= 0:
            return self.prior[lib]
        num = np.asarray(sparse.csr_matrix(w.reshape(1, -1)).dot(self.D[top]).todense()).ravel()
        den = np.asarray(sparse.csr_matrix(w.reshape(1, -1)).dot(self.M[top]).todense()).ravel()
        sc = w.sum() / max(kk, 1)
        return (num[lib] + m * sc * self.prior[lib]) / (den[lib] + m * sc)


def _l2(A):
    n = np.sqrt(np.maximum(np.asarray(A.multiply(A).sum(1)).ravel(), 1e-12))
    return A.multiply((1.0 / n)[:, None]).tocsr()

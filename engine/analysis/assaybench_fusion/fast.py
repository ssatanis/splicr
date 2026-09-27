"""Vectorised pool scorer: one big matrix for a whole split."""
import os, sys, pickle
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import K, DISC
HERE = os.path.dirname(os.path.abspath(__file__))


class Pack:
    def __init__(self, obj):
        recs = obj["recs"]
        self.names = obj["names"]
        self.n = len(recs)
        self.off = np.zeros(self.n + 1, np.int64)
        for j, r in enumerate(recs):
            self.off[j + 1] = self.off[j] + len(r["pool"])
        self.X = np.empty((self.off[-1], len(self.names)), np.float32)
        self.rel = np.empty(self.off[-1], np.float32)
        for j, r in enumerate(recs):
            s, e = self.off[j], self.off[j + 1]
            self.X[s:e] = r["X"]; self.rel[s:e] = r["rel"]
        self.idcg = np.array([r["idcg"] for r in recs], np.float64)
        self.rand = np.array([r["rand"] for r in recs], np.float64)
        self.den = np.array([r["denom"] for r in recs], np.float64)
        self.i = np.array([r["i"] for r in recs], np.int64)
        self.recs = recs

    def scores(self, w, sel=None):
        w = np.asarray(w, np.float32)
        s = self.X @ w
        out = np.zeros(self.n)
        rng = range(self.n) if sel is None else sel
        for j in rng:
            a, b = self.off[j], self.off[j + 1]
            if self.idcg[j] == 0:
                continue
            sj = s[a:b]; rj = self.rel[a:b]
            m = b - a
            if m > K:
                top = np.argpartition(-sj, K - 1)[:K]
                top = top[np.argsort(-sj[top], kind="stable")]
            else:
                top = np.argsort(-sj, kind="stable")
            obs = float(rj[top] @ DISC[: len(top)]) / self.idcg[j]
            v = (obs - self.rand[j]) / self.den[j]
            out[j] = v if v > 0 else 0.0
        return out

    def mean(self, w, sel=None):
        s = self.scores(w, sel)
        return s[list(sel)].mean() if sel is not None else s.mean()


def pack(which):
    p = os.path.join(HERE, "cache", f"pack_{which}.pkl")
    if os.path.exists(p):
        return pickle.load(open(p, "rb"))
    obj = pickle.load(open(os.path.join(HERE, "cache", f"feat_{which}.pkl"), "rb"))
    pk = Pack(obj)
    pickle.dump(pk, open(p, "wb"), protocol=4)
    return pk


def ascent(pk, sel, w0=None, grid=None, passes=4, quiet=False, cols=None):
    names = pk.names
    w = np.zeros(len(names)) if w0 is None else np.asarray(w0, float).copy()
    grid = grid if grid is not None else [0.0, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8]
    cols = cols if cols is not None else list(range(len(names)))
    best = pk.mean(w, sel) if np.any(w) else -1.0
    for p in range(passes):
        improved = False
        for j in cols:
            cur, bj, bv = w[j], w[j], best
            for g in grid:
                if g == cur:
                    continue
                w[j] = g
                v = pk.mean(w, sel)
                if v > bv + 1e-9:
                    bv, bj = v, g
            w[j] = bj
            if bv > best + 1e-9:
                best, improved = bv, True
        if not quiet:
            print(f"    pass {p}: {best:.5f} nz={int((w!=0).sum())}", flush=True)
        if not improved:
            break
    return w, best


def subpack(pk, sel):
    """A Pack restricted to the given screen rows (so the matmul shrinks too)."""
    sel = np.asarray(sel, np.int64)
    out = Pack.__new__(Pack)
    out.names = pk.names
    out.n = len(sel)
    sizes = pk.off[sel + 1] - pk.off[sel]
    out.off = np.zeros(out.n + 1, np.int64); out.off[1:] = np.cumsum(sizes)
    out.X = np.empty((out.off[-1], len(pk.names)), np.float32)
    out.rel = np.empty(out.off[-1], np.float32)
    for j, s in enumerate(sel):
        a, b = out.off[j], out.off[j + 1]
        out.X[a:b] = pk.X[pk.off[s]:pk.off[s + 1]]
        out.rel[a:b] = pk.rel[pk.off[s]:pk.off[s + 1]]
    out.idcg = pk.idcg[sel]; out.rand = pk.rand[sel]; out.den = pk.den[sel]
    out.i = pk.i[sel]; out.recs = [pk.recs[s] for s in sel]
    return out

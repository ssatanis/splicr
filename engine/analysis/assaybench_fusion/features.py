"""Cache a per-screen candidate pool and its channel matrix.

Tuning needs to score millions of candidate weight vectors, so the channels are
materialised once.  The pool is the union of each channel's own top ``POOL_N``
genes inside the screen's library; a gene outside every channel's top 200
cannot enter a non-negative blend's top 100, and the final test numbers are
recomputed over the full library anyway (``evaluate.py``).
"""
import os, sys, pickle, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import base, split_idx, K, DISC
from core import uni
from channels import ChannelBank

HERE = os.path.dirname(os.path.abspath(__file__))
POOL_N = 200


def pool_for(ch, names, lib_n):
    keep = np.zeros(lib_n, bool)
    for nm in names:
        v = ch[nm]
        if not np.any(v):
            continue
        n = min(POOL_N, lib_n)
        idx = np.argpartition(-v, n - 1)[:n] if lib_n > n else np.arange(lib_n)
        keep[idx] = True
    return np.where(keep)[0]


def build(which, bank=None, donor_rows=None, ext=None, out=None, mfield=None):
    u = uni()
    donor_rows = donor_rows if donor_rows is not None else split_idx("pre2022")
    bank = bank or ChannelBank(donor_rows, ext=ext)
    idx = split_idx(which) if isinstance(which, str) else np.asarray(which)
    recs = []
    names = None
    t0 = time.time()
    for n_done, i in enumerate(idx):
        ch = bank.for_screen(i, mfield=mfield)
        if names is None:
            names = [k for k, v in ch.items() if isinstance(v, np.ndarray)]
        lib_n = len(u.ulib[i])
        pool = pool_for(ch, names, lib_n)
        X = np.empty((len(pool), len(names)), np.float32)
        for j, nm in enumerate(names):
            X[:, j] = ch[nm][pool]
        t = base()["targets"][i]
        recs.append(dict(i=int(i), pool=pool.astype(np.int32), X=X,
                         rel=u.rel[i][pool].astype(np.float32),
                         idcg=t["idcg"], rand=t["rand"], denom=t["denom"]))
        if (n_done + 1) % 200 == 0:
            print(f"  {n_done+1}/{len(idx)}  {time.time()-t0:.0f}s", flush=True)
    obj = dict(names=names, recs=recs)
    if out:
        pickle.dump(obj, open(out, "wb"), protocol=4)
    return obj


def score_pool(rec, w, gate=None):
    """AnDCG@100 from a pool matrix and a weight vector."""
    s = rec["X"] @ w
    n = len(s)
    if n > K:
        top = np.argpartition(-s, K - 1)[:K]
        top = top[np.argsort(-s[top], kind="stable")]
    else:
        top = np.argsort(-s, kind="stable")
    r = rec["rel"][top]
    if rec["idcg"] == 0:
        return 0.0
    obs = float(np.dot(r, DISC[: len(r)])) / rec["idcg"]
    return max((obs - rec["rand"]) / rec["denom"], 0.0)


def score_all(recs, w):
    return np.array([score_pool(r, w) for r in recs])


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "test"
    o = build(which, out=os.path.join(HERE, "cache", f"feat_{which.replace('/','_')}.pkl"))
    print(which, len(o["recs"]), "screens", len(o["names"]), "channels",
          "mean pool", np.mean([len(r["pool"]) for r in o["recs"]]).round(0))

"""Fit the blend, choosing every free parameter by publication-grouped CV.

Nothing here reads a test screen.  The CV estimate printed alongside each
configuration is the number the choice was made on; the test column is printed
once, at the end, for the configuration CV picked.
"""
import sys, os, json, pickle, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fast import pack, subpack
from proto import cat_of, pub_of, grouped_folds

BLEND = ("llm_cons", "retr_r25", "retr_r10", "cnt_cleaned_phenotype", "global_rate",
         "global_relmass", "rel_library_methodology", "kn_drug_net", "kn_rep_net",
         "dm_common_ess", "neg_rate", "measured_freq")
GRID = [0.0, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0]


def fit(pk, sel, cols, w0=None, passes=3, grid=GRID):
    """Coordinate ascent on the metric itself, over the rows in ``sel``."""
    if sel is not None and len(sel) < pk.n:
        pk = subpack(pk, sel)
        sel = None
    w = np.zeros(len(pk.names)) if w0 is None else np.asarray(w0, float).copy()
    if not np.any(w[cols]):
        # the ascent needs a non-degenerate starting point; the anchor is the
        # first channel of *this* channel set, never a fixed channel, so an
        # atlas-only fit cannot be handed a model-consensus weight.
        w[cols[0]] = 1.0
    best = pk.mean(w, sel)
    for _ in range(passes):
        imp = False
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
                best, imp = bv, True
        if not imp:
            break
    return w, best


def cv_fit(pk, cats, cols, per_category, folds, shrink=0.0):
    """Held-out per-screen scores under the given fitting scheme."""
    out = np.zeros(pk.n)
    order = sorted(set(cats))
    for a, b in folds:
        wg, _ = fit(pk, a, cols)
        if not per_category:
            s = pk.scores(wg, b); out[b] = s[b]
            continue
        for c in order:
            sa = a[cats[a] == c]; sb = b[cats[b] == c]
            if len(sb) == 0:
                continue
            if len(sa) < 12:
                w = wg
            else:
                w, _ = fit(pk, sa, cols, w0=wg, passes=2)
                w = (1 - shrink) * w + shrink * wg
            s = pk.scores(w, sb); out[sb] = s[sb]
    return out


if __name__ == "__main__":
    tr = pack("pre2022")
    cats = cat_of(tr); pubs = pub_of(tr)
    order = sorted(set(cats))
    cols = [tr.names.index(c) for c in BLEND]
    folds = grouped_folds(pubs, 5)
    res = {}
    for tag, pc, sh in [("global weights", False, 0.0),
                        ("per-category", True, 0.0),
                        ("per-category shrunk 0.3", True, 0.3),
                        ("per-category shrunk 0.6", True, 0.6)]:
        t0 = time.time()
        s = cv_fit(tr, cats, cols, pc, folds, sh)
        cb = float(np.mean([s[cats == c].mean() for c in order]))
        res[tag] = (cb, s.mean(), pc, sh)
        print(f"  {tag:<26} CV cat-balanced={cb:.4f}  CV plain={s.mean():.4f}  [{time.time()-t0:.0f}s]", flush=True)
    bestt = max(res, key=lambda k: res[k][0])
    print("CV-chosen scheme:", bestt)
    json.dump({"scheme": bestt, "per_category": res[bestt][2], "shrink": res[bestt][3],
               "cv_cat_balanced": res[bestt][0], "blend": list(BLEND)},
              open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "scheme.json"), "w"))

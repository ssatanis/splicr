"""THE decision artifact: for each level of similarity quality (within-query AUC),
the best validation AnDCG@100 attainable over aggregation configs."""
import sys, os, pickle, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SCRATCH, splits, make_andcg
from splicr import benchmark as bm
from scipy import stats as st
from sklearn.metrics import roc_auc_score
from learn2 import gene_rank_from_sim, score_genes, paired

tr, va = splits()
a = make_andcg()
T = np.load(SCRATCH + "/T_val.npy").astype(np.float64)
Cva = pickle.load(open(SCRATCH + "/aux.pkl", "rb"))["Cva"]
nq, nd = T.shape
stats = bm.GeneStats().fit(tr)
is_orc = ((-T).argsort(1).argsort(1) < 25)
rng = np.random.default_rng(11)
CFGS = [(k, p, s) for k in (5, 10, 25, 50) for p in (1.0, 3.0)
        for s in (1e-9, 0.25, 1.0, 3.0, 8.0, 20.0)]
prior = score_genes({i: bm.GeneFrequencyPrior(stats=stats).fit(tr).rank(s)
                     for i, s in enumerate(va)}, va, a)

def wq(P):
    return float(np.mean([roc_auc_score(is_orc[i], P[i]) for i in range(nq)
                          if 0 < is_orc[i].sum() < nd]))

def best_cfg(P):
    bv, bc, bper = -1, None, None
    for k, p, s in CFGS:
        v = score_genes(gene_rank_from_sim(P, tr, va, a, stats, kn=k, power=p, smoothing=s), va, a)
        if v.mean() > bv: bv, bc, bper = v.mean(), (k, p, s), v
    return bv, bc, bper

print(f"validation global frequency prior = {prior.mean():.5f}")
print("\nSIMILARITY QUALITY -> BEST ACHIEVABLE VALIDATION AnDCG@100 (best over 48 aggregation configs)")
print(f"  {'similarity':<34} {'wq AUC':>7} {'best AnDCG@100':>15} {'config (k,power,smooth)':>26} {'vs prior':>10}")
Z = (T - T.mean(1, keepdims=True)) / (T.std(1, keepdims=True) + 1e-9)
out = []
for lam, tag in ((0.0, "pure noise"), (0.05, "synthetic"), (0.1, "synthetic"),
                 (0.2, "synthetic"), (0.3, "synthetic"), (0.5, "synthetic"),
                 (1.0, "PERFECT (reads val labels)")):
    P = lam * Z + (1 - lam) * rng.standard_normal(T.shape)
    v, c, per = best_cfg(P)
    m, lo, hi, p = paired(per, prior)
    out.append((wq(P), v))
    print(f"  {tag+f' lam={lam:.2f}':<34} {wq(P):>7.4f} {v:>15.5f} {str(c):>26} "
          f"{m:+.5f} [{lo:+.4f},{hi:+.4f}]")

print("\nREAL LABEL-FREE SIMILARITIES, same treatment")
import lightgbm as lgb, feat
Xv = np.load(SCRATCH + "/Xval.npy"); dat = np.load(SCRATCH + "/train_pairs.npz")
Xt, yt = dat["X"], dat["y"]; F = feat.FEATURES; idx = {f: i for i, f in enumerate(F)}
LIB = ["lib_jaccard", "lib_overlap", "q_libsize_log", "d_libsize_log", "libsize_logratio",
       "coverage_top100", "coverage_top20"]
DON = ["d_nhit_log", "d_hitfrac", "d_negfrac", "d_absrel", "d_ess_frac", "d_quality"]
sims = {"ScreenCorpus metadata cosine": Cva}
for name, cols in (("LGBM library+donor (13)", LIB + DON), ("LGBM all 45", F)):
    ci = [idx[f] for f in cols]
    m = lgb.train(dict(objective="regression", learning_rate=0.05, num_leaves=31,
                       min_data_in_leaf=200, feature_fraction=0.9, bagging_fraction=0.8,
                       bagging_freq=1, lambda_l2=10.0, verbose=-1, seed=0, num_threads=8),
                  lgb.Dataset(Xt[:, ci], label=yt), num_boost_round=400)
    sims[name] = m.predict(Xv.reshape(-1, len(F))[:, ci]).reshape(nq, nd)
for name, P in sims.items():
    v, c, per = best_cfg(P)
    m, lo, hi, p = paired(per, prior)
    print(f"  {name:<34} {wq(P):>7.4f} {v:>15.5f} {str(c):>26} "
          f"{m:+.5f} [{lo:+.4f},{hi:+.4f}] wilcoxon p={p:.3g}")

print("\nWHAT AUC IS NEEDED TO BEAT WHAT: interpolated from the synthetic curve")
xs = np.array([o[0] for o in out]); ys = np.array([o[1] for o in out])
for target in (0.18, 0.19, 0.20, 0.22, 0.25, 0.30):
    if target <= ys.max():
        print(f"  AnDCG@100 {target:.2f} requires within-query AUC ~ {np.interp(target, ys, xs):.3f}")
    else:
        print(f"  AnDCG@100 {target:.2f} is above the perfect-similarity ceiling {ys.max():.4f}")

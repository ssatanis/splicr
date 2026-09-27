"""How much similarity quality would it take? Calibration curve + gene-level retrieval."""
import sys, os, pickle, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SCRATCH, splits, make_andcg, K
from splicr import benchmark as bm
from scipy import stats as st
from sklearn.metrics import roc_auc_score
import lightgbm as lgb, feat

TOPM = 25
rng = np.random.default_rng(7)


def wq_auc(P, is_orc):
    nq, nd = P.shape
    return float(np.mean([roc_auc_score(is_orc[i], P[i]) for i in range(nq)
                          if 0 < is_orc[i].sum() < nd]))


def gene_rank_from_sim(P, tr, va, andcg, stats, kn=25, power=3.0, smoothing=8.0,
                       prior_smoothing=25.0, neg_pen=0.5):
    """RetrievalKNN aggregation driven by an arbitrary similarity matrix P."""
    out = {}
    for i, s in enumerate(va):
        p = P[i]
        order = np.argsort(-p)[:kn]
        lo, hi = p[order].min(), p[order].max()
        w = ((p[order] - lo) / (hi - lo + 1e-12)) ** power if hi > lo else np.ones(len(order))
        lib = list(dict.fromkeys(s["relevance_genes"]))
        wanted = set(lib)
        num, den, neg = {}, {}, {}
        for idx, weight in zip(order, w):
            if weight <= 0: continue
            n = tr[int(idx)]
            for g, sc, h in zip(n["relevance_genes"], n["relevance_scores"], n["hit"]):
                if g not in wanted: continue
                den[g] = den.get(g, 0.0) + weight
                if h: num[g] = num.get(g, 0.0) + weight * sc
                if sc < 0: neg[g] = neg.get(g, 0.0) + weight
        sc_ = {}
        for g in lib:
            pr = stats.rate(g, smoothing=prior_smoothing)
            d = den.get(g, 0.0) + smoothing or 1e-12
            v = (num.get(g, 0.0) + smoothing * pr) / d
            v -= neg_pen * (neg.get(g, 0.0) / d)
            sc_[g] = v
        out[i] = bm.rank_by_scores(lib, sc_, tie_break="random", seed=42, limit=K)
    return out


def score_genes(ranks, va, andcg):
    return np.array([andcg.target(s).score(ranks[i]) for i, s in enumerate(va)])


def paired(a, b, n=5000):
    d = a - b
    bs = np.array([d[rng.integers(0, len(d), len(d))].mean() for _ in range(n)])
    lo, hi = np.percentile(bs, [2.5, 97.5])
    p = st.wilcoxon(d).pvalue if np.any(d != 0) else 1.0
    return d.mean(), lo, hi, p


def main():
    tr, va = splits()
    a = make_andcg()
    T = np.load(SCRATCH + "/T_val.npy").astype(np.float64)
    Xv = np.load(SCRATCH + "/Xval.npy")
    dat = np.load(SCRATCH + "/train_pairs.npz")
    Xt, yt, qt = dat["X"], dat["y"], dat["q"]
    aux = pickle.load(open(SCRATCH + "/aux.pkl", "rb"))
    F = aux["features"]; Cva = aux["Cva"]; dq_val = aux["dq_val"]
    nq, nd = T.shape
    rank_true = (-T).argsort(1).argsort(1)
    is_orc = rank_true < TOPM
    stats = bm.GeneStats().fit(tr)
    oracle = T.max(1)

    # ---------------- 1. what score does a given AUC buy? ------------------
    print("=" * 84)
    print("CALIBRATION: donor-copy score and gene-level AnDCG@100 vs similarity quality")
    print("  (synthetic ranker: lambda * z(true transfer) + (1-lambda) * gaussian noise)")
    print(f"  {'lambda':>7} {'within-q AUC':>13} {'1NN copy':>10} {'top25 mean':>11} {'gene kNN@100':>13}")
    Z = (T - T.mean(1, keepdims=True)) / (T.std(1, keepdims=True) + 1e-9)
    curve = []
    for lam in (0.0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0):
        N = rng.standard_normal(T.shape)
        P = lam * Z + (1 - lam) * N
        auc = wq_auc(P, is_orc)
        c1 = T[np.arange(nq), P.argmax(1)].mean()
        top = np.argsort(-P, 1)[:, :25]
        c25 = T[np.arange(nq)[:, None], top].mean(1).mean()
        gk = score_genes(gene_rank_from_sim(P, tr, va, a, stats), va, a).mean()
        curve.append((lam, auc, c1, c25, gk))
        print(f"  {lam:>7.2f} {auc:>13.4f} {c1:>10.4f} {c25:>11.4f} {gk:>13.5f}")

    # ---------------- 2. real similarity variants --------------------------
    print("\n" + "=" * 84)
    print("REAL LABEL-FREE SIMILARITIES on validation")
    GROUPS = {
        "categorical": [f for f in F if f.startswith("cat_")] + ["lineage_match"],
        "text": [f for f in F if f.startswith("txt_")] + ["corpus_cosine"],
        "library": ["lib_jaccard", "lib_overlap", "q_libsize_log", "d_libsize_log",
                    "libsize_logratio", "coverage_top100", "coverage_top20"],
        "donor_profile": ["d_nhit_log", "d_hitfrac", "d_negfrac", "d_absrel",
                          "d_ess_frac", "d_quality"],
        "depmap": ["depmap_cell_corr", "ge_of_donortop_in_querycell",
                   "ge_of_donortop20_in_querycell", "ge_donorcell_minus_querycell",
                   "both_cells_mapped", "negsel_x_dess", "negsel_x_ge"],
        "design": ["year_diff", "days_logratio", "q_negsel", "d_negsel"],
    }
    idx = {f: i for i, f in enumerate(F)}
    variants = {}
    variants["metadata cosine (ScreenCorpus)"] = Cva
    variants["donor quality only (train-fit)"] = np.tile(dq_val, (nq, 1))
    Xflat = Xv.reshape(-1, len(F))
    def lgbm(cols, name, rounds=400, leaves=31, minleaf=200, l2=10.0):
        m = lgb.train(dict(objective="regression", learning_rate=0.05, num_leaves=leaves,
                           min_data_in_leaf=minleaf, feature_fraction=0.9,
                           bagging_fraction=0.8, bagging_freq=1, lambda_l2=l2,
                           verbose=-1, seed=0, num_threads=8),
                      lgb.Dataset(Xt[:, cols], label=yt), num_boost_round=rounds)
        variants[name] = m.predict(Xflat[:, cols]).reshape(nq, nd)
        return m
    allc = list(range(len(F)))
    lgbm(allc, "LGBM all 45 features")
    lgbm([idx[f] for f in GROUPS["library"]], "LGBM library-structure only (7)")
    lgbm([idx[f] for f in GROUPS["library"] + GROUPS["donor_profile"]],
         "LGBM library + donor profile (13)")
    lgbm([idx[f] for f in GROUPS["library"] + GROUPS["donor_profile"] + GROUPS["text"]],
         "LGBM library + donor + text (21)")
    lgbm([i for i in allc if F[i] not in set(GROUPS["depmap"])], "LGBM all minus DepMap (38)")
    variants["coverage_top100 alone"] = Xv[:, :, idx["coverage_top100"]].astype(np.float64)
    variants["lib_jaccard alone"] = Xv[:, :, idx["lib_jaccard"]].astype(np.float64)
    variants["ORACLE (reads val labels)"] = T

    print(f"  {'similarity':<38} {'wq AUC':>7} {'1NN copy':>9} {'gene kNN@100':>13}")
    res = {}
    for name, P in variants.items():
        auc = wq_auc(P, is_orc) if P.std() > 0 else 0.5
        c1 = T[np.arange(nq), P.argmax(1)].mean()
        per = score_genes(gene_rank_from_sim(P, tr, va, a, stats), va, a)
        res[name] = per
        print(f"  {name:<38} {auc:>7.4f} {c1:>9.4f} {per.mean():>13.5f}")

    # reference scorers
    corpus = bm.ScreenCorpus().fit(tr)
    ref = {}
    for sc in (bm.GeneFrequencyPrior(stats=stats),
               bm.RetrievalKNN(stats=stats, corpus=corpus)):
        sc.fit(tr)
        ref[sc.name] = score_genes({i: sc.rank(s) for i, s in enumerate(va)}, va, a)
        print(f"  {'[ref] '+sc.name:<38} {'':>7} {'':>9} {ref[sc.name].mean():>13.5f}")

    base = ref["gene_frequency_prior"]
    print("\n  paired vs the global frequency prior (bootstrap 95% CI + Wilcoxon):")
    for name, per in list(res.items()) + list(ref.items()):
        if name == "gene_frequency_prior": continue
        m, lo, hi, p = paired(per, base)
        flag = "" if (lo < 0 < hi) else "  SIGNIFICANT"
        print(f"    {name:<38} {m:+.5f}  [{lo:+.5f},{hi:+.5f}]  p={p:.3g}{flag}")

    pickle.dump({"res": res, "ref": ref, "curve": curve},
                open(SCRATCH + "/results2.pkl", "wb"))

if __name__ == "__main__":
    main()

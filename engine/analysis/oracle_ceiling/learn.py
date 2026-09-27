"""Train the label-free pair-similarity model; report AUC, ablations, retrieval score."""
import sys, os, pickle, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SCRATCH, splits, make_andcg, K
from scipy import stats as st
import lightgbm as lgb
import feat

TOPM = 25   # "oracle neighbour" = donor in the top-25 of 1349 by true transfer


def groups_of(features, name):
    idx = {f: i for i, f in enumerate(features)}
    G = {
        "categorical": [f for f in features if f.startswith("cat_")] + ["lineage_match"],
        "text": [f for f in features if f.startswith("txt_")] + ["corpus_cosine"],
        "library": ["lib_jaccard", "lib_overlap", "q_libsize_log", "d_libsize_log",
                    "libsize_logratio", "coverage_top100", "coverage_top20"],
        "donor_profile": ["d_nhit_log", "d_hitfrac", "d_negfrac", "d_absrel",
                          "d_ess_frac", "d_quality"],
        "depmap": ["depmap_cell_corr", "ge_of_donortop_in_querycell",
                   "ge_of_donortop20_in_querycell", "ge_donorcell_minus_querycell",
                   "both_cells_mapped", "negsel_x_dess", "negsel_x_ge"],
        "design": ["year_diff", "days_logratio", "q_negsel", "d_negsel"],
    }
    return [idx[f] for f in G[name]]


def fit_model(X, y, seed=0, n=700):
    return lgb.train(
        dict(objective="regression", metric="l2", learning_rate=0.05, num_leaves=63,
             min_data_in_leaf=60, feature_fraction=0.8, bagging_fraction=0.8,
             bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=seed, num_threads=8),
        lgb.Dataset(X, label=y), num_boost_round=n)


def main():
    tr, va = splits()
    a = make_andcg()
    T = np.load(SCRATCH + "/T_val.npy").astype(np.float64)
    Xv = np.load(SCRATCH + "/Xval.npy")
    dat = np.load(SCRATCH + "/train_pairs.npz")
    Xt, yt, qt = dat["X"], dat["y"], dat["q"]
    aux = pickle.load(open(SCRATCH + "/aux.pkl", "rb"))
    F = aux["features"]; Cva = aux["Cva"]
    nq, nd = T.shape

    # ---------- reference points -------------------------------------------
    oracle = T.max(axis=1)
    print("=" * 78)
    print(f"VALIDATION reference points (218 screens, donor pool = 1349 train screens)")
    print(f"  oracle 1NN donor transfer      {oracle.mean():.5f}")
    print(f"  random donor                   {T.mean():.5f}")
    print(f"  metadata(ScreenCorpus) 1NN     {T[np.arange(nq), Cva.argmax(1)].mean():.5f}")

    # ---------- the classifier question -----------------------------------
    rank_true = (-T).argsort(axis=1).argsort(axis=1)
    is_orc = (rank_true < TOPM)                      # 218 x 1349 bool
    print(f"\npositives = top-{TOPM} donors by TRUE transfer per query "
          f"({is_orc.sum()} of {T.size:,} pairs = {is_orc.mean():.2%})")

    model = fit_model(Xt, yt)
    P = model.predict(Xv.reshape(-1, len(F))).reshape(nq, nd)

    def auc_global(P):
        return st.rankdata(P.ravel())[is_orc.ravel()].mean() / P.size * 2 - \
               (is_orc.sum() + 1) / P.size          # placeholder, replaced below

    from sklearn.metrics import roc_auc_score
    gl = roc_auc_score(is_orc.ravel(), P.ravel())
    per = np.array([roc_auc_score(is_orc[i], P[i]) for i in range(nq) if 0 < is_orc[i].sum() < nd])
    print(f"\nAUC 'is an oracle neighbour' from label-free pair features:")
    print(f"  pooled over all {T.size:,} val pairs      {gl:.4f}")
    print(f"  within-query mean (the honest one)        {per.mean():.4f}   "
          f"median {np.median(per):.4f}  frac>0.5 {(per>0.5).mean():.1%}")
    glc = roc_auc_score(is_orc.ravel(), Cva.ravel())
    perc = np.array([roc_auc_score(is_orc[i], Cva[i]) for i in range(nq) if 0 < is_orc[i].sum() < nd])
    print(f"  same, using ScreenCorpus cosine alone     pooled {glc:.4f}  within-query {perc.mean():.4f}")

    # ---------- which features carry it -----------------------------------
    gain = model.feature_importance("gain")
    ordr = np.argsort(-gain)
    print(f"\ntop pair features by LightGBM gain:")
    for i in ordr[:16]:
        print(f"    {F[i]:<34} {gain[i]/gain.sum():6.2%}")

    print(f"\nfeature-GROUP ablation (within-query AUC; model refit each time):")
    base = per.mean()
    print(f"    {'ALL':<16} {base:.4f}")
    rows = []
    for g in ("categorical", "text", "library", "donor_profile", "depmap", "design"):
        cols = groups_of(F, g)
        keep = [i for i in range(len(F)) if i not in cols]
        m = fit_model(Xt[:, keep], yt)
        Pg = m.predict(Xv.reshape(-1, len(F))[:, keep]).reshape(nq, nd)
        A_ = np.array([roc_auc_score(is_orc[i], Pg[i]) for i in range(nq)
                       if 0 < is_orc[i].sum() < nd]).mean()
        m2 = fit_model(Xt[:, cols], yt)
        P2 = m2.predict(Xv.reshape(-1, len(F))[:, cols]).reshape(nq, nd)
        A2 = np.array([roc_auc_score(is_orc[i], P2[i]) for i in range(nq)
                       if 0 < is_orc[i].sum() < nd]).mean()
        rows.append((g, A_, base - A_, A2))
        print(f"    {'-'+g:<16} {A_:.4f}   drop {base-A_:+.4f}   |  ONLY this group {A2:.4f}")

    np.save(SCRATCH + "/P_val.npy", P.astype(np.float32))

    # ---------- how much of the gap does it close (donor-copy mode) --------
    print(f"\ndonor-copy retrieval (copy the chosen donor's own top-100):")
    pred1 = T[np.arange(nq), P.argmax(1)]
    print(f"  learned-similarity 1NN          {pred1.mean():.5f}")
    for m in (3, 5, 10, 25):
        top = np.argsort(-P, axis=1)[:, :m]
        print(f"  mean over learned top-{m:<3}        "
              f"{T[np.arange(nq)[:, None], top].mean(axis=1).mean():.5f}"
              f"   best-of-top-{m} (oracle over them) "
              f"{T[np.arange(nq)[:, None], top].max(axis=1).mean():.5f}")
    print(f"  recall of the true argmax donor in learned top-1/10/50: "
          f"{np.mean(P.argmax(1)==T.argmax(1)):.1%} / "
          f"{np.mean([(T[i].argmax() in np.argsort(-P[i])[:10]) for i in range(nq)]):.1%} / "
          f"{np.mean([(T[i].argmax() in np.argsort(-P[i])[:50]) for i in range(nq)]):.1%}")
    rho = np.array([st.spearmanr(P[i], T[i]).statistic for i in range(nq) if T[i].std() > 0])
    rhc = np.array([st.spearmanr(Cva[i], T[i]).statistic for i in range(nq) if T[i].std() > 0])
    print(f"  per-query Spearman(pred, true transfer): learned {np.nanmean(rho):+.4f} "
          f"vs metadata {np.nanmean(rhc):+.4f}")
    d = rho - rhc
    print(f"    paired: mean diff {np.nanmean(d):+.4f}  wilcoxon p "
          f"{st.wilcoxon(d[~np.isnan(d)]).pvalue:.2g}")

if __name__ == "__main__":
    main()

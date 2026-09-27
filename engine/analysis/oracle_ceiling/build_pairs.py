"""Build the label-free pair design matrices: train-train (fit) and val-train (probe)."""
import sys, os, pickle, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SCRATCH, splits, make_andcg
from splicr import benchmark as bm
import feat

NPD_TRAIN = 120          # donors sampled per train query

def main():
    tr, va = splits()
    a = make_andcg()
    dm = feat.depmap()
    ess = feat.essentials()
    T   = np.load(SCRATCH + "/T_val.npy").astype(np.float32)
    Ttt = np.load(SCRATCH + "/T_traintrain.npy").astype(np.float32)

    # shared gene universe (label-free: just which genes were measured)
    uni = {}
    for s in tr + va:
        for g in s["relevance_genes"]:
            n = a.normalize(g)
            if n not in uni:
                uni[n] = len(uni)
    D = feat.Side(tr, a, dm, ess, universe=uni)
    Q = feat.Side(va, a, dm, ess, universe=uni)
    print(f"sides built: donors {D.n}, val queries {Q.n}, universe {len(uni)}", flush=True)

    gtr = np.array([s["source_id"] for s in tr], dtype=object)
    same = gtr[:, None] == gtr[None, :]
    allowed = ~same                                   # train-train usable pairs

    # donor generalist quality, group-excluded; LOO version for train pairs
    Wt = np.where(allowed, Ttt, 0.0)
    cnt = allowed.sum(axis=0).astype(float)
    tot = Wt.sum(axis=0)
    dq_val = tot / np.maximum(cnt, 1)                       # for validation queries
    dq_loo = (tot[None, :] - Wt) / np.maximum(cnt[None, :] - allowed, 1)

    # corpus cosine
    corpus = bm.ScreenCorpus().fit(tr)
    Mtr = corpus.transform(tr); Mva = corpus.transform(va)
    Ctt = np.asarray((Mtr @ Mtr.T).todense(), dtype=np.float32)
    Cva = np.asarray((Mva @ Mtr.T).todense(), dtype=np.float32)

    txt_tt = feat.text_cosines(tr, tr, tr)
    txt_va = feat.text_cosines(tr, va, tr)
    alias, lineage, models, genes, A, Cm = dm
    print("cosines built", flush=True)

    # ---- validation design matrix: every pair -----------------------------
    Xv = np.zeros((Q.n, D.n, feat.NF), np.float32)
    for i in range(Q.n):
        Xv[i] = feat.row_features(i, Q, D, np.arange(D.n), txt_va, Cva, dq_val, A, Cm)
        if (i + 1) % 50 == 0: print(f"  val row {i+1}/{Q.n}", flush=True)
    np.save(SCRATCH + "/Xval.npy", Xv)

    # ---- train design matrix: sampled donors per query --------------------
    rng = np.random.default_rng(0)
    rows, ys, qs, ds = [], [], [], []
    for i in range(D.n):
        ok = np.where(allowed[i])[0]
        if ok.size == 0: continue
        byT = ok[np.argsort(-Ttt[i, ok])][:25]                  # oracle-like positives
        byS = ok[np.argsort(-Ctt[i, ok])][:35]                  # hard negatives
        rnd = rng.choice(ok, size=min(NPD_TRAIN, ok.size), replace=False)
        sel = np.unique(np.concatenate([byT, byS, rnd]))
        dqi = dq_loo[i]
        rows.append(feat.row_features(i, D, D, sel, txt_tt, Ctt, dqi, A, Cm))
        ys.append(Ttt[i, sel]); qs.append(np.full(sel.size, i)); ds.append(sel)
        if (i + 1) % 200 == 0: print(f"  train row {i+1}/{D.n}", flush=True)
    Xt = np.concatenate(rows); yt = np.concatenate(ys)
    qt = np.concatenate(qs); dt = np.concatenate(ds)
    np.savez(SCRATCH + "/train_pairs.npz", X=Xt, y=yt, q=qt, d=dt)
    with open(SCRATCH + "/aux.pkl", "wb") as fh:
        pickle.dump({"dq_val": dq_val, "Cva": Cva, "gtr": gtr,
                     "features": feat.FEATURES}, fh, protocol=4)
    print("train pairs", Xt.shape, "val tensor", Xv.shape)

if __name__ == "__main__":
    main()

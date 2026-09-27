"""The real gene-level ceiling: best aggregation under perfect similarity, and the
best achievable by any rule that only sees a donor's metadata signature."""
import sys, os, pickle, collections, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SCRATCH, splits, make_andcg, K
from splicr import benchmark as bm
from scipy import stats as st
from sklearn.metrics import roc_auc_score
import feat
from learn2 import gene_rank_from_sim, score_genes, paired

nz = feat._nz
tr, va = splits()
a = make_andcg()
T = np.load(SCRATCH + "/T_val.npy").astype(np.float64)
Cva = pickle.load(open(SCRATCH + "/aux.pkl", "rb"))["Cva"]
P = np.load(SCRATCH + "/P_val.npy").astype(np.float64)
nq, nd = T.shape
stats = bm.GeneStats().fit(tr)
is_orc = ((-T).argsort(1).argsort(1) < 25)

def wq(Pm):
    return float(np.mean([roc_auc_score(is_orc[i], Pm[i]) for i in range(nq)
                          if 0 < is_orc[i].sum() < nd]))

prior = score_genes({i: bm.GeneFrequencyPrior(stats=stats).fit(tr).rank(s)
                     for i, s in enumerate(va)}, va, a)
print(f"reference: global frequency prior on validation = {prior.mean():.5f}")
print(f"reference: copy-oracle (argmax donor's top-100)  = {T.max(1).mean():.5f}")

print("\n" + "=" * 88)
print("A. BEST AGGREGATION UNDER *PERFECT* SIMILARITY (similarity = the true transfer row)")
print("   this is the real gene-level ceiling for neighbour retrieval, not the copy-oracle")
best = (None, -1)
for kn in (1, 3, 5, 10, 25):
    for sm in (1e-9, 0.5, 2.0, 8.0):
        for pw in (1.0, 3.0):
            v = score_genes(gene_rank_from_sim(T, tr, va, a, stats, kn=kn, power=pw,
                                               smoothing=sm), va, a)
            if v.mean() > best[1]: best = ((kn, pw, sm), v.mean())
            print(f"   k={kn:<3} power={pw:<4} smoothing={sm:<4} -> {v.mean():.5f}")
print(f"   BEST oracle-similarity aggregation {best[0]} = {best[1]:.5f}")
cfg = best[0]

print("\n" + "=" * 88)
print("B. SAME AGGREGATION, REAL LABEL-FREE SIMILARITIES (config picked above)")
rows = {}
for name, M in (("metadata cosine", Cva), ("learned LGBM (45 feat)", P)):
    v = score_genes(gene_rank_from_sim(M, tr, va, a, stats, kn=cfg[0], power=cfg[1],
                                       smoothing=cfg[2]), va, a)
    rows[name] = v
    print(f"   {name:<28} AUC {wq(M):.4f}   AnDCG@100 {v.mean():.5f}")

print("\n" + "=" * 88)
print("C. INFORMATION BOUND, GENE LEVEL: best rule that sees only a donor signature.")
print("   similarity[j] := mean true transfer of j's signature cell (oracle over cells).")
sigsets = {
  "screen_type+library+phenotype": ["screen_type","library_type","library_methodology","cleaned_phenotype"],
  "+cell_line": ["screen_type","library_type","library_methodology","cleaned_phenotype","cell_line"],
  "+cell_line+condition": ["screen_type","library_type","library_methodology","cleaned_phenotype","cell_line","condition_name"],
}
for name, flds in sigsets.items():
    key = [tuple(nz(s.get(f)) for f in flds) for s in tr]
    g = collections.defaultdict(list)
    for j, k in enumerate(key): g[k].append(j)
    for minsz in (1, 3):
        M = np.zeros_like(T)
        for cell in g.values():
            c = np.array(cell)
            if c.size < minsz:
                M[:, c] = -1e9
            else:
                M[:, c] = T[:, c].mean(1, keepdims=True)
        v = score_genes(gene_rank_from_sim(M, tr, va, a, stats, kn=cfg[0], power=cfg[1],
                                           smoothing=cfg[2]), va, a)
        ncell = sum(1 for c in g.values() if len(c) >= minsz)
        print(f"   {name:<32} cells>={minsz} ({ncell:>4}) copy {np.where(M[0]>-1e8,1,0).sum() and T[np.arange(nq), M.argmax(1)].mean():.4f}"
              f"   AnDCG@100 {v.mean():.5f}")

print("\n" + "=" * 88)
print("D. SIGNIFICANCE vs the global frequency prior (paired over 218 validation screens)")
for name, v in list(rows.items()):
    m, lo, hi, p = paired(v, prior)
    print(f"   {name:<28} {m:+.5f}  95% CI [{lo:+.5f},{hi:+.5f}]  wilcoxon p={p:.3g}"
          f"{'' if lo<0<hi else '   SIGNIFICANT'}")

"""Is the oracle finding biology, or winning a lottery? Needle-in-haystack diagnostics."""
import sys, os, pickle, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SCRATCH, splits, make_andcg
from scipy import stats as st

tr, va = splits()
a = make_andcg()
T = np.load(SCRATCH + "/T_val.npy").astype(np.float64)
Cva = pickle.load(open(SCRATCH + "/aux.pkl", "rb"))["Cva"]
P = np.load(SCRATCH + "/P_val.npy").astype(np.float64)
nq, nd = T.shape
oracle = T.max(1)
ng = np.array([len(s["relevance_genes"]) for s in va])
nh = np.array([sum(1 for h in s["hit"] if h) for s in va])
npos = np.array([sum(1 for x in s["relevance_scores"] if x > 0) for s in va])

print("=" * 90)
print("VALIDATION screen shape vs oracle score")
print(f"  library size: min {ng.min()} p25 {np.percentile(ng,25):.0f} median {np.median(ng):.0f} "
      f"p75 {np.percentile(ng,75):.0f} max {ng.max()}")
print(f"  positive-relevance genes: min {npos.min()} median {np.median(npos):.0f} max {npos.max()}")
print(f"\n  {'bucket':<22} {'n':>4} {'med lib':>8} {'med pos':>8} {'oracle':>8} {'random':>8} "
      f"{'meta1NN':>8} {'learned1NN':>11} {'share of oracle mean':>21}")
buckets = [("pos hits 1-2", (npos <= 2)), ("pos hits 3-10", (npos > 2) & (npos <= 10)),
           ("pos hits 11-50", (npos > 10) & (npos <= 50)),
           ("pos hits 51-200", (npos > 50) & (npos <= 200)),
           ("pos hits >200", npos > 200)]
for name, m in buckets:
    if not m.any(): continue
    print(f"  {name:<22} {m.sum():>4} {np.median(ng[m]):>8.0f} {np.median(npos[m]):>8.0f} "
          f"{oracle[m].mean():>8.4f} {T[m].mean():>8.4f} "
          f"{T[np.arange(nq),Cva.argmax(1)][m].mean():>8.4f} "
          f"{T[np.arange(nq),P.argmax(1)][m].mean():>11.4f} "
          f"{oracle[m].sum()/oracle.sum():>20.1%}")
print(f"\n  small-library screens (<1000 genes): n={(ng<1000).sum()}, "
      f"oracle {oracle[ng<1000].mean():.4f}, share of oracle mean {oracle[ng<1000].sum()/oracle.sum():.1%}")
print(f"  genome-wide screens (>=10000):      n={(ng>=10000).sum()}, "
      f"oracle {oracle[ng>=10000].mean():.4f}, share {oracle[ng>=10000].sum()/oracle.sum():.1%}")

print("\n" + "=" * 90)
print("NEEDLE IN HAYSTACK: how many of the 1349 donors come close to the best one?")
frac90 = np.array([(T[i] >= 0.9*oracle[i]).sum() if oracle[i] > 0 else nd for i in range(nq)])
frac50 = np.array([(T[i] >= 0.5*oracle[i]).sum() if oracle[i] > 0 else nd for i in range(nq)])
print(f"  donors within 90% of the max: median {np.median(frac90):.0f}, "
      f"p25 {np.percentile(frac90,25):.0f}, p75 {np.percentile(frac90,75):.0f}")
print(f"  donors within 50% of the max: median {np.median(frac50):.0f}")
print(f"  screens where <=3 donors reach 90% of the max: {(frac90<=3).sum()}/{nq} "
      f"({(frac90<=3).mean():.1%}); they hold {oracle[frac90<=3].sum()/oracle.sum():.1%} of the oracle mean")
print(f"  P(hit the needle by chance) for those: {np.mean(frac90[frac90<=3]/nd):.4f}")

print("\n" + "=" * 90)
print("SELECTION-ON-NOISE CHECK: max of 1349 vs max of a random subsample of donors")
rng = np.random.default_rng(0)
for m in (10, 25, 50, 100, 300, 700, 1349):
    vals = []
    for _ in range(40):
        sel = rng.choice(nd, m, replace=False)
        vals.append(T[:, sel].max(1).mean())
    print(f"  oracle restricted to a random {m:>4}-donor pool: {np.mean(vals):.4f} "
          f"(+/-{np.std(vals):.4f})")
print("  -> if the curve keeps climbing with pool size, the max is largely selection, not a")
print("     property of particular donors.")

print("\n" + "=" * 90)
print("DOES THE ORACLE'S DONOR REPEAT? (a reusable donor is learnable; a one-off is not)")
best = T.argmax(1)
import collections
cnt = collections.Counter(best.tolist())
print(f"  distinct donors used by the oracle across 218 queries: {len(cnt)}")
print(f"  most-used donor appears {cnt.most_common(1)[0][1]} times; "
      f"top-10 donors cover {sum(n for _,n in cnt.most_common(10))}/{nq} queries")
print(f"  donors used exactly once: {sum(1 for _,n in cnt.items() if n==1)}")

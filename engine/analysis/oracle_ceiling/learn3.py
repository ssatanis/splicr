"""What does the oracle know? Match rates, information bound, category breakdown."""
import sys, os, pickle, numpy as np, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SCRATCH, splits, make_andcg, K
from scipy import stats as st
import feat

nz, lc = feat._nz, feat._lc


def main():
    tr, va = splits()
    a = make_andcg()
    T = np.load(SCRATCH + "/T_val.npy").astype(np.float64)
    Cva = pickle.load(open(SCRATCH + "/aux.pkl", "rb"))["Cva"]
    nq, nd = T.shape
    best = T.argmax(1); meta = Cva.argmax(1)

    # ---- 1. do oracle donors agree with the query on observable fields? ---
    print("=" * 88)
    print("AGREEMENT RATE on observable fields: oracle-chosen donor vs metadata-chosen vs base rate")
    fields = ["cell_line", "cell_type", "cleaned_phenotype", "screen_type", "library_type",
              "library_methodology", "condition_name", "experimental_setup",
              "significance_criteria", "author", "source"]
    print(f"  {'field':<24} {'oracle':>8} {'metadata':>9} {'random':>8} {'lift':>7}")
    for f in fields:
        qv = np.array([nz(s.get(f)) for s in va], dtype=object)
        dv = np.array([nz(s.get(f)) for s in tr], dtype=object)
        M = (qv[:, None] == dv[None, :]) & (qv[:, None] != "")
        o = M[np.arange(nq), best].mean(); m = M[np.arange(nq), meta].mean(); r = M.mean()
        print(f"  {f:<24} {o:>8.1%} {m:>9.1%} {r:>8.1%} {(o/max(r,1e-9)):>6.1f}x")

    # ---- 2. information bound over metadata partitions --------------------
    print("\n" + "=" * 88)
    print("INFORMATION BOUND: best possible score for ANY rule that sees only a donor")
    print("signature (a rule must score all donors in a cell equally, so it gets the cell mean)")
    sigs = {
        "screen_type only": ["screen_type"],
        "+ library_type/methodology": ["screen_type", "library_type", "library_methodology"],
        "+ cleaned_phenotype": ["screen_type", "library_type", "library_methodology",
                                "cleaned_phenotype"],
        "+ cell_line": ["screen_type", "library_type", "library_methodology",
                        "cleaned_phenotype", "cell_line"],
        "+ condition_name": ["screen_type", "library_type", "library_methodology",
                             "cleaned_phenotype", "cell_line", "condition_name"],
        "+ experimental_setup+duration": ["screen_type", "library_type", "library_methodology",
                                          "cleaned_phenotype", "cell_line", "condition_name",
                                          "experimental_setup", "duration"],
    }
    print(f"  {'donor signature':<34} {'cells':>6} {'singletons':>11} {'bound':>8} {'bound(cells>=3)':>16}")
    for name, flds in sigs.items():
        key = [tuple(nz(s.get(f)) for f in flds) for s in tr]
        groups = collections.defaultdict(list)
        for j, k in enumerate(key):
            groups[k].append(j)
        cells = [np.array(v) for v in groups.values()]
        means = np.stack([T[:, c].mean(1) for c in cells], 1)      # nq x ncell
        big = np.array([len(c) >= 3 for c in cells])
        b_all = means.max(1).mean()
        b_big = means[:, big].max(1).mean() if big.any() else float("nan")
        sing = sum(1 for c in cells if len(c) == 1)
        print(f"  {name:<34} {len(cells):>6} {sing:>11} {b_all:>8.4f} {b_big:>16.4f}")
    print(f"  {'(ORACLE, per-donor choice)':<34} {nd:>6} {'-':>11} {T.max(1).mean():>8.4f}")
    print(f"  {'(random donor)':<34} {'-':>6} {'-':>11} {T.mean():>8.4f}")

    # ---- 3. where the oracle's advantage lives ----------------------------
    print("\n" + "=" * 88)
    print("PER-CATEGORY (validation): oracle vs metadata-1NN vs random donor")
    cats = np.array([s["cleaned_phenotype"] for s in va], dtype=object)
    print(f"  {'cleaned_phenotype':<50} {'n':>4} {'oracle':>8} {'meta1NN':>8} {'random':>8}")
    for c in sorted(set(cats)):
        m = cats == c
        print(f"  {c:<50} {m.sum():>4} {T.max(1)[m].mean():>8.4f} "
              f"{T[np.arange(nq), meta][m].mean():>8.4f} {T[m].mean():>8.4f}")

    # ---- 4. is the oracle donor 'the same experiment elsewhere'? ----------
    print("\n" + "=" * 88)
    print("12 highest-oracle validation screens: query -> oracle donor (label-free view)")
    ordr = np.argsort(-T.max(1))[:12]
    P = np.load(SCRATCH + "/P_val.npy").astype(np.float64) if os.path.exists(SCRATCH + "/P_val.npy") else None
    for i in ordr:
        q, d = va[i], tr[best[i]]
        prank = int((P[i] > P[i, best[i]]).sum()) + 1 if P is not None else -1
        crank = int((Cva[i] > Cva[i, best[i]]).sum()) + 1
        print(f"\n  val#{i} oracle={T[i,best[i]]:.3f}  metadata-rank of that donor {crank}/1349, "
              f"learned-rank {prank}/1349")
        print(f"    Q: {q['cell_line'][:22]:<22} | {q['cleaned_phenotype'][:32]:<32} | "
              f"{str(q['condition_name'])[:26]:<26} | n={len(q['relevance_genes'])}")
        print(f"    D: {d['cell_line'][:22]:<22} | {d['cleaned_phenotype'][:32]:<32} | "
              f"{str(d['condition_name'])[:26]:<26} | n={len(d['relevance_genes'])}")
        print(f"    Qpheno: {str(q['phenotype'])[:96]}")
        print(f"    Dpheno: {str(d['phenotype'])[:96]}")

if __name__ == "__main__":
    main()

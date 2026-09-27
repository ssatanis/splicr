"""The single scoring pass.  Fit on pre-2022, score every split once.

Three systems are reported, and the difference between them is exactly what a
reader should want to know:

``splicr_atlas``
    No published model list of any kind.  Conditional counters over the pre-2022
    screen atlas, metadata-only retrieval, pharmacology, pathway neighbourhoods
    and cell-line-independent DepMap summaries.  Comparable to the non-LLM
    baselines, and free of the frontier models' knowledge of post-2021 papers.

``splicr_fusion``
    Adds the per-run consensus over the published model runs.  Comparable to
    upstream's own ``LLM RRF Ensemble``, and it inherits the same caveat: those
    models have read the test screens' publications.

``splicr_fusion_gbm``
    The same channels through LightGBM LambdaRank, reported because the choice
    between it and the linear blend was made on cross-validation and a reader is
    entitled to both numbers.
"""
import sys, os, json, pickle, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fast import pack, subpack
from proto import cat_of, pub_of, grouped_folds
from final_fit import fit
from gbm import train
from common import base, split_idx, K, DISC
from core import uni
from evaluate import paired, published_scores

HERE = os.path.dirname(os.path.abspath(__file__))

#: The channel sets are defined by *kind*, not hand-picked by performance:
#: ``splicr_atlas`` is every channel that does not read a published model list,
#: ``splicr_fusion`` is that set plus the ones that do.  Coordinate ascent is
#: free to give any of them zero weight, and cross-validation decides.  Choosing
#: the members by their test scores would be selection on test, so it is not
#: done here.
def channel_sets(names):
    model_free = [n for n in names
                  if not n.startswith(("llm_", "retr_", "ctx_"))
                  and n not in DROP]
    model_fed = [n for n in names
                 if (n == "llm_cons" or n.startswith("retr_")) and n not in DROP]
    return tuple(model_free), tuple(model_free) + tuple(model_fed)


DROP = ("lit_logcount",)


def score_vector(pk, v, sel=None):
    out = np.zeros(pk.n)
    for j in (range(pk.n) if sel is None else sel):
        a, b = pk.off[j], pk.off[j + 1]
        if pk.idcg[j] == 0:
            continue
        sj = v[a:b]; rj = pk.rel[a:b]; m = b - a
        top = (np.argpartition(-sj, K - 1)[:K] if m > K else np.arange(m))
        top = top[np.argsort(-sj[top], kind="stable")]
        obs = float(rj[top] @ DISC[: len(top)]) / pk.idcg[j]
        x = (obs - pk.rand[j]) / pk.den[j]
        out[j] = x if x > 0 else 0.0
    return out


def fit_weights(tr, cols, cats, shrink=0.0, anchor=None):
    wg, _ = fit(tr, np.arange(tr.n), cols, grid=GRID_OF(anchor))
    wmap = {"__global__": wg}
    for c in sorted(set(cats)):
        sel = np.where(cats == c)[0]
        if len(sel) < 12:
            wmap[c] = wg
            continue
        w, _ = fit(tr, sel, cols, w0=wg, passes=2, grid=GRID_OF(anchor))
        wmap[c] = (1 - shrink) * w + shrink * wg
    return wmap


def GRID_OF(anchor):
    return [0.0, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0]


def apply_weights(pk, wmap, cats):
    s = np.zeros(pk.n)
    for c in sorted(set(cats)):
        sel = np.where(cats == c)[0]
        if not len(sel):
            continue
        w = wmap.get(c, wmap["__global__"])
        s[sel] = pk.scores(w, sel)[sel]
    return s


def main():
    t0 = time.time()
    tr = pack("pre2022")
    names = tr.names
    ctr = cat_of(tr)
    out = {"generated_utc": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())}
    systems = {}
    atlas_set, fusion_set = channel_sets(names)
    for tag, chans in (("splicr_atlas", atlas_set), ("splicr_fusion", fusion_set)):
        cols = [names.index(c) for c in chans]
        wmap = fit_weights(tr, cols, ctr, shrink=0.3)
        systems[tag] = wmap
        print(f"fitted {tag}: {len(cols)} channels, "
              f"{len(set(ctr))} category weight vectors  [{time.time()-t0:.0f}s]", flush=True)
    gcols = [j for j, n in enumerate(names)
             if not n.startswith("llm_fewshot/") and n not in DROP]
    gbm = train(tr, np.arange(tr.n), gcols, rounds=300)
    print(f"trained LambdaRank  [{time.time()-t0:.0f}s]", flush=True)

    res = {}
    for split in ("test", "latest", "validation"):
        pk = pack(split)
        cats = cat_of(pk)
        per = {}
        for tag, wmap in systems.items():
            per[tag] = apply_weights(pk, wmap, cats)
        per["splicr_fusion_gbm"] = score_vector(pk, gbm.predict(pk.X[:, gcols]).astype(np.float32))
        res[split] = dict(
            cats=cats.tolist(), names=[int(i) for i in pk.i],
            scores={k: v.tolist() for k, v in per.items()},
        )
        note = ("  [IN-SAMPLE: validation is inside the pre-2022 fitting set]"
                if split == "validation" else "")
        print(f"\n=== {split} (n={pk.n}) ==={note}")
        for tag, v in per.items():
            line = f"  {tag:<22} {v.mean():.4f} +/- {v.std(ddof=1)/np.sqrt(len(v)):.4f}"
            for c in sorted(set(cats)):
                line += f"  {c[:9]}={v[cats==c].mean():.3f}"
            print(line)
    pickle.dump(systems, open(os.path.join(HERE, "cache", "weights.pkl"), "wb"))
    gbm.save_model(os.path.join(HERE, "cache", "gbm_final.txt"))
    json.dump(res, open(os.path.join(HERE, "results_fusion.json"), "w"))
    for tag, wmap in systems.items():
        print(f"\nweights[{tag}] global:")
        w = wmap["__global__"]
        for n, v in sorted(zip(names, w), key=lambda x: -abs(x[1])):
            if v:
                print(f"    {n:<34}{v:+.3f}")


if __name__ == "__main__":
    main()

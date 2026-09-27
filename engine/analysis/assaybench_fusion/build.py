"""Build the cached screen x gene tables every experiment in this folder reads.

Label-bearing arrays are kept per screen and only ever read for a screen through
the donor masks in ``common.py``; nothing here looks at a test label except to
build the scoring target.
"""
import os, sys, json, glob, pickle, re, ast
import numpy as np
from scipy import sparse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
from splicr.assaybench_io import load_split
from splicr import benchmark as bm

PRED_ROOT = os.path.join(HERE, "..", "..", ".tools", "assaybench", "benchmarking", "predictions")
OUT = os.path.join(HERE, "cache")
os.makedirs(OUT, exist_ok=True)

def main():
    andcg = bm.AnDCG(k=100)
    bio = load_split(None)
    lat = load_split(None, config="LaTest")
    for s in lat:
        s["yearfold0"] = "latest"
    screens = bio + lat
    genes, gidx = [], {}
    def gi(sym):
        j = gidx.get(sym)
        if j is None:
            j = gidx[sym] = len(genes); genes.append(sym)
        return j
    lib, rel, targets = [], [], []
    for s in screens:
        t = andcg.target(s)
        items = list(t.relevance.items())
        lib.append(np.array([gi(g) for g, _ in items], dtype=np.int32))
        rel.append(np.array([v for _, v in items], dtype=np.float32))
        targets.append(dict(idcg=t.idcg, rand=t.rand_ndcg, denom=t.denom, n=t.n_genes))
    meta = [{k: v for k, v in s.items() if k not in ("relevance_genes", "relevance_scores", "hit")} for s in screens]
    # published prediction lists, normalised, in-order, deduped
    name2i = {}
    for i, s in enumerate(screens):
        key = ("latest:" if s["yearfold0"] == "latest" else "") + str(s["dataset_name"])
        name2i[key] = i
    preds = {}
    for f in sorted(glob.glob(os.path.join(PRED_ROOT, "*", "*.json"))):
        d = json.load(open(f))
        model = d["model_name"]
        out = {}
        for dsn, recs in d["records_by_dataset"].items():
            for r in recs:
                lay = r.get("split_layout")
                if lay == "year":
                    key = str(r["dataset_name"])
                elif lay == "novel":
                    key = "latest:" + str(r["dataset_name"])
                else:
                    continue
                i = name2i.get(key)
                if i is None:
                    continue
                pg = r["predicted_genes"]
                if isinstance(pg, str):
                    try:
                        pg = ast.literal_eval(pg)
                    except Exception:
                        pg = [x.strip(" '\"") for x in pg.strip("[]").split(",")]
                seen, lst = set(), []
                for g in pg:
                    if not isinstance(g, str) or not g.strip():
                        continue
                    n = andcg.normalize(g)
                    if n in seen:
                        continue
                    seen.add(n); lst.append(gi(n))
                out[i] = np.array(lst, dtype=np.int32)
        preds[model] = out
        print(f"{model:<45} {len(out)} screens")
    pickle.dump(dict(genes=genes, lib=lib, rel=rel, targets=targets, meta=meta, preds=preds,
                     hgnc=sorted(andcg.hgnc_symbols)),
                open(os.path.join(OUT, "base.pkl"), "wb"), protocol=4)
    print("genes", len(genes), "screens", len(screens))

if __name__ == "__main__":
    main()

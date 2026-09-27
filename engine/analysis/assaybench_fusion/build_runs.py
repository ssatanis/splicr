"""Extract every sampling run from the published prediction files.

Most model files ship five independent runs per screen and an aggregate list;
only the aggregate is used by the published leaderboard.  How often a gene
survives across a model's own runs is a confidence signal that the aggregate
throws away, and it is free -- the runs are already in the repository.
"""
import os, sys, json, glob, ast, pickle
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import base
from core import uni

PRED = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "..", "..", ".tools", "assaybench", "benchmarking", "predictions")


def parse(v):
    if isinstance(v, list):
        return v
    if not isinstance(v, str):
        return []
    try:
        return ast.literal_eval(v)
    except Exception:
        return [x.strip(" '\"") for x in v.strip("[]").split(",") if x.strip(" '\"")]


def main():
    from splicr import benchmark as bm
    andcg = bm.AnDCG(k=100)
    u = uni(); d = base()
    key2i = {}
    for i, m in enumerate(d["meta"]):
        pre = "latest:" if m["yearfold0"] == "latest" else ""
        key2i[pre + str(m["dataset_name"])] = i
    out = {}
    for f in sorted(glob.glob(os.path.join(PRED, "*", "*.json"))):
        doc = json.load(open(f))
        model = doc["model_name"]
        per = {}
        for _, recs in doc["records_by_dataset"].items():
            for r in (recs if isinstance(recs, list) else [recs]):
                lay = r.get("split_layout")
                if lay == "year":
                    k = str(r["dataset_name"])
                elif lay == "novel":
                    k = "latest:" + str(r["dataset_name"])
                else:
                    continue
                i = key2i.get(k)
                if i is None:
                    continue
                runs = parse(r.get("prediction_runs"))
                if runs and not isinstance(runs[0], list):
                    runs = [runs]
                if not runs:
                    runs = [parse(r.get("predicted_genes"))]
                enc = []
                for run in runs:
                    seen, lst = set(), []
                    for g in run:
                        if not isinstance(g, str) or not g.strip():
                            continue
                        j = u.sym2u.get(andcg.normalize(g))
                        if j is None or j in seen:
                            continue
                        seen.add(j); lst.append(j)
                    if lst:
                        enc.append(np.array(lst, np.int32))
                if enc:
                    per[i] = enc
        out[model] = per
        nruns = np.mean([len(v) for v in per.values()]) if per else 0
        print(f"{model:<42} screens={len(per):<5} mean runs={nruns:.1f}", flush=True)
    pickle.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       "cache", "runs.pkl"), "wb"), protocol=4)


if __name__ == "__main__":
    main()

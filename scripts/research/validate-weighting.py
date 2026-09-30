#!/usr/bin/env python
"""
Which per-guide prior, if any, improves a single real screen?

    engine/.tools/env/bin/python scripts/research/validate-weighting.py --screens 120

The averaged-over-60-screens test in validate-benchmark.py has almost no
headroom: essential and non-essential genes separate at ROC AUC 0.998 before any
correction, because averaging 60 screens removes the noise a per-guide prior is
supposed to fight. A lab has one screen. So this runs the comparison the way a
lab would see it, once per screen, and reports the distribution of the change
rather than a single number.

Three priors are compared on identical folds, all against the same screens:

    rs3          Rule Set 3 on-target activity (Doench lab), already in the engine
    frameshift   Lindel predicted frameshift fraction
    gc           guide GC content, as a deliberately dumb control

A prior earns its place only if weighting by it moves NNMD and ROC AUC in the
right direction on most screens. `gc` is included because a prior that cannot
beat GC content is not encoding biology worth the complexity.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from splicr import lake  # noqa: E402
from splicr.config import DEPMAP_DIR  # noqa: E402
from splicr.references import essentials, nonessentials  # noqa: E402
from splicr.validate.benchmark import _auroc, _nnmd  # noqa: E402

RELEASE = "26Q1"
COUNTS = DEPMAP_DIR / RELEASE / "AvanaRawReadcounts.csv"
SEQMAP = DEPMAP_DIR / RELEASE / "ScreenSequenceMap.csv"
OUT = ROOT / "research" / "artifacts" / "validate"
RS3_CACHE = ROOT / "data" / "references" / "derived" / "rs3_avana.parquet"


def rs3_scores(val) -> dict[str, float]:
    """Rule Set 3 for every Avana guide, cached: the model is slow to import."""
    import pandas as pd

    if RS3_CACHE.exists():
        c = pd.read_parquet(RS3_CACHE)
        return dict(zip(c.guide_key, c.rs3))
    from splicr import rs3_compat  # noqa: F401 - shims sklearn/lightgbm versions
    from rs3.seq import predict_seq

    sub = val[val.context.str.len().eq(60)].copy()
    sub["ctx30"] = sub.context.str[9:39]          # 4 + 20 protospacer + 3 PAM + 3
    started = time.time()
    sub["rs3"] = predict_seq(sub.ctx30.tolist(), sequence_tracr="Hsu2013", n_jobs=4)
    print(f"  RS3: {len(sub):,} guides in {time.time() - started:.0f}s")
    RS3_CACHE.parent.mkdir(parents=True, exist_ok=True)
    sub[["guide_key", "rs3"]].to_parquet(RS3_CACHE, compression="zstd", index=False)
    return dict(zip(sub.guide_key, sub.rs3))


def main() -> int:
    import pandas as pd

    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", default="Avana-4")
    ap.add_argument("--screens", type=int, default=120)
    args = ap.parse_args()

    val = pd.read_parquet(lake.LOCAL_LAKE / "guide_validation" / "library=avana" / "data_0.parquet")
    val = val[val.status.eq("ok") & val.n_alignments.fillna(1).le(1) & val.drop_reason.isna()]
    val = val.dropna(subset=["gene_symbol", "frameshift"])
    val["gc"] = val.guide_key.str.count("[GC]") / 20.0
    val["rs3"] = val.guide_key.map(rs3_scores(val))
    val = val.dropna(subset=["rs3"])

    rows = list(csv.DictReader(open(SEQMAP)))
    pdna = next(r["SequenceID"] for r in rows if r["ScreenType"] == "pDNA" and r["pDNABatch"] == args.batch)
    screens = sorted(r["SequenceID"] for r in rows
                     if r["Library"] == "Avana" and r["ScreenType"] == "2DS"
                     and r["pDNABatch"] == args.batch and r["PassesQC"] == "True"
                     and r["ExcludeFromCRISPRCombined"] == "False")[:args.screens]

    import duckdb
    con = duckdb.connect()
    con.execute("set enable_progress_bar = false")
    cols = ", ".join(f'"{c}"' for c in [pdna, *screens])
    counts = con.execute(f'select "column0000" as sgrna, {cols} from read_csv(\'{COUNTS}\', header=true, '
                         f"sample_size=2000)").df()
    con.close()

    mat = counts[[pdna, *screens]].to_numpy(dtype=float)
    mat = np.where(np.isfinite(mat), mat, 0.0)
    cpm = (mat + 1.0) / (mat.sum(axis=0, keepdims=True) + len(mat)) * 1e6
    logcpm = np.log2(cpm)
    keep = mat[:, 0] >= 30
    lfc_all = logcpm[:, 1:] - logcpm[:, [0]]
    guides = counts["sgrna"].to_numpy()[keep]
    lfc_all = lfc_all[keep]

    val = val.set_index("guide_key").reindex(guides).reset_index().rename(columns={"index": "guide_key"})
    ok = val.gene_symbol.notna().to_numpy()
    genes = val.gene_symbol.to_numpy()
    ess, non = set(essentials(9606)), set(nonessentials(9606))
    cls = np.array(["essential" if g in ess else "nonessential" if g in non else "other" for g in genes])

    priors = {"rs3": val.rs3.to_numpy(), "frameshift": val.frameshift.to_numpy(), "gc": val.gc.to_numpy()}
    # A weight must be positive and comparable across guides: rank-normalise each
    # prior to (0,1] so the three are compared on their ordering alone, not on
    # whatever scale each model happens to emit.
    from scipy.stats import rankdata
    weights = {}
    for name, v in priors.items():
        r = np.full(len(v), np.nan)
        m = np.isfinite(v)
        r[m] = rankdata(v[m]) / m.sum()
        weights[name] = np.clip(r, 0.02, 1.0)

    results = {k: {"nnmd": [], "auroc": []} for k in priors}
    base = {"nnmd": [], "auroc": []}
    use = ok & np.isfinite(lfc_all).all(axis=1) & np.isfinite(priors["rs3"])
    for j in range(lfc_all.shape[1]):
        lfc = lfc_all[:, j]
        df = pd.DataFrame({"gene": genes[use], "cls": cls[use], "lfc": lfc[use],
                           **{k: weights[k][use] for k in priors}})
        df = df[df.cls != "other"]
        plain = df.groupby("gene").agg(cls=("cls", "first"), v=("lfc", "mean"))
        e, n = plain[plain.cls == "essential"].v.to_numpy(), plain[plain.cls == "nonessential"].v.to_numpy()
        base["nnmd"].append(_nnmd(e, n)); base["auroc"].append(_auroc(e, n))
        for name in priors:
            w = df.groupby("gene").apply(
                lambda s, c=name: float(np.average(s.lfc, weights=s[c])), include_groups=False)
            t = plain.assign(v=w)
            e2, n2 = t[t.cls == "essential"].v.to_numpy(), t[t.cls == "nonessential"].v.to_numpy()
            results[name]["nnmd"].append(_nnmd(e2, n2)); results[name]["auroc"].append(_auroc(e2, n2))

    out = {"release": RELEASE, "batch": args.batch, "n_screens": len(screens),
           "baseline": {"nnmd_median": round(float(np.median(base["nnmd"])), 4),
                        "auroc_median": round(float(np.median(base["auroc"])), 5)},
           "priors": {}}
    print(f"\n{len(screens)} single screens, {int(use.sum()):,} guides")
    print(f"baseline (unweighted): NNMD {out['baseline']['nnmd_median']}  AUROC {out['baseline']['auroc_median']}")
    for name in priors:
        dn = np.array(results[name]["nnmd"]) - np.array(base["nnmd"])
        da = np.array(results[name]["auroc"]) - np.array(base["auroc"])
        out["priors"][name] = {
            "delta_nnmd_median": round(float(np.median(dn)), 4),
            "delta_auroc_median": round(float(np.median(da)), 5),
            "screens_improved_nnmd": int((dn < 0).sum()), "screens_improved_auroc": int((da > 0).sum()),
            "n_screens": len(dn),
        }
        p = out["priors"][name]
        print(f"  {name:11s} dNNMD {p['delta_nnmd_median']:+.4f} "
              f"({p['screens_improved_nnmd']}/{p['n_screens']} better)   "
              f"dAUROC {p['delta_auroc_median']:+.5f} ({p['screens_improved_auroc']}/{p['n_screens']} better)")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "weighting_comparison.json").write_text(json.dumps(out, indent=2) + "\n")
    print(f"\nwrote {OUT / 'weighting_comparison.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

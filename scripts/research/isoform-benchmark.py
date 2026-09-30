#!/usr/bin/env python
"""
Run the pre-registered isoform-evasion test.

    engine/.tools/env/bin/python scripts/research/isoform-benchmark.py

Thresholds are read from `engine/research/isoform/PREREGISTRATION.md`, which was
committed before this ran. Nothing here chooses a threshold, and every test
prints its pre-declared bar next to its result.

Writes research/artifacts/validate/isoform_benchmark.json.
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
from splicr.validate import isoform  # noqa: E402

RELEASE = "26Q1"
EFFICACY = DEPMAP_DIR / RELEASE / "guide_efficacy.csv"
COUNTS = DEPMAP_DIR / RELEASE / "AvanaRawReadcounts.csv"
SEQMAP = DEPMAP_DIR / RELEASE / "ScreenSequenceMap.csv"
OUT = ROOT / "research" / "artifacts" / "validate" / "isoform_benchmark.json"

# Fixed in PREREGISTRATION.md before any outcome was computed.
THRESHOLDS = {
    "min_rho": 0.05,
    "max_p": 0.01,
    "gc_baseline": 0.0839,
    "min_partial_retained": 0.60,
    "min_effect_sd": 0.20,
    "min_screens_improved": 0.50,
    "evaded_below": 0.5,
}


def load_guides():
    import pandas as pd

    v = pd.read_parquet(lake.LOCAL_LAKE / "guide_validation" / "library=avana" / "data_0.parquet")
    v = v[v.status.eq("ok") & v.n_alignments.fillna(1).le(1) & v.drop_reason.isna()]
    v = v.dropna(subset=["gene_symbol", "cut_pos"]).copy()

    incl = isoform.inclusion_many(zip(v.gene_symbol, v.chrom, v.cut_pos.astype(int)))
    v["coding_fraction"] = [r.coding_fraction for r in incl]
    v["exonic_fraction"] = [r.exonic_fraction for r in incl]
    v["n_transcripts"] = [r.n_transcripts for r in incl]
    seq = v.sequence.str.upper()
    v["gc"] = (seq.str.count("G") + seq.str.count("C")) / seq.str.len()
    return v.dropna(subset=["coding_fraction"])


def _spearman(x, y):
    from scipy.stats import spearmanr

    r = spearmanr(x, y)
    return float(r.statistic), float(r.pvalue)


def _partial(x, y, z):
    """Spearman of x and y with the rank-linear effect of z removed from both."""
    from scipy.stats import rankdata, spearmanr

    rx, ry, rz = (rankdata(v).astype(float) for v in (x, y, z))
    design = np.column_stack([np.ones_like(rz), rz])
    resid = [v - design @ np.linalg.lstsq(design, v, rcond=None)[0] for v in (rx, ry)]
    r = spearmanr(*resid)
    return float(r.statistic), float(r.pvalue)


def correlation_tests(v) -> dict:
    import pandas as pd
    from scipy.stats import mannwhitneyu

    eff = pd.read_csv(EFFICACY)
    m = v.merge(eff, left_on="guide_key", right_on="sgrna", how="inner")
    out: dict = {"n_guides": int(len(m)), "n_genes": int(m.gene_symbol.nunique()), "tests": {}}

    rho, p = _spearman(m.coding_fraction, m.efficacy)
    gc_rho, gc_p = _spearman(m.gc, m.efficacy)
    ex_rho, ex_p = _spearman(m.exonic_fraction, m.efficacy)
    prho, pp = _partial(m.coding_fraction, m.efficacy, m.gc)

    out["tests"]["1_mechanism"] = {
        "statistic": round(rho, 4), "p_value": p, "n": len(m),
        "threshold": f"positive, p<{THRESHOLDS['max_p']}, rho>={THRESHOLDS['min_rho']}",
        "passes": bool(rho > 0 and p < THRESHOLDS["max_p"] and rho >= THRESHOLDS["min_rho"]),
    }
    out["tests"]["2_beats_gc"] = {
        "statistic": round(rho, 4), "gc_rho": round(gc_rho, 4), "gc_p": gc_p,
        "threshold": f"rho > {THRESHOLDS['gc_baseline']}",
        "passes": bool(rho > THRESHOLDS["gc_baseline"]),
    }
    retained = abs(prho) / abs(rho) if rho else 0.0
    out["tests"]["3_not_gc_artifact"] = {
        "partial_rho": round(prho, 4), "p_value": pp, "retained": round(retained, 3),
        "threshold": f"retains >= {THRESHOLDS['min_partial_retained']:.0%} of raw rho",
        "passes": bool(retained >= THRESHOLDS["min_partial_retained"]),
    }

    low = m[m.coding_fraction < THRESHOLDS["evaded_below"]].efficacy
    full = m[m.coding_fraction >= 1.0].efficacy
    if len(low) and len(full):
        u = mannwhitneyu(low, full)
        pooled = np.sqrt((low.var(ddof=1) * (len(low) - 1) + full.var(ddof=1) * (len(full) - 1))
                         / (len(low) + len(full) - 2))
        effect = (full.mean() - low.mean()) / pooled if pooled else float("nan")
        out["tests"]["4_contrast"] = {
            "low_n": int(len(low)), "low_mean": round(float(low.mean()), 4),
            "constitutive_n": int(len(full)), "constitutive_mean": round(float(full.mean()), 4),
            "p_value": float(u.pvalue), "effect_sd": round(float(effect), 3),
            "threshold": f"low group lower by >= {THRESHOLDS['min_effect_sd']} sd, p<{THRESHOLDS['max_p']}",
            "passes": bool(effect >= THRESHOLDS["min_effect_sd"] and u.pvalue < THRESHOLDS["max_p"]),
        }

    out["reference"] = {
        "exonic_fraction_rho": round(ex_rho, 4), "exonic_fraction_p": ex_p,
        "note": "gc_rho is the free baseline test 2 must beat",
    }
    out["deciles"] = decile_table(m)
    return out


def decile_table(m) -> list:
    import pandas as pd

    # coding_fraction is heavily tied at 1.0, so equal-count bins collapse;
    # fixed cut points describe the distribution honestly instead.
    bins = [-0.01, 0.25, 0.5, 0.75, 0.9, 0.999, 1.01]
    labels = ["<0.25", "0.25-0.5", "0.5-0.75", "0.75-0.9", "0.9-1.0", "=1.0"]
    m = m.assign(band=pd.cut(m.coding_fraction, bins, labels=labels))
    g = m.groupby("band", observed=True).agg(
        n=("efficacy", "size"), efficacy=("efficacy", "mean"), gc=("gc", "mean"))
    return [{"band": str(b), "n": int(r.n), "efficacy": round(float(r.efficacy), 4),
             "gc": round(float(r.gc), 4)} for b, r in g.iterrows()]


# --- Test 5: does filtering the guides improve a real screen? ---------------

def _nnmd(ess, non):
    mad = float(np.median(np.abs(non - np.median(non))))
    return float((np.median(ess) - np.median(non)) / (mad * 1.4826)) if mad else float("nan")


def _auroc(pos, neg):
    from scipy.stats import rankdata

    both = np.concatenate([pos, neg])
    ranks = rankdata(both)
    n1, n2 = len(pos), len(neg)
    if not n1 or not n2:
        return float("nan")
    u = ranks[:n1].sum() - n1 * (n1 + 1) / 2
    return 1.0 - u / (n1 * n2)


def filter_test(v, batch: str, n_screens: int) -> dict:
    import duckdb
    import pandas as pd

    rows = list(csv.DictReader(open(SEQMAP)))
    pdna = [r["SequenceID"] for r in rows if r["ScreenType"] == "pDNA" and r["pDNABatch"] == batch]
    screens = sorted(r["SequenceID"] for r in rows
                     if r["Library"] == "Avana" and r["ScreenType"] == "2DS"
                     and r["pDNABatch"] == batch and r["PassesQC"] == "True"
                     and r["ExcludeFromCRISPRCombined"] == "False")[:n_screens]
    if not pdna or not screens:
        return {"skipped": f"no pDNA or screens for batch {batch}"}

    con = duckdb.connect()
    con.execute("set enable_progress_bar = false")
    # DepMap ships the guide column unnamed, and DuckDB's placeholder name for
    # it depends on the column count, so it is read rather than assumed.
    first = con.execute(f"select * from read_csv('{COUNTS}', header=true, "
                        f"sample_size=2000) limit 0").df().columns[0]
    cols = ", ".join(f'"{c}"' for c in [pdna[0], *screens])
    df = con.execute(f'select "{first}" as sgrna, {cols} from '
                     f"read_csv('{COUNTS}', header=true, sample_size=2000)").df()
    con.close()

    mat = df[[pdna[0], *screens]].to_numpy(dtype=float)
    mat = np.where(np.isfinite(mat), mat, 0.0)
    cpm = (mat + 1.0) / (mat.sum(axis=0, keepdims=True) + len(mat)) * 1e6
    logcpm = np.log2(cpm)
    lfc = logcpm[:, 1:] - logcpm[:, [0]]
    keep = mat[:, 0] >= 30
    lfc_df = pd.DataFrame(lfc[keep], index=df.sgrna.to_numpy()[keep], columns=screens)

    ann = v.set_index("guide_key")[["gene_symbol", "coding_fraction"]]
    joined = lfc_df.join(ann, how="inner")
    ess, non = set(essentials(9606)), set(nonessentials(9606))
    joined = joined[joined.gene_symbol.isin(ess | non)].copy()
    joined["evaded"] = joined.coding_fraction < THRESHOLDS["evaded_below"]

    # A gene must keep >=2 guides after filtering, in both arms, so the
    # comparison is over the same genes and cannot be won by dropping genes.
    kept = joined[~joined.evaded]
    eligible = set(kept.groupby("gene_symbol").size()[lambda s: s >= 2].index)
    eligible &= set(joined.groupby("gene_symbol").size()[lambda s: s >= 2].index)
    both = joined[joined.gene_symbol.isin(eligible)]
    kept = kept[kept.gene_symbol.isin(eligible)]

    per_screen = []
    for s in screens:
        out = {}
        for arm, frame in (("all", both), ("filtered", kept)):
            gene = frame.groupby("gene_symbol")[s].mean()
            e = gene[gene.index.isin(ess)].to_numpy()
            n = gene[gene.index.isin(non)].to_numpy()
            out[arm] = {"nnmd": _nnmd(e, n), "auroc": _auroc(e, n)}
        out["d_nnmd"] = out["filtered"]["nnmd"] - out["all"]["nnmd"]
        out["d_auroc"] = out["filtered"]["auroc"] - out["all"]["auroc"]
        per_screen.append(out)

    d_nnmd = np.array([p["d_nnmd"] for p in per_screen])
    d_auroc = np.array([p["d_auroc"] for p in per_screen])
    # NNMD is negative-is-better, so an improvement is a decrease.
    improved_nnmd = float((d_nnmd < 0).mean())
    return {
        "batch": batch, "n_screens": len(screens),
        "genes_compared": int(len(eligible)),
        "guides_removed": int(both.evaded.sum()),
        "guides_total": int(len(both)),
        "baseline_nnmd_median": round(float(np.median([p["all"]["nnmd"] for p in per_screen])), 4),
        "baseline_auroc_median": round(float(np.median([p["all"]["auroc"] for p in per_screen])), 4),
        "d_nnmd_median": round(float(np.median(d_nnmd)), 4),
        "d_auroc_median": round(float(np.median(d_auroc)), 5),
        "screens_nnmd_improved": improved_nnmd,
        "screens_auroc_improved": float((d_auroc > 0).mean()),
        "threshold": (f"median NNMD improves (negative) and improves on "
                      f">{THRESHOLDS['min_screens_improved']:.0%} of screens"),
        "passes": bool(np.median(d_nnmd) < 0
                       and improved_nnmd > THRESHOLDS["min_screens_improved"]),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", default="Avana-4")
    ap.add_argument("--screens", type=int, default=100)
    ap.add_argument("--skip-filter-test", action="store_true")
    args = ap.parse_args()

    started = time.time()
    v = load_guides()
    print(f"{len(v):,} guides with a verified cut and an isoform inclusion\n")

    result = correlation_tests(v)
    for name, t in result["tests"].items():
        mark = "PASS" if t["passes"] else "FAIL"
        stat = t.get("statistic", t.get("partial_rho", t.get("effect_sd")))
        print(f"  [{mark}] {name:20s} {stat:+.4f}   needs {t['threshold']}")
    print(f"\n  free baseline: GC content scores {result['tests']['2_beats_gc']['gc_rho']:+.4f}")
    print("\n  efficacy by coding_fraction band:")
    for row in result["deciles"]:
        print(f"    {row['band']:>9s}  n={row['n']:6,}  efficacy {row['efficacy']:.4f}  gc {row['gc']:.3f}")

    if not args.skip_filter_test:
        print(f"\n  test 5: filtering on {args.screens} individually-scored screens ...")
        result["tests"]["5_filter"] = filter_test(v, args.batch, args.screens)
        f = result["tests"]["5_filter"]
        if "skipped" in f:
            print(f"    skipped: {f['skipped']}")
        else:
            print(f"    [{'PASS' if f['passes'] else 'FAIL'}] removed {f['guides_removed']:,}/"
                  f"{f['guides_total']:,} guides over {f['genes_compared']:,} genes")
            print(f"           baseline NNMD {f['baseline_nnmd_median']}  AUROC {f['baseline_auroc_median']}")
            print(f"           dNNMD median {f['d_nnmd_median']:+.4f} (negative is better), "
                  f"improved on {f['screens_nnmd_improved']:.0%} of screens")
            print(f"           dAUROC median {f['d_auroc_median']:+.5f}, "
                  f"improved on {f['screens_auroc_improved']:.0%} of screens")

    result["thresholds"] = THRESHOLDS
    result["seconds"] = round(time.time() - started, 1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2, default=str) + "\n")
    print(f"\nwrote {OUT.relative_to(ROOT)}")

    passed = [n for n, t in result["tests"].items() if t.get("passes")]
    print(f"passed {len(passed)}/{len(result['tests'])}: {', '.join(passed) or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

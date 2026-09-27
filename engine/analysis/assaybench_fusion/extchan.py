"""Gene-level channels from sources outside AssayBench.

Every source here is cell-line-independent and screen-independent:

* DepMap gene-level Chronos summaries and the inferred common-essentials list.
  Per-model ``CRISPRGeneEffect`` rows are *not* read -- on a fitness screen in a
  DepMap line that is a later release of the label (see ``splicr.orcs_safe`` and
  ``docs/08-assaybench-headroom.md`` section 6).
* PubTator mention counts, publication-filtered, as a "how studied is this gene"
  prior.
* Open Targets target attributes (constraint, GO / pathway breadth).
"""
import os, sys, json
import numpy as np
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import uni

REF = "/Users/sahaj/Documents/Projects/SplicR/data/references"


def _vec(sym2u, U, mapping, default=0.0):
    v = np.full(U, default, np.float32)
    for s, x in mapping.items():
        j = sym2u.get(s)
        if j is not None:
            v[j] = x
    return v


def build():
    u = uni()
    s2u, U = u.sym2u, u.U
    out = {}
    gs = pd.read_parquet(os.path.join(REF, "derived", "depmap_gene_stats.parquet"))
    out["dm_mean_neg"] = _vec(s2u, U, dict(zip(gs["gene"], -gs["mean"].astype(float))))
    out["dm_fracdep"] = _vec(s2u, U, dict(zip(gs["gene"], gs["frac_dep"].astype(float))))
    out["dm_selective"] = _vec(s2u, U, dict(zip(gs["gene"], gs["std"].astype(float))))
    ess = set()
    with open(os.path.join(REF, "depmap", "CRISPRInferredCommonEssentials.csv")) as fh:
        next(fh)
        for line in fh:
            ess.add(line.split("(")[0].strip())
    out["dm_common_ess"] = _vec(s2u, U, {g: 1.0 for g in ess})
    pt = json.load(open(os.path.join(REF, "derived", "pubtator_symbol_counts_excl_replication.json")))
    cnt = pt["counts"] if isinstance(pt, dict) and "counts" in pt else pt
    out["lit_logcount"] = _vec(s2u, U, {g: float(np.log1p(c)) for g, c in cnt.items()})
    try:
        at = pd.read_parquet(os.path.join(REF, "derived", "ot_gene_attrs.parquet"))
        col = "symbol"
        for c in at.columns:
            if c == col or at[c].dtype.kind not in "ifb":
                continue
            out[f"ot_{c}"] = _vec(s2u, U, dict(zip(at[col], at[c].astype(float))))
    except Exception as exc:  # pragma: no cover - optional source
        print("open targets attrs unavailable:", exc)
    for k in out:
        v = out[k]
        finite = np.isfinite(v)
        v[~finite] = 0.0
        sd = v.std() or 1.0
        out[k] = ((v - v.mean()) / sd).astype(np.float32)
    return out


if __name__ == "__main__":
    e = build()
    for k, v in e.items():
        print(f"{k:<24} nonzero={int((v!=0).sum()):>6}  mean={v.mean():+.3f}")

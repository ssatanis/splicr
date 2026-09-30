"""
Does predicted repair outcome explain anything about a real screen?

Everything upstream of this module is a prediction. This module is where the
prediction meets measured data, and it is written so it can fail: each test has
a direction fixed in advance, and a null test that must come out flat.

THE THREE TESTS

1. Mechanism. Among guides targeting genes that are essential in every cell
   line, do guides with a higher predicted frameshift fraction depleted more?
   The comparison is made on gene-centred fold changes (each guide's log fold
   change minus its gene's mean), so it asks whether repair prediction explains
   the spread of guides *within* a gene. Nothing about which gene was targeted
   can leak in. Expected sign: negative (more frameshift, more depletion).

2. Specificity. The same correlation among guides targeting non-essential
   genes. Knocking those out does not kill the cell, so there is no depletion
   for repair efficiency to modulate and the correlation should be flat. A
   model that "predicts" depletion here is reading an artefact - guide GC
   content, mapping bias - and not biology.

3. Practical value. Gene-level separation of essential from non-essential
   genes (ROC AUC and the null-normalised median difference that screen QC
   already uses), computed from a plain mean of guide fold changes and from a
   mean weighted by predicted knockout probability. If weighting does not move
   these, the prediction is real but not yet useful, and this module says so.

Essential and non-essential gene sets are Hart's CEGv2 and NEGv1, the same
reference sets the QC stage uses, so a result here is comparable with the QC
numbers already reported for a screen.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np


@dataclass
class TestResult:
    name: str
    statistic: float | None
    n: int
    detail: dict = field(default_factory=dict)

    def __str__(self) -> str:
        stat = "n/a" if self.statistic is None else f"{self.statistic:+.4f}"
        return f"{self.name}: {stat} (n={self.n:,})"


def _spearman(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    from scipy.stats import spearmanr

    r = spearmanr(x, y)
    return float(r.statistic), float(r.pvalue)


def _auroc(positive: np.ndarray, negative: np.ndarray) -> float:
    """P(a random positive scores below a random negative); depletion is negative."""
    from scipy.stats import rankdata

    both = np.concatenate([positive, negative])
    ranks = rankdata(both)
    n1, n2 = len(positive), len(negative)
    if n1 == 0 or n2 == 0:
        return float("nan")
    u = ranks[:n1].sum() - n1 * (n1 + 1) / 2
    return 1.0 - u / (n1 * n2)


def _nnmd(essential: np.ndarray, nonessential: np.ndarray) -> float:
    """(median essential - median non-essential) / MAD(non-essential); screen QC's metric."""
    if essential.size == 0 or nonessential.size == 0:
        return float("nan")
    mad = float(np.median(np.abs(nonessential - np.median(nonessential))))
    if mad == 0:
        return float("nan")
    return float((np.median(essential) - np.median(nonessential)) / (mad * 1.4826))


def _bootstrap_ci(x: np.ndarray, y: np.ndarray, n: int = 1000, seed: int = 0) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    stats = []
    for _ in range(n):
        idx = rng.integers(0, len(x), len(x))
        if np.std(x[idx]) == 0 or np.std(y[idx]) == 0:
            continue
        stats.append(_spearman(x[idx], y[idx])[0])
    if not stats:
        return (float("nan"), float("nan"))
    return (float(np.percentile(stats, 2.5)), float(np.percentile(stats, 97.5)))


def knockout_probability(frameshift: np.ndarray, ploidy: float = 2.0) -> np.ndarray:
    """
    Probability that a cell carrying this guide loses the protein from every copy.

    A frameshift in one allele disrupts that allele. A cell keeps its phenotype
    only if every copy is disrupted, so the per-allele frameshift fraction is
    raised to the copy number. This is the simplest defensible link between a
    repair spectrum and a knockout, and it is deliberately crude: it ignores
    in-frame deletions that still destroy the protein (handled separately by the
    protein layer), nonsense-mediated decay, and any dependence between alleles.
    `ploidy` is the effective number of copies to disrupt, 2 unless a cell line's
    measured copy number says otherwise.
    """
    fs = np.clip(np.asarray(frameshift, dtype=float), 0.0, 1.0)
    return fs ** ploidy


def run(guides, essentials: set[str], nonessentials: set[str],
        weight_col: str = "knockout_probability") -> dict:
    """
    `guides` is a DataFrame with columns: gene_symbol, frameshift, lfc
    (and optionally `weight_col`). One row per guide, `lfc` already averaged
    over whatever samples the caller wants compared.
    """
    import pandas as pd

    df = guides.dropna(subset=["gene_symbol", "frameshift", "lfc"]).copy()
    if weight_col not in df:
        df[weight_col] = knockout_probability(df["frameshift"].to_numpy())
    df["class"] = np.where(df.gene_symbol.isin(essentials), "essential",
                           np.where(df.gene_symbol.isin(nonessentials), "nonessential", "other"))
    # Centre within gene: what remains is guide-to-guide variation only.
    df["lfc_centred"] = df["lfc"] - df.groupby("gene_symbol")["lfc"].transform("mean")

    out: dict = {"n_guides": int(len(df)),
                 "n_genes": int(df.gene_symbol.nunique()),
                 "tests": {}}

    for label, kind in (("mechanism_essential", "essential"), ("specificity_nonessential", "nonessential")):
        sub = df[df["class"] == kind]
        sub = sub[sub.groupby("gene_symbol").gene_symbol.transform("size") >= 2]
        if len(sub) < 50:
            out["tests"][label] = TestResult(label, None, len(sub), {"reason": "too few guides"}).__dict__
            continue
        rho, p = _spearman(sub.frameshift.to_numpy(), sub.lfc_centred.to_numpy())
        lo, hi = _bootstrap_ci(sub.frameshift.to_numpy(), sub.lfc_centred.to_numpy())
        out["tests"][label] = TestResult(
            label, rho, len(sub),
            {"p_value": p, "ci95": [round(lo, 4), round(hi, 4)],
             "genes": int(sub.gene_symbol.nunique()),
             "expected_sign": "negative" if kind == "essential" else "~zero"}).__dict__

    # Gene level: plain mean versus weighted mean.
    gene = df[df["class"] != "other"].groupby(["gene_symbol", "class"], observed=True)
    plain = gene.lfc.mean()
    weighted = gene.apply(
        lambda s: float(np.average(s.lfc, weights=np.clip(s[weight_col], 1e-6, None))),
        include_groups=False)
    table = pd.DataFrame({"plain": plain, "weighted": weighted}).reset_index()
    ess = table[table["class"] == "essential"]
    non = table[table["class"] == "nonessential"]
    for how in ("plain", "weighted"):
        out.setdefault("gene_level", {})[how] = {
            "auroc": round(_auroc(ess[how].to_numpy(), non[how].to_numpy()), 4),
            "nnmd": round(_nnmd(ess[how].to_numpy(), non[how].to_numpy()), 4),
            "n_essential": int(len(ess)), "n_nonessential": int(len(non)),
        }
    g = out["gene_level"]
    g["delta_auroc"] = round(g["weighted"]["auroc"] - g["plain"]["auroc"], 4)
    g["delta_nnmd"] = round(g["weighted"]["nnmd"] - g["plain"]["nnmd"], 4)
    return out


def summarise(result: dict) -> str:
    lines = [f"guides {result['n_guides']:,} over {result['n_genes']:,} genes"]
    for name, t in result["tests"].items():
        stat = "n/a" if t["statistic"] is None else f"{t['statistic']:+.4f}"
        extra = t["detail"]
        ci = extra.get("ci95")
        lines.append(f"  {name:26s} rho={stat} n={t['n']:,}"
                     + (f" 95%CI [{ci[0]:+.3f},{ci[1]:+.3f}]" if ci else "")
                     + (f" p={extra['p_value']:.2e}" if extra.get("p_value") is not None else "")
                     + f"  expected {extra.get('expected_sign','')}")
    g = result.get("gene_level")
    if g:
        lines.append(f"  gene-level AUROC  plain {g['plain']['auroc']}  weighted {g['weighted']['auroc']}"
                     f"  delta {g['delta_auroc']:+.4f}")
        lines.append(f"  gene-level NNMD   plain {g['plain']['nnmd']}  weighted {g['weighted']['nnmd']}"
                     f"  delta {g['delta_nnmd']:+.4f}")
    return "\n".join(lines)

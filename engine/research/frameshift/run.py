#!/usr/bin/env python3
"""
Does predicted repair outcome explain which guides work?

Runs the analysis fixed in PREREGISTRATION.md. Read that first: the thresholds were
written down before this was executed, which is the only reason a correlation this
small would mean anything.

    python3 engine/research/frameshift/run.py

Writes result.json and report.html beside itself.
"""
from __future__ import annotations

import json
import math
import os
import pathlib
import sys
from collections import defaultdict

HERE = pathlib.Path(__file__).resolve().parent

try:
    import psycopg
except ImportError:  # pragma: no cover
    sys.exit("psycopg is required: engine/.tools/env/bin/pip install psycopg[binary]")


# ---------------------------------------------------------------------------
# The prediction
# ---------------------------------------------------------------------------

def frameshift_score(protospacer: str) -> float | None:
    """
    A frameshift proxy from a bare 20bp protospacer.

    Cas9 cuts bluntly between positions 17 and 18. The identity of position 17 --- the
    base immediately 5' of that cut --- is the strongest single published determinant of
    repair outcome reachable without flanking sequence: inDelphi, FORECasT and Lindel all
    report A and T there driving 1bp insertions, which are frameshifts by definition,
    while G and C favour deletions whose length distribution is wider and more often a
    multiple of three.

    Reported weights across those papers put 1bp-insertion propensity roughly twice as
    high for A/T as for G/C. This returns a bounded score in that spirit, nudged by two
    secondary effects that the same papers agree on: homopolymer runs at the cut raise
    insertion rates, and very high GC lowers overall editing.

    This is a PROXY. A real model reads ~60bp and predicts a full indel distribution.
    `atlas.guides.cut_pos` is 0 for every GeCKOv2 guide, so that sequence does not exist
    here, and a null from this says nothing about a full model.
    """
    if not protospacer or len(protospacer) != 20:
        return None
    seq = protospacer.upper()
    if any(base not in "ACGT" for base in seq):
        return None

    cut_base = seq[16]          # position 17, 1-indexed: immediately 5' of the cut
    base = 0.62 if cut_base in "AT" else 0.38

    # A homopolymer spanning the cut raises 1bp insertion further.
    window = seq[14:19]
    longest = 1
    run = 1
    for i in range(1, len(window)):
        run = run + 1 if window[i] == window[i - 1] else 1
        longest = max(longest, run)
    if longest >= 3:
        base += 0.06

    # Extreme GC suppresses editing overall, which reads as a weaker knockout.
    gc = sum(1 for b in seq if b in "GC") / 20.0
    if gc >= 0.8 or gc <= 0.2:
        base -= 0.05

    return max(0.0, min(1.0, base))


# ---------------------------------------------------------------------------
# Statistics, without scipy
# ---------------------------------------------------------------------------

def rank(values: list[float]) -> list[float]:
    """Average ranks, ties shared."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        shared = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = shared
        i = j + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Spearman rho and a two-sided p from the normal approximation."""
    n = len(xs)
    if n < 10:
        return float("nan"), float("nan")
    rx, ry = rank(xs), rank(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    if den == 0:
        return float("nan"), float("nan")
    rho = num / den
    z = abs(rho) * math.sqrt(n - 1)
    p = math.erfc(z / math.sqrt(2))
    return rho, p


def wilcoxon(diffs: list[float]) -> tuple[float, float, int]:
    """Signed-rank on non-zero differences. Returns (median, p, n)."""
    d = [x for x in diffs if x != 0]
    n = len(d)
    if n < 10:
        return float("nan"), float("nan"), n
    ranks = rank([abs(x) for x in d])
    w_pos = sum(r for x, r in zip(d, ranks) if x > 0)
    w_neg = sum(r for x, r in zip(d, ranks) if x < 0)
    w = min(w_pos, w_neg)
    mean = n * (n + 1) / 4.0
    sd = math.sqrt(n * (n + 1) * (2 * n + 1) / 24.0)
    z = (w - mean) / sd if sd else 0.0
    p = math.erfc(abs(z) / math.sqrt(2))
    s = sorted(d)
    median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
    return median, p, n


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

MIN_T0 = 30  # pre-registered: below this a guide's ratio is noise


def load(conn):
    """Per-guide LFC from counts, joined to sequence and essentiality."""
    with conn.cursor() as cur:
        cur.execute("select id, role from public.samples")
        roles = defaultdict(list)
        for sid, role in cur.fetchall():
            roles[role].append(sid)

    ref, ctrl = roles.get("reference", []), roles.get("control", [])
    if not ref or not ctrl:
        sys.exit(f"need reference and control samples, found {dict((k, len(v)) for k, v in roles.items())}")

    with conn.cursor() as cur:
        cur.execute(
            """
            with counts as (
              select guide_key, gene_symbol,
                     sum(count) filter (where sample_id = any(%s)) as t0,
                     sum(count) filter (where sample_id = any(%s)) as ctl
              from public.guide_counts
              group by guide_key, gene_symbol
            )
            select c.guide_key, c.gene_symbol, c.t0, c.ctl, g.sequence,
                   coalesce(s.is_common_essential, false)
            from counts c
            join atlas.guides g on g.guide_key = c.guide_key
            left join atlas.gene_stats s on s.gene_symbol = c.gene_symbol
            where c.t0 is not null and c.ctl is not null and g.sequence is not null
            """,
            (ref, ctrl),
        )
        rows = cur.fetchall()

    out = []
    for guide, gene, t0, ctl, seq, essential in rows:
        if t0 is None or ctl is None or t0 < MIN_T0:
            continue
        score = frameshift_score(seq)
        if score is None:
            continue
        out.append({
            "guide": guide, "gene": gene,
            "lfc": math.log2((ctl + 1) / (t0 + 1)),
            "score": score, "essential": bool(essential),
        })
    return out


# ---------------------------------------------------------------------------
# The pre-registered analysis
# ---------------------------------------------------------------------------

def analyse(guides):
    essential = [g for g in guides if g["essential"]]

    # PRIMARY. Depletion is negative LFC, so the predicted direction --- more
    # frameshift means more depletion --- is a NEGATIVE rho against raw LFC. It is
    # reported against depletion (-lfc) so a positive number means the prediction held.
    rho, p = spearman([g["score"] for g in essential], [-g["lfc"] for g in essential])

    passes = (
        not math.isnan(rho)
        and rho > 0
        and p < 0.01
        and abs(rho) >= 0.05
    )

    # SECONDARY. Within genes whose guides disagree, is the dud scored lower?
    by_gene = defaultdict(list)
    for g in essential:
        by_gene[g["gene"]].append(g)

    diffs = []
    examples = []
    for gene, gs in by_gene.items():
        if len(gs) < 3:
            continue
        gs = sorted(gs, key=lambda x: x["lfc"])          # most depleted first
        dud, rest = gs[-1], gs[:-1]                      # least depleted = the dud
        if dud["lfc"] - rest[-1]["lfc"] < 1.0:           # only genuinely disagreeing genes
            continue
        sibling_mean = sum(x["score"] for x in rest) / len(rest)
        diffs.append(dud["score"] - sibling_mean)
        if len(examples) < 8:
            examples.append({
                "gene": gene,
                "dud": {"lfc": round(dud["lfc"], 2), "score": round(dud["score"], 2)},
                "others": [{"lfc": round(x["lfc"], 2), "score": round(x["score"], 2)} for x in rest],
            })

    median, wp, wn = wilcoxon(diffs)

    return {
        "n_guides": len(guides),
        "n_essential_guides": len(essential),
        "n_essential_genes": len(by_gene),
        "primary": {
            "rho": None if math.isnan(rho) else round(rho, 4),
            "p": None if math.isnan(p) else p,
            "n": len(essential),
            "passes": bool(passes),
            "thresholds": {"direction": "positive", "p": 0.01, "min_abs_rho": 0.05},
        },
        "secondary": {
            "median_difference": None if math.isnan(median) else round(median, 4),
            "p": None if math.isnan(wp) else wp,
            "n_disagreeing_genes": wn,
        },
        "examples": examples,
        "score_distribution": _hist([g["score"] for g in essential]),
        "lfc_by_score_bucket": _buckets(essential),
    }


def _hist(values, bins=10):
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi == lo:
        return [{"lo": lo, "hi": hi, "n": len(values)}]
    out = []
    for i in range(bins):
        a = lo + (hi - lo) * i / bins
        b = lo + (hi - lo) * (i + 1) / bins
        n = sum(1 for v in values if (a <= v < b or (i == bins - 1 and v == b)))
        out.append({"lo": round(a, 3), "hi": round(b, 3), "n": n})
    return out


def _buckets(essential, bins=6):
    """Mean depletion per predicted-score bucket. The plot that shows the effect, or not."""
    if not essential:
        return []
    scores = sorted({g["score"] for g in essential})
    if len(scores) <= bins:
        groups = [[g for g in essential if g["score"] == s] for s in scores]
        labels = [round(s, 2) for s in scores]
    else:
        lo, hi = min(scores), max(scores)
        groups, labels = [], []
        for i in range(bins):
            a = lo + (hi - lo) * i / bins
            b = lo + (hi - lo) * (i + 1) / bins
            grp = [g for g in essential if a <= g["score"] < b or (i == bins - 1 and g["score"] == b)]
            groups.append(grp)
            labels.append(round((a + b) / 2, 2))
    out = []
    for label, grp in zip(labels, groups):
        if not grp:
            continue
        mean = sum(g["lfc"] for g in grp) / len(grp)
        out.append({"score": label, "mean_lfc": round(mean, 4), "n": len(grp)})
    return out


def main():
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        sys.exit("SUPABASE_DB_URL is not set")
    print("reading guide counts ...", flush=True)
    with psycopg.connect(dsn) as conn:
        guides = load(conn)
    print(f"  {len(guides):,} guides with a sequence and enough T0 depth", flush=True)

    result = analyse(guides)
    (HERE / "result.json").write_text(json.dumps(result, indent=2))

    p = result["primary"]
    print()
    print("PRIMARY   rho =", p["rho"], " p =", f"{p['p']:.3g}" if p["p"] is not None else None,
          " n =", p["n"])
    print("VERDICT  ", "PASSES the pre-registered bar" if p["passes"] else "does NOT pass")
    s = result["secondary"]
    print("SECONDARY median difference =", s["median_difference"],
          " p =", f"{s['p']:.3g}" if s["p"] is not None else None,
          " over", s["n_disagreeing_genes"], "disagreeing genes")
    print()
    print("wrote", HERE / "result.json")


if __name__ == "__main__":
    main()

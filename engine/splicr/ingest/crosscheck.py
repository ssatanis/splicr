"""
Independent verification of the authors' deposited counts.

Many GEO screens deposit a guide count table next to the raw reads. SplicR
recounts the reads itself, so every such screen gets a check nobody else runs:
do the authors' counts agree with a count made from their own FASTQ?

Samples are matched by data, not by name. Deposited column names ("DMSO1",
"input") rarely match run titles, and a split library's two halves often share
one deposited column, so each reprocessed sample is matched to the deposited
column it correlates with best over the guides both tables contain, and the
margin over the runner-up is kept as the confidence of that match.

Reported per sample: the matched column, Spearman rho of CPM over shared guides,
the fraction of guides within 25% of the deposited CPM, and the runner-up rho.
The study-level verdict is `agrees` when every sample matches with rho >= 0.9,
`partial` when the median does, else `disagrees`. A disagreement is reported,
not hidden: it is evidence about the deposit, the processing, or both.
"""

from __future__ import annotations

import gzip
import io
import re
import urllib.request
from pathlib import Path

import numpy as np

UA = "SplicR-ingest/1.0 (mailto:ss4497@cornell.edu)"
MAX_BYTES = 300 * 1024 * 1024
COUNT_NAME = re.compile(r"(count|sgrna|guide|read|mageck|library)", re.I)
TABLE_EXT = re.compile(r"\.(txt|tsv|csv)(\.gz)?$", re.I)


def geo_supplementary_tables(gse: str) -> list[str]:
    """URLs of plausibly count-shaped supplementary files for a GEO series."""
    stub = gse[:-3] + "nnn"
    base = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{stub}/{gse}/suppl/"
    try:
        html = urllib.request.urlopen(urllib.request.Request(base, headers={"User-Agent": UA}), timeout=60).read().decode()
    except Exception:  # noqa: BLE001 - no supplementary directory is common
        return []
    names = sorted(set(re.findall(r'href="([^"/?]+)"', html)))
    return [base + n for n in names if TABLE_EXT.search(n) and COUNT_NAME.search(n)]


def read_table(source: str | Path):
    """A deposited count table as (guide ids, sample names, float matrix). None if not count-shaped."""
    import pandas as pd

    if isinstance(source, str) and source.startswith("http"):
        req = urllib.request.Request(source, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=300) as r:
            if int(r.headers.get("Content-Length") or 0) > MAX_BYTES:
                return None
            raw = r.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            return None
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        text = raw.decode("utf-8", errors="replace")
    else:
        p = Path(source)
        text = (gzip.open(p, "rt") if p.suffix == ".gz" else open(p)).read()
    sep = "\t" if text.count("\t") > text.count(",") else ","
    df = pd.read_csv(io.StringIO(text), sep=sep)
    if df.shape[1] < 3:
        return None
    numeric = [c for c in df.columns[1:] if pd.api.types.is_numeric_dtype(df[c])]
    if not numeric or len(df) < 500:
        return None
    return df.iloc[:, 0].astype(str).to_numpy(), numeric, df[numeric].to_numpy(dtype=float)


def _cpm(x: np.ndarray) -> np.ndarray:
    s = x.sum(axis=0, keepdims=True)
    return x / np.where(s > 0, s, 1) * 1e6


def _spearman(a: np.ndarray, b: np.ndarray) -> float:
    from scipy.stats import spearmanr

    return float(spearmanr(a, b).statistic)


def crosscheck(ours: dict[str, dict[str, int]], deposited) -> dict:
    """
    ours: sample label -> {guide id -> count} (SplicR's counts from raw reads)
    deposited: (guide ids, sample names, matrix) from read_table
    """
    ids, names, mat = deposited
    row = {g: i for i, g in enumerate(ids)}
    samples = {}
    for label, counts in ours.items():
        shared = [g for g in counts if g in row]
        if len(shared) < 500:
            samples[label] = {"status": "no shared guide ids", "n_shared": len(shared)}
            continue
        mine = _cpm(np.array([[counts[g]] for g in shared], dtype=float))[:, 0]
        theirs = _cpm(mat[[row[g] for g in shared], :])
        rhos = [_spearman(mine, theirs[:, j]) for j in range(theirs.shape[1])]
        order = np.argsort(rhos)[::-1]
        best = int(order[0])
        t = theirs[:, best]
        ok = t > 0
        within = float(np.mean(np.abs(mine[ok] / t[ok] - 1) <= 0.25)) if ok.any() else None
        samples[label] = {
            "matched_column": names[best], "spearman": round(rhos[best], 4),
            "runner_up": {"column": names[int(order[1])], "spearman": round(rhos[int(order[1])], 4)}
            if len(order) > 1 else None,
            "within_25pct_cpm": round(within, 4) if within is not None else None, "n_shared": len(shared),
        }
    rhos = [s["spearman"] for s in samples.values() if "spearman" in s]
    if not rhos:
        verdict = "not_comparable"
    elif min(rhos) >= 0.9:
        verdict = "agrees"
    elif float(np.median(rhos)) >= 0.9:
        verdict = "partial"
    else:
        verdict = "disagrees"
    return {"verdict": verdict, "median_spearman": round(float(np.median(rhos)), 4) if rhos else None,
            "samples": samples}


def counts_by_label(counts_paths: dict[str, Path]) -> dict[str, dict[str, int]]:
    import pandas as pd

    out: dict[str, dict[str, int]] = {}
    for path in counts_paths.values():
        df = pd.read_csv(path, sep="\t")
        for col in df.columns[2:]:
            out[col] = dict(zip(df["sgRNA"].astype(str), df[col].astype(int)))
    return out


def run(accession: str, counts_paths: dict[str, Path]) -> dict | None:
    """Cross-check against every count-shaped supplementary table; keep the best-matching one."""
    if not accession.startswith("GSE"):
        return None
    ours = counts_by_label(counts_paths)
    best = None
    for url in geo_supplementary_tables(accession):
        try:
            table = read_table(url)
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the others
            table = None
            err = str(exc)
        else:
            err = None
        if table is None:
            continue
        res = crosscheck(ours, table)
        res["source"] = url
        if res["median_spearman"] is not None and (best is None or res["median_spearman"] > best["median_spearman"]):
            best = res
        if err:
            res["warning"] = err
    return best

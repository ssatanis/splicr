"""The simple baselines for the replication benchmark.

A reviewer's first reaction to this benchmark will be "surely effect size alone
does most of this". This module exists to find out, and to make the answer as
unfavourable to SplicR as the data on disk honestly allows. Every baseline here
is built to be as strong as it can be, not as easy to beat as it can be. If one
of them wins, that is the result.

Six families, and the argument each one makes.

``effect_``
    Screen A's own effect size, in every form the ORCS score columns support.
    This is the published margin to beat: mean AP 0.2517 on the development
    primary space against a 0.0453 floor.

``sig_``
    The screen's own significance column. A hit call is a threshold on some
    statistic, and the continuous statistic underneath it should rank better than
    the binary call. Available on 139 of the 269 screens that appear on a query
    side: BAGEL screens, which are 121 of the 269 and 121 of the held-out block,
    report a Bayes Factor and no FDR or p-value at all.

``guide_``
    Guide-level support, as far as it is recoverable. It is barely recoverable:
    ORCS ships gene-level summaries with no per-guide fold change, no guide count
    and no dispersion, so guide *concordance* cannot be computed from this data at
    all. What can be computed is the structure of the library A used, from the
    published guide maps: how many guides target the gene and how specific they
    are.

``freq_``
    The frequent-hitter prior: how often this gene is called a hit across other
    screens. This is the strongest baseline that reads no screen-specific data,
    and it is the one that would most embarrass a method that claims to be
    reasoning about a particular screen. Fitted per unit over
    :func:`dataset.allowed_background_screens` only.

``depmap_``
    Cell-line-independent DepMap essentiality: common-essential membership, and
    Chronos breadth of essentiality, which a parallel analysis measured at 0.171
    AnDCG on a different task from zero screen labels. Reads no screen at all.

``lr_``
    The best simple combination: logistic regression on two or three of the
    above, fitted on development labels only.

METRICS, DECLARED BEFORE ANY WERE COMPUTED

Primary: mean average precision over the non-common-essential (primary) gene
space, per unit, averaged over units, with paired tests resampled by screen pair.
Chosen for four reasons. It was fixed in ``docs/07-replication-benchmark.md``
before any baseline in this module existed, so it cannot be selected after seeing
which baseline it flatters. Positives are rare, 3.0% to 4.5% of the primary
space, and average precision is the standard summary for a rare-positive ranking.
It is invariant to any strictly monotone per-unit transform, which matters here
because Bayes Factor, CERES score and MaGeCK Score are not on comparable scales,
so a method cannot win by rescaling. And it uses the whole ranking rather than
one cut point, so it does not have to assume a budget.

Secondary, reported for every baseline: precision at 10, 20 and 50, and ROC AUC.
Precision@k is the decision-relevant quantity, since a validation budget really
is 10 to 50 genes, and it is reported for exactly that reason. It is not primary
because at k = 10 it is an average of ten Bernoulli draws per unit, so it is far
noisier than average precision and the ordering of close baselines under it is
not stable. AUC is reported because it treats ties by averaging rather than by an
arbitrary tie order, which matters for the FDR baselines: an ORCS FDR column has
as few as 450 distinct values over 17,600 genes, with a single tie block of over
10,000, and average precision resolves such ties by gene-alphabetical order.
Where a baseline's AP and AUC disagree, ties are the reason.

LEAKAGE

Every unit-specific quantity reads screen A or the allowed background set, never
screen B. The frequent-hitter prior is fitted per unit over
:func:`dataset.allowed_background_screens`, which removes both pair screens, both
publications and every screen in the pair's cell line, and its shrinkage
hyperparameters are fitted over that same per-unit set rather than globally,
because a globally fitted prior would have been fitted on data containing B.
DepMap Chronos features drop the unit's own model column, which is stricter than
the spec requires. The logistic regressions are fitted on development labels
only, and the split is disjoint by publication and by cell line.

Usage::

    export PATH="engine/.tools/env/bin:$PATH"
    python -m splicr.replication.simple development
    python -m splicr.replication.simple heldout --evaluating
"""

from __future__ import annotations

import collections
import csv
import functools
import json
import os
import re
from typing import Iterable, Sequence

import numpy as np

from . import dataset
from .. import orcs_safe

DEPMAP_DIR = dataset.DEPMAP_DIR
SCORES_PARQUET = os.path.join(orcs_safe.PARSED_DIR, "orcs_human_safe_scores.parquet")


# ---------------------------------------------------------------------------
# Thresholds and resolution rules, with the source of each
# ---------------------------------------------------------------------------

#: Which ORCS score column counts as "the significance column" for a screen.
#: Resolved from metadata only, never from the screen's own hit calls, for the
#: same reason the SCORE.1 direction is: inferring it from hits would mean
#: touching the label whenever that screen is the B side.
#:
#: Two resolutions are offered because they are genuinely different baselines and
#: the choice is a real one:
#:
#: * ``criteria`` takes the column the screen's own SIGNIFICANCE_CRITERIA names,
#:   which is what the screen says it used to decide. It is the faithful reading.
#: * ``finest`` prefers a p-value over an FDR where a screen reports both. Within
#:   one screen a BH FDR is a monotone function of the p-value, so the two rank
#:   identically except for ties, and the FDR column is far more heavily tied, so
#:   the p-value is the better *ranking* statistic while carrying the same
#:   evidence. 10 screens report both.
#:
#: Which one is reported as "significance alone" is chosen on development.
SIGNIFICANCE_RESOLUTIONS = ("criteria", "finest")

#: Score types that are significance statistics, with lower meaning stronger.
#: Read off the ORCS SCORE.n_TYPE vocabulary as it appears in this corpus.
SIGNIFICANCE_TYPES = ("FDR", "p-Value")

#: DepMap dependency-probability cut for "this gene is a dependency in this
#: line". Source: DepMap's own CRISPRGeneDependency file is a probability of
#: dependency per (model, gene) from the Chronos mixture fit, and 0.5 is the
#: probability at which that mixture assigns a gene-line pair to the dependent
#: component. It is DepMap's convention restated, not a threshold chosen here,
#: and nothing in this module is tuned on it.
DEPMAP_DEPENDENCY_P = 0.5

#: Minimum background screens measuring a gene before its raw hit rate is
#: reported as an unshrunk estimate. The shrunk estimate needs no floor, which is
#: the point of shrinking; this exists only so the unshrunk contrast is not
#: dominated by genes measured twice.
FREQ_MIN_MEASURED = 20

#: Guide maps shipped by DepMap, keyed by the ORCS LIBRARY string. These are
#: library designs, not measurements: sgRNA sequence, genome alignment and the
#: number of alignments. The ORCS LIBRARY names map to them exactly, and the two
#: libraries covered are the two that dominate the benchmark.
#:
#: ``Human CRISPR Library v.1.1`` is the Sanger Yusa/KY library, which is what
#: DepMap ships as KYGuideMap; ``Avana`` is the Broad Avana library. No other
#: library in this benchmark has a published per-guide map on disk, so the guide
#: baselines cover 237 of the 269 query screens and are NaN elsewhere. The
#: ``data/lake/guides`` parquet covers Brunello, Brie, GeCKOv2, TKOv3, Calabrese,
#: Dolcetto, Gattinara and Gouda, none of which is KY or Avana, and only 7 GeCKO
#: v2 screens here would gain from it, so it is not used.
GUIDE_MAPS = {
    "Human CRISPR Library v.1.1": "KYGuideMap.csv",
    "Avana": "AvanaGuideMap.csv",
}


# ---------------------------------------------------------------------------
# Screen score columns
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def _score_columns():
    """``{screen_id: {gene: (score1..score5)}}`` for the benchmark's screens.

    One row per (screen, gene), collapsed by exactly the rule
    :func:`dataset._rows_sql` uses: rows that disagree on HIT are dropped, rows
    that agree are averaged. The gene set therefore matches what the dataset
    loaders return, and :func:`_verify_score_cache` asserts that on every read.
    """
    if not os.path.exists(SCORES_PARQUET):
        raise FileNotFoundError(
            f"{SCORES_PARQUET} missing. Build it with\n"
            f"  python engine/tools/build_orcs_score_columns.py --screens benchmark"
        )
    import duckdb

    con = duckdb.connect()
    df = con.execute(
        f"""
        select screen_id, gene,
               avg(score1) s1, avg(score2) s2, avg(score3) s3,
               avg(score4) s4, avg(score5) s5
        from read_parquet('{SCORES_PARQUET}')
        group by screen_id, gene
        having min(hit::int) = max(hit::int)
        """
    ).fetchdf()
    orcs_safe.assert_safe(set(int(x) for x in df["screen_id"].unique()))
    out: dict[int, dict] = {}
    for sid, grp in df.groupby("screen_id"):
        out[int(sid)] = {
            "gene": grp["gene"].to_numpy(),
            "scores": grp[["s1", "s2", "s3", "s4", "s5"]].to_numpy(dtype=float),
        }
    return out


def _score_frame(screen_id: int, genes: Sequence[str]) -> np.ndarray:
    """SCORE.1 to SCORE.5 for ``screen_id``, aligned to ``genes``. NaN where absent."""
    tab = _score_columns()[int(screen_id)]
    pos = {g: i for i, g in enumerate(tab["gene"])}
    out = np.full((len(genes), 5), np.nan)
    for i, g in enumerate(genes):
        j = pos.get(g)
        if j is not None:
            out[i] = tab["scores"][j]
    return out


def _verify_score_cache(unit: dataset.ReplicationPair, genes: Sequence[str], scores: np.ndarray) -> None:
    """Refuse to score a unit whose SCORE.1 does not match the dataset loader.

    The sidecar cache is built by a second parser, so a divergence between it and
    the long cache would show up as a quietly wrong feature rather than an error.
    SCORE.1 is present in both, so it is the check.
    """
    if not np.isfinite(scores[:, 0]).all():
        missing = int((~np.isfinite(scores[:, 0])).sum())
        raise RuntimeError(
            f"{unit.unit_id}: the score sidecar is missing SCORE.1 for {missing} of "
            f"{len(genes)} genes in the shared space; rebuild it with "
            f"tools/build_orcs_score_columns.py --screens benchmark"
        )


# ---------------------------------------------------------------------------
# Significance column resolution
# ---------------------------------------------------------------------------

_CRIT = re.compile(r"Score\.(\d)\s*\(([^)]+)\)")


@functools.lru_cache(maxsize=None)
def significance_column(screen_id: int, resolution: str = "finest") -> tuple[int, str] | None:
    """Which score column is this screen's significance statistic, and its type.

    Returns ``(index, type)`` with ``index`` 1-based into SCORE.1..SCORE.5, or
    ``None`` when the screen reports no FDR and no p-value. Metadata only.
    """
    if resolution not in SIGNIFICANCE_RESOLUTIONS:
        raise ValueError(f"unknown resolution {resolution!r}; choose from {SIGNIFICANCE_RESOLUTIONS}")
    meta = dataset.screen_index()[int(screen_id)]
    types = {i: meta.get(f"SCORE.{i}_TYPE", "-") for i in range(1, 6)}
    available = [(i, t) for i, t in types.items() if t in SIGNIFICANCE_TYPES]
    if not available:
        return None
    if resolution == "criteria":
        # What the screen says it thresholded. Take the first clause naming a
        # significance type; screens combining two criteria name the effect size
        # first and the significance second.
        for idx_s, typ in _CRIT.findall(meta.get("SIGNIFICANCE_CRITERIA", "") or ""):
            i = int(idx_s)
            if typ in SIGNIFICANCE_TYPES and types.get(i) == typ:
                return (i, typ)
        # A screen with no parsable criteria still has a column; fall through.
    # "finest": prefer a p-value, which within a screen is a monotone
    # transform of the BH FDR but far less tied.
    for typ in ("p-Value", "FDR"):
        for i, t in available:
            if t == typ:
                return (i, t)
    return available[0]


# ---------------------------------------------------------------------------
# Frequent-hitter prior
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def _background_matrix():
    """Hit and measured matrices over every eligible screen.

    ``hit`` and ``measured`` are (n_screens, n_genes) uint8. Built once over the
    eligible set; a unit's prior is then a column subset of it, which is what
    makes a per-unit leak-free prior affordable.
    """
    import duckdb

    eligible, _ = dataset.eligible_screens()
    orcs_safe.assert_safe(eligible)
    ids = ",".join(str(int(s)) for s in eligible)
    con = duckdb.connect()
    df = con.execute(
        f"select screen_id, gene, hit from ({dataset._rows_sql(f'where screen_id in ({ids})')})"
    ).fetchdf()
    screens = sorted(int(s) for s in df["screen_id"].unique())
    genes = sorted(df["gene"].unique())
    si = {s: i for i, s in enumerate(screens)}
    gi = {g: i for i, g in enumerate(genes)}
    measured = np.zeros((len(screens), len(genes)), dtype=np.uint8)
    hit = np.zeros((len(screens), len(genes)), dtype=np.uint8)
    r = df["screen_id"].map(si).to_numpy()
    c = df["gene"].map(gi).to_numpy()
    measured[r, c] = 1
    hit[r, c] = df["hit"].to_numpy().astype(np.uint8)
    return {"screens": screens, "screen_index": si, "genes": genes,
            "gene_index": gi, "measured": measured, "hit": hit}


@functools.lru_cache(maxsize=1)
def _background_effect_matrix():
    """Within-screen rank of the oriented SCORE.1, over every eligible screen.

    The hit-rate prior throws away magnitude: a gene that just missed the
    threshold in forty screens looks identical to one that was never near it. This
    is the same prior computed on the continuous statistic instead, which is the
    stronger form and therefore the one the frequent-hitter baseline should be
    judged on.

    Each screen's SCORE.1 is rank-normalised within that screen before averaging,
    because a Bayes Factor, a CERES score and a MaGeCK Score are not on a common
    scale and averaging them raw would just weight the screens with the widest
    range. Screens whose SCORE.1_TYPE gives no direction, which is CasTLE, are
    excluded rather than guessed at: ``_direction`` returns 0 for them and the
    spec says raw SCORE.1 must not be scored there.
    """
    import duckdb

    eligible, _ = dataset.eligible_screens()
    orcs_safe.assert_safe(eligible)
    idx = dataset.screen_index()
    ids = ",".join(str(int(s)) for s in eligible)
    con = duckdb.connect()
    df = con.execute(
        f"select screen_id, gene, score1 from ({dataset._rows_sql(f'where screen_id in ({ids})')})"
    ).fetchdf()
    screens = sorted(int(s) for s in df["screen_id"].unique())
    genes = sorted(df["gene"].unique())
    si = {s: i for i, s in enumerate(screens)}
    gi = {g: i for i, g in enumerate(genes)}
    mat = np.full((len(screens), len(genes)), np.nan, dtype=np.float32)
    usable = np.zeros(len(screens), bool)
    for sid, grp in df.groupby("screen_id"):
        sid = int(sid)
        d = dataset.SCORE1_DIRECTION.get(idx[sid].get("SCORE.1_TYPE", ""), "unknown")
        sign = -1.0 if d == "lower_is_stronger" else (1.0 if d == "higher_is_stronger" else 0.0)
        if sign == 0.0:
            continue
        r = _rank01(sign * grp["score1"].to_numpy(dtype=float))
        cols = grp["gene"].map(gi).to_numpy()
        mat[si[sid], cols] = r
        usable[si[sid]] = True
    return {"screens": screens, "screen_index": si, "genes": genes,
            "gene_index": gi, "rank": mat, "usable": usable}


def background_effect_prior(unit: dataset.ReplicationPair, genes: Sequence[str]) -> dict[str, np.ndarray]:
    """Mean within-screen effect rank over the unit's allowed background screens."""
    bg = _background_effect_matrix()
    rows = [bg["screen_index"][s] for s in dataset.allowed_background_screens(unit)
            if s in bg["screen_index"] and bg["usable"][bg["screen_index"][s]]]
    cols = np.array([bg["gene_index"].get(g, -1) for g in genes])
    have = cols >= 0
    out = np.full(len(genes), np.nan)
    if rows and have.any():
        sub = bg["rank"][np.asarray(rows, dtype=int)][:, cols[have]]
        with np.errstate(invalid="ignore"):
            out[have] = np.nanmean(sub, axis=0)
    return {"bg_effect_rank": out, "_n_background_screens": len(rows)}


def _beta_moments(k: np.ndarray, n: np.ndarray) -> tuple[float, float]:
    """Method-of-moments Beta prior for a hit rate, from counts alone.

    Fitted over whatever set of screens is passed in, which for a unit is its own
    allowed background set. Fitting it globally would mean fitting the prior on a
    corpus containing B, which rule 2 of this benchmark forbids, and the cost of
    refitting per unit is two moments over 19,000 genes.

    Falls back to Jeffreys (0.5, 0.5) where the moment estimate is degenerate,
    which happens only if the between-gene variance is at or below the binomial
    variance and there is no overdispersion to model.
    """
    ok = n >= 1
    if ok.sum() < 100:
        return 0.5, 0.5
    p = k[ok] / n[ok]
    m = float(p.mean())
    v = float(p.var())
    if not (0.0 < m < 1.0) or v <= 0:
        return 0.5, 0.5
    # Beta moment match on the observed rate distribution, corrected for the
    # binomial noise each per-gene rate carries.
    nbar = float(n[ok].mean())
    v_binom = m * (1.0 - m) / max(nbar, 1.0)
    v_true = max(v - v_binom, 1e-9)
    conc = m * (1.0 - m) / v_true - 1.0
    if not np.isfinite(conc) or conc <= 0:
        return 0.5, 0.5
    conc = float(min(conc, 1e4))
    return m * conc, (1.0 - m) * conc


def frequency_prior(unit: dataset.ReplicationPair, genes: Sequence[str]) -> dict[str, np.ndarray]:
    """The frequent-hitter prior for one unit, fitted on its allowed background.

    Returns the shrunk rate, the raw rate, and the number of background screens
    that measured the gene. Nothing here reads screen A or screen B.
    """
    bg = _background_matrix()
    allowed = [bg["screen_index"][s] for s in dataset.allowed_background_screens(unit)
               if s in bg["screen_index"]]
    rows = np.asarray(allowed, dtype=int)
    cols = np.asarray([bg["gene_index"].get(g, -1) for g in genes], dtype=int)
    have = cols >= 0
    n = np.zeros(len(genes)); k = np.zeros(len(genes))
    if len(rows):
        sub_n = bg["measured"][rows][:, cols[have]].sum(axis=0, dtype=np.int32)
        sub_k = bg["hit"][rows][:, cols[have]].sum(axis=0, dtype=np.int32)
        n[have] = sub_n
        k[have] = sub_k
    a, bb = _beta_moments(k, n)
    shrunk = (k + a) / (n + a + bb)
    raw = np.where(n >= FREQ_MIN_MEASURED, np.divide(k, np.maximum(n, 1)), np.nan)
    return {
        "freq_shrunk": shrunk,
        "freq_raw": raw,
        "freq_n_measured": n,
        "_n_background_screens": len(rows),
        "_beta": (a, bb),
    }


# ---------------------------------------------------------------------------
# DepMap, cell-line independent
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def _chronos():
    """DepMap Chronos gene effect and dependency probability, models by genes."""
    cache = os.path.join(DEPMAP_DIR, "_cache")
    eff = np.load(os.path.join(cache, "chronos_24Q4.npz"), allow_pickle=True)
    dep = np.load(os.path.join(cache, "dependency_24Q4.npz"), allow_pickle=True)
    if not (list(eff["rows"]) == list(dep["rows"]) and list(eff["cols"]) == list(dep["cols"])):
        raise RuntimeError("the Chronos effect and dependency caches are not aligned")
    return {
        "models": {m: i for i, m in enumerate(eff["rows"].tolist())},
        "gene_index": {g: i for i, g in enumerate(eff["cols"].tolist())},
        "effect": eff["mat"],
        "dependency": dep["mat"],
    }


@functools.lru_cache(maxsize=1)
def _achilles_common_essentials() -> frozenset[str]:
    """DepMap's AchillesCommonEssentialControls list.

    A different list from the one that defines the primary space, which is CEGv2
    union CRISPRInferredCommonEssentials. On the primary space that defining
    union is identically false and so carries exactly no information, which is
    the point of the space; this list is not identically false there, so it is
    the honest way to ask whether a common-essentiality lookup still helps once
    the defining list has been removed.
    """
    path = os.path.join(DEPMAP_DIR, "AchillesCommonEssentialControls.csv")
    out: set[str] = set()
    if not os.path.exists(path):
        return frozenset()
    with open(path) as fh:
        for row in csv.DictReader(fh):
            g = (row.get("Gene") or "").split(" (")[0].strip()
            if g:
                out.add(g)
    return frozenset(out)


def depmap_features(unit: dataset.ReplicationPair, genes: Sequence[str]) -> dict[str, np.ndarray]:
    """Cell-line-independent DepMap essentiality features for one unit.

    The unit's own DepMap model is dropped from every average, which is stricter
    than :func:`dataset.forbidden_external` requires: the spec forbids per-cell-
    line DepMap features and permits cross-line summaries, and dropping the one
    column costs nothing. The residual concern the spec records still stands, that
    a summary over 1,177 other lines is correlated with this line's answer.
    """
    ch = _chronos()
    drop = ch["models"].get(unit.depmap_model or "")
    keep = np.ones(ch["effect"].shape[0], bool)
    if drop is not None:
        keep[drop] = False
    eff = ch["effect"][keep]
    dep = ch["dependency"][keep]
    cols = np.array([ch["gene_index"].get(g, -1) for g in genes])
    have = cols >= 0

    breadth = np.full(len(genes), np.nan)
    mean_eff = np.full(len(genes), np.nan)
    if have.any():
        sub_dep = dep[:, cols[have]]
        sub_eff = eff[:, cols[have]]
        with np.errstate(invalid="ignore"):
            breadth[have] = np.nanmean(sub_dep > DEPMAP_DEPENDENCY_P, axis=0)
            mean_eff[have] = np.nanmean(sub_eff, axis=0)

    ce = dataset.common_essentials()
    ach = _achilles_common_essentials()
    return {
        "depmap_breadth": breadth,
        # Negated so that higher means more essential, matching every other
        # feature's "higher is more likely to replicate" convention.
        "depmap_mean_effect": -mean_eff,
        "depmap_common_essential": np.array([float(g in ce) for g in genes]),
        "depmap_achilles_essential": np.array([float(g in ach) for g in genes]),
        "_n_models": int(keep.sum()),
        "_dropped_model": unit.depmap_model if drop is not None else None,
    }


# ---------------------------------------------------------------------------
# Guide-level support
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=None)
def _guide_map(filename: str) -> dict[str, tuple[int, float]]:
    """``{gene: (n_guides, mean_specificity)}`` from a DepMap guide map.

    ``mean_specificity`` is the mean of 1/nAlignments over the gene's guides: a
    guide that aligns to one genomic site makes a clean claim about one gene, and
    one that aligns to several does not. This reads the library design only, not
    any measurement: the ``UsedByChronos`` and ``DropReason`` columns are DepMap's
    processing decisions about the Avana and KY experiments, so they are ignored
    and every designed guide is counted.
    """
    path = os.path.join(DEPMAP_DIR, filename)
    if not os.path.exists(path):
        return {}
    n: dict[str, int] = collections.Counter()
    spec: dict[str, float] = collections.Counter()
    with open(path) as fh:
        for row in csv.DictReader(fh):
            gene_field = row.get("Gene") or ""
            for part in gene_field.split(";"):
                g = part.split(" (")[0].strip()
                if not g or g == "-":
                    continue
                try:
                    na = float(row.get("nAlignments") or "nan")
                except ValueError:
                    na = float("nan")
                n[g] += 1
                spec[g] += (1.0 / na) if na and np.isfinite(na) and na > 0 else 0.0
    return {g: (c, spec[g] / c) for g, c in n.items()}


def guide_features(unit: dataset.ReplicationPair, genes: Sequence[str]) -> dict[str, np.ndarray]:
    """What guide-level support is recoverable for screen A's library.

    Guide CONCORDANCE is not recoverable and this is not a softened statement:
    ORCS ships one row per gene with up to five summary scores, and no per-guide
    fold change, guide count, standard error or dispersion. There is no quantity
    in this benchmark's inputs from which "did the gene's guides agree" can be
    computed. What is recoverable is the design of the library screen A used, from
    the published guide map, for the 237 of 269 query screens whose library has
    one on disk.
    """
    lib = GUIDE_MAPS.get(unit.query_library)
    n = np.full(len(genes), np.nan)
    spec = np.full(len(genes), np.nan)
    if lib:
        m = _guide_map(lib)
        for i, g in enumerate(genes):
            v = m.get(g)
            if v is not None:
                n[i], spec[i] = float(v[0]), float(v[1])
    return {"guide_n": n, "guide_specificity": spec, "_library_map": lib}


# ---------------------------------------------------------------------------
# Features for one unit
# ---------------------------------------------------------------------------

def _direction(unit: dataset.ReplicationPair) -> float:
    """+1, -1 or 0 to orient SCORE.1 so higher means stronger depletion.

    Read from the unit's ``query_score1_direction``, which the dataset derives
    from SCORE.1_TYPE metadata and never from hit calls. 0 for CasTLE Score,
    where the spec says raw SCORE.1 must not be scored; those units get a
    constant, which average precision resolves by the same gene-alphabetical
    order it gives every tied ranking, so they contribute at the floor rather
    than at a guessed direction.
    """
    d = unit.query_score1_direction
    return -1.0 if d == "lower_is_stronger" else (1.0 if d == "higher_is_stronger" else 0.0)


def unit_features(unit: dataset.ReplicationPair) -> dict:
    """Everything the simple baselines need for one unit. Reads no label."""
    inputs = dataset.load_pair_inputs(unit)
    genes = inputs["gene"].tolist()
    scores = _score_frame(unit.query_screen, genes)
    _verify_score_cache(unit, genes, scores)

    sign = _direction(unit)
    a_hit = inputs["a_hit"].to_numpy().astype(float)
    effect = sign * scores[:, 0]

    feats: dict[str, np.ndarray] = {
        "effect": effect,
        "a_hit": a_hit,
        "score1_raw": scores[:, 0],
    }
    # Log2FC, where the screen reports one as a separate column. 8 screens do.
    l2fc_col = None
    meta = dataset.screen_index()[int(unit.query_screen)]
    for i in range(2, 6):
        if meta.get(f"SCORE.{i}_TYPE") == "Log2FC":
            l2fc_col = i
            break
    feats["effect_l2fc"] = -scores[:, l2fc_col - 1] if l2fc_col else np.full(len(genes), np.nan)

    for res in SIGNIFICANCE_RESOLUTIONS:
        col = significance_column(unit.query_screen, res)
        # Negated: an FDR or p-value is small when the evidence is strong, and
        # every feature here is oriented so higher means more likely to replicate.
        feats[f"sig_{res}"] = -scores[:, col[0] - 1] if col else np.full(len(genes), np.nan)

    feats.update({k: v for k, v in frequency_prior(unit, genes).items() if not k.startswith("_")})
    feats.update({k: v for k, v in background_effect_prior(unit, genes).items() if not k.startswith("_")})
    feats.update({k: v for k, v in depmap_features(unit, genes).items() if not k.startswith("_")})
    feats.update({k: v for k, v in guide_features(unit, genes).items() if not k.startswith("_")})

    # What is left of A's effect size once the gene's behaviour in other screens
    # is taken out. If the replication signal lives entirely in the gene-general
    # part, this is worthless and the frequent-hitter prior is the whole story; if
    # it lives in the screen-specific part, this is where a method has to work.
    # Both terms are within-unit ranks, so the difference is on one scale.
    feats["effect_vs_background"] = _rank01(feats["effect"]) - _rank01(feats["bg_effect_rank"])

    # Fit-free combinations: the mean of the within-unit ranks, with no
    # coefficients to fit and so nothing that can be overfitted to development.
    # A reviewer cannot say these were tuned, because there is nothing in them to
    # tune.
    feats["mean_rank_effect_freq"] = np.nanmean(
        np.column_stack([_rank01(feats["effect"]), _rank01(feats["freq_shrunk"])]), axis=1)
    feats["mean_rank_effect_freq_depmap"] = np.nanmean(
        np.column_stack([_rank01(feats["effect"]), _rank01(feats["freq_shrunk"]),
                         _rank01(feats["depmap_breadth"])]), axis=1)
    feats["mean_rank_effect_bgeffect"] = np.nanmean(
        np.column_stack([_rank01(feats["effect"]), _rank01(feats["bg_effect_rank"])]), axis=1)

    return {
        "unit": unit,
        "genes": genes,
        "features": feats,
        "is_common_essential": inputs["is_common_essential"].to_numpy(),
        "significance_available": significance_column(unit.query_screen, "finest") is not None,
        "guide_map": GUIDE_MAPS.get(unit.query_library),
    }


# ---------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------

def _rank01(x: np.ndarray) -> np.ndarray:
    """Rank-normalise to (0, 1) within a unit, NaN-safe, average ranks for ties.

    Every feature is rank-normalised within its unit before a learned model sees
    it, because the scales are not comparable across screens: a Bayes Factor, a
    CERES score and a MaGeCK Score share no units, and background coverage
    differs per unit too. Ranking within the unit makes the input distribution
    identical for every unit, which is what lets a development fit transfer.
    """
    from scipy.stats import rankdata

    x = np.asarray(x, dtype=float)
    out = np.full(x.shape, np.nan)
    ok = np.isfinite(x)
    if not ok.any():
        return out
    out[ok] = (rankdata(x[ok], method="average") - 0.5) / ok.sum()
    return out


def _lex(primary: np.ndarray, secondary: np.ndarray) -> np.ndarray:
    """Rank by ``primary``, breaking its ties with ``secondary``.

    Used for the "hit call first, then effect size" and "significance first, then
    effect size" forms. Those are not the same as ranking by the secondary
    statistic alone wherever the hit call is not a threshold on it, which is most
    of this corpus: 116 CERES screens threshold an FDR while their SCORE.1 is a
    CERES score, and 8 MaGeCK screens threshold SCORE.3.
    """
    p = _rank01(primary)
    s = _rank01(secondary)
    p = np.where(np.isfinite(p), p, 0.0)
    s = np.where(np.isfinite(s), s, 0.0)
    return p + s / (len(p) + 1.0)


#: Every choice in this module that could have been made differently, fixed on
#: development and recorded here BEFORE the held-out labels were read once. The
#: numbers quoted are development average precision on the primary space.
#:
#: 1. Significance column resolution: ``finest``. Measured 0.2151 against 0.2144
#:    for ``criteria``, so the choice is immaterial; ``finest`` is kept because the
#:    rule was stated in advance and because a p-value is the less tied column.
#: 2. Frequent-hitter shrinkage: keep the empirical-Bayes shrunk rate. It measured
#:    0.2979 against 0.2977 unshrunk, so shrinkage buys nothing here and is kept
#:    only because it is the principled estimator; the unshrunk rate is reported
#:    beside it so nobody has to take that on trust.
#: 3. The combination nominated as the one to beat: ``lr_effect_freq_depmap``,
#:    logistic regression on A's effect size, the frequent-hitter prior and DepMap
#:    Chronos breadth. Best on development at 0.3580, and the most parsimonious of
#:    the group within noise of it.
#: 4. Its zero-parameter counterpart, ``mean_rank_effect_freq_depmap``, the plain
#:    mean of the same three within-unit ranks, measured 0.3527. It has nothing in
#:    it to tune, so it is the number a reviewer cannot answer with "you tuned it",
#:    and if it holds up on held out it is the honest figure to quote.
#: 5. No hyperparameter was searched. One LogisticRegression setting, L2 at the
#:    default C with balanced class weights, is used for every combination, so no
#:    combination has a private setting.
#: 6. Guide baselines were not tuned and could not be: no development screen uses
#:    a library with a published guide map.
DEVELOPMENT_DECISIONS = {
    "significance_resolution": "finest",
    "frequency_estimator": "freq_shrunk",
    "nominated_combination": "lr_effect_freq_depmap",
    "fit_free_counterpart": "mean_rank_effect_freq_depmap",
    "hyperparameters_searched": 0,
    "guide_baselines_tuned": False,
}

#: Single-feature baselines: name -> (feature, one-line argument).
SINGLE = {
    "effect_score1": ("effect", "A's SCORE.1 oriented by SCORE.1_TYPE; the published margin to beat"),
    "effect_score1_flipped": ("__flip_effect", "the same column with the sign reversed; a sanity check, not a candidate"),
    "effect_l2fc": ("effect_l2fc", "the separate Log2FC column, where a screen reports one"),
    "a_hit": ("a_hit", "A's published binary hit call"),
    "sig_criteria": ("sig_criteria", "the significance column A's own criteria names"),
    "sig_finest": ("sig_finest", "the finest significance column A reports, p-value over FDR"),
    "freq_shrunk": ("freq_shrunk", "the gene's shrunk hit rate over the allowed background screens"),
    "freq_raw": ("freq_raw", "the same rate unshrunk, for contrast"),
    "bg_effect_rank": ("bg_effect_rank", "the gene's mean within-screen effect rank over the allowed background screens"),
    "effect_vs_background": ("effect_vs_background", "A's effect rank minus the gene's background effect rank: what is specific to this screen"),
    "mean_rank_effect_freq": ("mean_rank_effect_freq", "mean within-unit rank of effect size and the hit-rate prior; no coefficients to fit"),
    "mean_rank_effect_freq_depmap": ("mean_rank_effect_freq_depmap", "mean within-unit rank of effect size, the hit-rate prior and DepMap breadth; no coefficients to fit"),
    "mean_rank_effect_bgeffect": ("mean_rank_effect_bgeffect", "mean within-unit rank of A's effect size and the background effect prior"),
    "depmap_breadth": ("depmap_breadth", "fraction of DepMap models where the gene is a dependency"),
    "depmap_mean_effect": ("depmap_mean_effect", "mean Chronos gene effect over DepMap models, negated"),
    "depmap_common_essential": ("depmap_common_essential", "membership of the list that defines the primary space; constant there by construction"),
    "depmap_achilles_essential": ("depmap_achilles_essential", "membership of DepMap's Achilles common-essential controls"),
    "guide_n": ("guide_n", "number of guides targeting the gene in A's library"),
    "guide_specificity": ("guide_specificity", "mean 1/nAlignments over the gene's guides in A's library"),
}

#: Rank-then-tie-break forms. These are the strong versions of the obvious
#: baselines and exist because a binary hit call and a heavily tied FDR both
#: leave most of the gene space unordered.
COMPOSED = {
    "hit_then_effect": ("a_hit", "effect", "A's hit call, ties broken by A's effect size"),
    "sig_then_effect": ("sig_finest", "effect", "A's significance column, ties broken by A's effect size"),
    "effect_then_freq": ("effect", "freq_shrunk", "A's effect size, ties broken by the frequent-hitter prior"),
}

#: Logistic-regression combinations, fitted on development only. Kept to two and
#: three features on purpose, with one five-feature model to show the ceiling: the
#: question is what a competent analyst reaches with the obvious inputs, not what
#: a large model reaches.
#:
#: No combination includes ``guide_n`` or ``guide_specificity``. Not because they
#: are weak, but because they cannot be fitted: development contains no screen
#: whose library has a published guide map, so both features are entirely missing
#: on every development unit. A coefficient fitted where a feature is constant
#: carries no information about it, and applying such a coefficient to held out,
#: where the feature varies over 237 of 248 units, would be fitting on the
#: evaluation set by the back door. The guide baselines are therefore reported as
#: single baselines on held out and labelled as never having been developed.
#:
#: ``sig_finest`` is included even though 5 of 28 development units lack it,
#: because the missingness flag makes "no significance column" a state the model
#: can represent rather than an imputed average.
COMBOS = {
    "lr_effect_freq": ["effect", "freq_shrunk"],
    "lr_effect_depmap": ["effect", "depmap_breadth"],
    "lr_effect_freq_depmap": ["effect", "freq_shrunk", "depmap_breadth"],
    "lr_effect_hit_freq": ["effect", "a_hit", "freq_shrunk"],
    "lr_effect_sig_freq": ["effect", "sig_finest", "freq_shrunk"],
    "lr_effect_bgeffect": ["effect", "bg_effect_rank"],
    "lr_effect_bgeffect_depmap": ["effect", "bg_effect_rank", "depmap_breadth"],
    "lr_simple_five": ["effect", "a_hit", "freq_shrunk", "depmap_breadth",
                       "depmap_mean_effect"],
    "lr_simple_seven": ["effect", "a_hit", "sig_finest", "freq_shrunk", "bg_effect_rank",
                        "depmap_breadth", "depmap_mean_effect"],
}


def single_score(bundle: dict, name: str) -> np.ndarray:
    feats = bundle["features"]
    key, _ = SINGLE[name]
    if key == "__flip_effect":
        return -feats["effect"]
    return np.asarray(feats[key], dtype=float)


def composed_score(bundle: dict, name: str) -> np.ndarray:
    primary, secondary, _ = COMPOSED[name]
    return _lex(bundle["features"][primary], bundle["features"][secondary])


def _fill(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Rank-normalise, then replace NaN with 0.5 and emit a missingness flag.

    A missing feature has to be distinguishable from a middling one: a BAGEL
    screen reports no significance column at all, and 32 of the 269 query screens
    have no guide map, so imputing the median without a flag would tell the model
    those units are average when they are unmeasured.
    """
    r = _rank01(x)
    miss = (~np.isfinite(r)).astype(float)
    return np.where(np.isfinite(r), r, 0.5), miss


def design_matrix(bundle: dict, features: Sequence[str]) -> np.ndarray:
    """Two columns per feature: the within-unit rank, and a missingness flag.

    Both columns are emitted for every feature whether or not anything is missing
    in this unit, so the matrix has the same width on every unit and on every
    split. Emitting the flag only where something was missing would silently
    change the column count between development and held out, and the
    development-fitted coefficients would then be applied to the wrong columns.
    """
    cols = []
    for f in features:
        v, miss = _fill(bundle["features"][f])
        cols.append(v)
        cols.append(miss)
    return np.column_stack(cols)


def _fit_logistic(X: np.ndarray, y: np.ndarray):
    from sklearn.linear_model import LogisticRegression

    # L2 with the default C, class_weight balanced because positives are 3% to
    # 4.5% of the primary space. Nothing here is tuned per baseline: one setting
    # for every combination, so no combination gets a private hyperparameter.
    model = LogisticRegression(max_iter=2000, class_weight="balanced")
    model.fit(X, y)
    return model


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

PRECISION_K = (10, 20, 50)


def precision_at_k(y: np.ndarray, score: np.ndarray, k: int) -> float:
    """Fraction of the top ``k`` that hit in B.

    Ties are resolved by the caller's order, which is gene-alphabetical, exactly
    as :func:`dataset.average_precision` does. That is arbitrary but identical
    for every method, so no method is rewarded for emitting ties.
    """
    order = np.argsort(-np.asarray(score, dtype=float), kind="stable")[:k]
    return float(np.asarray(y, dtype=float)[order].mean())


def roc_auc(y: np.ndarray, score: np.ndarray) -> float:
    """Mann-Whitney AUC with average ranks for ties.

    Unlike average precision this treats a tie block as genuinely unordered
    rather than resolving it alphabetically, so the gap between a baseline's AP
    and its AUC is a direct readout of how tied its statistic is.
    """
    from scipy.stats import rankdata

    y = np.asarray(y, dtype=float)
    s = np.asarray(score, dtype=float)
    npos, nneg = float(y.sum()), float((1 - y).sum())
    if npos == 0 or nneg == 0:
        return float("nan")
    r = rankdata(np.where(np.isfinite(s), s, -np.inf), method="average")
    return float((r[y > 0].sum() - npos * (npos + 1) / 2.0) / (npos * nneg))


def score_unit(bundle: dict, score: np.ndarray, labels, space: str) -> dict:
    """Every metric for one unit's ranking, restricted to ``space``."""
    unit = bundle["unit"]
    merged = labels.set_index("gene").reindex(bundle["genes"])
    if merged["b_hit"].isna().any():
        # The label frame and the input frame are both the shared gene space, so a
        # gene present in one and not the other means the two reads disagree.
        # Better to refuse than to score a silently misaligned ranking.
        raise RuntimeError(
            f"{unit.unit_id}: {int(merged['b_hit'].isna().sum())} input genes have no label; "
            f"the inputs and labels reads disagree on the shared space"
        )
    y = merged["b_hit"].to_numpy().astype(float)
    sel = np.ones(len(y), bool) if space == "all" else ~bundle["is_common_essential"]
    y = y[sel]
    s = np.asarray(score, dtype=float)[sel]
    # A NaN must never outrank a real value. Sending it to -inf puts every
    # unmeasured gene at the bottom, which is the honest place for "this baseline
    # has nothing to say about this gene".
    s = np.where(np.isfinite(s), s, -np.inf)
    out = {
        "unit_id": unit.unit_id,
        "pair_key": unit.pair_key,
        "n_genes": int(sel.sum()),
        "n_positives": int(y.sum()),
        "average_precision": dataset.average_precision(y, s),
        "auc": roc_auc(y, s),
        "marginal": float(y.mean()),
    }
    for k in PRECISION_K:
        out[f"p_at_{k}"] = precision_at_k(y, s, k)
    return out


# ---------------------------------------------------------------------------
# Running the whole set
# ---------------------------------------------------------------------------

def _bundles(split: str) -> list[dict]:
    return [unit_features(u) for u in dataset.pairs(split)]


def _labels(split: str, evaluating: bool) -> dict[str, "object"]:
    return {u.unit_id: dataset.load_pair_labels(u, evaluating=evaluating)
            for u in dataset.pairs(split)}


def all_scores(bundles: Sequence[dict], fitted: dict | None = None) -> dict[str, dict[str, np.ndarray]]:
    """``{baseline: {unit_id: score vector}}`` for every baseline in the module."""
    out: dict[str, dict[str, np.ndarray]] = collections.defaultdict(dict)
    for b in bundles:
        uid = b["unit"].unit_id
        for name in SINGLE:
            out[name][uid] = single_score(b, name)
        for name in COMPOSED:
            out[name][uid] = composed_score(b, name)
        if fitted:
            for name, model in fitted.items():
                out[name][uid] = model["model"].decision_function(
                    design_matrix(b, model["features"])
                )
    return dict(out)


def fit_combinations(bundles: Sequence[dict], labels: dict, space: str = dataset.PRIMARY_SPACE) -> dict:
    """Fit every logistic-regression combination on the bundles given.

    Called with development bundles and development labels only. The genes used
    for the fit are restricted to the same space the model is scored on, so the
    fit is not dominated by common essentials it will never be asked about.
    """
    stacked: dict[str, list[np.ndarray]] = collections.defaultdict(list)
    ys: list[np.ndarray] = []
    for b in bundles:
        uid = b["unit"].unit_id
        merged = labels[uid].set_index("gene").reindex(b["genes"])
        y = merged["b_hit"].to_numpy().astype(float)
        sel = np.ones(len(y), bool) if space == "all" else ~b["is_common_essential"]
        ys.append(y[sel])
        for name, feats in COMBOS.items():
            stacked[name].append(design_matrix(b, feats)[sel])
    y_all = np.concatenate(ys)
    fitted = {}
    for name, feats in COMBOS.items():
        X = np.vstack(stacked[name])
        fitted[name] = {"features": feats, "model": _fit_logistic(X, y_all),
                        "n_rows": int(X.shape[0]), "n_columns": int(X.shape[1])}
    return fitted


def run(
    split: str,
    evaluating: bool = False,
    space: str = dataset.PRIMARY_SPACE,
    fitted: dict | None = None,
    reference: str = "marginal_rate",
) -> dict:
    """Score every simple baseline on ``split`` and test each against a reference.

    ``reference`` is the baseline every other one is compared against. The
    default is ``marginal_rate``, the information-free floor, which is what the
    task asked for; ``effect_score1`` is the more demanding comparison and is
    reported alongside it.
    """
    bundles = _bundles(split)
    labels = _labels(split, evaluating)
    scores = all_scores(bundles, fitted)

    per_unit: dict[str, dict[str, dict]] = {}
    for name, by_unit in scores.items():
        per_unit[name] = {
            b["unit"].unit_id: score_unit(b, by_unit[b["unit"].unit_id], labels[b["unit"].unit_id], space)
            for b in bundles
        }
    # The floor: a ranking with no information scores its unit's positive rate.
    per_unit["marginal_rate"] = {
        b["unit"].unit_id: score_unit(b, np.zeros(len(b["genes"])), labels[b["unit"].unit_id], space)
        for b in bundles
    }
    for uid, row in per_unit["marginal_rate"].items():
        row["average_precision"] = row["marginal"]
        row["auc"] = 0.5
        for k in PRECISION_K:
            row[f"p_at_{k}"] = row["marginal"]

    summary = {}
    for name, rows in per_unit.items():
        vals = list(rows.values())
        summary[name] = {
            m: float(np.nanmean([v[m] for v in vals]))
            for m in ("average_precision", "auc", *[f"p_at_{k}" for k in PRECISION_K])
        }
        summary[name]["n_units"] = len(vals)

    tests = {}
    for ref in {reference, "effect_score1"}:
        ref_ap = {u: r["average_precision"] for u, r in per_unit[ref].items()}
        tests[ref] = {}
        for name, rows in per_unit.items():
            if name == ref:
                continue
            ap = {u: r["average_precision"] for u, r in rows.items()}
            tests[ref][name] = dataset.paired_test(ap, ref_ap)

    # Baselines that cannot be computed on every unit have to be measured where
    # they CAN be computed, or their mean is a mixture of the baseline and the
    # floor. Each restricted comparison names its own subset and its own n.
    subsets = {
        "significance_available": [b["unit"].unit_id for b in bundles if b["significance_available"]],
        "guide_map_available": [b["unit"].unit_id for b in bundles if b["guide_map"]],
        "log2fc_available": [
            b["unit"].unit_id for b in bundles
            if np.isfinite(b["features"]["effect_l2fc"]).any()
        ],
    }
    restricted = {}
    for sub, uids in subsets.items():
        if not uids:
            restricted[sub] = {"n_units": 0}
            continue
        blk = {"n_units": len(uids),
               "n_screen_pairs": len({per_unit["effect_score1"][u]["pair_key"] for u in uids}),
               "summary": {}, "vs_marginal": {}, "vs_effect": {}}
        for name, rows in per_unit.items():
            vals = [rows[u] for u in uids]
            blk["summary"][name] = {
                m: float(np.nanmean([v[m] for v in vals]))
                for m in ("average_precision", "auc", *[f"p_at_{k}" for k in PRECISION_K])
            }
        for ref, key in (("marginal_rate", "vs_marginal"), ("effect_score1", "vs_effect")):
            ref_ap = {u: per_unit[ref][u]["average_precision"] for u in uids}
            for name, rows in per_unit.items():
                if name == ref:
                    continue
                blk[key][name] = dataset.paired_test(
                    {u: rows[u]["average_precision"] for u in uids}, ref_ap)
        restricted[sub] = blk

    return {
        "restricted": restricted,
        "split": split,
        "space": space,
        "n_units": len(bundles),
        "n_screen_pairs": len({b["unit"].pair_key for b in bundles}),
        "reference": reference,
        "summary": summary,
        "paired_tests": tests,
        "per_unit": per_unit,
        "coverage": {
            "significance": sum(1 for b in bundles if b["significance_available"]),
            "guide_map": sum(1 for b in bundles if b["guide_map"]),
        },
    }


def coverage_report() -> dict:
    """Which baselines can be computed on how many units, and why not elsewhere."""
    out = {}
    for split in dataset.SPLITS:
        units = dataset.pairs(split)
        sig = [u for u in units if significance_column(u.query_screen, "finest")]
        gmap = [u for u in units if u.query_library in GUIDE_MAPS]
        unknown_dir = [u for u in units if _direction(u) == 0.0]
        out[split] = {
            "n_units": len(units),
            "significance_available": len(sig),
            "significance_missing_libraries": sorted(collections.Counter(
                dataset.screen_index()[u.query_screen]["ANALYSIS"]
                for u in units if u not in sig).items()),
            "guide_map_available": len(gmap),
            "guide_map_missing_libraries": sorted(collections.Counter(
                u.query_library for u in units if u.query_library not in GUIDE_MAPS).items()),
            "score1_direction_unknown": len(unknown_dir),
        }
    return out


def _fmt(res: dict, top: int = 40) -> str:
    lines = [
        f"simple baselines  split={res['split']}  space={res['space']}  "
        f"units={res['n_units']}  screen pairs={res['n_screen_pairs']}",
        f"  significance column available on {res['coverage']['significance']} units, "
        f"guide map on {res['coverage']['guide_map']}",
        "",
        f"  {'baseline':<28} {'AP':>7} {'AUC':>7} {'P@10':>7} {'P@20':>7} {'P@50':>7}",
    ]
    order = sorted(res["summary"], key=lambda n: -res["summary"][n]["average_precision"])
    for name in order[:top]:
        s = res["summary"][name]
        lines.append(
            f"  {name:<28} {s['average_precision']:>7.4f} {s['auc']:>7.4f} "
            f"{s['p_at_10']:>7.3f} {s['p_at_20']:>7.3f} {s['p_at_50']:>7.3f}"
        )
    for ref, block in res["paired_tests"].items():
        lines += ["", f"  paired AP difference against {ref} (bootstrap by screen pair):"]
        for name in order:
            if name not in block:
                continue
            t = block[name]
            mark = "*" if t["significant"] else " "
            lines.append(
                f"  {mark} {name:<26} {t['mean_difference']:+.4f}  "
                f"CI [{t['ci95'][0]:+.4f}, {t['ci95'][1]:+.4f}]  p={t['wilcoxon_p']:.2g}"
            )
    return "\n".join(lines)


def _main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("split", choices=[*dataset.SPLITS, "coverage"])
    ap.add_argument("--evaluating", action="store_true",
                    help="required for held-out labels; say so in the write-up")
    ap.add_argument("--space", default=dataset.PRIMARY_SPACE, choices=list(dataset.GENE_SPACES))
    ap.add_argument("--json", default="")
    a = ap.parse_args()

    if a.split == "coverage":
        print(json.dumps(coverage_report(), indent=1))
        return

    dev = _bundles("development")
    fitted = fit_combinations(dev, _labels("development", False), space=a.space)
    res = run(a.split, evaluating=a.evaluating, space=a.space, fitted=fitted)
    print(_fmt(res))
    if a.json:
        thin = {k: v for k, v in res.items() if k != "per_unit"}
        with open(a.json, "w") as fh:
            json.dump(thin, fh, indent=1, default=float)
        print(f"\nwrote {a.json}")


if __name__ == "__main__":
    _main()

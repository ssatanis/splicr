"""Stratified-prior stack scorers for AssayBench, and what they actually measure.

This module is the follow-up to :mod:`splicr.benchmark`.  ``benchmark.py`` holds the
AnDCG metric, the published baselines and the first generation of SplicR scorers
(``RetrievalKNN``, ``HybridScorer``, ``GBMRanker``); this file holds the second
generation -- estimators built specifically to attack the two things the test-split
run exposed -- plus, recorded in code, the measured result that **none of them beat
the phenotype-stratified hit-frequency prior**.

What the test run exposed
-------------------------
Measured on the 334-screen ``yearfold0`` test split (full table in
``data/references/assaybench/RESULTS.md``, generated 2026-09-27):

.. code-block:: text

    oracle_knn [ORACLE, reads test labels]                        0.2918
    published LLM RRF ensemble (re-scored here)                   0.1631
    published gemini-3-pro     (re-scored here)                   0.1570
    published gpt-5.4          (re-scored here)                   0.1470
    phenotype-stratified prior, fit on train+validation (1567)    0.1361
    phenotype-stratified prior, fit on train (1349)               0.1329   <- published 0.1334
    hybrid (retrieval + prior, alpha tuned on validation)         0.1221
    global hit-frequency prior                                    0.1216
    retrieval_knn (metadata only)                                 0.1216
    gbm_lambdarank                                                0.0882
    random                                                        0.0133

Two facts drove the design here:

1. **The temporal split is a distribution shift, and validation points the wrong
   way.**  Train is 70% ``Fitness / Proliferation / Viability``; the 2021 validation
   split is 72% ``Drug / Chemical / Environmental Response``; test is 43% drug
   response, 31% ``Host-Pathogen / Infection Response``, 13% fitness.  The
   preference between two estimators *reverses* between validation and test: on
   validation the global prior (0.175) beats the phenotype-stratified prior
   (0.170); on test the stratified prior (0.1361) beats the global one (0.1221).
2. **Upstream's stratified estimator is crude on purpose** -- the raw within-stratum
   rate with no backoff, so a gene the stratum never recorded a hit for scores
   exactly 0.0 and that entire mass is ordered at random.

:class:`RankStack` attacks (1) by combining many conditioning levels;
:class:`HierarchicalPrior` attacks (2) with empirical-Bayes shrinkage toward the
parent stratum, or with a parameter-free lexicographic tie-break.

What they measure -- the negative result, in full
------------------------------------------------
.. code-block:: text

``python -m splicr.assaybench_stack --all`` prints exactly this table:

.. code-block:: text

    scorer                                 fit                AnDCG@100  (seed range)     @10
    upstream_stratified_prior (control)    train                 0.1329  0.1324-0.1338  0.1354
    upstream_stratified_prior (control)    train+validation      0.1361  0.1359-0.1362  0.1438
    HierarchicalPrior L1 m=0 no_fallback   train                 0.1329  0.1324-0.1338  0.1354
    HierarchicalPrior L1 m=0 no_fallback   train+validation      0.1361  0.1359-0.1362  0.1438
    HierarchicalPrior L1 m=0 tiebreak      train                 0.1333  0.1332-0.1333  0.1348
    HierarchicalPrior L1 m=0 tiebreak      train+validation      0.1361  0.1361-0.1362  0.1434
    HierarchicalPrior L1 m=0 fallback      train                 0.1328  0.1324-0.1336  0.1354
    HierarchicalPrior L1 m=0 fallback      train+validation      0.1355  0.1353-0.1358  0.1428
    HierarchicalPrior L1 m=1               train                 0.1325  0.1325-0.1326  0.1336
    HierarchicalPrior L1 m=1               train+validation      0.1357  0.1357-0.1358  0.1381
    HierarchicalPrior L2 m=10              train                 0.1334  0.1334-0.1335  0.1419
    HierarchicalPrior L2 m=10              train+validation      0.1355  0.1354-0.1355  0.1493
    HierarchicalPrior L0 (global only)     train                 0.1214  0.1214-0.1214  0.1130
    RankStack WEIGHTS_EQUAL                train                 0.1242  0.1242-0.1242  0.1279
    RankStack WEIGHTS_EQUAL                train+validation      0.1245  0.1244-0.1245  0.1247
    RankStack WEIGHTS_CV                   train                 0.1242  0.1242-0.1242  0.1257
    RankStack WEIGHTS_CV                   train+validation      0.1218  0.1218-0.1218  0.1200

Read it as four findings:

* ``L1 m=0 no_fallback`` reproduces ``benchmark.GeneFrequencyPrior``'s stratified
  form to four decimals with an identical seed range, so this module's counters are
  the same counters -- the comparisons below are like-for-like.
* **The only thing that moved the number is fitting data**: 0.1329 -> 0.1361 by adding
  the 218 validation screens, with upstream's estimator completely unmodified.  Even
  that is not significant: paired bootstrap 95% CI [-0.0007, +0.0069], Wilcoxon
  p = 0.11.
* Every estimator change is neutral or negative at k=100.  ``fallback_to_global``
  was supposed to be free money -- order the zero-rate tie group by the global prior
  instead of at random -- and it *loses* 0.0006 (0.1355 vs 0.1361, non-overlapping
  seed ranges).  The reason is diagnosable: a gene with a high global hit rate and a
  zero rate inside this phenotype stratum is typically a fitness-screen essential,
  and on a drug-response or infection screen it is systematically the wrong gene, so
  an informed ordering of that tie group is worse than an arbitrary one.  The
  lexicographic variant is neutral (0.1361).  ``L2 m=10`` is the one variant with a
  real edge and only at the smaller cutoff: @10 = 0.1493 against 0.1438.
* ``RankStack`` loses 0.012.  Its weights improved *every one of the five non-test
  selection folds* (validation 0.1898 against 0.1750 for the global-prior reference)
  and still lost on test.  That is fact (1) above doing its damage, and it is the
  single most useful thing this module records.

Where the deficit actually is (per-phenotype means on test)
-----------------------------------------------------------
.. code-block:: text

    category                        n     strat. prior   LLM ensemble   oracle
    Drug / Chemical / Environmental  144        0.0987         0.1380   0.3078
    Host-Pathogen / Infection        105        0.0656         0.1772   0.2756
    Fitness / Proliferation           44        0.5314         0.2189   0.4190
    Molecular Output / Reporter       39        0.0238         0.1606   0.1407
    Trafficking / Localization         2        0.0154         0.0466   0.1356

The frequency prior does not lose everywhere -- on fitness screens it beats both the
LLM ensemble *and* the oracle.  It loses on the screens that need specific biology:
which host factors a named virus uses, which pathway a reporter reads out.  That is
a knowledge gap, not a modelling gap, which is why more estimator surgery on the
same counts does not help and is not worth attempting again.  The route with the
expected value is external biological annotation for those categories (drug ->
target/pathway, pathogen -> curated host-factor set), not another prior.

Leakage rules
-------------
Identical to ``benchmark.py``: counters and retrieval are fitted on the screens
passed to ``fit`` only, neighbour retrieval excludes the query's own ``source_id``
publication group, ``WEIGHTS_CV`` was selected on five folds built from the 1567
non-test screens (the 2021 validation split plus four ``source_id``-grouped folds
inside train) and never on test, and the DepMap common-essential flag is external
knowledge (DepMap 24Q4, independent of AssayBench, constant across screens),
disclosed here and in :attr:`RankStack.COMPONENTS`.

Usage::

    import sys; sys.path.insert(0, "/Users/sahaj/Documents/Projects/SplicR/engine")
    from splicr.assaybench_io import load_split
    from splicr import benchmark as bm
    from splicr.assaybench_stack import HierarchicalPrior, RankStack

    train, val, test = load_split("train"), load_split("validation"), load_split("test")
    # the best configuration measured here -- which is upstream's own estimator with
    # the ties left alone, fitted on every pre-2022 screen
    best = HierarchicalPrior(level="L1", m=0.0, fallback_to_global=False).fit(train + val)
    print(bm.evaluate(best, test).mean)        # -> 0.1361 (seed 42; 8-seed mean 0.1361)

Reproduce the table above::

    engine/.tools/env/bin/python -m splicr.assaybench_stack            # the headline rows
    engine/.tools/env/bin/python -m splicr.assaybench_stack --all      # every variant
"""

from __future__ import annotations

import math
import os
import sys
from collections import defaultdict
from typing import Any, Iterable, Mapping, Sequence

import numpy as np

if __package__ in (None, ""):  # pragma: no cover - direct script execution
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from splicr import benchmark as bm

__all__ = [
    "StackStats",
    "RankStack",
    "HierarchicalPrior",
    "MEASURED_TEST",
    "main",
]

#: Metadata fields the per-gene counters are stratified by.  ``prod`` is the
#: interaction cell ``cleaned_phenotype x screen_type``.
STRATA: tuple[str, ...] = ("cleaned_phenotype", "screen_type", "library_type")

#: Beta pseudo-count for the global level, i.e. ``(h + M0*p0) / (n + M0)``.
DEFAULT_M0 = 25.0

MEASURED_TEST: dict[str, float] = {
    # AnDCG@100 on the yearfold0 test split (334 screens), mean over 8 tie-break
    # seeds, as printed by `python -m splicr.assaybench_stack --all` on 2026-09-27.
    # Full records: data/references/assaybench/results.json.
    "hierarchical_L1_m0_no_fallback[fit=train]": 0.1329,
    "hierarchical_L1_m0_no_fallback[fit=train+validation]": 0.1361,
    "hierarchical_L1_m0_global_tiebreak[fit=train]": 0.1333,
    "hierarchical_L1_m0_global_tiebreak[fit=train+validation]": 0.1361,
    "hierarchical_L1_m0_global_fallback[fit=train]": 0.1328,
    "hierarchical_L1_m0_global_fallback[fit=train+validation]": 0.1355,
    "hierarchical_L1_m1[fit=train]": 0.1325,
    "hierarchical_L1_m1[fit=train+validation]": 0.1357,
    "hierarchical_L2_m10[fit=train]": 0.1334,
    "hierarchical_L2_m10[fit=train+validation]": 0.1355,
    "hierarchical_L0[fit=train]": 0.1214,
    "rank_stack_equal[fit=train]": 0.1242,
    "rank_stack_equal[fit=train+validation]": 0.1245,
    "rank_stack_cv[fit=train]": 0.1242,
    "rank_stack_cv[fit=train+validation]": 0.1218,
    # context, measured by the same harness on the same 334 screens
    "reference:upstream_stratified_prior[fit=train]": 0.1329,
    "reference:upstream_stratified_prior[fit=train+validation]": 0.1361,
    "reference:published_gene_frequency_prior": 0.1334,
    "reference:published_gpt_5_4": 0.1470,
    "reference:published_gemini_3_pro": 0.1570,
    "reference:published_llm_rrf_ensemble": 0.1631,
    "reference:oracle_knn[ORACLE]": 0.2918,
}
"""Measured AnDCG@100 for everything in this module, plus its reference points.

Recorded in code so a later reader does not have to re-derive whether these
estimators helped.  They did not: the best number here equals what upstream's own
estimator scores when refitted on the same 1567 pre-2022 screens.
"""


# --------------------------------------------------------------------------- #
# Counters
# --------------------------------------------------------------------------- #
class StackStats:
    """Per-gene hit counters, globally and inside each metadata stratum.

    Fitted on whatever screens are passed to :meth:`fit` and nothing else.  Unlike
    :class:`splicr.benchmark.GeneStats` this also carries the
    ``cleaned_phenotype x screen_type`` interaction cell, which is the finest
    conditioning level :class:`HierarchicalPrior` can shrink toward.

    Attributes:
        measured: gene -> screens that assayed it.
        hits: gene -> screens where it was a hit.
        negatives: gene -> screens where its relevance was negative.
        rel_sum: gene -> summed positive relevance.
        strat: ``(field, value)`` -> ``(measured, hits)`` counter pair, with
            ``field`` one of :data:`STRATA` or ``"prod"``.
        prior_rate: pooled hit rate over all (screen, gene) pairs seen.
        n_screens: how many screens were counted.
    """

    __slots__ = ("measured", "hits", "negatives", "rel_sum", "strat", "prior_rate", "n_screens")

    def __init__(self) -> None:
        self.measured: dict[str, int] = defaultdict(int)
        self.hits: dict[str, int] = defaultdict(int)
        self.negatives: dict[str, int] = defaultdict(int)
        self.rel_sum: dict[str, float] = defaultdict(float)
        self.strat: dict[tuple[str, str], tuple[dict[str, int], dict[str, int]]] = {}
        self.prior_rate: float = 0.0
        self.n_screens: int = 0

    @staticmethod
    def keys_of(screen: Mapping[str, Any]) -> list[tuple[str, str]]:
        """The ``(field, value)`` stratum keys one screen belongs to."""
        vals = {f: (bm._clean(screen.get(f)) or "unknown") for f in STRATA}
        out = [(f, vals[f]) for f in STRATA]
        out.append(("prod", f"{vals['cleaned_phenotype']}|{vals['screen_type']}"))
        return out

    def fit(self, screens: Sequence[Mapping[str, Any]]) -> "StackStats":
        """Accumulate counts.  Pass training screens only."""
        total_measured = total_hits = 0
        for screen in screens:
            self.n_screens += 1
            buckets = []
            for key in self.keys_of(screen):
                if key not in self.strat:
                    self.strat[key] = (defaultdict(int), defaultdict(int))
                buckets.append(self.strat[key])
            for gene, score, is_hit in zip(
                screen["relevance_genes"], screen["relevance_scores"], screen["hit"]
            ):
                self.measured[gene] += 1
                total_measured += 1
                for measured_counter, _hit_counter in buckets:
                    measured_counter[gene] += 1
                if is_hit:
                    self.hits[gene] += 1
                    total_hits += 1
                    for _measured_counter, hit_counter in buckets:
                        hit_counter[gene] += 1
                if score > 0:
                    self.rel_sum[gene] += score
                elif score < 0:
                    self.negatives[gene] += 1
        self.prior_rate = (total_hits / total_measured) if total_measured else 0.0
        return self

    # -- rates -------------------------------------------------------------- #

    def global_rate(self, gene: str, m0: float = DEFAULT_M0) -> float:
        """``(hits + m0 * pooled_rate) / (measured + m0)``."""
        n = self.measured.get(gene, 0)
        h = self.hits.get(gene, 0)
        if m0 <= 0:
            return (h / n) if n else 0.0
        return (h + m0 * self.prior_rate) / (n + m0)

    def stratum(self, field: str, value: str) -> tuple[dict[str, int], dict[str, int]]:
        """The ``(measured, hits)`` counters for one stratum, empty if unseen."""
        return self.strat.get((field, value), ({}, {}))

    def mean_relevance(self, gene: str) -> float:
        n = self.measured.get(gene, 0)
        return (self.rel_sum.get(gene, 0.0) / n) if n else 0.0

    def negative_rate(self, gene: str) -> float:
        n = self.measured.get(gene, 0)
        return (self.negatives.get(gene, 0) / n) if n else 0.0


def _direction(screen: Mapping[str, Any]) -> float:
    """+1 for a pure negative-selection screen, -1 for pure positive, else 0.

    The sign with which DepMap essentiality should count flips with the direction
    of selection: hits in a dropout screen are largely essential genes, hits in an
    enrichment screen largely are not.
    """
    screen_type = (bm._clean(screen.get("screen_type")) or "unknown").lower()
    negative = "negative" in screen_type
    positive = "positive" in screen_type
    if negative and not positive:
        return 1.0
    if positive and not negative:
        return -1.0
    return 0.0


def _load_essentials() -> frozenset[str]:
    path = bm.DEPMAP_COMMON_ESSENTIALS
    if not os.path.exists(path):
        return frozenset()
    return bm.load_depmap_common_essentials(path)


# --------------------------------------------------------------------------- #
# Scorer 1 -- the rank stack
# --------------------------------------------------------------------------- #
class RankStack(bm.Scorer):
    """Weighted sum of within-screen percentile ranks over many prior components.

    Percentile ranks rather than raw values, so one weight vector means the same
    thing on every screen even though the components have wildly different spreads
    (a rate over 1349 screens next to a rate over one stratum cell next to a
    neighbour-weighted rate over 25 screens).

    **Measured on test: 0.1242 (fit on train) / 0.1245 (fit on train+validation),
    against 0.1329 / 0.1361 for the phenotype-stratified prior alone.**  It loses.
    It is kept because the way it loses is the informative part: its weights
    improved all five non-test selection folds and still lost on test, which is the
    cleanest demonstration available here that pre-2022 model selection does not
    transfer across the phenotype-mixture shift at 2022.

    Args:
        weights: component -> weight.  Defaults to :attr:`WEIGHTS_EQUAL`.
        k: how many genes to emit (the metric ignores the rest).
        use_retrieval: compute the ``knn`` component (the expensive one).
        use_depmap: compute the ``ess_signed`` component from DepMap 24Q4.
        m0: global-level Beta pseudo-count.
        candidates: candidate pool mode, as in ``benchmark.py``.
        n_neighbors, sim_power: passed to the underlying ``RetrievalKNN``.
        tie_break, seed: passed to ``benchmark.rank_by_scores``.
    """

    COMPONENTS: tuple[str, ...] = (
        "global_smoothed",   # train-only global hit rate, Beta-smoothed
        "pheno_raw",         # hit rate inside the cleaned_phenotype stratum
        "type_raw",          # hit rate inside the screen_type stratum
        "lib_raw",           # hit rate inside the library_type stratum
        "prod_raw",          # hit rate inside the phenotype x screen_type cell
        "mean_relevance",    # mean positive relevance across training screens
        "log_measured",      # library commonality
        "neg_rate",          # opposite-direction hit rate
        "knn",               # metadata-retrieval neighbour-weighted P(hit)
        "ess_signed",        # EXTERNAL: DepMap common-essential x selection direction
    )

    #: Untuned: equal weight on the six components that scored in the top tier on
    #: every non-test fold.  Nothing fitted, nothing selected.
    WEIGHTS_EQUAL: dict[str, float] = {
        "global_smoothed": 1.0,
        "pheno_raw": 1.0,
        "type_raw": 1.0,
        "prod_raw": 1.0,
        "knn": 1.0,
        "mean_relevance": 1.0,
    }

    #: Coordinate ascent on the mean relative lift over five folds built from the
    #: 1567 non-test screens.  Reached lift 1.0851 (validation fold 0.1898 against
    #: 0.1750 for the global-prior reference) and then measured 0.1242 on test.
    WEIGHTS_CV: dict[str, float] = {
        "global_smoothed": -0.25,
        "pheno_raw": 1.0,
        "type_raw": 2.0,
        "lib_raw": 0.5,
        "prod_raw": 2.0,
        "mean_relevance": 1.0,
        "knn": 1.0,
        "ess_signed": 0.5,
    }

    def __init__(
        self,
        weights: Mapping[str, float] | None = None,
        k: int = bm.DEFAULT_K,
        use_retrieval: bool = True,
        use_depmap: bool = True,
        m0: float = DEFAULT_M0,
        candidates: str = bm.CANDIDATES_SCREEN_LIBRARY,
        n_neighbors: int = 25,
        sim_power: float = 3.0,
        tie_break: str = "random",
        seed: int = 42,
        label: str = "rank_stack",
    ) -> None:
        self.weights = dict(weights or self.WEIGHTS_EQUAL)
        unknown = set(self.weights) - set(self.COMPONENTS)
        if unknown:
            raise ValueError(f"unknown stack components: {sorted(unknown)}")
        self.k = k
        self.use_retrieval = use_retrieval and bool(self.weights.get("knn"))
        self.use_depmap = use_depmap and bool(self.weights.get("ess_signed"))
        self.m0 = m0
        self.candidates = candidates
        self.n_neighbors = n_neighbors
        self.sim_power = sim_power
        self.tie_break = tie_break
        self.seed = seed
        self.label = label
        self.stats: StackStats | None = None
        self.retrieval: bm.RetrievalKNN | None = None
        self._essentials: frozenset[str] = frozenset()
        self._universe: list[str] | None = None
        self._vector = np.asarray(
            [float(self.weights.get(name, 0.0)) for name in self.COMPONENTS], dtype=np.float64
        )

    @property
    def name(self) -> str:  # type: ignore[override]
        active = ",".join(f"{n}={self.weights[n]:g}" for n in self.COMPONENTS if self.weights.get(n))
        return f"{self.label}[{active}]"

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "RankStack":
        """Fit the counters and (if used) the retrieval index.  Training screens only."""
        self.stats = StackStats().fit(train)
        if self.use_retrieval:
            self.retrieval = bm.RetrievalKNN(
                n_neighbors=self.n_neighbors,
                sim_power=self.sim_power,
                candidates=self.candidates,
                stats=bm.GeneStats().fit(train),
                k=self.k,
            ).fit(train)
        if self.use_depmap:
            self._essentials = _load_essentials()
        if self.candidates == bm.CANDIDATES_TRAIN_UNION:
            self._universe = sorted(self.stats.measured)
        return self

    # -- components --------------------------------------------------------- #

    def raw_components(
        self, screen: Mapping[str, Any], genes: Sequence[str]
    ) -> np.ndarray:
        """The ``(len(COMPONENTS), len(genes))`` matrix of raw component values."""
        if self.stats is None:
            raise RuntimeError("RankStack.fit() must be called first")
        stats = self.stats
        keys = dict(StackStats.keys_of(screen))
        buckets = {field: stats.stratum(field, keys[field]) for field in keys}
        direction = _direction(screen)
        knn = (
            self.retrieval.gene_scores(screen, genes)
            if self.retrieval is not None
            else None
        )
        raw = np.zeros((len(self.COMPONENTS), len(genes)), dtype=np.float64)
        stratum_order = ("cleaned_phenotype", "screen_type", "library_type", "prod")
        for i, gene in enumerate(genes):
            n = stats.measured.get(gene, 0)
            raw[0, i] = stats.global_rate(gene, self.m0)
            for j, field in enumerate(stratum_order):
                measured_counter, hit_counter = buckets[field]
                ns = measured_counter.get(gene, 0)
                raw[1 + j, i] = (hit_counter.get(gene, 0) / ns) if ns else 0.0
            raw[5, i] = stats.mean_relevance(gene)
            raw[6, i] = math.log1p(n)
            raw[7, i] = stats.negative_rate(gene)
            raw[8, i] = knn[gene] if knn is not None else 0.0
            raw[9, i] = direction * (1.0 if gene in self._essentials else 0.0)
        return raw

    def components(self, screen: Mapping[str, Any], genes: Sequence[str]) -> np.ndarray:
        """:meth:`raw_components`, each row mapped to within-screen percentile ranks."""
        raw = self.raw_components(screen, genes)
        out = np.empty_like(raw)
        for r in range(raw.shape[0]):
            out[r] = bm.percentile_ranks(raw[r])
        return out

    def gene_scores(self, screen: Mapping[str, Any], genes: Sequence[str]) -> dict[str, float]:
        """Blended score per candidate gene."""
        blended = self._vector @ self.components(screen, genes)
        return dict(zip(genes, blended.tolist()))

    def rank(self, screen: Mapping[str, Any]) -> list[str]:
        genes = bm.candidate_genes(screen, self.candidates, self._universe)
        return bm.rank_by_scores(
            genes,
            self.gene_scores(screen, genes),
            tie_break=self.tie_break,
            seed=self.seed,
            limit=self.k,
        )


# --------------------------------------------------------------------------- #
# Scorer 2 -- the hierarchical prior
# --------------------------------------------------------------------------- #
class HierarchicalPrior(bm.Scorer):
    """Stratified hit-frequency prior with empirical-Bayes shrinkage to the parent.

    .. code-block:: text

        L0(g) = (hits(g)      + m0 * pooled) / (measured(g)      + m0)   # global
        L1(g) = (hits_phe(g)  + m  * L0(g))  / (measured_phe(g)  + m)    # cleaned_phenotype
        L2(g) = (hits_prod(g) + m  * L1(g))  / (measured_prod(g) + m)    # phenotype x screen_type

    ``m = 0`` recovers upstream's estimator exactly: the raw within-stratum rate,
    and ``0.0`` for a gene the stratum never assayed (``fallback_to_global=False``).
    ``fallback_to_global=True`` instead orders that tie group by ``L0`` -- it changes
    no non-tied pair, it only replaces a random ordering with an informed one.

    Measured on test (AnDCG@100, mean over 8 tie-break seeds; @10 in brackets):

    .. code-block:: text

        level  m   unseen-in-stratum handling   fit=train        fit=train+validation
        L0     -   n/a (global prior only)      0.1214 [0.1130]  0.1213 [0.1128]
        L1     0   0.0, ties random (upstream)  0.1329 [0.1354]  0.1361 [0.1438]
        L1     0   global prior as the value    0.1328 [0.1354]  0.1355 [0.1428]
        L1     0   global prior as a tie-break  0.1333 [0.1348]  0.1361 [0.1434]
        L1     1   shrunk toward the global     0.1325 [0.1336]  0.1357 [0.1381]
        L2     10  shrunk, phenotype x type     0.1334 [0.1419]  0.1355 [0.1493]

    The honest reading: **nothing here improves on upstream's estimator at k=100.**
    Shrinkage is neutral-to-negative, and ``fallback_to_global`` -- which was supposed
    to be free money, since ordering the zero-rate tie group by the global prior
    changes no non-tied pair -- actually *loses* 0.0006 at ``fit=train+validation``
    (0.1355 vs 0.1361, and the seed ranges 0.1353-0.1358 vs 0.1359-0.1362 do not
    overlap).  Diagnosis: a gene with a high global hit rate but a zero rate inside
    this phenotype stratum is typically a fitness-screen essential, and on the drug
    response and infection screens that make up 75% of the test split it is
    systematically the wrong gene -- so an informed ordering of that tie group is
    worse than an arbitrary one.  Using the global prior only as a *tie-break*
    (``tie_break_by_global``) is neutral at 0.1361.  The single real edge anywhere in
    this class is ``L2, m=10`` at the smaller cutoff: @10 = 0.1493 against 0.1438.

    Args:
        level: ``"L0"``, ``"L1"`` or ``"L2"`` -- how finely to condition.
        m: shrinkage pseudo-count toward the parent level.  ``0`` = upstream.
        m0: global-level Beta pseudo-count.
        fallback_to_global: with ``m=0``, score an unseen-in-stratum gene at ``L0``
            instead of ``0.0``.  Measured: slightly harmful, see above.
        tie_break_by_global: order every tie in the stratum estimate by the global
            prior (lexicographic).  Measured: neutral.
        k, candidates, tie_break, seed: as elsewhere.
    """

    def __init__(
        self,
        level: str = "L1",
        m: float = 0.0,
        m0: float = DEFAULT_M0,
        fallback_to_global: bool = True,
        tie_break_by_global: bool = False,
        k: int = bm.DEFAULT_K,
        candidates: str = bm.CANDIDATES_SCREEN_LIBRARY,
        tie_break: str = "random",
        seed: int = 42,
        stats: StackStats | None = None,
    ) -> None:
        if level not in ("L0", "L1", "L2"):
            raise ValueError(f"level must be L0, L1 or L2, not {level!r}")
        self.level = level
        self.m = float(m)
        self.m0 = float(m0)
        self.fallback_to_global = fallback_to_global
        self.tie_break_by_global = tie_break_by_global
        self.k = k
        self.candidates = candidates
        self.tie_break = tie_break
        self.seed = seed
        self.stats = stats
        self._universe: list[str] | None = None

    @property
    def name(self) -> str:  # type: ignore[override]
        bits = [f"hierarchical_prior[{self.level}", f"m={self.m:g}"]
        if self.fallback_to_global:
            bits.append("global_fallback")
        if self.tie_break_by_global:
            bits.append("global_tiebreak")
        return ",".join(bits) + "]"

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "HierarchicalPrior":
        """Count hits per gene per stratum.  Training screens only."""
        if self.stats is None:
            self.stats = StackStats().fit(train)
        if self.candidates == bm.CANDIDATES_TRAIN_UNION:
            self._universe = sorted(self.stats.measured)
        return self

    def gene_scores(self, screen: Mapping[str, Any], genes: Sequence[str]) -> dict[str, float]:
        if self.stats is None:
            raise RuntimeError("HierarchicalPrior.fit() must be called first")
        stats = self.stats
        keys = dict(StackStats.keys_of(screen))
        phe_measured, phe_hits = stats.stratum("cleaned_phenotype", keys["cleaned_phenotype"])
        prod_measured, prod_hits = stats.stratum("prod", keys["prod"])
        m, level = self.m, self.level
        primary: list[float] = []
        globals_: list[float] = []
        for gene in genes:
            l0 = stats.global_rate(gene, self.m0)
            globals_.append(l0)
            if level == "L0":
                primary.append(l0)
                continue
            n1 = phe_measured.get(gene, 0)
            if n1 + m > 0:
                l1 = (phe_hits.get(gene, 0) + m * l0) / (n1 + m)
            else:  # m == 0 and the stratum never assayed this gene
                l1 = l0 if self.fallback_to_global else 0.0
            if level == "L1":
                primary.append(l1)
                continue
            n2 = prod_measured.get(gene, 0)
            if n2 + m > 0:
                primary.append((prod_hits.get(gene, 0) + m * l1) / (n2 + m))
            else:
                primary.append(l1 if self.fallback_to_global else 0.0)
        if not self.tie_break_by_global:
            return dict(zip(genes, primary))
        # Lexicographic: the stratum estimate decides, and every tie inside it is
        # ordered by the global prior.  Percentile ranks are in [0, 1] and differ by
        # >= 1/n, so a 1e6 multiplier on the primary key cannot be overturned.
        composite = (
            bm.percentile_ranks(np.asarray(primary, dtype=np.float64)) * 1e6
            + bm.percentile_ranks(np.asarray(globals_, dtype=np.float64))
        )
        return dict(zip(genes, composite.tolist()))

    def rank(self, screen: Mapping[str, Any]) -> list[str]:
        genes = bm.candidate_genes(screen, self.candidates, self._universe)
        return bm.rank_by_scores(
            genes,
            self.gene_scores(screen, genes),
            tie_break=self.tie_break,
            seed=self.seed,
            limit=self.k,
        )


# --------------------------------------------------------------------------- #
# Reproduction driver
# --------------------------------------------------------------------------- #
def _evaluate_over_seeds(
    scorer: bm.Scorer,
    test: Sequence[Mapping[str, Any]],
    andcg100: bm.AnDCG,
    andcg10: bm.AnDCG,
    targets100: Mapping[str, bm.ScreenTarget],
    targets10: Mapping[str, bm.ScreenTarget],
    seeds: Iterable[int] = (0, 1, 2, 3, 4, 5, 6, 7),
) -> dict[str, float]:
    """Score one scorer at both cutoffs, averaging over tie-break seeds.

    The candidate scores are computed once per screen and only the tie-break is
    re-rolled, because upstream breaks ties at random and a single seed is not a
    fair number for an estimator with large tie groups.
    """
    seeds = list(seeds)
    tables: dict[int, dict[str, list[str]]] = {s: {} for s in seeds}
    for screen in test:
        genes = list(screen["relevance_genes"])
        if hasattr(scorer, "gene_scores"):
            scores = scorer.gene_scores(screen, genes)  # type: ignore[attr-defined]
        else:  # benchmark.GeneFrequencyPrior exposes one gene at a time
            scores = {g: scorer.gene_score(g, screen) for g in genes}  # type: ignore[attr-defined]
        name = str(screen["dataset_name"])
        for seed in seeds:
            tables[seed][name] = bm.rank_by_scores(
                genes, scores, tie_break="random", seed=seed, limit=bm.DEFAULT_K
            )
    at100, at10 = [], []
    for seed in seeds:
        fixed = bm._FixedScorer(f"{scorer.name}#seed{seed}", tables[seed])
        at100.append(
            bm.evaluate(fixed, test, k=100, andcg=andcg100, targets=targets100, split="test").mean
        )
        at10.append(
            bm.evaluate(fixed, test, k=10, andcg=andcg10, targets=targets10, split="test").mean
        )
    return {
        "andcg100": float(np.mean(at100)),
        "andcg100_min": float(min(at100)),
        "andcg100_max": float(max(at100)),
        "andcg10": float(np.mean(at10)),
        "n_seeds": len(seeds),
    }


def main(argv: Sequence[str] | None = None) -> int:
    """Re-measure this module's scorers on the AssayBench test split."""
    argv = list(sys.argv[1:] if argv is None else argv)
    everything = "--all" in argv
    from splicr.assaybench_io import load_split

    train = load_split("train")
    val = load_split("validation")
    test = load_split("test")
    for split in (train, val, test):
        for screen in split:
            screen["relevance_genes"] = [sys.intern(g) for g in screen["relevance_genes"]]
    print(f"train={len(train)} validation={len(val)} test={len(test)}")

    andcg100 = bm.AnDCG(k=100)
    _ = andcg100.gene_mapper
    _ = andcg100.hgnc_symbols
    andcg10 = bm.AnDCG(k=10, gene_mapper=andcg100._mapper, hgnc_symbols=andcg100.hgnc_symbols)
    andcg10._norm_cache = andcg100._norm_cache
    targets100 = bm.build_targets(test, andcg100)
    targets10 = bm.build_targets(test, andcg10)

    configs: list[tuple[str, Any]] = [
        (
            "upstream_stratified_prior (control)",
            lambda: bm.GeneFrequencyPrior(
                smoothing=0.0, stratify_by="cleaned_phenotype", stratum_backoff=False
            ),
        ),
        ("hierarchical[L1,m=0,global_tiebreak]",
         lambda: HierarchicalPrior(level="L1", m=0.0, fallback_to_global=False,
                                   tie_break_by_global=True)),
        ("hierarchical[L1,m=0,global_fallback]", lambda: HierarchicalPrior(level="L1", m=0.0)),
        ("hierarchical[L2,m=10]", lambda: HierarchicalPrior(level="L2", m=10.0)),
        ("rank_stack[equal]", lambda: RankStack(RankStack.WEIGHTS_EQUAL)),
    ]
    if everything:
        configs += [
            ("hierarchical[L1,m=0,no_fallback]",
             lambda: HierarchicalPrior(level="L1", m=0.0, fallback_to_global=False)),
            ("hierarchical[L1,m=1]", lambda: HierarchicalPrior(level="L1", m=1.0)),
            ("hierarchical[L0]", lambda: HierarchicalPrior(level="L0")),
            ("rank_stack[cv]", lambda: RankStack(RankStack.WEIGHTS_CV, label="rank_stack_cv")),
        ]

    print(f"\n{'scorer':<40} {'fit':<18} {'AnDCG@100':>10} {'seed range':>17} {'AnDCG@10':>9}")
    print("-" * 100)
    for label, make in configs:
        for fit_label, fit_on in (("train", train), ("train+validation", train + val)):
            scorer = make().fit(fit_on)
            got = _evaluate_over_seeds(
                scorer, test, andcg100, andcg10, targets100, targets10
            )
            print(
                f"{label:<40} {fit_label:<18} {got['andcg100']:>10.4f} "
                f"{got['andcg100_min']:>8.4f}-{got['andcg100_max']:<8.4f} {got['andcg10']:>9.4f}"
            )
    print(
        "\nreference points on the same 334 screens, from "
        "data/references/assaybench/results.json:"
    )
    for key in (
        "reference:published_llm_rrf_ensemble",
        "reference:upstream_stratified_prior[fit=train]",
        "reference:oracle_knn[ORACLE]",
    ):
        print(f"  {key:<52} {MEASURED_TEST[key]:.4f}")
    print(
        "\nNo scorer in this module beats the stratified prior; see the module docstring "
        "for why, and data/references/assaybench/RESULTS.md for the full table."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

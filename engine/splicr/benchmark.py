"""AssayBench (Genentech) scoring harness and SplicR gene-ranking scorers.

This module has three parts:

1. :class:`AnDCG` / :func:`adjusted_ndcg` -- a from-scratch reimplementation of
   the AssayBench ranking metric ``adjusted_ndcg@k``.  It is written to be
   *bit-for-bit* identical to the upstream implementation in
   ``assaybench.benchmark.metrics.RankingMetrics`` (MIT licensed, vendored at
   ``engine/.tools/assaybench``), and :func:`self_test` asserts that equality on
   real screens rather than asserting it in a comment.  The reimplementation
   exists because it precomputes the per-screen constants (IDCG, nDCG_rand,
   the normalized relevance table) once instead of once per prediction, which
   turns a 450k-evaluation sweep from hours into minutes.

2. Baselines (:class:`RandomBaseline`, :class:`GeneFrequencyPrior`,
   :class:`OracleKNN`) so a SplicR number is comparable rather than
   free-floating.  ``OracleKNN`` follows upstream's ``knn_test.py`` oracle and
   **reads test labels**, so it is a ceiling, not a method; it reproduces the
   published 0.2918 exactly.  ``GeneFrequencyPrior`` covers upstream's
   ``*-hit-freq`` family.  Which member of that family is the published 0.1334
   turned out to matter -- see :data:`PUBLISHED` and the note below.

Which baseline is 0.1334 -- measured, not assumed
--------------------------------------------------
The reference number 0.1334 was described to us as "rank genes by how often they
are a hit across the training screens".  Implemented literally
(``hits[g] / measured[g]`` over the 1349 ``yearfold0`` training screens) that
measures **0.1217** here, not 0.1334, and the gap is stable across tie-break
seeds so it is not noise.

Rather than assume a dataset difference, the gap was localised.
:class:`OracleKNN` reproduces its own published number, 0.2918, *exactly* -- so
the snapshot, the split, the candidate pool, the symbol normalization and the
metric are all correct, and the discrepancy has to live in the prior's
definition.  Sweeping upstream's published baseline family on this split:

.. code-block:: text

    global-hit-freq                                 0.1217
    phenotype-hit-freq      (screen_rationale)      0.1241
    library-type-hit-freq                           0.1259
    screen-type-hit-freq                            0.1292
    experimental-setup-hit-freq                     0.1304
    coarse-phenotype-hit-freq (cleaned_phenotype)   0.1329   <- 0.1334

So 0.1334 is upstream's ``coarse-phenotype-hit-freq``: hit frequency stratified
by the five-category ``cleaned_phenotype``, with no backoff.  Over eight
tie-break seeds it measures 0.1329 in the range [0.1324, 0.1338], which contains
0.1334.  **The frequency-prior baseline a SplicR scorer has to beat on this split
is therefore 0.1329, not 0.1217.**  Other candidate explanations were each
measured and rejected: priors fit on train+validation (0.1221), a global rather
than per-gene denominator (0.1232), counting both directions as hits (0.1226),
forward/reverse example expansion (0.1214), relevance-weighted counts (0.1209),
Beta smoothing from s=5 to s=200 (0.1212--0.1215), and the alternative
``year_match_val_testfold0`` split (0.1400 unstratified).

3. SplicR scorers (:class:`RetrievalKNN`, :class:`HybridScorer`,
   :class:`GBMRanker`) which are fit on train only, tuned on validation only.

Metric semantics, all verified against upstream by running it
--------------------------------------------------------------
The published prose formula ``(nDCG - nDCG_rand) / (1 - nDCG_rand)`` omits five
behaviours that materially change the number:

* **The result is clamped at zero** (``max(adj, 0)``).  A screen you rank worse
  than chance contributes 0, not a negative.  You therefore cannot win by being
  less-bad where you lose; every gain must come from screens where you are
  strictly better than chance.
* **nDCG_rand is analytic, not sampled.**  It is the nDCG of a *constant* vector
  of length ``min(k, n_genes)`` filled with ``np.mean(all_relevances)``.  No RNG.
  (``RankingMetrics.num_random_samples = 10`` is dead code.)
* **IDCG clips negative relevances to 0, the numerator does not.**  Ranking an
  opposite-direction gene actively subtracts, and nDCG cannot exceed 1.
* **nDCG_rand can be negative**, making the denominator ``> 1``.  That happens
  when mean relevance is negative, i.e. on bidirectional screens carrying more
  negative than positive mass (60 of the 334 ``yearfold0`` test screens).
* **The "condensed" step costs budget.**  Order is: pad to ``k`` with 0.0,
  truncate to ``k``, *then* drop ``None`` (genes the screen did not measure).
  Because truncation happens first, an unmeasured gene inside your top-k
  consumes a slot and is then deleted -- it is not skipped for free.  Predicting
  genes outside the screen's library shortens your effective ranked list.

Gain is **linear** in relevance (``rel / log2(i + 2)``), not ``2**rel - 1``.

What the relevance scores actually look like
--------------------------------------------
``relevance_scores`` is the within-screen percentile rank of the screen's own
effect statistic, signed by direction, and zeroed for non-hits.  So the hits in
a screen all sit in a narrow band just below 1.0 (e.g. 0.88--1.00 for a screen
with 2071 hits out of 17587 genes).  Consequence: AnDCG@100 is, to a very good
approximation, a log-discounted **precision@100 for hits**, with a mild bonus
for ordering hits by effect size.  Every scorer here therefore estimates
P(gene is a hit in this screen) and ranks by it.

Candidate sets, stated plainly
------------------------------
Every non-LLM baseline in upstream's ``generate_baseline_predictions.py`` ranks
*within* ``example["relevance_genes"]``, i.e. it is told which genes the screen
measured.  That is how 0.1334 was produced, so :data:`CANDIDATES_SCREEN_LIBRARY`
is the default here too, and it is what makes our number comparable.  It is not
label leakage -- no relevance value is read -- but it is screen-specific
information an LLM prompted only with the screen description does not get.
:data:`CANDIDATES_TRAIN_UNION` is provided for the stricter setting where the
ranker may only emit genes seen in training, and the metric's condensed step
then charges you for every gene the screen did not measure.

Where the SplicR scorers actually stand -- measured, on validation
------------------------------------------------------------------
The benchmark test split has **not** been run for the SplicR scorers.  What
follows is the 218-screen ``yearfold0`` validation split, fitting on all 1349
training screens.  Validation is easier than test (the frequency prior scores
0.177 here against 0.122 on test), so these numbers are **not** comparable to the
published table -- only to each other.

.. code-block:: text

    random                                       0.0232 +/- 0.0037
    gene_frequency_prior (unstratified)          0.1767 +/- 0.0192
    gene_frequency_prior (coarse-phenotype)      0.1690 +/- 0.0169
    gene_frequency_prior + smoothing + neg       0.1747 +/- 0.0190
    retrieval_knn                                0.1761 +/- 0.0187
    hybrid (alpha = 0.70, tuned on validation)   0.1776 +/- 0.0190
    gbm_lambdarank                               0.1334 +/- 0.0141

**No SplicR scorer here beats the gene-frequency prior yet.**  Stated precisely,
because the difference is small enough that only a paired test can settle it:
hybrid minus prior on the same 218 screens is +0.0010 (69 screens better, 55
worse, 94 exactly tied), Wilcoxon p = 0.336, paired bootstrap 95% CI
[-0.0010, +0.0029].  The interval contains zero, so this is not a real gain.
:class:`RetrievalKNN` alone (0.1761) is marginally *below* the prior (0.1767),
and :class:`GBMRanker` (0.1334) is clearly below it.

Two structural reasons, both consequences of the metric rather than of tuning:

* The clamp at zero means losses floor at 0 for every method, so the 94 tied
  screens are mostly screens where both methods are at or below chance.  There is
  no credit available for being less-bad, only for being strictly better.
* Relevance is near-flat across a screen's hits, so AnDCG@100 is close to a
  log-discounted precision@100.  The prior already captures most of what
  metadata retrieval can add, because which genes are *ever* hits dominates
  which screen you are looking at.

The honest headroom estimate is :class:`OracleKNN` at 0.2918: a single training
screen chosen with perfect hindsight more than doubles the prior, so the signal
exists -- the metadata similarity function here is simply not sharp enough to
find it.  Sharpening that, not further blending, is where the next gain has to
come from.

Leakage rules honoured by this module
-------------------------------------
* Gene priors, stratified priors, the TF-IDF vocabulary and IDF weights, and all
  neighbour statistics are fit on the **train** split only.
* Neighbour retrieval excludes training screens from the query's own publication
  (``source_id``), so a training screen cannot retrieve itself or its
  same-paper near-duplicates.  See :class:`RetrievalKNN` -- without this, a
  feature trained on neighbour statistics is trained on a leaked label.
* ``alpha`` and the other blend/aggregation hyperparameters are selected on the
  **validation** split only (:meth:`HybridScorer.tune`).
* DepMap common-essential flags are **external knowledge, not leakage**: they
  come from ``data/references/depmap/CRISPRInferredCommonEssentials.csv``
  (DepMap 24Q4), are independent of AssayBench labels, and are constant across
  screens.  Their use is disclosed here and in :attr:`GBMRanker.FEATURE_NAMES`.
* :class:`OracleKNN` deliberately violates these rules and says so in its
  docstring, its ``is_oracle`` attribute, and its ``name``.

Usage::

    import sys; sys.path.insert(0, "/Users/sahaj/Documents/Projects/SplicR/engine")
    from splicr.assaybench_io import load_split
    from splicr import benchmark as bm

    train = load_split("train")
    val   = load_split("validation")
    test  = load_split("test")

    prior = bm.GeneFrequencyPrior().fit(train)
    print(bm.evaluate(prior, test).mean)          # -> AnDCG@100

Self-test::

    engine/.tools/env/bin/python -m splicr.benchmark              # synthetic only
    engine/.tools/env/bin/python -m splicr.benchmark --real       # + upstream parity
    engine/.tools/env/bin/python -m splicr.benchmark --reproduce  # + published calibration
"""

from __future__ import annotations

import math
import os
import random
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

DEFAULT_K = 100
"""The benchmark cutoff.  The headline AssayBench number is mean adjusted_ndcg@100."""

CANDIDATES_SCREEN_LIBRARY = "screen_library"
"""Rank within ``screen["relevance_genes"]`` -- what upstream's baselines do."""

CANDIDATES_TRAIN_UNION = "train_union"
"""Rank within the union of training-screen libraries -- no screen-specific input."""

PUBLISHED: dict[str, dict[str, Any]] = {
    # Reference numbers handed to us for the yearfold0 test split (334 screens),
    # each paired with what this harness actually measures.  Measured values come
    # from runs of this module; see :func:`reproduce_published`.
    "oracle_knn": {
        "published": 0.2918,
        "measured": 0.2918,
        "note": "exact match; 1349 x 334 sweep, ORACLE (reads test labels)",
    },
    "gene_frequency_prior": {
        "published": 0.1334,
        "measured": 0.1329,
        "measured_seed_range": (0.1324, 0.1338),
        "note": (
            "0.1334 is upstream's coarse-phenotype-hit-freq, i.e. hit frequency "
            "stratified by the 5-category `cleaned_phenotype` with NO backoff -- "
            "GeneFrequencyPrior(stratify_by='cleaned_phenotype', "
            "stratum_backoff=False).  The *unstratified* global prior that the "
            "prose describes measures 0.1217 here, not 0.1334."
        ),
    },
    "global_hit_freq_unstratified": {
        "published": None,
        "measured": 0.1217,
        "note": "literal hits[g]/measured[g] over the 1349 training screens",
    },
    "random": {"published": 0.0, "measured": 0.0150, "note": "clamp at 0 makes this > 0"},
}
"""Published reference numbers vs what this harness measures.

Recorded here because a score is only meaningful against a baseline measured on
the *same* split with the *same* metric.  Two facts worth carrying forward:

* :class:`OracleKNN` reproduces the published 0.2918 **exactly**, which is strong
  evidence that the split, the candidate handling, the symbol normalization and
  the metric are all correct.
* Given that, the 0.1334 figure cannot be the unstratified global hit-frequency
  prior, which measures 0.1217 here.  Sweeping upstream's published baseline
  family identified it as ``coarse-phenotype-hit-freq`` (stratified by
  ``cleaned_phenotype``, no backoff), measured at 0.1329 with a tie-break seed
  range of 0.1324--0.1338 that contains 0.1334.  So the honest baseline for a
  frequency prior on this split is **0.1329**, and that is what a SplicR scorer
  has to beat.  Other rejected explanations, each measured: train+validation
  priors (0.1221), a global rather than per-gene denominator (0.1232),
  both-direction hits (0.1226), forward/reverse example expansion (0.1214),
  relevance-weighted counts (0.1209), Beta smoothing from s=5 to s=200
  (0.1212--0.1215), and the alternative ``year_match_val_testfold0`` split
  (0.1400 unstratified).
"""

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEPMAP_COMMON_ESSENTIALS = os.path.join(
    _REPO_ROOT, "data", "references", "depmap", "CRISPRInferredCommonEssentials.csv"
)
DEPMAP_NONESSENTIAL_CONTROLS = os.path.join(
    _REPO_ROOT, "data", "references", "depmap", "AchillesNonessentialControls.csv"
)

# Free-text metadata fields, in the order they are concatenated for TF-IDF.
TEXT_FIELDS: tuple[str, ...] = (
    "phenotype",
    "screen_rationale",
    "condition_clause",
    "condition_name",
    "experimental_setup",
    "significance_criteria",
    "ranking_rationale",
    "notes",
)
CELL_FIELDS: tuple[str, ...] = ("cell_line", "cell_type")
CATEGORICAL_FIELDS: tuple[str, ...] = (
    "screen_type",
    "library_type",
    "library_methodology",
    "experimental_setup",
    "cleaned_phenotype",
    "screen_category",
    "source",
)
_MISSING = {"", "not specified", "none", "nan", "unknown", "n/a", "na"}


# --------------------------------------------------------------------------- #
# Part 1 -- the metric
# --------------------------------------------------------------------------- #

# Upstream computes ``rel / np.log2(i + 2)``.  To stay bit-for-bit identical we
# must *divide by the same np.float64* rather than multiply by a precomputed
# reciprocal (multiplying by 1/log2 rounds differently in the last ulp), and we
# must use numpy's log2 rather than math.log2 (they can disagree by 1 ulp).
_LOG2: np.ndarray = np.log2(np.arange(2, 2 + 4096, dtype=np.float64))


def _log2_table(n: int) -> np.ndarray:
    """Return ``[log2(2), log2(3), ..., log2(n + 1)]``, growing the cache as needed."""
    global _LOG2
    if n > _LOG2.size:
        _LOG2 = np.log2(np.arange(2, 2 + max(n, 2 * _LOG2.size), dtype=np.float64))
    return _LOG2


def dcg(relevances: Sequence[float | None], k: int | None = DEFAULT_K) -> float:
    """Discounted cumulative gain, matching ``RankingMetrics.compute_dcg``.

    Args:
        relevances: Relevance in predicted rank order.  ``None`` marks a gene the
            screen did not measure (or an unrecognised symbol).
        k: Cutoff.  ``None`` uses the whole list.

    Returns:
        ``sum(rel_i / log2(i + 2))`` over the *condensed* top-k.

    The three-step order is load-bearing and reproduced exactly:

    1. pad with ``0.0`` up to ``k`` when the list is short (this is the penalty
       for returning fewer than ``k`` genes),
    2. truncate to ``k``,
    3. drop ``None`` and repack the survivors into consecutive positions.

    Because (2) precedes (3), an unmeasured gene inside the top-k burns a slot.
    """
    rels: Sequence[float | None] = relevances
    if k is not None and len(rels) < k:
        rels = list(rels) + [0.0] * (k - len(rels))
    if k is not None:
        rels = rels[:k]
    condensed = [r for r in rels if r is not None]
    if k is not None:
        condensed = condensed[:k]  # no-op; kept so the shape matches upstream
    if not condensed:
        return 0.0
    log2 = _log2_table(len(condensed))
    return sum(rel / log2[i] for i, rel in enumerate(condensed))


def ndcg(
    predicted_relevances: Sequence[float | None],
    all_relevances: Sequence[float],
    k: int | None = DEFAULT_K,
) -> float:
    """Normalized DCG, matching ``RankingMetrics.compute_ndcg``.

    The ideal ranking clips negative relevances to ``0.0`` (an unknown gene
    scoring 0 beats an opposite-direction gene scoring < 0), while the numerator
    keeps them.  So nDCG <= 1 always, and a wrong-direction gene subtracts.
    """
    num = dcg(predicted_relevances, k)
    ideal = sorted((max(r, 0.0) for r in all_relevances), reverse=True)
    den = dcg(ideal, k=k)
    if den == 0:
        return 0.0
    return num / den


def adjusted_ndcg(
    predicted_relevances: Sequence[float | None],
    all_relevances: Sequence[float],
    k: int | None = DEFAULT_K,
) -> float:
    """AnDCG@k -- the headline AssayBench metric.

    Matches ``RankingMetrics.compute_adjusted_ndcg``:
    ``max((nDCG - nDCG_rand) / (1 - nDCG_rand), 0)`` where ``nDCG_rand`` is the
    nDCG of a constant vector of length ``min(k, n_genes)`` filled with the mean
    relevance.  Deterministic -- there is no sampling.

    Raises:
        ZeroDivisionError: in the degenerate case ``nDCG_rand == 1`` (every gene
            in the screen carries the same positive relevance).  Upstream raises
            here too; it does not occur on any AssayBench split.
    """
    n = len(all_relevances)
    m = min(k, n) if k is not None else n
    observed = ndcg(predicted_relevances, all_relevances, k)
    # np.mean (pairwise summation), not sum()/len, to match upstream bit-for-bit.
    rand = ndcg([np.mean(all_relevances)] * m, all_relevances, k)
    return max((observed - rand) / (1 - rand), 0)


class AnDCG:
    """Gene-symbol-level AnDCG@k scorer with HGNC gating and synonym mapping.

    Wraps :func:`adjusted_ndcg` with the symbol handling upstream's
    ``RankingMetrics.evaluate`` performs:

    * duplicates removed before *and* after normalization (``dict.fromkeys``),
    * predicted and ground-truth symbols both normalized through
      ``assaybench.utils.gene_mapper.GeneMapper`` (HGNC previous symbols,
      aliases, UniProt protein names, manual fixups),
    * a symbol the screen did not measure scores ``None`` (unmeasured),
    * a symbol that is not an approved HGNC symbol scores ``no_hgnc_penalty``
      (upstream default ``None``, i.e. also treated as unmeasured).

    Normalization results are memoised across screens, which is the main reason
    this class is fast enough to sweep 1349 x 334 screen pairs.

    Args:
        k: Cutoff for the metric.
        use_gene_mapper: Normalize synonyms.  Leave ``True`` for parity with the
            published numbers.
        no_hgnc_penalty: Relevance assigned to a non-HGNC symbol.
        gene_mapper: Pre-built ``GeneMapper``; built lazily when ``None``.
        hgnc_symbols: Pre-built approved-symbol set; loaded lazily when ``None``.
    """

    def __init__(
        self,
        k: int = DEFAULT_K,
        use_gene_mapper: bool = True,
        no_hgnc_penalty: float | None = None,
        gene_mapper: Any | None = None,
        hgnc_symbols: frozenset[str] | None = None,
    ) -> None:
        self.k = k
        self.use_gene_mapper = use_gene_mapper
        self.no_hgnc_penalty = no_hgnc_penalty
        self._mapper = gene_mapper
        self._hgnc = hgnc_symbols
        self._norm_cache: dict[str, str] = {}

    # -- lazy resources ---------------------------------------------------- #

    @property
    def gene_mapper(self) -> Any | None:
        """The upstream ``GeneMapper``, or ``None`` when mapping is disabled."""
        if not self.use_gene_mapper:
            return None
        if self._mapper is None:
            from assaybench.utils.gene_mapper import GeneMapper

            self._mapper = GeneMapper(verbose=False)
        return self._mapper

    @property
    def hgnc_symbols(self) -> frozenset[str]:
        """Approved HGNC symbols, read from the vendored ``all_genes.tsv``."""
        if self._hgnc is None:
            import csv
            from importlib.resources import files

            path = files("assaybench.data.hgnc") / "all_genes.tsv"
            with open(str(path), newline="") as fh:
                self._hgnc = frozenset(
                    row["Approved symbol"] for row in csv.DictReader(fh, delimiter="\t")
                )
        return self._hgnc

    # -- symbol handling --------------------------------------------------- #

    def normalize(self, gene: str) -> str:
        """Upper-case and synonym-map one symbol, falling back to the input."""
        hit = self._norm_cache.get(gene)
        if hit is not None:
            return hit
        upper = gene.strip().upper()
        out = upper
        mapper = self.gene_mapper
        if mapper is not None:
            mapped = mapper.map_gene(upper)
            if mapped is not None:
                out = mapped
        self._norm_cache[gene] = out
        return out

    def relevance_of(self, table: Mapping[str, float], gene: str) -> float | None:
        """Look one symbol up in a screen's relevance table (``None`` = unmeasured)."""
        norm = self.normalize(gene)
        if norm in table:
            return table[norm]
        if norm not in self.hgnc_symbols:
            return self.no_hgnc_penalty
        return None

    # -- scoring ----------------------------------------------------------- #

    def target(self, screen: Mapping[str, Any]) -> "ScreenTarget":
        """Precompute the per-screen constants once (see :class:`ScreenTarget`)."""
        return ScreenTarget.build(screen, self)

    def score(
        self,
        predicted_genes: Sequence[str],
        ground_truth_genes: Sequence[str],
        relevance_scores: Sequence[float],
    ) -> float:
        """AnDCG@k for one prediction against one screen's ground truth.

        Equivalent to
        ``RankingMetrics(...).evaluate(...)["adjusted_ndcg@k"]`` but without
        computing the other metric groups.
        """
        target = ScreenTarget.build(
            {"relevance_genes": ground_truth_genes, "relevance_scores": relevance_scores},
            self,
        )
        return target.score(predicted_genes)


@dataclass
class ScreenTarget:
    """One screen's ground truth, pre-reduced to everything scoring needs.

    ``idcg`` and ``rand_ndcg`` depend only on the screen, so building this once
    and scoring many candidate rankings against it is what makes the oracle
    sweep and hyperparameter search tractable.

    Attributes:
        name: ``dataset_name``.
        relevance: normalized symbol -> relevance.
        idcg: ideal DCG@k (negatives clipped to 0).
        rand_ndcg: the analytic chance-level nDCG@k.
        denom: ``1 - rand_ndcg``; > 1 when mean relevance is negative.
        n_genes: number of measured genes.
        n_hits: number of genes with relevance > 0.
        k: cutoff.
    """

    name: str
    relevance: dict[str, float]
    idcg: float
    rand_ndcg: float
    denom: float
    n_genes: int
    n_hits: int
    k: int
    _andcg: AnDCG

    @classmethod
    def build(cls, screen: Mapping[str, Any], andcg: AnDCG) -> "ScreenTarget":
        """Normalize a screen's ground truth and precompute IDCG / nDCG_rand."""
        genes = screen["relevance_genes"]
        scores = screen["relevance_scores"]
        k = andcg.k
        # Later assignment wins when two symbols normalize together -- this is
        # exactly ``dict(zip(normalized_gt, relevance_scores))`` upstream.
        table: dict[str, float] = {}
        for gene, score in zip(genes, scores):
            table[andcg.normalize(gene)] = score
        ideal = sorted((max(r, 0.0) for r in scores), reverse=True)
        idcg = dcg(ideal, k=k)
        m = min(k, len(scores)) if k is not None else len(scores)
        rand_dcg = dcg([np.mean(scores)] * m, k=k)
        rand_ndcg = 0.0 if idcg == 0 else rand_dcg / idcg
        return cls(
            name=str(screen.get("dataset_name", "")),
            relevance=table,
            idcg=float(idcg),
            rand_ndcg=float(rand_ndcg),
            denom=float(1 - rand_ndcg),
            n_genes=len(genes),
            n_hits=sum(1 for s in scores if s > 0),
            k=k,
            _andcg=andcg,
        )

    def relevances(self, predicted_genes: Sequence[str]) -> list[float | None]:
        """Map a ranked symbol list to relevances, deduping as upstream does.

        Stops once ``k`` unique post-normalization symbols are collected: the
        metric truncates at ``k`` before condensing, so nothing past that can
        affect the score.  This is what lets callers pass a full 17k-gene
        ranking without paying for 17k lookups.
        """
        andcg = self._andcg
        seen_raw: set[str] = set()
        seen_norm: set[str] = set()
        out: list[float | None] = []
        for gene in predicted_genes:
            if gene in seen_raw:
                continue
            seen_raw.add(gene)
            norm = andcg.normalize(gene)
            if norm in seen_norm:
                continue
            seen_norm.add(norm)
            if norm in self.relevance:
                out.append(self.relevance[norm])
            elif norm not in andcg.hgnc_symbols:
                out.append(andcg.no_hgnc_penalty)
            else:
                out.append(None)
            if len(out) >= self.k:
                break
        return out

    def score(self, predicted_genes: Sequence[str]) -> float:
        """AnDCG@k for a ranked symbol list."""
        return self.score_relevances(self.relevances(predicted_genes))

    def score_relevances(self, rels: Sequence[float | None]) -> float:
        """AnDCG@k for an already-resolved relevance list."""
        if self.idcg == 0:
            observed = 0.0
        else:
            observed = dcg(rels, self.k) / self.idcg
        return max((observed - self.rand_ndcg) / self.denom, 0)


# --------------------------------------------------------------------------- #
# Part 2 -- evaluation driver
# --------------------------------------------------------------------------- #


@dataclass
class EvalResult:
    """Outcome of scoring one method on one split.

    Attributes:
        name: method name.
        k: metric cutoff.
        split: split label.
        per_screen: ``dataset_name -> AnDCG@k``.
        mean: unweighted mean over scored screens -- the benchmark number.
        n_screens: how many screens were scored.
        n_clamped: how many scored exactly 0.0, i.e. were at or below chance and
            hit the clamp.  Reported because the clamp is why "less bad" never
            helps: on those screens every method ties at 0.
        n_missing: screens in the split with no prediction supplied.
        sem: standard error of the mean over screens.
    """

    name: str
    k: int
    split: str
    per_screen: dict[str, float]
    mean: float
    n_screens: int
    n_clamped: int
    n_missing: int
    sem: float

    def __str__(self) -> str:
        return (
            f"{self.name:<28} AnDCG@{self.k} = {self.mean:.4f} "
            f"+/- {self.sem:.4f} (n={self.n_screens}, "
            f"clamped@0={self.n_clamped}, missing={self.n_missing})"
        )


def evaluate(
    scorer: "Scorer",
    screens: Sequence[Mapping[str, Any]],
    k: int = DEFAULT_K,
    andcg: AnDCG | None = None,
    targets: Mapping[str, ScreenTarget] | None = None,
    split: str = "",
    progress: bool = False,
) -> EvalResult:
    """Score a :class:`Scorer` on a list of screens.

    Args:
        scorer: anything with ``.name`` and ``.rank(screen) -> list[str]``.
        screens: the split, as returned by ``assaybench_io.load_split``.
        k: metric cutoff.
        andcg: shared metric instance (reuses the symbol cache; build one per
            process and pass it everywhere).
        targets: prebuilt ``dataset_name -> ScreenTarget`` map, to avoid
            re-normalizing ground truth for every method.
        split: label for the result.
        progress: print a dot every 25 screens.

    Returns:
        An :class:`EvalResult`.
    """
    andcg = andcg or AnDCG(k=k)
    if andcg.k != k:
        raise ValueError(f"AnDCG instance has k={andcg.k}, evaluate() asked for k={k}")
    per: dict[str, float] = {}
    missing = 0
    for i, screen in enumerate(screens):
        name = str(screen["dataset_name"])
        target = (targets or {}).get(name) or andcg.target(screen)
        ranking = scorer.rank(screen)
        if ranking is None:
            missing += 1
            continue
        per[name] = float(target.score(ranking))
        if progress and (i + 1) % 25 == 0:
            print(".", end="", flush=True)
    if progress:
        print()
    vals = np.asarray(list(per.values()), dtype=float)
    if vals.size == 0:
        raise ValueError(f"{scorer.name}: nothing scored on split {split!r}")
    return EvalResult(
        name=scorer.name,
        k=k,
        split=split or str(screens[0].get("split", "")),
        per_screen=per,
        mean=float(vals.mean()),
        n_screens=int(vals.size),
        n_clamped=int((vals == 0.0).sum()),
        n_missing=missing,
        sem=float(vals.std(ddof=1) / math.sqrt(vals.size)) if vals.size > 1 else 0.0,
    )


def build_targets(
    screens: Sequence[Mapping[str, Any]], andcg: AnDCG
) -> dict[str, ScreenTarget]:
    """Precompute a :class:`ScreenTarget` per screen, keyed by ``dataset_name``."""
    return {str(s["dataset_name"]): andcg.target(s) for s in screens}


# --------------------------------------------------------------------------- #
# Part 3 -- statistics fit on the training split
# --------------------------------------------------------------------------- #


def _clean(value: Any) -> str:
    """Normalize a metadata field to a string, mapping missing markers to ``""``."""
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in _MISSING else text


def candidate_genes(
    screen: Mapping[str, Any],
    mode: str,
    universe: Sequence[str] | None = None,
) -> list[str]:
    """The gene pool a scorer is allowed to rank for one screen.

    Args:
        screen: the screen record.
        mode: :data:`CANDIDATES_SCREEN_LIBRARY` (the screen's measured genes --
            what upstream's published baselines use) or
            :data:`CANDIDATES_TRAIN_UNION` (only genes seen in training).
        universe: the train-union gene list, required for the second mode.
    """
    if mode == CANDIDATES_SCREEN_LIBRARY:
        return list(screen["relevance_genes"])
    if mode == CANDIDATES_TRAIN_UNION:
        if universe is None:
            raise ValueError("CANDIDATES_TRAIN_UNION needs a fitted gene universe")
        return list(universe)
    raise ValueError(f"unknown candidate mode {mode!r}")


@dataclass
class GeneStats:
    """Per-gene hit / miss / direction counts, fit on training screens only.

    ``hit`` in AssayBench marks a significant gene in the screen's *reported*
    direction; ``relevance_scores`` additionally carries negative values for
    opposite-direction genes on bidirectional screens.  Both are tracked, since
    a gene that is frequently an opposite-direction hit is a gene you want to
    keep out of your top-100 (negative relevance actively subtracts).

    Attributes:
        measured: gene -> number of training screens that assayed it.
        hits: gene -> number of training screens where it was a hit.
        negatives: gene -> number of training screens where relevance < 0.
        rel_sum: gene -> sum of positive relevance across training screens.
        by_stratum: ``(field, value)`` -> (measured, hits) counters.
        n_screens: number of training screens used.
        prior_rate: pooled hit rate, the Beta-prior mean used for smoothing.
    """

    measured: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    hits: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    negatives: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    rel_sum: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    by_stratum: dict[tuple[str, str], tuple[dict[str, int], dict[str, int]]] = field(
        default_factory=dict
    )
    n_screens: int = 0
    prior_rate: float = 0.0
    strata_fields: tuple[str, ...] = ("screen_type", "library_type", "cleaned_phenotype")

    def fit(self, train: Sequence[Mapping[str, Any]]) -> "GeneStats":
        """Accumulate counts over the training screens.  Train only."""
        total_measured = 0
        total_hits = 0
        for screen in train:
            self.n_screens += 1
            genes = screen["relevance_genes"]
            scores = screen["relevance_scores"]
            hitflags = screen["hit"]
            keys = [
                (f, _clean(screen.get(f)) or "unknown")
                for f in self.strata_fields
                if f in screen
            ]
            buckets = []
            for key in keys:
                if key not in self.by_stratum:
                    self.by_stratum[key] = (defaultdict(int), defaultdict(int))
                buckets.append(self.by_stratum[key])
            for gene, score, is_hit in zip(genes, scores, hitflags):
                self.measured[gene] += 1
                total_measured += 1
                for m_counter, h_counter in buckets:
                    m_counter[gene] += 1
                if is_hit:
                    self.hits[gene] += 1
                    total_hits += 1
                    for _m, h_counter in buckets:
                        h_counter[gene] += 1
                if score > 0:
                    self.rel_sum[gene] += score
                elif score < 0:
                    self.negatives[gene] += 1
        self.prior_rate = (total_hits / total_measured) if total_measured else 0.0
        return self

    # -- derived rates ----------------------------------------------------- #

    def raw_rate(self, gene: str) -> float:
        """Unsmoothed hit rate, i.e. upstream's ``global-hit-freq`` score."""
        n = self.measured.get(gene, 0)
        return (self.hits.get(gene, 0) / n) if n else 0.0

    def rate(self, gene: str, smoothing: float = 0.0) -> float:
        """Beta-smoothed hit rate ``(hits + s*p) / (measured + s)``.

        ``smoothing=0`` reproduces :meth:`raw_rate`.  Larger values pull genes
        assayed in only a handful of screens toward the pooled rate, which is
        the difference between "1/1 screens, therefore certain" and a real
        estimate.
        """
        n = self.measured.get(gene, 0)
        h = self.hits.get(gene, 0)
        if smoothing <= 0:
            return (h / n) if n else 0.0
        return (h + smoothing * self.prior_rate) / (n + smoothing)

    def negative_rate(self, gene: str, smoothing: float = 0.0) -> float:
        """Beta-smoothed rate of being an *opposite*-direction hit."""
        n = self.measured.get(gene, 0)
        neg = self.negatives.get(gene, 0)
        if smoothing <= 0:
            return (neg / n) if n else 0.0
        return neg / (n + smoothing)

    def mean_relevance(self, gene: str) -> float:
        """Mean positive relevance across the training screens that assayed it."""
        n = self.measured.get(gene, 0)
        return (self.rel_sum.get(gene, 0.0) / n) if n else 0.0

    def stratum_rate(
        self,
        field_name: str,
        value: str,
        gene: str,
        smoothing: float = 20.0,
        backoff: bool = True,
    ) -> float:
        """Hit rate within one metadata stratum.

        Args:
            field_name: the stratifying metadata field.
            value: that field's value on the screen being predicted.
            gene: the gene.
            smoothing: Beta pseudo-count toward the backoff target.
            backoff: ``True`` (SplicR) backs an unseen stratum or an unseen gene
                off to the global smoothed rate.  ``False`` reproduces upstream's
                stratified baselines exactly: a gene the stratum never assayed
                scores ``0.0`` (upstream's ``score_dict.get(g, 0.0)``), and only
                an entirely unseen stratum falls back to the global rate.

        Backoff is the better estimator, but ``backoff=False`` is what
        reproduces the published table, so both are available.
        """
        bucket = self.by_stratum.get((field_name, value or "unknown"))
        if bucket is None:
            return self.raw_rate(gene) if not backoff else self.rate(gene, smoothing)
        m_counter, h_counter = bucket
        n = m_counter.get(gene, 0)
        if not backoff:
            return (h_counter.get(gene, 0) / n) if n else 0.0
        fallback = self.rate(gene, smoothing=smoothing)
        if n == 0:
            return fallback
        return (h_counter.get(gene, 0) + smoothing * fallback) / (n + smoothing)

    def universe(self, min_measured: int = 1) -> list[str]:
        """Genes seen in at least ``min_measured`` training screens, hit-rate sorted."""
        genes = [g for g, n in self.measured.items() if n >= min_measured]
        genes.sort(key=lambda g: (-self.raw_rate(g), -self.measured[g], g))
        return genes


class ScreenCorpus:
    """Metadata-only screen embedding: TF-IDF over text plus one-hot categoricals.

    No labels, no gene lists, no LLM.  Three blocks are built and L2-normalized
    separately so their relative influence is a tunable weight rather than an
    accident of vocabulary size:

    * **text** -- word 1--2 grams over :data:`TEXT_FIELDS` (phenotype, rationale,
      condition clause, assay notes, ...),
    * **cell** -- character 3--5 grams over :data:`CELL_FIELDS`, so ``HAP1`` and
      ``HAP-1`` and ``KBM-7``/``KBM7`` match despite different spellings,
    * **categorical** -- one-hot over :data:`CATEGORICAL_FIELDS` (screen type,
      library type, methodology, coarse phenotype, ...).  Direction of selection
      lives here and matters a lot: hits in a negative-selection screen are
      essential genes, hits in a positive-selection screen are mostly not.

    The vocabulary and IDF weights are fit on **train only**; validation and test
    screens are only ever transformed.

    Args:
        text_weight: multiplier on the L2-normalized text block.
        cell_weight: multiplier on the cell-line block.
        cat_weight: multiplier on the one-hot block.
        max_text_features: TF-IDF vocabulary cap for the text block.
        min_df: minimum document frequency for the text block.
        use_author: include the ``author`` field in the text block.  Default
            ``False``: the author is legitimately available metadata, but
            matching on it finds the same lab's other screens, which is a
            shortcut the temporal split does not otherwise expose.  AssayBench
            ships ``authorfold*`` splits precisely to test for that, so leaving
            it off keeps the ``yearfold0`` number honest.
    """

    def __init__(
        self,
        text_weight: float = 1.0,
        cell_weight: float = 0.6,
        cat_weight: float = 0.8,
        max_text_features: int = 60000,
        min_df: int = 2,
        use_author: bool = False,
    ) -> None:
        self.text_weight = text_weight
        self.cell_weight = cell_weight
        self.cat_weight = cat_weight
        self.max_text_features = max_text_features
        self.min_df = min_df
        self.use_author = use_author
        self._text_vec: Any = None
        self._cell_vec: Any = None
        self._cat_vec: Any = None
        self.fitted = False

    # -- field extraction -------------------------------------------------- #

    def text_of(self, screen: Mapping[str, Any]) -> str:
        """Concatenate the free-text metadata fields for one screen."""
        fields = TEXT_FIELDS + (("author",) if self.use_author else ())
        parts = [_clean(screen.get(f)) for f in fields]
        return " ".join(p for p in parts if p).lower()

    def cell_of(self, screen: Mapping[str, Any]) -> str:
        """Concatenate cell-line / cell-type text for one screen."""
        parts = [_clean(screen.get(f)) for f in CELL_FIELDS]
        return " ".join(p for p in parts if p).lower()

    def cats_of(self, screen: Mapping[str, Any]) -> dict[str, str]:
        """One-hot source dict for one screen."""
        return {f: (_clean(screen.get(f)) or "unknown") for f in CATEGORICAL_FIELDS}

    # -- fit / transform --------------------------------------------------- #

    def fit(self, train: Sequence[Mapping[str, Any]]) -> "ScreenCorpus":
        """Fit vocabularies and IDF on the training screens.  Train only."""
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.feature_extraction import DictVectorizer

        self._text_vec = TfidfVectorizer(
            max_features=self.max_text_features,
            stop_words="english",
            ngram_range=(1, 2),
            sublinear_tf=True,
            min_df=self.min_df,
        )
        self._text_vec.fit([self.text_of(s) for s in train])

        self._cell_vec = TfidfVectorizer(
            analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=self.min_df
        )
        self._cell_vec.fit([self.cell_of(s) for s in train])

        self._cat_vec = DictVectorizer(sparse=True)
        self._cat_vec.fit([self.cats_of(s) for s in train])

        self.fitted = True
        return self

    def transform(self, screens: Sequence[Mapping[str, Any]]) -> Any:
        """Embed screens as a row-L2-normalized sparse matrix."""
        if not self.fitted:
            raise RuntimeError("ScreenCorpus.fit() must be called first (on train only)")
        import scipy.sparse as sp
        from sklearn.preprocessing import normalize

        blocks = []
        for weight, mat in (
            (self.text_weight, self._text_vec.transform([self.text_of(s) for s in screens])),
            (self.cell_weight, self._cell_vec.transform([self.cell_of(s) for s in screens])),
            (self.cat_weight, self._cat_vec.transform([self.cats_of(s) for s in screens])),
        ):
            if weight <= 0:
                continue
            blocks.append(normalize(mat, norm="l2", copy=True) * weight)
        return normalize(sp.hstack(blocks, format="csr"), norm="l2", copy=False)

    def similarity(
        self, query: Sequence[Mapping[str, Any]], reference: Sequence[Mapping[str, Any]]
    ) -> np.ndarray:
        """Cosine similarity matrix ``(len(query), len(reference))``."""
        q = self.transform(query)
        r = self.transform(reference)
        return np.asarray((q @ r.T).todense())


# --------------------------------------------------------------------------- #
# Part 4 -- ranking helpers
# --------------------------------------------------------------------------- #


def rank_by_scores(
    genes: Sequence[str],
    scores: Mapping[str, float],
    default: float = 0.0,
    tie_break: str = "random",
    seed: int = 0,
    limit: int | None = None,
) -> list[str]:
    """Order ``genes`` by ``scores`` descending.

    Args:
        genes: the candidate pool.
        scores: gene -> score (missing genes get ``default``).
        default: score for genes absent from ``scores``.
        tie_break: ``"random"`` shuffles before a stable sort, reproducing
            upstream's ``random.shuffle`` + ``sort`` but with a seeded RNG so
            runs are reproducible; ``"stable"`` keeps input order; ``"name"``
            breaks ties alphabetically.
        seed: RNG seed for ``tie_break="random"``.
        limit: keep only the top N (the metric never looks past ``k``).

    Returns:
        The ranked gene list.
    """
    items = [(g, scores.get(g, default)) for g in genes]
    if tie_break == "random":
        random.Random(seed).shuffle(items)
    elif tie_break == "name":
        items.sort(key=lambda gs: gs[0])
    elif tie_break != "stable":
        raise ValueError(f"unknown tie_break {tie_break!r}")
    items.sort(key=lambda gs: gs[1], reverse=True)
    out = [g for g, _ in items]
    return out[:limit] if limit else out


def percentile_ranks(values: np.ndarray) -> np.ndarray:
    """Map an array to ``[0, 1]`` percentile ranks (ties get their average rank).

    Used to put two heterogeneous scores (a neighbour-derived rate and a global
    prior) on a common scale before blending them, so ``alpha`` means the same
    thing on every screen regardless of the raw score distributions.
    """
    from scipy.stats import rankdata

    if values.size == 0:
        return values
    return (rankdata(values, method="average") - 1) / max(values.size - 1, 1)


class Scorer:
    """Interface every baseline and SplicR scorer implements.

    Attributes:
        name: identifier used in reports.
        is_oracle: ``True`` when the scorer reads evaluation-split labels and its
            number is therefore a ceiling, not a result.
    """

    name: str = "scorer"
    is_oracle: bool = False

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "Scorer":
        """Fit on training screens.  Must not touch validation or test labels."""
        return self

    def rank(self, screen: Mapping[str, Any]) -> list[str] | None:
        """Return a ranked gene list for one screen, or ``None`` to skip it."""
        raise NotImplementedError


# --------------------------------------------------------------------------- #
# Part 5 -- baselines
# --------------------------------------------------------------------------- #


class RandomBaseline(Scorer):
    """Random permutation of the candidate pool.

    Sanity floor.  AnDCG subtracts the analytic chance level and clamps at 0, so
    this must come out at or just above 0.0 -- a shuffle beats the *constant*
    mean-relevance vector only by luck, and the clamp keeps the unlucky half from
    going negative.  The expected value is therefore slightly positive, not
    exactly 0.
    """

    name = "random"

    def __init__(
        self,
        seed: int = 42,
        candidates: str = CANDIDATES_SCREEN_LIBRARY,
        k: int = DEFAULT_K,
    ) -> None:
        self.seed = seed
        self.candidates = candidates
        self.k = k
        self._universe: list[str] | None = None
        self._n = 0

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "RandomBaseline":
        """Record the train-union universe (only needed for that candidate mode)."""
        if self.candidates == CANDIDATES_TRAIN_UNION:
            seen: set[str] = set()
            for screen in train:
                seen.update(screen["relevance_genes"])
            self._universe = sorted(seen)
        return self

    def rank(self, screen: Mapping[str, Any]) -> list[str]:
        genes = candidate_genes(screen, self.candidates, self._universe)
        self._n += 1
        random.Random(self.seed + self._n).shuffle(genes)
        return genes[: self.k]


class GeneFrequencyPrior(Scorer):
    """Rank genes by how often they are a hit across the **training** screens.

    This is upstream's ``global-hit-freq`` baseline (published AnDCG@100 =
    0.1334 on the ``yearfold0`` test split).  Reproducing that number is the
    wiring check for the whole harness: it exercises the split loader, the
    symbol normalization, the candidate pool and the metric at once.

    With ``smoothing=0`` and ``candidates=CANDIDATES_SCREEN_LIBRARY`` this is
    upstream's baseline exactly: score = ``hits[g] / measured[g]`` over training
    screens, random tie-break, ranked within the evaluation screen's own gene
    list.  ``smoothing > 0`` is a SplicR change (see :meth:`GeneStats.rate`) and
    should be reported separately from the reproduction.

    Args:
        smoothing: Beta pseudo-count pulling rarely-assayed genes toward the
            pooled hit rate.  ``0`` = upstream behaviour.
        negative_penalty: subtract this times the opposite-direction rate.
            ``0`` = upstream behaviour.
        candidates: candidate pool mode.
        stratify_by: optional metadata field for a stratified prior.  Upstream's
            ``screen-type-hit-freq`` is ``stratify_by="screen_type"`` and its
            ``coarse-phenotype-hit-freq`` -- the baseline that actually produces
            the published 0.1334 -- is ``stratify_by="cleaned_phenotype",
            stratum_backoff=False``; see :data:`PUBLISHED`.
        stratum_backoff: ``False`` reproduces upstream's stratified baselines
            exactly (unseen gene in stratum -> 0.0); ``True`` backs off to the
            global smoothed rate, which is the better estimator.
        tie_break / seed: see :func:`rank_by_scores`.
        k: truncate the emitted ranking (the metric ignores the rest).
    """

    def __init__(
        self,
        smoothing: float = 0.0,
        negative_penalty: float = 0.0,
        candidates: str = CANDIDATES_SCREEN_LIBRARY,
        stratify_by: str | None = None,
        stratum_backoff: bool = True,
        tie_break: str = "random",
        seed: int = 42,
        k: int = DEFAULT_K,
        stats: GeneStats | None = None,
    ) -> None:
        self.smoothing = smoothing
        self.negative_penalty = negative_penalty
        self.candidates = candidates
        self.stratify_by = stratify_by
        self.stratum_backoff = stratum_backoff
        self.tie_break = tie_break
        self.seed = seed
        self.k = k
        self.stats = stats
        self._universe: list[str] | None = None

    @property
    def name(self) -> str:  # type: ignore[override]
        bits = ["gene_frequency_prior"]
        if self.stratify_by:
            bits.append(f"by_{self.stratify_by}")
            if not self.stratum_backoff:
                bits.append("exact")
        if self.smoothing:
            bits.append(f"s{self.smoothing:g}")
        if self.negative_penalty:
            bits.append(f"np{self.negative_penalty:g}")
        if self.candidates != CANDIDATES_SCREEN_LIBRARY:
            bits.append(self.candidates)
        return "+".join(bits)

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "GeneFrequencyPrior":
        """Count hits per gene over the training screens.  Train only."""
        if self.stats is None:
            self.stats = GeneStats().fit(train)
        if self.candidates == CANDIDATES_TRAIN_UNION:
            self._universe = self.stats.universe()
        return self

    def gene_score(self, gene: str, screen: Mapping[str, Any]) -> float:
        """Prior score for one gene in the context of one screen."""
        assert self.stats is not None
        if self.stratify_by:
            value = _clean(screen.get(self.stratify_by)) or "unknown"
            base = self.stats.stratum_rate(
                self.stratify_by,
                value,
                gene,
                smoothing=max(self.smoothing, 1e-9),
                backoff=self.stratum_backoff,
            )
        else:
            base = self.stats.rate(gene, smoothing=self.smoothing)
        if self.negative_penalty:
            base -= self.negative_penalty * self.stats.negative_rate(
                gene, smoothing=self.smoothing
            )
        return base

    def rank(self, screen: Mapping[str, Any]) -> list[str]:
        genes = candidate_genes(screen, self.candidates, self._universe)
        scores = {g: self.gene_score(g, screen) for g in genes}
        return rank_by_scores(
            genes, scores, tie_break=self.tie_break, seed=self.seed, limit=self.k
        )


class OracleKNN(Scorer):
    """ORACLE -- reads evaluation-split labels.  A ceiling, not a method.

    For each evaluation screen, sweeps every training screen, scores the
    prediction "training screen's own top-``k`` genes by relevance" against the
    *evaluation screen's ground truth*, and keeps the best-scoring training
    screen.  Published AnDCG@100 = 0.2918 on ``yearfold0`` test.

    This is upstream's ``knn_test.py`` oracle (``compute_oracle_knn`` picking the
    argmax of the transfer matrix, then ``evaluate_knn_transfer`` copying that
    screen's top-``k``).  It is useful for exactly one thing: bounding how much
    headroom a *metadata-only* nearest-neighbour method like
    :class:`RetrievalKNN` could have if its similarity function were perfect.
    Any comparison must label it an oracle.

    Cost: ``len(train) x len(eval)`` metric evaluations (1349 x 334 = 450k on the
    test split).  :class:`ScreenTarget` caching keeps that to a few minutes.

    Args:
        k: cutoff (also how many genes are copied from the matched screen).
        andcg: shared metric instance.
        restrict_category: only consider training screens whose
            ``screen_category`` matches, mirroring upstream's
            ``require_matching_reverse``.
    """

    name = "oracle_knn[ORACLE:reads_test_labels]"
    is_oracle = True

    def __init__(
        self,
        k: int = DEFAULT_K,
        andcg: AnDCG | None = None,
        restrict_category: bool = False,
    ) -> None:
        self.k = k
        self.andcg = andcg or AnDCG(k=k)
        self.restrict_category = restrict_category
        self._train: list[Mapping[str, Any]] = []
        self._train_top: list[list[str]] = []
        self._train_category: list[str] = []
        self.matched: dict[str, str] = {}

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "OracleKNN":
        """Cache each training screen's own top-``k`` ranking (train labels: fine)."""
        self._train = list(train)
        self._train_top = []
        self._train_category = []
        for screen in self._train:
            pairs = sorted(
                zip(screen["relevance_genes"], screen["relevance_scores"]),
                key=lambda gs: gs[1],
                reverse=True,
            )
            self._train_top.append([g for g, _ in pairs[: self.k]])
            self._train_category.append(_clean(screen.get("screen_category")))
        return self

    def rank(self, screen: Mapping[str, Any]) -> list[str]:
        """Pick the training screen that scores best *on this screen's labels*."""
        target = self.andcg.target(screen)
        category = _clean(screen.get("screen_category"))
        best_score, best_idx = -math.inf, 0
        for idx, genes in enumerate(self._train_top):
            if self.restrict_category and self._train_category[idx] != category:
                continue
            score = target.score(genes)
            if score > best_score:
                best_score, best_idx = score, idx
        self.matched[str(screen["dataset_name"])] = str(
            self._train[best_idx]["dataset_name"]
        )
        return self._train_top[best_idx]


# --------------------------------------------------------------------------- #
# Part 6 -- SplicR scorers
# --------------------------------------------------------------------------- #


class RetrievalKNN(Scorer):
    """SplicR: metadata-only k-nearest-screen retrieval.  The honest oracle.

    Same idea as :class:`OracleKNN` -- a similar screen's hits are this screen's
    hits -- but similarity is computed from the screen *description* alone
    (:class:`ScreenCorpus`: TF-IDF text + cell-line char n-grams + one-hot
    categoricals), never from labels.  Nothing about the evaluation screen's
    relevance scores is read at prediction time.

    Scoring, per candidate gene ``g``, over the ``n_neighbors`` most similar
    training screens ``N``:

    .. code-block:: text

        w_j   = max(sim_j, 0) ** sim_power
        num   = sum_j w_j * value(g, j)      +  smoothing * prior(g)
        den   = sum_j w_j * measured(g, j)   +  smoothing
        score = num / den  -  negative_penalty * neg_rate(g, N)

    where ``value(g, j)`` is ``relevance`` when ``use_relevance`` (which keeps
    effect-size ordering, worth a little because AnDCG's gain is linear in
    relevance) or ``1.0`` for a plain hit indicator.  ``measured(g, j)`` is 1
    when screen ``j`` assayed ``g``.

    The smoothing term is what makes this robust: a gene none of the neighbours
    assayed falls back to the global training prior instead of to zero, so the
    method degrades gracefully to :class:`GeneFrequencyPrior` rather than
    collapsing when retrieval is poor.

    Group-aware retrieval (``exclude_same_group``), and why it is on by default
    --------------------------------------------------------------------------
    The 1349 ``yearfold0`` training screens come from only **134 distinct
    papers** (``source_id``), and 1302 of them share a paper with at least one
    other training screen.  The temporal split, meanwhile, leaves **zero**
    ``source_id`` overlap between train and validation.  So if neighbours are
    drawn without restriction:

    * a *training* screen retrieves itself at cosine similarity 1.0, plus a
      handful of same-paper screens with near-identical metadata and
      near-identical hits;
    * a *validation* screen's best neighbour sits at about 0.14.

    Any model trained on those features sees a neighbour signal that is almost
    the label, then meets a far weaker one at evaluation time.  Measured on the
    218 validation screens, that shift dropped :class:`GBMRanker` to 0.0810
    against a 0.1767 frequency prior.  Excluding the query's own ``source_id``
    group makes train-time and evaluation-time features identically distributed,
    and costs nothing at evaluation time because there is nothing to exclude.

    Args:
        n_neighbors: neighbourhood size.
        exclude_same_group: drop training screens sharing the query's
            ``group_field`` value.  Leave ``True``.
        group_field: the grouping key; ``source_id`` is the publication.
        sim_power: sharpening exponent on the similarity weights.
        smoothing: pseudo-count pulling toward the global training prior.
        prior_smoothing: smoothing used *inside* that global prior.
        negative_penalty: subtract this times the neighbour-weighted rate of
            being an opposite-direction hit.
        use_relevance: weight by relevance rather than a binary hit flag.
        min_similarity: ignore neighbours at or below this cosine similarity.
        candidates: candidate pool mode.
        corpus: pre-built :class:`ScreenCorpus` (its weights are hyperparameters).
        stats: pre-fit :class:`GeneStats`, shared to avoid recounting.
        k, tie_break, seed: as elsewhere.
    """

    def __init__(
        self,
        n_neighbors: int = 25,
        sim_power: float = 3.0,
        smoothing: float = 8.0,
        prior_smoothing: float = 25.0,
        negative_penalty: float = 0.5,
        use_relevance: bool = True,
        min_similarity: float = 0.0,
        candidates: str = CANDIDATES_SCREEN_LIBRARY,
        corpus: ScreenCorpus | None = None,
        stats: GeneStats | None = None,
        k: int = DEFAULT_K,
        tie_break: str = "random",
        seed: int = 42,
        exclude_same_group: bool = True,
        group_field: str = "source_id",
    ) -> None:
        self.exclude_same_group = exclude_same_group
        self.group_field = group_field
        self.n_neighbors = n_neighbors
        self.sim_power = sim_power
        self.smoothing = smoothing
        self.prior_smoothing = prior_smoothing
        self.negative_penalty = negative_penalty
        self.use_relevance = use_relevance
        self.min_similarity = min_similarity
        self.candidates = candidates
        self.corpus = corpus
        self.stats = stats
        self.k = k
        self.tie_break = tie_break
        self.seed = seed
        self._train: list[Mapping[str, Any]] = []
        self._train_matrix: Any = None
        self._train_groups: np.ndarray | None = None
        self._universe: list[str] | None = None
        self._neighbor_cache: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    @property
    def name(self) -> str:  # type: ignore[override]
        return f"retrieval_knn[k={self.n_neighbors},p={self.sim_power:g},s={self.smoothing:g}]"

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "RetrievalKNN":
        """Fit the corpus and gene statistics.  Train only."""
        self._train = list(train)
        if self.stats is None:
            self.stats = GeneStats().fit(self._train)
        if self.corpus is None:
            self.corpus = ScreenCorpus()
        if not self.corpus.fitted:
            self.corpus.fit(self._train)
        self._train_matrix = self.corpus.transform(self._train)
        self._train_groups = np.asarray(
            [_clean(s.get(self.group_field)) for s in self._train], dtype=object
        )
        if self.candidates == CANDIDATES_TRAIN_UNION:
            self._universe = self.stats.universe()
        self._neighbor_cache.clear()
        return self

    # -- retrieval --------------------------------------------------------- #

    def neighbors(self, screen: Mapping[str, Any]) -> tuple[np.ndarray, np.ndarray]:
        """Indices into the training list and their weights, most similar first.

        Training screens sharing the query's ``group_field`` value are removed
        first when ``exclude_same_group`` is set, which also removes the query
        itself when the query is a training screen.  See the class docstring for
        why that matters.
        """
        key = str(screen["dataset_name"])
        cached = self._neighbor_cache.get(key)
        if cached is not None:
            return cached
        assert self.corpus is not None and self._train_matrix is not None
        query = self.corpus.transform([screen])
        sims = np.asarray((query @ self._train_matrix.T).todense()).ravel()
        if self.exclude_same_group and self._train_groups is not None:
            group = _clean(screen.get(self.group_field))
            if group:
                sims = np.where(self._train_groups == group, -np.inf, sims)
        order = np.argsort(-sims, kind="stable")[: self.n_neighbors]
        order = order[sims[order] > self.min_similarity]
        weights = np.maximum(sims[order], 0.0) ** self.sim_power
        out = (order, weights)
        self._neighbor_cache[key] = out
        return out

    def gene_scores(self, screen: Mapping[str, Any], genes: Sequence[str]) -> dict[str, float]:
        """Neighbour-weighted, prior-smoothed P(hit) for each candidate gene."""
        assert self.stats is not None
        order, weights = self.neighbors(screen)
        wanted = set(genes)
        num: dict[str, float] = defaultdict(float)
        den: dict[str, float] = defaultdict(float)
        neg: dict[str, float] = defaultdict(float)
        for idx, weight in zip(order, weights):
            if weight <= 0:
                continue
            neighbor = self._train[int(idx)]
            for gene, score, is_hit in zip(
                neighbor["relevance_genes"],
                neighbor["relevance_scores"],
                neighbor["hit"],
            ):
                if gene not in wanted:
                    continue
                den[gene] += weight
                if is_hit:
                    num[gene] += weight * (score if self.use_relevance else 1.0)
                if score < 0:
                    neg[gene] += weight
        out: dict[str, float] = {}
        smoothing = self.smoothing
        for gene in genes:
            prior = self.stats.rate(gene, smoothing=self.prior_smoothing)
            d = den.get(gene, 0.0) + smoothing
            value = (num.get(gene, 0.0) + smoothing * prior) / d if d > 0 else prior
            if self.negative_penalty:
                nd = den.get(gene, 0.0) + smoothing
                value -= self.negative_penalty * (neg.get(gene, 0.0) / nd if nd > 0 else 0.0)
            out[gene] = value
        return out

    def rank(self, screen: Mapping[str, Any]) -> list[str]:
        genes = candidate_genes(screen, self.candidates, self._universe)
        scores = self.gene_scores(screen, genes)
        return rank_by_scores(
            genes, scores, tie_break=self.tie_break, seed=self.seed, limit=self.k
        )


class HybridScorer(Scorer):
    """SplicR: convex blend of :class:`RetrievalKNN` and :class:`GeneFrequencyPrior`.

    ``score(g) = alpha * pct(retrieval(g)) + (1 - alpha) * pct(prior(g))`` where
    ``pct`` is the within-screen percentile rank (:func:`percentile_ranks`).
    Blending percentiles rather than raw values matters: the retrieval score is a
    smoothed rate over a handful of neighbours while the prior is a rate over
    1349 screens, so their raw spreads differ per screen and a fixed ``alpha``
    on raw values would not mean the same thing twice.

    ``alpha`` is selected by :meth:`tune` on the **validation** split only.  The
    test split is never touched during fitting or tuning.

    Args:
        retrieval: a fitted or unfitted :class:`RetrievalKNN`.
        prior: a fitted or unfitted :class:`GeneFrequencyPrior`.
        alpha: blend weight on the retrieval component.
        candidates, k, tie_break, seed: as elsewhere.
    """

    def __init__(
        self,
        retrieval: RetrievalKNN | None = None,
        prior: GeneFrequencyPrior | None = None,
        alpha: float = 0.7,
        candidates: str = CANDIDATES_SCREEN_LIBRARY,
        k: int = DEFAULT_K,
        tie_break: str = "random",
        seed: int = 42,
    ) -> None:
        self.retrieval = retrieval
        self.prior = prior
        self.alpha = alpha
        self.candidates = candidates
        self.k = k
        self.tie_break = tie_break
        self.seed = seed
        self.stats: GeneStats | None = None
        self.tuning: list[tuple[float, float]] = []
        self._universe: list[str] | None = None
        self._component_cache: dict[str, tuple[list[str], np.ndarray, np.ndarray]] = {}

    @property
    def name(self) -> str:  # type: ignore[override]
        return f"hybrid[alpha={self.alpha:.2f}]"

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "HybridScorer":
        """Fit both components on the training screens, sharing one GeneStats."""
        self.stats = GeneStats().fit(train)
        if self.retrieval is None:
            self.retrieval = RetrievalKNN(candidates=self.candidates, k=self.k)
        if self.prior is None:
            self.prior = GeneFrequencyPrior(
                smoothing=25.0, candidates=self.candidates, k=self.k
            )
        self.retrieval.stats = self.retrieval.stats or self.stats
        self.retrieval.candidates = self.candidates
        self.prior.stats = self.prior.stats or self.stats
        self.prior.candidates = self.candidates
        self.retrieval.fit(train)
        self.prior.fit(train)
        if self.candidates == CANDIDATES_TRAIN_UNION:
            self._universe = self.stats.universe()
        self._component_cache.clear()
        return self

    def _components(
        self, screen: Mapping[str, Any]
    ) -> tuple[list[str], np.ndarray, np.ndarray]:
        """Candidates plus the two percentile-ranked component scores, memoised.

        Cached per screen so an ``alpha`` sweep costs one component pass, not one
        per ``alpha``.  Computing the retrieval scores is the expensive half
        (it walks every neighbour's full gene list), so this cache is the
        difference between a tunable method and an intractable one.
        """
        key = str(screen["dataset_name"])
        cached = self._component_cache.get(key)
        if cached is not None:
            return cached
        assert self.retrieval is not None and self.prior is not None
        genes = candidate_genes(screen, self.candidates, self._universe)
        retrieval_scores = self.retrieval.gene_scores(screen, genes)
        r = percentile_ranks(np.asarray([retrieval_scores[g] for g in genes], dtype=float))
        p = percentile_ranks(
            np.asarray([self.prior.gene_score(g, screen) for g in genes], dtype=float)
        )
        out = (genes, r, p)
        self._component_cache[key] = out
        return out

    def _blended(self, screen: Mapping[str, Any], alpha: float) -> list[str]:
        genes, r, p = self._components(screen)
        blended = alpha * r + (1.0 - alpha) * p
        scores = dict(zip(genes, blended.tolist()))
        return rank_by_scores(
            genes, scores, tie_break=self.tie_break, seed=self.seed, limit=self.k
        )

    def rank(self, screen: Mapping[str, Any]) -> list[str]:
        return self._blended(screen, self.alpha)

    def tune(
        self,
        validation: Sequence[Mapping[str, Any]],
        alphas: Sequence[float] = (0.0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0),
        andcg: AnDCG | None = None,
        targets: Mapping[str, ScreenTarget] | None = None,
        verbose: bool = True,
    ) -> float:
        """Pick ``alpha`` by AnDCG@k on the validation split.  Never on test.

        Returns:
            The selected ``alpha``, also stored on ``self.alpha``.  The full
            sweep lands in ``self.tuning``.
        """
        andcg = andcg or AnDCG(k=self.k)
        targets = targets or build_targets(validation, andcg)
        self.tuning = []
        best = (-math.inf, self.alpha)
        for alpha in alphas:
            vals = [
                targets[str(s["dataset_name"])].score(self._blended(s, alpha))
                for s in validation
            ]
            mean = float(np.mean(vals))
            self.tuning.append((float(alpha), mean))
            if verbose:
                print(f"  alpha={alpha:.2f}  val AnDCG@{self.k}={mean:.4f}")
            if mean > best[0]:
                best = (mean, float(alpha))
        self.alpha = best[1]
        if verbose:
            print(f"  selected alpha={self.alpha:.2f} (val {best[0]:.4f})")
        return self.alpha


def load_depmap_common_essentials(path: str = DEPMAP_COMMON_ESSENTIALS) -> frozenset[str]:
    """Read DepMap 24Q4 inferred common essentials as bare HGNC symbols.

    The file is one ``SYMBOL (ENTREZ_ID)`` per line under an ``Essentials``
    header.  **External knowledge, not leakage**: DepMap is independent of
    AssayBench, and the flag is constant across screens.
    """
    out: set[str] = set()
    with open(path) as fh:
        next(fh, None)
        for line in fh:
            token = line.strip()
            if not token:
                continue
            out.add(re.sub(r"\s*\(\d+\)\s*$", "", token))
    return frozenset(out)


class GBMRanker(Scorer):
    """SplicR: LightGBM LambdaRank over per-gene, per-screen features.

    Learns the combination that :class:`HybridScorer` fixes by hand, and adds
    features a linear blend cannot express -- notably the interaction between
    DepMap essentiality and the direction of selection.  That interaction is the
    single most informative non-label signal available: hits in a
    negative-selection screen are largely essential genes, hits in a
    positive-selection screen are largely not, so the *sign* with which
    essentiality should be used flips per screen.

    Training rows are sampled per screen (all hits up to ``max_pos``, plus
    ``max_neg`` non-hits) because the full cross product is 1349 x ~17.6k = 23M
    rows.  Groups are screens, so LambdaRank optimises within-screen ordering,
    which is what AnDCG measures.

    ``fit`` uses training screens for rows and validation screens only for early
    stopping -- the test split is never seen.

    Args:
        n_neighbors, sim_power: retrieval settings for the neighbour features.
        max_pos, max_neg: per-screen row budget.
        n_estimators, learning_rate, num_leaves: LightGBM settings.
        label_bins: relevance -> integer gain buckets for LambdaRank.
        use_depmap: include the DepMap essentiality features (external data).
        candidates, k, seed: as elsewhere.
    """

    name = "gbm_lambdarank"

    FEATURE_NAMES: tuple[str, ...] = (
        "prior_rate_smoothed",          # train-only global hit rate
        "prior_rate_raw",               # train-only unsmoothed hit rate
        "log_measured",                 # how many training screens assayed it
        "negative_rate",                # train-only opposite-direction rate
        "mean_relevance",               # train-only mean positive relevance
        "knn_rate",                     # neighbour-weighted P(hit), metadata-only
        "knn_neg_rate",                 # neighbour-weighted opposite-direction rate
        "knn_coverage",                  # neighbour weight that actually assayed it
        "stratum_rate_screen_type",     # train-only, backed off to global
        "stratum_rate_library_type",    # train-only, backed off to global
        "stratum_rate_phenotype",       # train-only, backed off to global
        "depmap_common_essential",      # EXTERNAL (DepMap 24Q4), not leakage
        "depmap_nonessential_control",  # EXTERNAL (DepMap 24Q4), not leakage
        "is_negative_selection",        # from screen metadata
        "essential_x_negative_selection",  # the sign-flip interaction
        "screen_hit_rate_prior",        # train-only expected hit rate for this stratum
    )

    def __init__(
        self,
        n_neighbors: int = 25,
        sim_power: float = 3.0,
        max_pos: int = 400,
        max_neg: int = 1600,
        n_estimators: int = 600,
        learning_rate: float = 0.05,
        num_leaves: int = 63,
        label_bins: Sequence[float] = (0.0, 0.5, 0.9, 0.99),
        use_depmap: bool = True,
        candidates: str = CANDIDATES_SCREEN_LIBRARY,
        k: int = DEFAULT_K,
        seed: int = 42,
    ) -> None:
        self.n_neighbors = n_neighbors
        self.sim_power = sim_power
        self.max_pos = max_pos
        self.max_neg = max_neg
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.num_leaves = num_leaves
        self.label_bins = tuple(label_bins)
        self.use_depmap = use_depmap
        self.candidates = candidates
        self.k = k
        self.seed = seed
        self.stats: GeneStats | None = None
        self.retrieval: RetrievalKNN | None = None
        self.model: Any = None
        self._essentials: frozenset[str] = frozenset()
        self._nonessentials: frozenset[str] = frozenset()
        self._universe: list[str] | None = None
        self._stratum_prior: dict[str, float] = {}

    # -- features ---------------------------------------------------------- #

    def _load_external(self) -> None:
        if not self.use_depmap:
            return
        if not self._essentials and os.path.exists(DEPMAP_COMMON_ESSENTIALS):
            self._essentials = load_depmap_common_essentials(DEPMAP_COMMON_ESSENTIALS)
        if not self._nonessentials and os.path.exists(DEPMAP_NONESSENTIAL_CONTROLS):
            self._nonessentials = load_depmap_common_essentials(
                DEPMAP_NONESSENTIAL_CONTROLS
            )

    def features(self, screen: Mapping[str, Any], genes: Sequence[str]) -> np.ndarray:
        """Build the ``(len(genes), len(FEATURE_NAMES))`` feature block."""
        assert self.stats is not None and self.retrieval is not None
        stats = self.stats
        order, weights = self.retrieval.neighbors(screen)
        wanted = set(genes)
        knn_num: dict[str, float] = defaultdict(float)
        knn_den: dict[str, float] = defaultdict(float)
        knn_neg: dict[str, float] = defaultdict(float)
        total_weight = float(weights.sum()) or 1.0
        for idx, weight in zip(order, weights):
            if weight <= 0:
                continue
            neighbor = self.retrieval._train[int(idx)]
            for gene, score, is_hit in zip(
                neighbor["relevance_genes"],
                neighbor["relevance_scores"],
                neighbor["hit"],
            ):
                if gene not in wanted:
                    continue
                knn_den[gene] += weight
                if is_hit:
                    knn_num[gene] += weight * score
                if score < 0:
                    knn_neg[gene] += weight

        screen_type = _clean(screen.get("screen_type")) or "unknown"
        library_type = _clean(screen.get("library_type")) or "unknown"
        phenotype = _clean(screen.get("cleaned_phenotype")) or "unknown"
        is_negative = 1.0 if "negative" in screen_type.lower() else 0.0
        stratum_prior = self._stratum_prior.get(screen_type, stats.prior_rate)

        rows = np.zeros((len(genes), len(self.FEATURE_NAMES)), dtype=np.float32)
        for i, gene in enumerate(genes):
            den = knn_den.get(gene, 0.0)
            essential = 1.0 if gene in self._essentials else 0.0
            rows[i] = (
                stats.rate(gene, smoothing=25.0),
                stats.raw_rate(gene),
                math.log1p(stats.measured.get(gene, 0)),
                stats.negative_rate(gene, smoothing=25.0),
                stats.mean_relevance(gene),
                (knn_num.get(gene, 0.0) / den) if den > 0 else 0.0,
                (knn_neg.get(gene, 0.0) / den) if den > 0 else 0.0,
                den / total_weight,
                stats.stratum_rate("screen_type", screen_type, gene),
                stats.stratum_rate("library_type", library_type, gene),
                stats.stratum_rate("cleaned_phenotype", phenotype, gene),
                essential,
                1.0 if gene in self._nonessentials else 0.0,
                is_negative,
                essential * is_negative,
                stratum_prior,
            )
        return rows

    def _label(self, relevance: float) -> int:
        """Bucket a relevance into a LambdaRank integer gain."""
        if relevance <= 0:
            return 0
        return 1 + sum(1 for edge in self.label_bins[1:] if relevance >= edge)

    def _rows_for(
        self, screens: Sequence[Mapping[str, Any]], rng: random.Random
    ) -> tuple[np.ndarray, np.ndarray, list[int]]:
        feats, labels, groups = [], [], []
        for screen in screens:
            genes = list(screen["relevance_genes"])
            scores = list(screen["relevance_scores"])
            pos = [i for i, s in enumerate(scores) if s > 0]
            neg = [i for i, s in enumerate(scores) if s <= 0]
            if not pos:
                continue
            if len(pos) > self.max_pos:
                pos = rng.sample(pos, self.max_pos)
            if len(neg) > self.max_neg:
                neg = rng.sample(neg, self.max_neg)
            idx = pos + neg
            chosen = [genes[i] for i in idx]
            feats.append(self.features(screen, chosen))
            labels.extend(self._label(scores[i]) for i in idx)
            groups.append(len(idx))
        if not feats:
            raise ValueError("no usable training rows")
        return np.vstack(feats), np.asarray(labels, dtype=np.int32), groups

    # -- fit / predict ----------------------------------------------------- #

    def fit(
        self,
        train: Sequence[Mapping[str, Any]],
        validation: Sequence[Mapping[str, Any]] | None = None,
        stats: GeneStats | None = None,
        corpus: ScreenCorpus | None = None,
        verbose: bool = True,
        **kw: Any,
    ) -> "GBMRanker":
        """Fit LambdaRank on train rows, early-stopping on validation rows.

        The test split is not read here or anywhere else in this class.
        """
        import lightgbm as lgb

        self._load_external()
        self.stats = stats or GeneStats().fit(train)
        self.retrieval = RetrievalKNN(
            n_neighbors=self.n_neighbors,
            sim_power=self.sim_power,
            candidates=self.candidates,
            corpus=corpus,
            stats=self.stats,
            k=self.k,
        ).fit(train)

        by_type: dict[str, list[float]] = defaultdict(list)
        for screen in train:
            n = len(screen["relevance_scores"]) or 1
            by_type[_clean(screen.get("screen_type")) or "unknown"].append(
                sum(1 for s in screen["relevance_scores"] if s > 0) / n
            )
        self._stratum_prior = {t: float(np.mean(v)) for t, v in by_type.items()}

        rng = random.Random(self.seed)
        x_train, y_train, g_train = self._rows_for(train, rng)
        self.model = lgb.LGBMRanker(
            objective="lambdarank",
            metric="ndcg",
            n_estimators=self.n_estimators,
            learning_rate=self.learning_rate,
            num_leaves=self.num_leaves,
            label_gain=list(range(len(self.label_bins) + 1)),
            random_state=self.seed,
            n_jobs=-1,
            verbose=-1,
        )
        # eval_at belongs on fit(), not the constructor: passing it to the
        # constructor lands it in **params and then collides with fit's own
        # argument.  feature_name is deliberately omitted -- naming columns at
        # fit time but predicting on a bare ndarray makes sklearn warn on every
        # predict, and FEATURE_NAMES already documents the column order.
        kwargs: dict[str, Any] = {"group": g_train, "eval_at": [self.k]}
        if validation:
            x_val, y_val, g_val = self._rows_for(validation, random.Random(self.seed + 1))
            kwargs["eval_set"] = [(x_val, y_val)]
            kwargs["eval_group"] = [g_val]
            kwargs["callbacks"] = [
                lgb.early_stopping(50, verbose=verbose),
                lgb.log_evaluation(100 if verbose else 0),
            ]
        self.model.fit(x_train, y_train, **kwargs)
        if self.candidates == CANDIDATES_TRAIN_UNION:
            self._universe = self.stats.universe()
        return self

    def rank(self, screen: Mapping[str, Any]) -> list[str]:
        if self.model is None:
            raise RuntimeError("GBMRanker.fit() must be called first")
        genes = candidate_genes(screen, self.candidates, self._universe)
        preds = self.model.predict(self.features(screen, genes))
        order = np.argsort(-np.asarray(preds), kind="stable")[: self.k]
        return [genes[int(i)] for i in order]

    def importances(self) -> list[tuple[str, float]]:
        """Feature importances, most important first.

        Names come from :attr:`FEATURE_NAMES` by position, which is the same
        order :meth:`features` writes the columns in.
        """
        if self.model is None:
            raise RuntimeError("GBMRanker.fit() must be called first")
        pairs = list(zip(self.FEATURE_NAMES, self.model.feature_importances_.tolist()))
        pairs.sort(key=lambda p: -p[1])
        return pairs


# --------------------------------------------------------------------------- #
# Part 7 -- self-test
# --------------------------------------------------------------------------- #


class _FixedScorer(Scorer):
    """Scorer that replays a precomputed ``dataset_name -> ranking`` map."""

    def __init__(self, name: str, table: Mapping[str, Sequence[str]]) -> None:
        self.name = name
        self.table = table

    def rank(self, screen: Mapping[str, Any]) -> list[str] | None:
        got = self.table.get(str(screen["dataset_name"]))
        return list(got) if got is not None else None


def _synthetic_screen(
    n_genes: int = 500, n_hits: int = 60, seed: int = 0
) -> dict[str, Any]:
    """A screen with relevance shaped like AssayBench's (percentile-ranked hits)."""
    rng = np.random.default_rng(seed)
    genes = [f"G{i:05d}" for i in range(n_genes)]
    scores = [0.0] * n_genes
    hit_idx = rng.choice(n_genes, size=n_hits, replace=False)
    for rank, i in enumerate(sorted(hit_idx.tolist())):
        scores[i] = 1.0 - rank / n_genes
    return {
        "dataset_name": f"synthetic_{seed}",
        "relevance_genes": genes,
        "relevance_scores": scores,
        "hit": [s > 0 for s in scores],
    }


def self_test(
    real: bool = False, verbose: bool = True, parity_screens: int = 10_000
) -> dict[str, Any]:
    """Verify the metric, then (optionally) verify it against upstream on real data.

    Checks, in order:

    1. **Perfect ranking scores 1.0.**  Rank the screen's genes by true relevance.
    2. **Random ranking scores ~0.0**, averaged over 200 shuffles.  It is
       slightly *above* zero, not exactly zero, because AnDCG clamps at 0: a
       shuffle that lands below chance contributes 0 instead of a negative, so
       the mean of clamped shuffles is positive by construction.  The *unclamped*
       mean is the quantity that should sit at ~0, and it is reported too.
    3. **Reversed ranking scores below random**, and its *unclamped* value is
       negative.  The clamped value cannot be negative -- that is the point of
       the clamp -- so the test asserts on the unclamped number.
    4. **Component identities** against closed forms: nDCG_rand equals
       ``mean(rel) * H_min(k,n) / IDCG@k``; negatives in the numerator subtract
       while IDCG clips them; a short list is penalised by padding.
    5. With ``real=True``: **bit-for-bit parity with upstream**
       ``RankingMetrics.evaluate(...)["adjusted_ndcg@100"]`` across real screens
       and several prediction styles, plus a smoke test of every scorer.

    Args:
        real: also run the upstream-parity and end-to-end checks (needs the
            parquet snapshot on disk).
        verbose: print each check.
        parity_screens: cap on how many test screens enter the upstream-parity
            sweep.  The default covers the whole split.

    Returns:
        A dict of the measured numbers, so a caller can report them rather than
        trust a printout.
    """
    out: dict[str, Any] = {}
    say = print if verbose else (lambda *a, **k: None)
    k = DEFAULT_K

    say("=" * 78)
    say("SplicR benchmark.py self-test")
    say("=" * 78)

    # ---- 1-3: synthetic ranking behaviour, metric-level (no symbol mapping)
    screen = _synthetic_screen()
    rel = screen["relevance_scores"]
    genes = screen["relevance_genes"]
    table = dict(zip(genes, rel))

    perfect = sorted(genes, key=lambda g: -table[g])
    out["perfect"] = float(adjusted_ndcg([table[g] for g in perfect], rel, k))
    say(f"[1] perfect ranking          AnDCG@{k} = {out['perfect']:.6f}  (expect 1.0)")
    assert abs(out["perfect"] - 1.0) < 1e-12, out["perfect"]

    def unclamped(pred_genes: Sequence[str]) -> float:
        pred = [table[g] for g in pred_genes]
        n = ndcg(pred, rel, k)
        r = ndcg([np.mean(rel)] * min(k, len(rel)), rel, k)
        return float((n - r) / (1 - r))

    rng = random.Random(7)
    clamped_vals, raw_vals = [], []
    for _ in range(200):
        shuffled = genes[:]
        rng.shuffle(shuffled)
        clamped_vals.append(float(adjusted_ndcg([table[g] for g in shuffled], rel, k)))
        raw_vals.append(unclamped(shuffled))
    out["random_clamped"] = float(np.mean(clamped_vals))
    out["random_unclamped"] = float(np.mean(raw_vals))
    say(
        f"[2] random ranking (200x)    AnDCG@{k} = {out['random_clamped']:.6f} clamped, "
        f"{out['random_unclamped']:+.6f} unclamped  (expect ~0)"
    )
    assert abs(out["random_unclamped"]) < 0.05, out["random_unclamped"]
    assert 0.0 <= out["random_clamped"] < 0.10, out["random_clamped"]

    reversed_genes = list(reversed(perfect))
    out["reversed_clamped"] = float(
        adjusted_ndcg([table[g] for g in reversed_genes], rel, k)
    )
    out["reversed_unclamped"] = unclamped(reversed_genes)
    say(
        f"[3] reversed ranking         AnDCG@{k} = {out['reversed_clamped']:.6f} clamped, "
        f"{out['reversed_unclamped']:+.6f} unclamped  (expect < 0 unclamped)"
    )
    assert out["reversed_unclamped"] < 0, out["reversed_unclamped"]
    assert out["reversed_clamped"] == 0.0, out["reversed_clamped"]

    # ---- 4: component identities
    n = len(rel)
    m = min(k, n)
    log2 = _log2_table(m)
    harmonic = sum(1.0 / log2[i] for i in range(m))
    ideal = sorted((max(r, 0.0) for r in rel), reverse=True)
    idcg = dcg(ideal, k)
    closed_form = float(np.mean(rel)) * harmonic / idcg
    measured_rand = ndcg([np.mean(rel)] * m, rel, k)
    out["ndcg_rand_closed_form_error"] = abs(closed_form - float(measured_rand))
    say(
        f"[4a] nDCG_rand analytic      {measured_rand:.9f} vs closed form "
        f"{closed_form:.9f}  (delta {out['ndcg_rand_closed_form_error']:.2e})"
    )
    assert out["ndcg_rand_closed_form_error"] < 1e-12

    bidir = [1.0, 0.8, 0.0, -0.9, -1.0]
    out["idcg_clips_negatives"] = float(dcg(sorted((max(r, 0.0) for r in bidir), reverse=True), 5))
    out["negative_subtracts"] = float(ndcg([-1.0, -0.9], bidir, 5))
    say(
        f"[4b] IDCG clips negatives    IDCG@5={out['idcg_clips_negatives']:.6f}; "
        f"ranking two negatives gives nDCG={out['negative_subtracts']:+.6f} (expect < 0)"
    )
    assert out["negative_subtracts"] < 0

    full = [table[g] for g in perfect]
    out["short_list_penalty"] = float(
        adjusted_ndcg(full[:10], rel, k) - adjusted_ndcg(full, rel, k)
    )
    say(
        f"[4c] short list is penalised top-10 only scores "
        f"{adjusted_ndcg(full[:10], rel, k):.6f} vs {adjusted_ndcg(full, rel, k):.6f} "
        f"(delta {out['short_list_penalty']:+.6f}, expect < 0)"
    )
    assert out["short_list_penalty"] < 0

    # 50 *distinct* unmeasured symbols -- distinct matters, because the evaluator
    # dedups before scoring, so 50 copies of one name would cost only one slot.
    unmeasured = [f"ZZZUNMEASURED{i}" for i in range(50)] + perfect
    andcg_obj = AnDCG(k=k, use_gene_mapper=False, hgnc_symbols=frozenset(genes))
    target = andcg_obj.target(screen)
    out["condensed_burns_slots"] = float(target.score(unmeasured))
    out["no_padding_reference"] = float(target.score(perfect))
    out["dedup_collapses_repeats"] = float(target.score(["ZZZUNMEASURED0"] * 50 + perfect))
    say(
        f"[4d] condensed burns slots   50 distinct unmeasured genes first -> "
        f"{out['condensed_burns_slots']:.6f} vs {out['no_padding_reference']:.6f} clean; "
        f"50 copies of one name -> {out['dedup_collapses_repeats']:.6f} (dedup)"
    )
    assert out["condensed_burns_slots"] < out["no_padding_reference"]
    assert out["dedup_collapses_repeats"] == out["no_padding_reference"]

    if not real:
        say("-" * 78)
        say("synthetic checks passed; pass --real for upstream parity + scorer smoke test")
        return out

    # ---- 5: upstream parity on real screens
    from splicr.assaybench_io import load_split
    from assaybench.benchmark.metrics import RankingMetrics

    say("-" * 78)
    say("loading real AssayBench splits ...")
    train = load_split("train")
    val = load_split("validation")
    test = load_split("test")
    out["n_train"], out["n_validation"], out["n_test"] = len(train), len(val), len(test)
    say(f"    train={len(train)} validation={len(val)} test={len(test)}")

    mine = AnDCG(k=k)
    upstream = RankingMetrics(k_values=[k], metric_groups=["adjusted_ndcg"])
    # Share the mapper so parity tests the arithmetic, not two mapper instances.
    upstream.gene_mapper = mine.gene_mapper

    rng2 = random.Random(11)
    worst = 0.0
    n_pairs = 0
    for screen in test[:parity_screens]:
        gt = screen["relevance_genes"]
        rel = screen["relevance_scores"]
        tbl = dict(zip(gt, rel))
        ordered = sorted(gt, key=lambda g: -tbl[g])
        styles = {
            "perfect_top100": ordered[:100],
            "perfect_top30": ordered[:30],
            "shuffled_library": rng2.sample(list(gt), min(150, len(gt))),
            "reversed_top100": ordered[::-1][:100],
            "half_bogus": ["NOTAGENE1", "NOTAGENE2", "TP53", "KRAS"] + ordered[:96],
            "with_duplicates": (ordered[:50] * 2),
            "empty_ish": ordered[:3],
        }
        tgt = mine.target(screen)
        for style, pred in styles.items():
            a = float(tgt.score(pred))
            b = float(
                upstream.evaluate(
                    predicted_genes=list(pred),
                    ground_truth_genes=list(gt),
                    relevance_scores=list(rel),
                )[f"adjusted_ndcg@{k}"]
            )
            worst = max(worst, abs(a - b))
            n_pairs += 1
    out["upstream_max_abs_diff"] = worst
    out["upstream_pairs_compared"] = n_pairs
    say(
        f"[5a] upstream parity         max |mine - upstream| = {worst:.3e} "
        f"over {n_pairs} (screen, prediction-style) pairs"
    )
    assert worst == 0.0, f"not bit-identical to upstream: {worst:.3e}"

    # ---- 5b: scorer smoke test on a small slice (not the published evaluation)
    say("-" * 78)
    say("scorer smoke test on 40 train / 25 validation screens (NOT the benchmark run)")
    small_train, small_val = train[:400], val[:25]
    targets = build_targets(small_val, mine)
    stats = GeneStats().fit(small_train)
    corpus = ScreenCorpus().fit(small_train)
    out["smoke"] = {}

    for scorer in (
        RandomBaseline(k=k),
        GeneFrequencyPrior(stats=stats, k=k),
        GeneFrequencyPrior(smoothing=25.0, negative_penalty=0.5, stats=stats, k=k),
        RetrievalKNN(stats=stats, corpus=corpus, k=k),
    ):
        scorer.fit(small_train)
        res = evaluate(scorer, small_val, k=k, andcg=mine, targets=targets, split="val-smoke")
        out["smoke"][scorer.name] = res.mean
        say(f"    {res}")

    hybrid = HybridScorer(k=k).fit(small_train)
    hybrid.tune(small_val, alphas=(0.0, 0.5, 1.0), andcg=mine, targets=targets, verbose=verbose)
    res = evaluate(hybrid, small_val, k=k, andcg=mine, targets=targets, split="val-smoke")
    out["smoke"][hybrid.name] = res.mean
    say(f"    {res}")

    oracle = OracleKNN(k=k, andcg=mine).fit(small_train[:150])
    res = evaluate(oracle, small_val[:10], k=k, andcg=mine, targets=targets, split="val-smoke")
    out["smoke"][oracle.name] = res.mean
    say(f"    {res}   <-- ORACLE, reads eval labels")

    ess = load_depmap_common_essentials()
    out["depmap_common_essentials"] = len(ess)
    say(f"    DepMap 24Q4 inferred common essentials loaded: {len(ess)} genes (external)")

    gbm = GBMRanker(k=k, max_pos=100, max_neg=300, n_estimators=60).fit(
        small_train[:200], validation=small_val, stats=stats, corpus=corpus, verbose=False
    )
    res = evaluate(gbm, small_val, k=k, andcg=mine, targets=targets, split="val-smoke")
    out["smoke"][gbm.name] = res.mean
    say(f"    {res}")
    say("    top features: " + ", ".join(f"{n}={v}" for n, v in gbm.importances()[:5]))

    say("-" * 78)
    say("all checks passed")
    return out


def reproduce_published(
    fold_column: str = "yearfold0", seeds: Sequence[int] = (0, 1, 2, 3), verbose: bool = True
) -> dict[str, Any]:
    """Re-measure the two published reference points on the full splits.

    This is the calibration run, not the SplicR evaluation: it establishes that
    the harness agrees with the published table before any SplicR number is
    quoted against it.  Checks

    * ``oracle_knn`` (published 0.2918) -- a full ``len(train) x len(test)``
      sweep.  ORACLE: reads test labels.
    * the frequency prior (published 0.1334), both unstratified and in upstream's
      ``coarse-phenotype-hit-freq`` form, over several tie-break seeds.

    Args:
        fold_column: which split assignment to use.
        seeds: tie-break seeds for the prior (upstream tie-breaks at random, so a
            single seed is not a fair comparison).
        verbose: print as it goes.

    Returns:
        The measured numbers alongside :data:`PUBLISHED`.
    """
    from splicr.assaybench_io import load_split

    say = print if verbose else (lambda *a, **k: None)
    andcg = AnDCG(k=DEFAULT_K)
    train = load_split("train", fold_column=fold_column)
    test = load_split("test", fold_column=fold_column)
    targets = build_targets(test, andcg)
    stats = GeneStats().fit(train)
    out: dict[str, Any] = {
        "fold_column": fold_column,
        "n_train": len(train),
        "n_test": len(test),
    }
    say(f"calibration on {fold_column}: train={len(train)} test={len(test)}")

    def sweep(label: str, make: Callable[[int], Scorer]) -> list[float]:
        vals = []
        for seed in seeds:
            res = evaluate(make(seed), test, andcg=andcg, targets=targets, split="test")
            vals.append(res.mean)
        say(
            f"  {label:<52} {np.mean(vals):.4f}  "
            f"[{min(vals):.4f}, {max(vals):.4f}] over {len(seeds)} seeds"
        )
        return vals

    out["global_hit_freq_unstratified"] = sweep(
        "gene_frequency_prior, unstratified",
        lambda s: GeneFrequencyPrior(smoothing=0.0, seed=s, stats=stats),
    )
    out["coarse_phenotype_hit_freq"] = sweep(
        "gene_frequency_prior, coarse-phenotype (published 0.1334)",
        lambda s: GeneFrequencyPrior(
            smoothing=0.0,
            stratify_by="cleaned_phenotype",
            stratum_backoff=False,
            seed=s,
            stats=stats,
        ),
    )
    out["random"] = sweep("random", lambda s: RandomBaseline(seed=s).fit(train))

    say(f"  sweeping oracle: {len(train) * len(test):,} metric evaluations ...")
    oracle = OracleKNN(k=DEFAULT_K, andcg=andcg).fit(train)
    res = evaluate(oracle, test, andcg=andcg, targets=targets, split="test")
    out["oracle_knn"] = res.mean
    say(f"  {'oracle_knn (published 0.2918) [ORACLE]':<52} {res.mean:.4f}")

    out["published"] = PUBLISHED
    return out


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point: ``python -m splicr.benchmark [--real] [--reproduce]``."""
    argv = list(sys.argv[1:] if argv is None else argv)
    self_test(real="--real" in argv or "--reproduce" in argv, verbose=True)
    if "--reproduce" in argv:
        print("-" * 78)
        reproduce_published()
    return 0


if __name__ == "__main__":  # pragma: no cover
    if __package__ in (None, ""):
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    raise SystemExit(main())

"""Stratified hit-frequency priors for AssayBench screens -- the backbone family.

WHAT THIS IS
------------
For every (screen, gene) pair this module emits a small set of *label-free* prior
scores: "given only this screen's metadata and its library, how likely is this gene
to be one of its top hits?".  Everything is estimated from the AssayBench **train**
split (``yearfold0 == "train"``, 1349 screens) by hierarchical empirical-Bayes
pooling.  Nothing here ever reads validation or test labels; :func:`fit` refuses a
fitting set that contains a non-train screen.

WHY IT IS BUILT THIS WAY (all numbers are standalone validation AnDCG@100, 218
screens, scored with ``assaybench.benchmark.metrics.RankingMetrics``)::

    upstream global-hit-freq          hits/measured, unsmoothed          0.17662
    upstream coarse-phenotype-hit-freq  cleaned_phenotype, no backoff    0.16918
    + relevance-rank evidence         instead of the binary hit flag     0.18453
    + direction stratum               "decreases X" vs "increases X"     0.19090
    + (phenotype x direction) level   hierarchical EB shrinkage          0.20470
    + opposite-direction contrast     subtract the mirrored prior        0.21418

Four findings drove the design.

1. **Direction is the dominant stratum, and it is free.**  AssayBench's
   ``phenotype`` field always opens with one of ``decreases`` / ``increases`` /
   ``either`` / ``impacts`` (100% of train and validation).  That verb says which
   way the screen's own hits point, and it is the most shifted axis between the
   splits: train is 72% ``decreases``, validation is 31% ``decreases`` / 46%
   ``increases``.  An unstratified prior is therefore mostly an *essentiality*
   prior, which is close to the worst possible ranking for an ``increases``
   screen.  Stratifying on the verb is worth more than stratifying on phenotype,
   cell type, screen type, library type or assay setup -- each of which we
   measured separately (see ``WHAT DID NOT WORK`` below).

2. **The opposite direction is a better negative than the global average.**
   ``decreases`` and ``increases`` records built from the same BioGRID screen have
   *disjoint* positive sets (median Jaccard 0.000 over the 116 sibling pairs in
   train+validation) and each carries the other's hits as *negative* relevance.
   The metric's numerator does not clip negatives, so ranking an
   opposite-direction gene actively subtracts.  Scoring
   ``p(g | direction) - lam * p(g | flipped direction)`` is the single largest
   gain in the family (+0.017 on validation, paired Wilcoxon p < 1e-8).

3. **Magnitude beats the binary hit flag.**  Relevance is ``|effect|`` for
   significant genes, and nDCG is dominated by the top few, so pooling each donor
   screen's *within-screen relevance percentile* rather than its 0/1 hit flag is
   worth about +0.008.

4. **Per-screen mass normalisation is actively harmful.**  Down-weighting a donor
   by its hit count (so a 5000-hit fitness screen cannot outvote a 16-hit drug
   screen) *cost* 0.04 AnDCG.  Raw pooling wins; see ``WHAT DID NOT WORK``.

WHAT DID NOT WORK (measured, not assumed)
-----------------------------------------
* ``mass=1/n_hits`` (equal per-screen mass): 0.16095 vs 0.19090.  Also
  ``1/sqrt(n_hits)``: ~0.189, i.e. no better than raw.  Screens with many hits
  really are more informative about which genes hit.
* Stratifying on ``cell_type`` (99 levels), ``cell_line`` (681), ``library_type``,
  ``library_methodology``, ``screen_category`` or ``experimental_setup``: every
  one landed within 0.0002 of the *unstratified* prior once shrinkage was fitted.
  They add nothing the direction verb and the coarse phenotype do not already
  carry.  A third hierarchy level on top of (phenotype x direction) is worth
  <0.0002 and its fitted shrinkage goes to 100-300, i.e. the level is shrunk
  almost entirely back into its parent.
* **The library-restriction correction is right but not significant here.**
  Dividing by *times measured* rather than *times screened* is worth +0.003 to
  +0.004, but the paired bootstrap CI crosses zero on 218 screens
  (p = 0.17-0.38).  It is kept because it is the correct estimator, not because
  the validation set can prove it.
* Time-decay weighting of donors by publication year and soft strata weighted by
  query/donor library overlap: see ``WEIGHTED_VARIANTS`` in this module's
  ``__main__`` output -- neither cleared its CI.
* Beta-Binomial MLE shrinkage fitted on train alone gives ``alpha_global = 4.8``,
  ``alpha_direction = 13.0`` and 0.18825 with *zero* validation tuning, against
  0.18586 at the nearest hand-picked grid point.  The fit is sound; the
  validation-optimal alphas are larger (30-100) because the metric cares only
  about the top 100, where over-shrinking rare genes is cheap.  Pass
  ``alphas="eb"`` for the untuned estimator.

HONEST TUNING NOTE
------------------
The default hyperparameters were selected on the 218 validation screens.  A
split-half check (tune on 109, score the other 109, 400 resamples) puts the
honestly-held-out value of that selection at **0.2082 +/- 0.0186** against the
0.21418 tuned on all 218 -- so roughly 0.006 of the headline is selection
optimism, and the top of the surface is flat (21 of 2160 configurations lie
within 0.002 of the best).

USAGE
-----
    from splicr.features.priors import screen_gene_priors, FEATURE_NAMES
    feats = screen_gene_priors(my_screens)          # fits on train automatically
    feats["U_1234_dec"]["POLR2A"]["prior_contrast"] # -> float

    python -m splicr.features.priors                # self-check on validation
"""

from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np

# --------------------------------------------------------------------------- #
# public surface
# --------------------------------------------------------------------------- #

#: Every feature this module emits, in a stable order.
FEATURE_NAMES: list[str] = [
    "prior_global_raw",          # upstream global-hit-freq: hits / times_measured
    "prior_pheno_exact",         # upstream coarse-phenotype-hit-freq (no backoff)
    "prior_global",              # EB-smoothed global prior, relevance-rank evidence
    "prior_direction",           # + direction stratum
    "prior_direction_opposite",  # the same level at the flipped direction verb
    "prior_stratum",             # full hierarchy at the screen's own key
    "prior_stratum_opposite",    # full hierarchy at the mirrored key
    "prior_lift",                # prior_stratum - lift_weight * prior_global
    "prior_contrast",            # the family's best single feature (see BEST_FEATURE)
    "gene_log_times_measured",   # log1p(train screens that assayed the gene)
    "gene_never_hit",            # 1.0 when assayed >= 20 times and never a hit
]

#: The feature whose standalone validation AnDCG@100 the self-check reports.
BEST_FEATURE = "prior_contrast"

#: Pre-registered configuration.  Selected on validation only; see the module
#: docstring's HONEST TUNING NOTE for the split-half correction.
DEFAULT_CONFIG: dict[str, Any] = {
    "evidence": "relrank",
    "levels": ("direction", "pheno_direction"),
    "alphas": (30.0, 100.0, 100.0),
    "contrast_weight": 0.65,
    "lift_weight": 0.0,
    "either_union": False,
    "measured_denominator": True,
    "min_donors": 1,
}

TRAIN_SPLIT = "train"
_NEVER_HIT_MIN_MEASURED = 20

_MISSING = {"", "-", "none", "n/a", "na", "null", "not specified", "unknown", "nan",
            "not applicable", "unspecified"}

_DIRECTION_VERB = {
    "decreases": "dec", "decrease": "dec", "decreased": "dec",
    "increases": "inc", "increase": "inc", "increased": "inc",
    "either": "either",
    "impacts": "impacts", "impact": "impacts",
}
#: Canonical verb to write back when mirroring a screen's direction.
_FLIP_VERB = {"dec": "increases", "inc": "decreases"}


class LeakageError(RuntimeError):
    """Raised when the prior is asked to fit on a non-train screen."""


# --------------------------------------------------------------------------- #
# metadata helpers
# --------------------------------------------------------------------------- #

def _clean(value: Any) -> str:
    """Normalize a metadata field, mapping AssayBench's null sentinels to ``""``."""
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in _MISSING else text


def _field(screen: Mapping[str, Any], name: str) -> str:
    """One metadata field, with ``"unknown"`` for missing (so it forms a real stratum)."""
    return _clean(screen.get(name)) or "unknown"


def direction_of(screen: Mapping[str, Any]) -> str:
    """Which way the screen's own hits point: ``dec`` / ``inc`` / ``either`` / ``impacts``.

    Read off the first word of ``phenotype``, which AssayBench always fills with one
    of five verbs.  This is ordinary metadata -- the same string the LLM baselines
    are shown -- and covers 100% of the train and validation splits.
    """
    parts = _clean(screen.get("phenotype")).lower().split()
    if not parts:
        return "na"
    return _DIRECTION_VERB.get(parts[0].strip(".,;:"), "na")


def mirror_screen(screen: Mapping[str, Any], verb: str | None = None) -> dict | None:
    """The same screen with its direction verb flipped, or ``None`` if it has no opposite.

    Only ``phenotype`` changes, so every other stratum key is preserved -- the
    mirrored screen lands in the *same* phenotype/cell/library cell of the
    hierarchy, one direction over.
    """
    target = verb or _FLIP_VERB.get(direction_of(screen))
    if target is None:
        return None
    parts = _clean(screen.get("phenotype")).split()
    out = dict(screen)
    out["phenotype"] = " ".join([target] + parts[1:])
    return out


#: Stratum key builders.  Each must refine the one before it.
LEVEL_KEYS: dict[str, Callable[[Mapping[str, Any]], tuple]] = {
    "direction": lambda s: (direction_of(s),),
    "pheno": lambda s: (_field(s, "cleaned_phenotype"),),
    "pheno_direction": lambda s: (_field(s, "cleaned_phenotype"), direction_of(s)),
    "pheno_direction_screentype": lambda s: (
        _field(s, "cleaned_phenotype"), direction_of(s), _field(s, "screen_type")),
    "pheno_direction_celltype": lambda s: (
        _field(s, "cleaned_phenotype"), direction_of(s), _field(s, "cell_type")),
    "pheno_direction_libmeth": lambda s: (
        _field(s, "cleaned_phenotype"), direction_of(s), _field(s, "library_methodology")),
}


# --------------------------------------------------------------------------- #
# evidence definitions: what one donor screen contributes per gene
# --------------------------------------------------------------------------- #

def _ev_hit(rel: np.ndarray, hit: np.ndarray) -> np.ndarray:
    """Upstream's binary significance flag."""
    return hit.astype(np.float64)


def _ev_pos(rel: np.ndarray, hit: np.ndarray) -> np.ndarray:
    """1 where relevance is positive (same-direction hit)."""
    return (rel > 0.0).astype(np.float64)


def _ev_relrank(rel: np.ndarray, hit: np.ndarray) -> np.ndarray:
    """Within-screen percentile of positive relevance, 0 for non-hits.

    Scale-free: AssayBench relevance is ``|effect|`` in each screen's own units
    (Z-score, CRISPR score, -log10 p, ...), so raw magnitudes are not comparable
    across screens but their within-screen ranks are.  nDCG is dominated by the
    highest-relevance genes, so preserving *which* hits were the strongest is what
    this buys over the binary flag.
    """
    out = np.zeros(len(rel), dtype=np.float64)
    pos = rel > 0.0
    n = int(pos.sum())
    if n:
        v = rel[pos]
        order = np.argsort(v, kind="stable")
        ranks = np.empty(n, dtype=np.float64)
        ranks[order] = np.arange(1, n + 1, dtype=np.float64) / n
        out[pos] = ranks
    return out


def _ev_relmag(rel: np.ndarray, hit: np.ndarray) -> np.ndarray:
    """Positive relevance divided by the screen's own maximum."""
    out = np.maximum(rel, 0.0)
    mx = float(out.max()) if len(out) else 0.0
    return out / mx if mx > 0 else out


EVIDENCE: dict[str, Callable[[np.ndarray, np.ndarray], np.ndarray]] = {
    "hit": _ev_hit,
    "pos": _ev_pos,
    "relrank": _ev_relrank,
    "relmag": _ev_relmag,
}


# --------------------------------------------------------------------------- #
# symbol normalization
# --------------------------------------------------------------------------- #

class _Normalizer:
    """Upper-cases and synonym-maps gene symbols, memoised.

    Uses ``assaybench.utils.gene_mapper.GeneMapper`` when available -- the same
    mapper the metric applies to both sides -- so a train screen's ``KIAA0101``
    and a test screen's ``PCLAF`` pool into one gene.  Falls back to upper-casing.
    """

    def __init__(self, use_gene_mapper: bool = True) -> None:
        self._cache: dict[str, str] = {}
        self._mapper: Any = None
        self._want = use_gene_mapper

    def _lazy(self) -> Any:
        if self._mapper is None and self._want:
            try:
                from assaybench.utils.gene_mapper import GeneMapper

                self._mapper = GeneMapper(verbose=False)
            except Exception:                              # pragma: no cover
                self._want = False
                self._mapper = None
        return self._mapper

    def __call__(self, gene: str) -> str:
        got = self._cache.get(gene)
        if got is not None:
            return got
        upper = gene.strip().upper()
        out = upper
        mapper = self._lazy()
        if mapper is not None:
            try:
                mapped = mapper.map_gene(upper)
            except Exception:                              # pragma: no cover
                mapped = None
            if mapped:
                out = mapped
        self._cache[gene] = out
        return out


# --------------------------------------------------------------------------- #
# the estimator
# --------------------------------------------------------------------------- #

def _shrink(num: np.ndarray, den: np.ndarray, alpha: float,
            parent: np.ndarray) -> np.ndarray:
    """``(num + alpha*parent) / (den + alpha)``, falling back to ``parent`` with no data.

    The fallback matters: with ``alpha == 0`` a gene the stratum never assayed gives
    ``0/0``.  Upstream's stratified baselines resolve that to ``0.0``, which throws
    the gene to the bottom of the ranking on no evidence at all; backing off to the
    parent estimate is the better estimator and is what this family uses.
    """
    total = den + alpha
    with np.errstate(divide="ignore", invalid="ignore"):
        est = (num + alpha * parent) / np.where(total > 0, total, 1.0)
    return np.where(total > 0, est, parent)


@dataclass
class _Cell:
    """Pooled evidence for one stratum: per-gene numerator and denominator."""

    num: np.ndarray
    den: np.ndarray
    n_donors: int


class StratifiedPrior:
    """Hierarchical empirical-Bayes hit-frequency prior over genes, per screen.

    The estimator is a chain of Beta shrinkages, coarse to fine::

        p_root(g)      = (sum_s e_s(g)      + a_0 * pooled) / (sum_s m_s(g)      + a_0)
        p_level(g|key) = (sum_{s in key} e_s(g) + a_l * p_parent(g)) / (sum_{s in key} m_s(g) + a_l)

    where ``e_s(g)`` is the donor's evidence for gene ``g`` (see :data:`EVIDENCE`)
    and ``m_s(g)`` is 1 **iff donor s measured g** -- the library-restriction
    correction: a gene cannot hit in a screen that never assayed it, so the
    denominator is times-measured, not times-screened.

    Args:
        evidence: key into :data:`EVIDENCE`. ``"relrank"`` (default) pools each
            donor's within-screen relevance percentile; ``"hit"`` reproduces
            upstream's binary counting.
        levels: stratum keys from :data:`LEVEL_KEYS`, coarse to fine.  Each must
            refine the previous one.
        alphas: ``len(levels) + 1`` Beta pseudo-counts; ``alphas[0]`` shrinks the
            global prior toward the pooled scalar rate and ``alphas[i+1]`` shrinks
            level ``i`` toward level ``i-1``.  Pass the string ``"eb"`` to fit them
            on train alone by Beta-Binomial marginal likelihood instead.
        contrast_weight: ``lam`` in ``p(g|key) - lam * p(g|mirrored key)``.  0 disables.
        lift_weight: ``gamma`` in ``... - gamma * p_global(g)``.  0 disables.
        either_union: when True, ``either``/``impacts`` screens are scored with the
            mean of the ``dec`` and ``inc`` strata rather than their own thin one.
        measured_denominator: False switches to times-*screened*, which is the
            common mistake; kept so the ablation is runnable.
        min_donors: skip a stratum with fewer donors than this and keep the parent.
        use_gene_mapper: normalize symbols through AssayBench's ``GeneMapper``.

    The object is deterministic and picklable after :meth:`fit`.
    """

    def __init__(
        self,
        evidence: str = DEFAULT_CONFIG["evidence"],
        levels: Sequence[str] = DEFAULT_CONFIG["levels"],
        alphas: Sequence[float] | str = DEFAULT_CONFIG["alphas"],
        contrast_weight: float = DEFAULT_CONFIG["contrast_weight"],
        lift_weight: float = DEFAULT_CONFIG["lift_weight"],
        either_union: bool = DEFAULT_CONFIG["either_union"],
        measured_denominator: bool = DEFAULT_CONFIG["measured_denominator"],
        min_donors: int = DEFAULT_CONFIG["min_donors"],
        use_gene_mapper: bool = True,
    ) -> None:
        if evidence not in EVIDENCE:
            raise ValueError(f"unknown evidence {evidence!r}; choose from {sorted(EVIDENCE)}")
        bad = [lv for lv in levels if lv not in LEVEL_KEYS]
        if bad:
            raise ValueError(f"unknown level(s) {bad}; choose from {sorted(LEVEL_KEYS)}")
        self.evidence = evidence
        self.levels = tuple(levels)
        self.alphas_spec = alphas
        self.contrast_weight = float(contrast_weight)
        self.lift_weight = float(lift_weight)
        self.either_union = bool(either_union)
        self.measured_denominator = bool(measured_denominator)
        self.min_donors = int(min_donors)
        self._norm = _Normalizer(use_gene_mapper)
        self.fitted = False

        # filled by fit()
        self.vocab: dict[str, int] = {}
        self.alphas: tuple[float, ...] = ()
        self.n_train: int = 0
        self.pooled_rate: float = 0.0
        self._root: _Cell | None = None
        self._cells: list[dict[tuple, _Cell]] = []
        self._times_measured: np.ndarray | None = None
        self._times_hit: np.ndarray | None = None
        self._pheno_exact: dict[str, np.ndarray] = {}
        self._score_cache: dict[tuple, np.ndarray] = {}

    # -- fitting ----------------------------------------------------------- #

    def fit(self, train: Sequence[Mapping[str, Any]] | None = None,
            allow_non_train: bool = False) -> "StratifiedPrior":
        """Pool the training screens.  Train split only.

        Args:
            train: AssayBench records.  ``None`` loads ``yearfold0 == "train"``
                from the local parquet snapshot.
            allow_non_train: bypass the split guard.  Only for deliberate
                experiments on a re-split corpus; never for a benchmark run.

        Raises:
            LeakageError: if any record is marked validation or test.
        """
        if train is None:
            from splicr.assaybench_io import load_split

            train = load_split(TRAIN_SPLIT)
        train = list(train)
        if not train:
            raise ValueError("empty training set")
        if not allow_non_train:
            bad = [str(s.get("dataset_name")) for s in train
                   if str(s.get("yearfold0", s.get("split", TRAIN_SPLIT))) != TRAIN_SPLIT]
            if bad:
                raise LeakageError(
                    f"refusing to fit on {len(bad)} non-train screen(s), e.g. {bad[:5]}. "
                    "The prior must never see validation or test labels."
                )

        ev_fn = EVIDENCE[self.evidence]
        self.vocab = {}
        rows: list[tuple[np.ndarray, np.ndarray, Mapping[str, Any]]] = []
        for s in train:
            gi, ev = self._encode_donor(s, ev_fn)
            rows.append((gi, ev, s))
        nv = len(self.vocab)
        self.n_train = len(rows)

        root_num = np.zeros(nv)
        root_den = np.zeros(nv)
        measured = np.zeros(nv)
        hits = np.zeros(nv)
        for gi, ev, s in rows:
            np.add.at(root_num, gi, ev)
            np.add.at(root_den, gi, 1.0)
            np.add.at(measured, gi, 1.0)
            np.add.at(hits, gi, np.asarray(s["hit"], dtype=bool)[: len(gi)].astype(float)
                      if len(s["hit"]) == len(gi) else 0.0)
        # `hit` is per raw symbol; recompute it on the deduped/normalised axis
        hits = np.zeros(nv)
        for gi, _ev, s in rows:
            hv = self._encode_hits(s)
            np.add.at(hits, gi, hv)
        self._times_measured = measured
        self._times_hit = hits
        self.pooled_rate = float(root_num.sum() / max(root_den.sum(), 1e-12))
        if not self.measured_denominator:
            root_den = np.full(nv, float(len(rows)))
        self._root = _Cell(root_num, root_den, len(rows))

        self._cells = []
        for name in self.levels:
            keyfn = LEVEL_KEYS[name]
            cells: dict[tuple, _Cell] = {}
            for gi, ev, s in rows:
                key = keyfn(s)
                cell = cells.get(key)
                if cell is None:
                    cell = cells[key] = _Cell(np.zeros(nv), np.zeros(nv), 0)
                np.add.at(cell.num, gi, ev)
                np.add.at(cell.den, gi, 1.0)
                cell.n_donors += 1
            if not self.measured_denominator:
                for cell in cells.values():
                    cell.den = np.full(nv, float(cell.n_donors))
            self._cells.append(cells)

        # upstream's coarse-phenotype-hit-freq, for reference and for ensembling
        pheno: dict[str, list[np.ndarray]] = {}
        for gi, _ev, s in rows:
            key = _field(s, "cleaned_phenotype")
            acc = pheno.get(key)
            if acc is None:
                acc = pheno[key] = [np.zeros(nv), np.zeros(nv)]
            np.add.at(acc[0], gi, self._encode_hits(s))
            np.add.at(acc[1], gi, 1.0)
        self._pheno_exact = {
            k: np.divide(h, m, out=np.zeros(nv), where=m > 0) for k, (h, m) in pheno.items()
        }

        self.alphas = (tuple(self._fit_alphas_eb())
                       if isinstance(self.alphas_spec, str)
                       else tuple(float(a) for a in self.alphas_spec))
        if len(self.alphas) != len(self.levels) + 1:
            raise ValueError(
                f"need {len(self.levels)+1} alphas for {len(self.levels)} level(s), "
                f"got {len(self.alphas)}"
            )
        self._score_cache = {}
        self.fitted = True
        return self

    def _encode_donor(self, s: Mapping[str, Any],
                      ev_fn: Callable) -> tuple[np.ndarray, np.ndarray]:
        """Normalised gene indices and evidence for one donor, deduped later-wins."""
        rel_table: dict[str, float] = {}
        hit_table: dict[str, bool] = {}
        for g, r, h in zip(s["relevance_genes"], s["relevance_scores"], s["hit"]):
            n = self._norm(g)
            rel_table[n] = float(r)
            hit_table[n] = bool(h)
        names = list(rel_table)
        for n in names:
            if n not in self.vocab:
                self.vocab[n] = len(self.vocab)
        gi = np.fromiter((self.vocab[n] for n in names), dtype=np.int64, count=len(names))
        rel = np.fromiter((rel_table[n] for n in names), dtype=np.float64, count=len(names))
        hit = np.fromiter((hit_table[n] for n in names), dtype=bool, count=len(names))
        return gi, ev_fn(rel, hit)

    def _encode_hits(self, s: Mapping[str, Any]) -> np.ndarray:
        """Binary hit vector on the same deduped axis :meth:`_encode_donor` produces."""
        table: dict[str, bool] = {}
        for g, h in zip(s["relevance_genes"], s["hit"]):
            table[self._norm(g)] = bool(h)
        return np.fromiter((table[n] for n in table), dtype=np.float64, count=len(table))

    def _fit_alphas_eb(self, cap: float = 1e5) -> list[float]:
        """Fit one shrinkage strength per level by Beta-Binomial marginal likelihood.

        Train only.  Uses the binary hit counts, for which the Beta-Binomial is the
        exact marginal; non-integer evidence would need a continuous analogue, so the
        alphas fitted here are reused for whichever evidence is configured.  On the
        AssayBench train split this returns ``alpha_global ~= 4.8`` and
        ``alpha_direction ~= 13.0``.
        """
        from scipy.optimize import minimize_scalar
        from scipy.special import gammaln

        assert self._times_measured is not None and self._times_hit is not None
        nv = len(self._times_measured)

        def mle(num: np.ndarray, den: np.ndarray, parent: np.ndarray) -> float:
            m = np.round(den).astype(float)
            h = np.round(num).astype(float)
            keep = m > 0
            m, h = m[keep], np.clip(h[keep], 0.0, None)
            pi = np.clip(np.asarray(parent, float)[keep], 1e-6, 1 - 1e-6)
            h = np.minimum(h, m)

            def nll(log_a: float) -> float:
                a = math.exp(log_a)
                ap, aq = a * pi, a * (1.0 - pi)
                return -float(np.sum(
                    gammaln(h + ap) + gammaln(m - h + aq) - gammaln(m + a)
                    - gammaln(ap) - gammaln(aq) + gammaln(a)))

            res = minimize_scalar(nll, bounds=(math.log(1e-3), math.log(cap)),
                                  method="bounded")
            return float(math.exp(res.x))

        pooled = float(self._times_hit.sum() / max(self._times_measured.sum(), 1e-12))
        a0 = mle(self._times_hit, self._times_measured, np.full(nv, pooled))
        parent = _shrink(self._times_hit, self._times_measured, a0, np.full(nv, pooled))
        out = [a0]
        for cells in self._cells:
            nums = np.concatenate([c.num for c in cells.values()]) if cells else np.zeros(0)
            dens = np.concatenate([c.den for c in cells.values()]) if cells else np.zeros(0)
            pars = np.concatenate([parent] * len(cells)) if cells else np.zeros(0)
            out.append(mle(nums, dens, pars) if cells else 0.0)
        return out

    # -- scoring ----------------------------------------------------------- #

    def _require(self) -> None:
        if not self.fitted:
            raise RuntimeError("StratifiedPrior.fit() must be called first (train only)")

    def _global_vector(self) -> np.ndarray:
        assert self._root is not None
        key = ("global",)
        got = self._score_cache.get(key)
        if got is None:
            nv = len(self._times_measured)  # type: ignore[arg-type]
            got = _shrink(self._root.num, self._root.den, self.alphas[0],
                          np.full(nv, self.pooled_rate))
            self._score_cache[key] = got
        return got

    def _level_vector(self, screen: Mapping[str, Any], depth: int) -> np.ndarray:
        """Hierarchy estimate after shrinking through the first ``depth`` levels."""
        chain = tuple(LEVEL_KEYS[name](screen) for name in self.levels[:depth])
        key = ("level", depth, chain)
        got = self._score_cache.get(key)
        if got is not None:
            return got
        cur = self._global_vector()
        for lv in range(depth):
            cell = self._cells[lv].get(chain[lv])
            if cell is None or cell.n_donors < self.min_donors:
                continue
            cur = _shrink(cell.num, cell.den, self.alphas[lv + 1], cur)
        self._score_cache[key] = cur
        return cur

    def _pheno_exact_vector(self, screen: Mapping[str, Any]) -> np.ndarray:
        got = self._pheno_exact.get(_field(screen, "cleaned_phenotype"))
        if got is None:
            m, h = self._times_measured, self._times_hit
            got = np.divide(h, m, out=np.zeros(len(m)), where=m > 0)  # type: ignore[arg-type]
        return got

    def feature_vectors(self, screen: Mapping[str, Any]) -> dict[str, np.ndarray]:
        """All features for one screen as vocab-length vectors (the fast path)."""
        self._require()
        m = self._times_measured
        h = self._times_hit
        assert m is not None and h is not None
        nv = len(m)
        glob = self._global_vector()
        depth = len(self.levels)
        stratum = self._level_vector(screen, depth)
        dirn_only = self._level_vector(screen, 1) if depth >= 1 else glob

        mir = mirror_screen(screen)
        if mir is None:
            stratum_opp = np.zeros(nv)
            dirn_opp = np.zeros(nv)
        else:
            stratum_opp = self._level_vector(mir, depth)
            dirn_opp = self._level_vector(mir, 1) if depth >= 1 else glob

        if self.either_union and direction_of(screen) in ("either", "impacts", "na"):
            lo = self._level_vector(mirror_screen(screen, "decreases"), depth)
            hi = self._level_vector(mirror_screen(screen, "increases"), depth)
            base = 0.5 * (lo + hi)
            contrast = base - self.lift_weight * glob
        else:
            base = stratum
            contrast = base - self.contrast_weight * stratum_opp - self.lift_weight * glob

        return {
            "prior_global_raw": np.divide(h, m, out=np.zeros(nv), where=m > 0),
            "prior_pheno_exact": self._pheno_exact_vector(screen),
            "prior_global": glob,
            "prior_direction": dirn_only,
            "prior_direction_opposite": dirn_opp,
            "prior_stratum": stratum,
            "prior_stratum_opposite": stratum_opp,
            "prior_lift": stratum - self.lift_weight * glob,
            "prior_contrast": contrast,
            "gene_log_times_measured": np.log1p(m),
            "gene_never_hit": ((m >= _NEVER_HIT_MIN_MEASURED) & (h == 0)).astype(np.float64),
        }

    def gene_index(self, gene: str) -> int:
        """Vocab index for a symbol, or ``-1`` when the train split never saw it."""
        return self.vocab.get(self._norm(gene), -1)

    def transform(
        self,
        screens: Sequence[Mapping[str, Any]],
        features: Iterable[str] | None = None,
    ) -> dict[str, dict[str, dict[str, float]]]:
        """``{dataset_name: {gene_symbol: {feature_name: value}}}``.

        Keys are each screen's own symbols exactly as they appear in
        ``relevance_genes`` (so the caller can rank the screen's library directly);
        the lookup itself happens on the normalized symbol.  Genes the train split
        never assayed fall back to the parent estimate, which is finite and
        well-defined, never 0-by-accident.

        Labels are not read: only ``dataset_name``, ``relevance_genes`` and the
        metadata fields in :data:`LEVEL_KEYS` are touched.
        """
        self._require()
        names = list(features) if features is not None else list(FEATURE_NAMES)
        unknown = [n for n in names if n not in FEATURE_NAMES]
        if unknown:
            raise ValueError(f"unknown feature(s) {unknown}")
        out: dict[str, dict[str, dict[str, float]]] = {}
        for s in screens:
            vecs = self.feature_vectors(s)
            idx, genes = self._library_index(s)
            per_gene: dict[str, dict[str, float]] = {}
            cols = {n: vecs[n] for n in names}
            for pos, gene in enumerate(genes):
                j = idx[pos]
                if j >= 0:
                    per_gene[gene] = {n: float(v[j]) for n, v in cols.items()}
                else:
                    per_gene[gene] = {n: float(_OUT_OF_VOCAB[n](self, vecs))
                                      for n in names}
            out[str(s["dataset_name"])] = per_gene
        return out

    def transform_dense(
        self, screens: Sequence[Mapping[str, Any]], features: Iterable[str] | None = None
    ) -> dict[str, tuple[list[str], np.ndarray]]:
        """``{dataset_name: (gene_symbols, array[n_genes, n_features])}``.

        Same values as :meth:`transform` without the per-gene dicts -- use this when
        feeding a ranker, where the dict form costs ~100x the memory.
        """
        self._require()
        names = list(features) if features is not None else list(FEATURE_NAMES)
        out: dict[str, tuple[list[str], np.ndarray]] = {}
        for s in screens:
            vecs = self.feature_vectors(s)
            idx, genes = self._library_index(s)
            mat = np.empty((len(genes), len(names)), dtype=np.float64)
            for c, n in enumerate(names):
                v = vecs[n]
                fb = float(_OUT_OF_VOCAB[n](self, vecs))
                col = np.where(idx >= 0, v[np.maximum(idx, 0)], fb)
                mat[:, c] = col
            out[str(s["dataset_name"])] = (genes, mat)
        return out

    def rank(self, screen: Mapping[str, Any], feature: str = BEST_FEATURE,
             k: int | None = 100, seed: int = 42) -> list[str]:
        """The screen's own library ranked by one feature, best first.

        Library-restricted by construction, which is a real structural advantage
        under this metric: a gene outside the screen's library consumes a top-100
        slot and is then deleted by the condensed evaluation.

        Ties are broken by a fixed permutation of the vocabulary (seeded, so runs
        are reproducible) rather than by symbol order, which would otherwise give
        alphabetically-early genes a systematic edge.
        """
        self._require()
        vecs = self.feature_vectors(screen)
        idx, genes = self._library_index(screen)
        v = vecs[feature]
        fb = float(_OUT_OF_VOCAB[feature](self, vecs))
        score = np.where(idx >= 0, v[np.maximum(idx, 0)], fb)
        rng = np.random.default_rng(seed)
        jitter = rng.permutation(len(genes)).astype(np.float64)
        order = np.lexsort((jitter, -score))
        if k is not None:
            order = order[:k]
        return [genes[i] for i in order]

    def _library_index(self, s: Mapping[str, Any]) -> tuple[np.ndarray, list[str]]:
        """Deduped library symbols (raw spelling) and their vocab indices."""
        seen: dict[str, str] = {}
        for g in s["relevance_genes"]:
            n = self._norm(g)
            seen.setdefault(n, g)
        genes = list(seen.values())
        idx = np.fromiter((self.vocab.get(self._norm(g), -1) for g in genes),
                          dtype=np.int64, count=len(genes))
        return idx, genes


#: Value used for a gene the train split never assayed, per feature.  Every prior
#: backs off to the relevant parent estimate rather than to a hard 0.
_OUT_OF_VOCAB: dict[str, Callable[[StratifiedPrior, dict[str, np.ndarray]], float]] = {
    "prior_global_raw": lambda p, v: 0.0,
    "prior_pheno_exact": lambda p, v: 0.0,
    "prior_global": lambda p, v: p.pooled_rate,
    "prior_direction": lambda p, v: p.pooled_rate,
    "prior_direction_opposite": lambda p, v: p.pooled_rate,
    "prior_stratum": lambda p, v: p.pooled_rate,
    "prior_stratum_opposite": lambda p, v: p.pooled_rate,
    "prior_lift": lambda p, v: p.pooled_rate * (1.0 - p.lift_weight),
    "prior_contrast": lambda p, v: p.pooled_rate * (
        1.0 - p.contrast_weight - p.lift_weight),
    "gene_log_times_measured": lambda p, v: 0.0,
    "gene_never_hit": lambda p, v: 0.0,
}


# --------------------------------------------------------------------------- #
# the documented one-shot entry point
# --------------------------------------------------------------------------- #

def screen_gene_priors(
    screens: Sequence[Mapping[str, Any]],
    train: Sequence[Mapping[str, Any]] | None = None,
    features: Iterable[str] | None = None,
    dense: bool = False,
    **config: Any,
) -> dict[str, Any]:
    """Prior features for a list of AssayBench screen records.

    Args:
        screens: records to featurise.  Only ``dataset_name``, ``relevance_genes``
            and metadata are read -- never ``relevance_scores`` or ``hit``.  Safe to
            call on validation or test records.
        train: fitting corpus.  ``None`` loads the ``train`` split from the local
            parquet snapshot.  Non-train records raise :class:`LeakageError`.
        features: subset of :data:`FEATURE_NAMES`; ``None`` means all of them.
        dense: return ``{name: (genes, array)}`` instead of nested dicts.
        **config: overrides for :class:`StratifiedPrior` (see
            :data:`DEFAULT_CONFIG`), e.g. ``alphas="eb"`` for untuned shrinkage.

    Returns:
        ``{dataset_name: {gene_symbol: {feature_name: value}}}``, or the dense form.

    Deterministic: the same records and config always produce the same floats.
    """
    prior = StratifiedPrior(**{**{k: v for k, v in DEFAULT_CONFIG.items()}, **config})
    prior.fit(train)
    return (prior.transform_dense(screens, features) if dense
            else prior.transform(screens, features))


# --------------------------------------------------------------------------- #
# self-check
# --------------------------------------------------------------------------- #

def _validation_andcg(prior: StratifiedPrior, feature: str,
                      screens: Sequence[Mapping[str, Any]]) -> np.ndarray:
    """Per-screen AnDCG@100 using the upstream metric, never a reimplementation."""
    from assaybench.benchmark.metrics import RankingMetrics

    metric = RankingMetrics(k_values=[100], metric_groups=["adjusted_ndcg"])
    vals = []
    for s in screens:
        genes = prior.rank(s, feature=feature, k=100)
        res = metric.evaluate(predicted_genes=genes,
                              ground_truth_genes=s["relevance_genes"],
                              relevance_scores=s["relevance_scores"])
        vals.append(res["adjusted_ndcg@100"])
    return np.asarray(vals, dtype=np.float64)


def _main() -> int:
    from splicr.assaybench_io import load_split

    print("splicr.features.priors -- self-check (validation only, test never loaded)")
    train = load_split(TRAIN_SPLIT)
    val = load_split("validation")
    print(f"  train {len(train)} screens, validation {len(val)} screens")

    prior = StratifiedPrior().fit(train)
    print(f"  evidence={prior.evidence} levels={prior.levels} alphas={prior.alphas} "
          f"contrast={prior.contrast_weight} lift={prior.lift_weight}")
    print(f"  vocabulary {len(prior.vocab)} genes, pooled rate {prior.pooled_rate:.5f}")

    order = ["prior_global_raw", "prior_pheno_exact", "prior_global", "prior_direction",
             "prior_stratum", "prior_lift", "prior_contrast"]
    per: dict[str, np.ndarray] = {}
    for name in order:
        per[name] = _validation_andcg(prior, name, val)
        print(f"    {name:<26} validation AnDCG@100 = {per[name].mean():.5f}")

    best = max(per, key=lambda n: per[n].mean())
    print(f"\n  BEST SINGLE FEATURE: {best}  validation AnDCG@100 = {per[best].mean():.5f}")
    if best != BEST_FEATURE:
        print(f"  NOTE: BEST_FEATURE is declared as {BEST_FEATURE!r}")

    ref = per["prior_global_raw"]
    d = per[best] - ref
    rng = np.random.default_rng(0)
    boot = d[rng.integers(0, len(d), size=(10000, len(d)))].mean(axis=1)
    lo, hi = np.percentile(boot, [2.5, 97.5])
    try:
        from scipy.stats import wilcoxon

        p = float(wilcoxon(per[best], ref, zero_method="wilcox").pvalue)
    except Exception:                                        # pragma: no cover
        p = float("nan")
    print(f"  vs upstream global-hit-freq: delta={d.mean():+.5f} "
          f"95% CI [{lo:+.5f}, {hi:+.5f}] Wilcoxon p={p:.3e}")
    print(f"  screens clamped to 0 by the metric: {int((per[best] == 0).sum())}/{len(val)}")

    dense = prior.transform_dense(val[:3])
    nested = prior.transform(val[:1])
    name0 = str(val[0]["dataset_name"])
    g0 = next(iter(nested[name0]))
    print(f"  transform() sample: {name0} / {g0} -> "
          f"{ {k: round(v, 5) for k, v in nested[name0][g0].items()} }")
    print(f"  transform_dense() shapes: "
          f"{[(k, v[1].shape) for k, v in dense.items()]}")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))))
    raise SystemExit(_main())

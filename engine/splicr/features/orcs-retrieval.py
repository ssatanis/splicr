#!/usr/bin/env python
"""ORCS-backed retrieval features for AssayBench gene ranking.

WHAT THIS IS
------------
AssayBench ships only ``relevance_genes`` / ``relevance_scores`` per screen.  The
raw BioGRID ORCS archive ships, for *every* screen, the full assayed gene list
plus a gene-level ``HIT`` call and a continuous ``SCORE.1``.  That is a much
richer basis for screen-to-screen retrieval than the AssayBench records alone:

* 1,574 donor screens instead of 1,349 (the safe pool contains 368 screens
  AssayBench never turned into records at all),
* the *full* library per donor, so the "did this donor even measure this gene"
  denominator is exact,
* graded hit strength from ``SCORE.1``, and
* the ORCS screen index's own metadata (``CONDITION_NAME``, ``SCREEN_RATIONALE``,
  ``NOTES``, ``LIBRARY``, ...), which is what the retrieval similarity is built on.

LEAKAGE
-------
AssayBench *is* BioGRID ORCS: 1,565 of the 1,952 human ORCS screens are
AssayBench records, and for a validation/test screen the ORCS ``HIT`` column is
literally the answer key (reading a screen's own ORCS record scores AnDCG@100
0.676, vs an oracle-kNN upper bound of 0.292).  Every ORCS read in this module
therefore goes through :mod:`splicr.orcs_safe`, which enforces the audited
exclusion boundary (``publication`` policy: 378 excluded, 1,574 safe) at the
point of read and raises :class:`splicr.orcs_safe.LeakageError` otherwise.  The
safe-only parsed cache physically does not contain the excluded screens.

The query side is label-free by construction: input records are wrapped in
:class:`_ScreenView`, which raises :class:`LabelAccessError` if anything in this
module touches ``relevance_scores`` or ``hit``.  Only metadata and
``relevance_genes`` (the library, i.e. which genes were measured) are read.  So
the module is safe to run on the test split for *prediction*; it cannot read the
test split's labels even by accident.

WHAT THE FEATURES ARE
---------------------
Every feature is a per-(screen, gene) value, computed only for genes the query
screen actually measured.  Staying inside the query's library is a real
structural advantage on this benchmark: the "condensed" evaluation pads to k,
truncates to k, *then* drops unmeasured genes, so an out-of-library gene burns a
top-100 slot and is deleted.  We are 100% library-restricted.

The shared estimator is a direction-matched, similarity-weighted, Beta-smoothed
hit rate over safe ORCS donors::

    score(g) = sum_j w_j * H_j(g)  /  ( sum_j w_j * M_j(g) + eps * mean(w) )

``M_j(g)`` is 1 when donor *j* assayed *g*; ``H_j(g)`` is the donor's graded hit
strength for *g* in the query's direction, ``1/log2(2+rank)`` over that donor's
hits ordered by ``SCORE.1`` extremity.  The features differ in how ``w_j`` is
built and in which direction pool ``H`` is drawn from.

DIRECTION
---------
AnDCG's numerator does *not* clip negative relevance, so ranking an
opposite-direction gene actively subtracts.  Direction therefore matters, and it
is recoverable on both sides without touching labels or the ``dataset_name``
identifier:

* query side, from ``phenotype`` / ``ranking_rationale`` / ``significance_criteria``
  ("decreases cell proliferation" -> depletion; "increase drug resistance" ->
  enrichment; "either increases or decreases ..." -> both).  Audited against the
  1,349 train records' own ``dataset_name`` ``_dec``/``_inc``/``_merged`` suffix:
  168/169 suffixed records correct, 74/74 merged correct.
* donor side, from ORCS ``SCREEN_TYPE`` (Negative Selection -> depletion,
  Positive Selection -> enrichment, Phenotype Screen -> its own pool), falling
  back to the sign of ``SCORE.1`` for the 272 "Positive and Negative Selection"
  screens whose ``SCORE.1_TYPE`` has an interpretable sign.  Sign is *not*
  globally interpretable across ORCS (CERES negative = essential, Bayes Factor
  positive = essential), which is why ``SCREEN_TYPE`` leads.

USAGE
-----
    import sys; sys.path.insert(0, "/Users/sahaj/Documents/Projects/SplicR/engine")
    from splicr.features.orcs_retrieval import orcs_retrieval_features, FEATURE_NAMES
    from splicr.assaybench_io import load_split

    feats, names = orcs_retrieval_features(load_split("validation"))
    feats["2063"]["TP53"]["orcs_retrieval_rate"]

Self-check (prints the standalone validation AnDCG@100 of every feature)::

    python engine/splicr/features/orcs-retrieval.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tarfile
import time
from collections.abc import Mapping as _MappingABC
from functools import lru_cache
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
from scipy import sparse

_HERE = os.path.dirname(os.path.abspath(__file__))
_ENGINE = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _ENGINE not in sys.path:  # so the file runs as a script, not only as a module
    sys.path.insert(0, _ENGINE)

from splicr.orcs_safe import (  # noqa: E402
    PARSED_DIR,
    LeakageError,
    assert_safe,
    boundary,
    safe_ids,
)

ORCS_ARCHIVE = os.environ.get(
    "ORCS_ARCHIVE",
    "/Users/sahaj/Documents/Projects/SplicR/data/references/orcs/orcs-human.tar.gz",
)
INDEX_MEMBER = "BIOGRID-ORCS-SCREEN_INDEX-2.0.18.index.tab.txt"
INDEX_CACHE = os.path.join(PARSED_DIR, "orcs_human_safe_index.json")
PROFILE_CACHE = os.path.join(PARSED_DIR, "orcs_safe_profiles.npz")
LONG_CACHE = os.path.join(PARSED_DIR, "orcs_human_safe_long.parquet")


# --------------------------------------------------------------------------- #
# feature family
# --------------------------------------------------------------------------- #

#: The family, in the order :func:`orcs_retrieval_features` emits it.
#:
#: ``orcs_retrieval_rate`` is the pre-registered primary feature; the others are
#: ablations and diagnostics kept because a downstream ranker can use them and
#: because two of them (``orcs_prf_rate``, ``orcs_cohit_ppmi``) are honest
#: negatives that should stay visible rather than be quietly dropped.
FEATURE_NAMES: list[str] = [
    "orcs_retrieval_rate",       # PRIMARY: library x drug x text similarity kNN, binary hits
    "orcs_retrieval_rate_graded",  # same, SCORE.1-graded hit strength (NEGATIVE RESULT: worse)
    "orcs_libnn_rate",           # library-containment similarity only
    "orcs_text_rate",            # TF-IDF metadata-text similarity only
    "orcs_hit_rate",             # direction-matched global smoothed hit rate (no retrieval)
    "orcs_hit_rate_stratum",     # restricted to phenotype-stratum-matched donors
    "orcs_opposite_rate",        # rate of being an OPPOSITE-direction hit (subtract this)
    "orcs_net_rate",             # orcs_retrieval_rate - NET_LAMBDA * orcs_opposite_rate
    "orcs_support_log",          # log1p(#safe donors that assayed the gene): confidence
    "orcs_prf_rate",             # pseudo-relevance-feedback rerank (NEGATIVE RESULT)
    "orcs_cohit_ppmi",           # co-hit PPMI against pseudo-positive seeds (NEGATIVE RESULT)
]

#: Pre-registered configuration of the primary feature, fixed on validation
#: before any test evaluation.  Chosen as the centre of a stable plateau of the
#: (cond_mult, text_mult, k) grid rather than the grid argmax.
PRIMARY = dict(cond_mult=15.0, text_mult=10.0, k=150, eps=1000.0, binary=True)
NET_LAMBDA = 1.0
PRF_TOP = 200          # pseudo-positives used by orcs_prf_rate
PRF_BETA = 1.0
STRATUM_SMOOTHING_FALLBACK = True


class LabelAccessError(RuntimeError):
    """Raised when this module tries to read a query screen's labels."""


_LABEL_KEYS = frozenset({"relevance_scores", "hit"})


class _ScreenView(_MappingABC):
    """Read-only view of an AssayBench record that hides the labels.

    Feature code may read metadata and ``relevance_genes`` (which genes the
    screen assayed -- the library).  Touching ``relevance_scores`` or ``hit``
    raises, which is what makes "never fits on the test split" a property of the
    code rather than a promise in a docstring.
    """

    __slots__ = ("_rec",)

    def __init__(self, rec: Mapping[str, Any]) -> None:
        self._rec = rec

    def __getitem__(self, key: str) -> Any:
        if key in _LABEL_KEYS:
            raise LabelAccessError(
                f"orcs-retrieval tried to read {key!r}. This module is label-free on the "
                "query side; only metadata and relevance_genes may be used."
            )
        return self._rec[key]

    def __iter__(self):
        return (k for k in self._rec if k not in _LABEL_KEYS)

    def __len__(self) -> int:
        return sum(1 for _ in self)

    def get(self, key: str, default: Any = None) -> Any:
        if key in _LABEL_KEYS:
            raise LabelAccessError(f"orcs-retrieval tried to read {key!r}.")
        return self._rec.get(key, default)


# --------------------------------------------------------------------------- #
# cache building
# --------------------------------------------------------------------------- #

#: ``SCORE.1_TYPE`` values whose SIGN is interpretable, with negative meaning
#: depletion.  Used only for "Positive and Negative Selection" screens, where
#: ``SCREEN_TYPE`` cannot resolve a gene's direction.  Anything not listed falls
#: back to "this screen reports both directions and we cannot tell them apart".
SIGNED_NEG_DEPLETION = frozenset({
    "CERES score", "Chronos score", "Gene Effect", "Gene Score", "Score",
    "Log2FC", "Log2", "Log2 fold change", "Log2 Fold Change", "LFC",
    "log2 fold change", "CRISPR Score (CS)", "CS", "Beta Score", "T-score",
    "Z-score", "z-score", "Robust Z-score", "Normalized Z-score", "normZ",
    "DrugZ Score", "Delta Z score", "Delta Z scores",
    "Rho (Log2e Treated vs. Untreated)", "Signed -log10(p-Value)",
})

#: ORCS ``PHENOTYPE`` -> AssayBench ``cleaned_phenotype``.  ORCS uses a small
#: controlled vocabulary; AssayBench collapses it into five strata.
PHENOTYPE_TO_STRATUM = {
    "cell proliferation": "Fitness / Proliferation / Viability",
    "viability": "Fitness / Proliferation / Viability",
    "senescence": "Fitness / Proliferation / Viability",
    "tumorigenicity": "Fitness / Proliferation / Viability",
    "cell cycle": "Fitness / Proliferation / Viability",
    "apoptosis": "Fitness / Proliferation / Viability",
    "response to chemicals": "Drug / Chemical / Environmental Response",
    "response to toxin": "Drug / Chemical / Environmental Response",
    "response to radiation": "Drug / Chemical / Environmental Response",
    "response to virus": "Host-Pathogen / Infection Response",
    "response to bacteria": "Host-Pathogen / Infection Response",
    "phagocytosis": "Host-Pathogen / Infection Response",
    "protein/peptide accumulation": "Molecular Output / Reporter / Pathway Activity",
    "regulation of signal transduction phenotype": "Molecular Output / Reporter / Pathway Activity",
    "gene expression": "Molecular Output / Reporter / Pathway Activity",
    "protein/peptide distribution": "Trafficking / Localization / Structural",
    "protein transport": "Trafficking / Localization / Structural",
    "cell morphology": "Trafficking / Localization / Structural",
    "cell migration": "Trafficking / Localization / Structural",
    "cell adhesion": "Trafficking / Localization / Structural",
}

#: ORCS index fields concatenated into the donor text document for TF-IDF.
DONOR_TEXT_FIELDS = (
    "CONDITION_NAME", "CONDITION_DOSAGE", "EXPERIMENTAL_SETUP", "PHENOTYPE",
    "SCREEN_RATIONALE", "NOTES", "CELL_LINE", "CELL_TYPE", "SCREEN_TYPE",
    "LIBRARY_TYPE", "LIBRARY_METHODOLOGY", "LIBRARY",
)
#: AssayBench fields concatenated into the query text document, in the same order.
QUERY_TEXT_FIELDS = (
    "condition_name", "condition_dosage", "experimental_setup", "phenotype",
    "screen_rationale", "notes", "cell_line", "cell_type", "screen_type",
    "library_type", "library_methodology", "condition_clause",
)


def build_index_cache(archive: str = ORCS_ARCHIVE, out: str = INDEX_CACHE,
                      policy: str | None = None) -> str:
    """Extract the ORCS screen index and keep only rows for SAFE screen ids.

    The index ships inside the archive, so nothing is fetched.  Excluded screens
    are dropped here, at the point of read, so the cache on disk cannot leak.
    """
    ok = safe_ids(policy)
    with tarfile.open(archive, "r:gz") as tf:
        fh = tf.extractfile(INDEX_MEMBER)
        if fh is None:
            raise FileNotFoundError(f"{INDEX_MEMBER} not in {archive}")
        text = fh.read().decode("utf-8", "replace")
    lines = text.split("\n")
    header = [c.lstrip("#") for c in lines[0].split("\t")]
    screens: dict[str, dict[str, str]] = {}
    for line in lines[1:]:
        if not line.strip():
            continue
        row = dict(zip(header, line.split("\t")))
        sid = int(row["SCREEN_ID"])
        if sid in ok:
            screens[str(sid)] = row
    assert_safe([int(k) for k in screens], policy=policy)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as fh2:
        json.dump({"policy": policy or "publication",
                   "boundary_generated_utc": boundary()["generated_utc"],
                   "n": len(screens), "columns": header, "screens": screens}, fh2)
    return out


def build_profile_cache(long_parquet: str = LONG_CACHE, out: str = PROFILE_CACHE) -> str:
    """Normalise the safe long table's gene symbols once and store it compactly.

    Symbols go through the same ``GeneMapper`` the metric uses, so an ORCS symbol
    and an AssayBench symbol that denote the same gene land on the same index.
    """
    import pyarrow.parquet as pq

    from splicr import benchmark as bm

    table = pq.read_table(long_parquet)
    screen_id = table.column("screen_id").to_numpy()
    raw_genes = np.asarray(table.column("gene").to_pylist(), dtype=object)
    hit = table.column("hit").to_numpy(zero_copy_only=False)
    score1 = table.column("score1").to_numpy(zero_copy_only=False).astype(np.float32)
    del table
    assert_safe(np.unique(screen_id).tolist())

    andcg = bm.AnDCG(k=100)
    uniq_raw = np.unique(raw_genes)
    norm_of = {r: andcg.normalize(r) for r in uniq_raw}
    symbols = sorted(set(norm_of.values()))
    index_of = {g: i for i, g in enumerate(symbols)}
    raw_to_id = {r: index_of[norm_of[r]] for r in uniq_raw}
    gene_idx = np.fromiter((raw_to_id[g] for g in raw_genes), np.int32, len(raw_genes))
    del raw_genes

    order = np.argsort(screen_id, kind="stable")
    screen_id, gene_idx = screen_id[order], gene_idx[order]
    hit, score1 = hit[order], score1[order]
    sids, starts = np.unique(screen_id, return_index=True)
    ends = np.append(starts[1:], len(screen_id))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    np.savez_compressed(
        out, genes=np.array(symbols, dtype=object), screen_ids=sids.astype(np.int32),
        starts=starts.astype(np.int64), ends=ends.astype(np.int64),
        gene_idx=gene_idx, hit=hit, score1=score1,
    )
    return out


# --------------------------------------------------------------------------- #
# corpus
# --------------------------------------------------------------------------- #

_NZ = lambda s: re.sub(r"[^A-Z0-9]", "", (s or "").upper())  # noqa: E731
_TOKEN = re.compile(r"[a-z0-9]+")


def _tokens(text: str | None) -> frozenset[str]:
    return frozenset(t for t in _TOKEN.findall((text or "").lower()) if len(t) > 2)


class ORCSCorpus:
    """Direction-resolved hit profiles for the SAFE ORCS human screens.

    Attributes:
        genes: normalised gene symbols; column order of every matrix.
        gene_index: symbol -> column.
        screen_ids: ORCS ``SCREEN_ID`` per row.  Always inside the safe set.
        measured: ``(n_donors, n_genes)`` binary CSR -- donor assayed the gene.
        hits: ``{"dec", "inc", "pheno", "both"}`` -> graded-strength CSR.
        hits_bin: the same, binarised.
        direction: per-donor direction class, one of ``dec``, ``inc``, ``pheno``,
            ``mixed_split`` (both directions, resolved by ``SCORE.1`` sign),
            ``mixed_both`` (both directions, unresolvable) or ``none`` (no hits).
        compatible: direction -> boolean donor mask usable for that query direction.
        text: donor TF-IDF document per screen.
    """

    def __init__(self, policy: str | None = None) -> None:
        if not os.path.exists(PROFILE_CACHE):
            build_profile_cache()
        if not os.path.exists(INDEX_CACHE):
            build_index_cache(policy=policy)
        z = np.load(PROFILE_CACHE, allow_pickle=True)
        with open(INDEX_CACHE) as fh:
            idx = json.load(fh)
        self.meta: dict[int, dict[str, str]] = {int(k): v for k, v in idx["screens"].items()}
        self.genes: list[str] = list(z["genes"])
        self.gene_index: dict[str, int] = {g: i for i, g in enumerate(self.genes)}
        self.screen_ids = z["screen_ids"]
        assert_safe(self.screen_ids.tolist(), policy=policy)   # boundary, enforced on read
        assert_safe(list(self.meta), policy=policy)

        starts, ends = z["starts"], z["ends"]
        gene_idx, hit, score1 = z["gene_idx"], z["hit"], z["score1"]
        n_d, n_g = len(self.screen_ids), len(self.genes)

        rows = np.repeat(np.arange(n_d), ends - starts)
        measured = sparse.csr_matrix(
            (np.ones(len(gene_idx), np.float32), (rows, gene_idx)), shape=(n_d, n_g))
        measured.data[:] = 1.0            # csr_matrix sums duplicate (screen, gene) pairs
        self.measured = measured

        pools: dict[str, list[list]] = {p: [[], [], []] for p in ("dec", "inc", "pheno")}
        direction: list[str] = []
        for j, sid in enumerate(self.screen_ids):
            lo, hi = starts[j], ends[j]
            h, g, v = hit[lo:hi], gene_idx[lo:hi], score1[lo:hi]
            where = np.flatnonzero(h)
            if where.size == 0:
                direction.append("none")
                continue
            hit_g, hit_v = g[where], v[where]
            finite = np.isfinite(hit_v)
            strength = self._strength(v, where, hit_v, finite)
            row = self.meta[int(sid)]
            screen_type, score_type = row["SCREEN_TYPE"], row["SCORE.1_TYPE"]
            if screen_type == "Negative Selection":
                kind = "dec"
            elif screen_type == "Positive Selection":
                kind = "inc"
            elif screen_type == "Phenotype Screen":
                kind = "pheno"
            elif score_type in SIGNED_NEG_DEPLETION and finite.any():
                kind = "mixed_split"
            else:
                kind = "mixed_both"
            if kind in ("dec", "inc", "pheno"):
                self._add(pools[kind], j, hit_g, strength)
            elif kind == "mixed_split":
                neg, pos = finite & (hit_v < 0), finite & (hit_v > 0)
                self._add(pools["dec"], j, hit_g[neg], strength[neg])
                self._add(pools["inc"], j, hit_g[pos], strength[pos])
            else:  # direction unresolvable: half weight into each pool
                self._add(pools["dec"], j, hit_g, strength * 0.5)
                self._add(pools["inc"], j, hit_g, strength * 0.5)
            direction.append(kind)
        self.direction = np.array(direction, dtype=object)

        def mat(p: list[list]) -> sparse.csr_matrix:
            m = sparse.csr_matrix(
                (np.asarray(p[2], np.float32),
                 (np.asarray(p[0], np.int64), np.asarray(p[1], np.int64))), shape=(n_d, n_g))
            m.data = np.clip(m.data, 0.0, 1.0)     # duplicate gene rows must not accumulate
            return m

        dec, inc, pheno = mat(pools["dec"]), mat(pools["inc"]), mat(pools["pheno"])
        self.hits = {"dec": dec, "inc": inc, "pheno": pheno, "both": (dec + inc + pheno)}
        self.hits_bin = {}
        for key, m in self.hits.items():
            b = m.copy()
            b.data = (b.data > 0).astype(np.float32)
            self.hits_bin[key] = b
        self._hits_csc: dict[str, sparse.csc_matrix] = {}

        self.compatible = {
            "dec": np.isin(self.direction, ("dec", "mixed_split", "mixed_both")),
            "inc": np.isin(self.direction, ("inc", "mixed_split", "mixed_both")),
            "pheno": self.direction == "pheno",
            "both": self.direction != "none",
        }
        for key, mask in list(self.compatible.items()):
            if not mask.any():                      # never hand the caller an empty pool
                self.compatible[key] = self.direction != "none"
        self.stratum = np.array(
            [PHENOTYPE_TO_STRATUM.get((self.meta[int(s)].get("PHENOTYPE") or "").strip().lower(), "")
             for s in self.screen_ids], dtype=object)
        self.condition_tokens = [_tokens(self.meta[int(s)].get("CONDITION_NAME"))
                                 for s in self.screen_ids]
        self.text = [" | ".join(str(self.meta[int(s)].get(f) or "") for f in DONOR_TEXT_FIELDS)
                     for s in self.screen_ids]
        self.library_size = np.asarray(self.measured.sum(1)).ravel()
        self.support = np.asarray(self.measured.sum(0)).ravel()   # donors per gene

    # -- helpers ----------------------------------------------------------- #

    @staticmethod
    def _strength(all_scores, where, hit_scores, finite) -> np.ndarray:
        """Graded hit strength, ``1/log2(2+rank)``, strongest hit first.

        ``SCORE.1`` means different things in different screens (CERES negative =
        essential, Bayes Factor positive = essential), so the tail that holds the
        hits is read off the screen's *own* HIT flag rather than assumed.
        """
        orient = 1.0
        if finite.sum() > 1:
            ok = np.isfinite(all_scores)
            pct = np.full(len(all_scores), 0.5)
            if ok.sum() > 1:
                ranks = np.argsort(np.argsort(all_scores[ok])).astype(np.float64)
                pct[ok] = ranks / max(ok.sum() - 1, 1)
            orient = 1.0 if pct[where][finite].mean() > 0.5 else -1.0
        key = orient * np.where(finite, hit_scores, -np.inf)
        order = np.argsort(-key, kind="stable")
        out = np.empty(len(hit_scores), np.float32)
        out[order] = 1.0 / np.log2(2.0 + np.arange(len(hit_scores)))
        return out

    @staticmethod
    def _add(pool: list[list], row: int, cols: np.ndarray, vals: np.ndarray) -> None:
        if cols.size == 0:
            return
        pool[0].extend([row] * int(cols.size))
        pool[1].extend(cols.tolist())
        pool[2].extend(np.asarray(vals, np.float32).tolist())

    def hits_csc(self, direction: str, binary: bool = False) -> sparse.csc_matrix:
        """Column-sliceable copy of a hit pool (cached)."""
        key = f"{direction}{'_bin' if binary else ''}"
        if key not in self._hits_csc:
            src = self.hits_bin if binary else self.hits
            self._hits_csc[key] = src[direction].tocsc()
        return self._hits_csc[key]


@lru_cache(maxsize=2)
def load_corpus(policy: str | None = None) -> ORCSCorpus:
    """Load (and build on first use) the safe ORCS retrieval corpus."""
    return ORCSCorpus(policy=policy)


# --------------------------------------------------------------------------- #
# query side
# --------------------------------------------------------------------------- #

_DEC = re.compile(r"\bdecreas|\breduc|\bdeplet|\bloss of|\bsensitiz|\bsensitivity to\b", re.I)
_INC = re.compile(r"\bincreas|\benrich|\bresistan|\baccumulat", re.I)
_BOTH = re.compile(r"either increases or decreases|\bimpacts\b|\baffects\b", re.I)


def query_direction(screen: Mapping[str, Any]) -> str:
    """Infer a query screen's reported hit direction from its metadata.

    Returns ``"dec"`` (depletion / negative selection / sensitiser),
    ``"inc"`` (enrichment / positive selection / resistance), ``"pheno"``
    (reporter or sorting screen) or ``"both"`` (bidirectional, merged).

    Uses only ``phenotype`` and ``screen_type``.  It deliberately does *not*
    parse ``dataset_name``, even though that field encodes the ORCS id and the
    ``_dec``/``_inc`` suffix: ``dataset_name`` is an identifier, and reading
    structure out of it is the kind of shortcut that stops being defensible.
    """
    phenotype = screen.get("phenotype") or ""
    if _BOTH.search(phenotype):
        return "both"
    dec, inc = _DEC.search(phenotype), _INC.search(phenotype)
    if dec and not inc:
        return "dec"
    if inc and not dec:
        return "inc"
    if dec and inc:
        return "dec" if dec.start() < inc.start() else "inc"
    screen_type = screen.get("screen_type") or ""
    if screen_type == "Negative Selection":
        return "dec"
    if screen_type == "Positive Selection":
        return "inc"
    if screen_type == "Phenotype Screen":
        return "pheno"
    return "both"


def _query_text(screen: Mapping[str, Any]) -> str:
    return " | ".join(str(screen.get(f) or "") for f in QUERY_TEXT_FIELDS)


@lru_cache(maxsize=2)
def _vectorizer(policy: str | None = None):
    """TF-IDF fitted on the ORCS donor corpus alone.

    Fitting on the donors only (not on the query batch, not on the AssayBench
    train text) keeps the transform a fixed function: a screen's features do not
    depend on which other screens were passed in the same call.
    """
    from sklearn.feature_extraction.text import TfidfVectorizer

    corpus = load_corpus(policy)
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2),
                          sublinear_tf=True, min_df=2, dtype=np.float32)
    vec.fit(corpus.text)
    from sklearn.preprocessing import normalize

    donor = normalize(vec.transform(corpus.text))
    return vec, donor


# --------------------------------------------------------------------------- #
# the estimator
# --------------------------------------------------------------------------- #

def _topk(weights: np.ndarray, k: int | None) -> np.ndarray:
    """Zero every donor outside the k highest weights (deterministic, stable)."""
    if k is None or k >= weights.size:
        return weights
    nonzero = int((weights > 0).sum())
    if nonzero <= k:
        return weights
    cut = np.partition(weights, weights.size - k)[weights.size - k]
    return np.where(weights >= cut, weights, 0.0).astype(np.float32)


def _rate(weights: np.ndarray, library: np.ndarray, hits: sparse.csr_matrix,
          measured: sparse.csr_matrix, eps: float, n_donors: int) -> np.ndarray:
    total = float(weights.sum())
    numerator = np.asarray(weights @ hits).ravel()[library]
    denominator = np.asarray(weights @ measured).ravel()[library]
    return numerator / (denominator + eps * total / max(n_donors, 1))


def _screen_arrays(view: Mapping[str, Any], corpus: ORCSCorpus, query_text_vec,
                   eps: float, cond_mult: float, text_mult: float, k: int | None,
                   binary: bool = True) -> tuple[list[str], np.ndarray]:
    """Compute every feature for one screen. Returns (gene symbols, values array)."""
    gi = corpus.gene_index
    library = np.array(sorted({gi[g] for g in
                               (_normalize(x) for x in view["relevance_genes"]) if g in gi}),
                       dtype=np.int64)
    n_feat = len(FEATURE_NAMES)
    if library.size == 0:
        return [], np.zeros((0, n_feat), np.float32)
    symbols = [corpus.genes[i] for i in library]
    direction = query_direction(view)
    n_d = len(corpus.screen_ids)
    compat = corpus.compatible[direction].astype(np.float32)

    # ---- similarity blocks, all label-free ----
    lib_vec = np.zeros(len(corpus.genes), np.float32)
    lib_vec[library] = 1.0
    containment = np.asarray(corpus.measured @ lib_vec).ravel() / float(library.size)

    q_tokens = _tokens(view.get("condition_name"))
    if q_tokens:
        cond = np.fromiter((len(q_tokens & d) / len(q_tokens) for d in corpus.condition_tokens),
                           np.float32, n_d)
    else:
        cond = np.zeros(n_d, np.float32)
    text = np.maximum(np.asarray(query_text_vec).ravel(), 0.0).astype(np.float32)

    w_full = containment * (1.0 + cond_mult * cond) * (1.0 + text_mult * text) * compat
    w_lib = containment * compat
    w_text = (text + 1e-6) * compat
    w_uniform = compat.copy()

    out = np.zeros((library.size, n_feat), np.float32)
    col = {name: i for i, name in enumerate(FEATURE_NAMES)}
    M = corpus.measured

    def safe(weights: np.ndarray) -> np.ndarray:
        weights = np.asarray(weights, np.float32)
        return weights if weights.sum() > 0 else compat.copy()

    # `binary` selects which pool is primary. Binary HIT calls win: grading them by
    # SCORE.1 costs -0.0105 AnDCG@100 on validation, CI [-0.0175, -0.0033], p=0.001,
    # and loses in every cell of the (cond_mult, text_mult, k) grid. SCORE.1 spans 42
    # incompatible score types, so the strength ordering is partly noise.
    H = corpus.hits_bin if binary else corpus.hits
    H_other = corpus.hits if binary else corpus.hits_bin
    w_primary = safe(_topk(w_full, k))
    out[:, col["orcs_retrieval_rate"]] = _rate(
        w_primary, library, H[direction], M, eps, n_d)
    out[:, col["orcs_retrieval_rate_graded"]] = _rate(
        w_primary, library, H_other[direction], M, eps, n_d)
    out[:, col["orcs_libnn_rate"]] = _rate(
        safe(_topk(w_lib, k)), library, H[direction], M, eps, n_d)
    out[:, col["orcs_text_rate"]] = _rate(
        safe(_topk(w_text, k)), library, H[direction], M, eps, n_d)
    out[:, col["orcs_hit_rate"]] = _rate(
        safe(w_uniform), library, H[direction], M, eps, n_d)

    stratum = (view.get("cleaned_phenotype") or "").strip()
    w_strat = np.where((corpus.stratum == stratum) | (corpus.stratum == ""),
                       w_uniform, 0.0).astype(np.float32)
    if w_strat.sum() <= 0 and STRATUM_SMOOTHING_FALLBACK:
        w_strat = w_uniform
    out[:, col["orcs_hit_rate_stratum"]] = _rate(
        safe(w_strat), library, H[direction], M, eps, n_d)

    opposite = {"dec": "inc", "inc": "dec"}.get(direction)
    if opposite is not None:
        out[:, col["orcs_opposite_rate"]] = _rate(
            w_primary, library, H[opposite], M, eps, n_d)
    out[:, col["orcs_net_rate"]] = (out[:, col["orcs_retrieval_rate"]]
                                    - NET_LAMBDA * out[:, col["orcs_opposite_rate"]])
    out[:, col["orcs_support_log"]] = np.log1p(corpus.support[library])

    # ---- pseudo-relevance feedback (reported negative) ----
    hits_csc = corpus.hits_csc(direction, binary=binary)[:, library]
    norms = np.sqrt(np.asarray(hits_csc.multiply(hits_csc).sum(1)).ravel()) + 1e-6
    base = out[:, col["orcs_retrieval_rate"]]
    top = np.argsort(-base, kind="stable")[:PRF_TOP]
    pseudo = np.zeros(library.size, np.float32)
    pseudo[top] = 1.0 / np.log2(2.0 + np.arange(len(top)))
    sim = (np.asarray(hits_csc @ pseudo).ravel() / norms) / (np.linalg.norm(pseudo) + 1e-9)
    w_prf = safe(_topk(w_primary * np.power(np.maximum(sim, 0.0) + 1e-6, PRF_BETA), k))
    out[:, col["orcs_prf_rate"]] = _rate(w_prf, library, H[direction], M, eps, n_d)

    # ---- co-hit PPMI against the pseudo-positive seeds (reported negative) ----
    present = (hits_csc > 0).astype(np.float32)
    seeds = present[:, top]
    df_gene = np.asarray(present.sum(0)).ravel().astype(np.float64)
    df_seed = np.asarray(seeds.sum(0)).ravel().astype(np.float64)
    n_eff = float((np.asarray(present.sum(1)).ravel() > 0).sum()) + 1e-9
    cooc = np.asarray((present.T @ seeds).todense(), dtype=np.float64)
    ppmi = np.log(np.maximum(cooc, 0.5) * n_eff / np.maximum(df_gene[:, None] * df_seed[None, :], 1e-9))
    out[:, col["orcs_cohit_ppmi"]] = np.maximum(ppmi, 0.0).mean(1)
    return symbols, out


@lru_cache(maxsize=1)
def _andcg():
    from splicr import benchmark as bm

    return bm.AnDCG(k=100)


def _normalize(symbol: str) -> str:
    return _andcg().normalize(symbol)


# --------------------------------------------------------------------------- #
# public API
# --------------------------------------------------------------------------- #

def orcs_retrieval_features(
    screens: Sequence[Mapping[str, Any]],
    top_n: int | None = 1000,
    primary: str = "orcs_retrieval_rate",
    policy: str | None = None,
    key: str = "dataset_name",
    progress: bool = False,
) -> tuple[dict[str, dict[str, dict[str, float]]], list[str]]:
    """ORCS-backed retrieval features for a list of AssayBench screen records.

    Args:
        screens: AssayBench records, e.g. from
            :func:`splicr.assaybench_io.load_split`.  Only metadata and
            ``relevance_genes`` are read; ``relevance_scores`` and ``hit`` are
            hidden behind :class:`_ScreenView` and raise if touched.  Safe to
            call on the test split -- it cannot see the test labels.
        top_n: keep only this many genes per screen, ranked by ``primary``.
            The full library is always used internally for ranking; this only
            bounds the size of the returned dict.  ``None`` returns every
            measured gene, which for a genome-wide screen is ~18k genes x
            11 features -- fine for one screen, ~5M entries for 334.
        primary: feature used to choose which genes survive ``top_n``.
        policy: ORCS exclusion policy; ``None`` uses the enforced default
            (``publication``: 378 excluded, 1,574 safe).
        key: record field used as the per-screen key of the result.
        progress: print a line every 50 screens.

    Returns:
        ``(features, FEATURE_NAMES)`` where ``features`` maps
        ``screen[key] -> {gene_symbol: {feature_name: value}}``.  Gene symbols
        are normalised through the same ``GeneMapper`` the metric uses.

    Deterministic: no RNG, stable sorts, and the TF-IDF vocabulary is fitted on
    the fixed ORCS donor corpus rather than on the input batch.
    """
    if primary not in FEATURE_NAMES:
        raise ValueError(f"primary must be one of {FEATURE_NAMES}")
    corpus = load_corpus(policy)
    vec, _donor = _vectorizer(policy)
    from sklearn.preprocessing import normalize

    views = [_ScreenView(s) for s in screens]
    query_mat = normalize(vec.transform([_query_text(v) for v in views]))
    text_sim = query_mat @ _donor.T          # (n_queries, n_donors), sparse-ish
    text_sim = np.asarray(text_sim.todense(), dtype=np.float32)

    cfg = PRIMARY
    out: dict[str, dict[str, dict[str, float]]] = {}
    primary_col = FEATURE_NAMES.index(primary)
    for i, view in enumerate(views):
        symbols, values = _screen_arrays(
            view, corpus, text_sim[i], eps=cfg["eps"], cond_mult=cfg["cond_mult"],
            text_mult=cfg["text_mult"], k=cfg["k"], binary=cfg["binary"])
        if top_n is not None and len(symbols) > top_n:
            keep = np.argsort(-values[:, primary_col], kind="stable")[:top_n]
            symbols = [symbols[j] for j in keep]
            values = values[keep]
        out[str(view[key])] = {
            g: {name: float(values[r, c]) for c, name in enumerate(FEATURE_NAMES)}
            for r, g in enumerate(symbols)
        }
        if progress and (i + 1) % 50 == 0:
            print(f"  screen {i + 1}/{len(views)}", flush=True)
    return out, list(FEATURE_NAMES)


def rank_genes(
    screens: Sequence[Mapping[str, Any]],
    feature: str = "orcs_retrieval_rate",
    k: int = 100,
    policy: str | None = None,
    key: str = "dataset_name",
    progress: bool = False,
) -> dict[str, list[str]]:
    """``{screen_key: top-k gene symbols}`` ranked by one feature.

    This is the prediction entry point: the ranking is over the query's own
    measured genes, so every slot in the top-k is a gene the screen assayed.
    """
    if feature not in FEATURE_NAMES:
        raise ValueError(f"unknown feature {feature!r}")
    corpus = load_corpus(policy)
    vec, donor = _vectorizer(policy)
    from sklearn.preprocessing import normalize

    views = [_ScreenView(s) for s in screens]
    text_sim = np.asarray((normalize(vec.transform([_query_text(v) for v in views])) @ donor.T
                           ).todense(), dtype=np.float32)
    cfg = PRIMARY
    col = FEATURE_NAMES.index(feature)
    out: dict[str, list[str]] = {}
    for i, view in enumerate(views):
        symbols, values = _screen_arrays(
            view, corpus, text_sim[i], eps=cfg["eps"], cond_mult=cfg["cond_mult"],
            text_mult=cfg["text_mult"], k=cfg["k"], binary=cfg["binary"])
        order = np.argsort(-values[:, col], kind="stable")[:k]
        out[str(view[key])] = [symbols[j] for j in order]
        if progress and (i + 1) % 50 == 0:
            print(f"  screen {i + 1}/{len(views)}", flush=True)
    return out


# --------------------------------------------------------------------------- #
# self-check
# --------------------------------------------------------------------------- #

def _self_check(split: str = "validation", bootstrap: int = 20000) -> int:
    from splicr import benchmark as bm
    from splicr.assaybench_io import load_split

    if split == "test":
        raise SystemExit(
            "refusing to self-check on the test split: this module is tuned on "
            "validation and the test split is evaluated exactly once, elsewhere."
        )
    t0 = time.time()
    corpus = load_corpus()
    print(f"safe ORCS donors {len(corpus.screen_ids)}  genes {len(corpus.genes)}  "
          f"policy {boundary()['exclusion_policy']['recommended']}")
    import collections
    print("  donor direction classes:", dict(collections.Counter(corpus.direction)))

    screens = load_split(split)
    andcg = bm.AnDCG(k=100)
    targets = [andcg.target(s) for s in screens]
    print(f"{split} screens {len(screens)}   loaded {time.time() - t0:.0f}s", flush=True)

    vec, donor = _vectorizer()
    from sklearn.preprocessing import normalize
    views = [_ScreenView(s) for s in screens]
    text_sim = np.asarray((normalize(vec.transform([_query_text(v) for v in views])) @ donor.T
                           ).todense(), dtype=np.float32)
    cfg = PRIMARY
    scores = np.zeros((len(screens), len(FEATURE_NAMES)))
    for i, view in enumerate(views):
        symbols, values = _screen_arrays(
            view, corpus, text_sim[i], eps=cfg["eps"], cond_mult=cfg["cond_mult"],
            text_mult=cfg["text_mult"], k=cfg["k"], binary=cfg["binary"])
        if not symbols:
            continue
        for c in range(len(FEATURE_NAMES)):
            order = np.argsort(-values[:, c], kind="stable")[:100]
            scores[i, c] = targets[i].score([symbols[j] for j in order])
        if (i + 1) % 50 == 0:
            print(f"  scored {i + 1}/{len(screens)}  {time.time() - t0:.0f}s", flush=True)

    train = load_split("train")
    prior = bm.GeneFrequencyPrior(stats=bm.GeneStats().fit(train)).fit(train)
    base = np.zeros(len(screens))
    for i, s in enumerate(screens):
        ranked = prior.rank(s)
        base[i] = targets[i].score(ranked[:100]) if ranked else 0.0

    rng = np.random.default_rng(0)
    order = np.argsort(-scores.mean(0))
    print(f"\nstandalone {split} AnDCG@100 (mean over {len(screens)} screens)")
    print(f"  {'feature':<28} {'AnDCG@100':>10} {'vs freq prior':>14} {'95% CI':>22} {'wilcoxon':>10}")
    print(f"  {'[baseline] freq prior':<28} {base.mean():>10.5f}")
    from scipy import stats as st
    for c in order:
        delta = scores[:, c] - base
        draws = delta[rng.integers(0, len(delta), (bootstrap, len(delta)))].mean(1)
        lo, hi = np.percentile(draws, [2.5, 97.5])
        try:
            p = st.wilcoxon(scores[:, c], base).pvalue
        except ValueError:
            p = float("nan")
        print(f"  {FEATURE_NAMES[c]:<28} {scores[:, c].mean():>10.5f} {delta.mean():>+14.5f} "
              f"  [{lo:+.5f},{hi:+.5f}] {p:>10.2g}")
    best = FEATURE_NAMES[int(np.argmax(scores.mean(0)))]
    print(f"\nBEST SINGLE FEATURE: {best}  {scores.mean(0).max():.5f}")
    print(f"PRE-REGISTERED PRIMARY: orcs_retrieval_rate  "
          f"{scores[:, FEATURE_NAMES.index('orcs_retrieval_rate')].mean():.5f}")
    print(f"config {cfg}   total {time.time() - t0:.0f}s")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--split", default="validation",
                    help="split for the self-check; 'test' is refused")
    ap.add_argument("--build-cache", action="store_true",
                    help="rebuild the index and profile caches, then exit")
    a = ap.parse_args(argv)
    if a.build_cache:
        print("index   ->", build_index_cache())
        print("profile ->", build_profile_cache())
        return 0
    return _self_check(a.split)


if __name__ == "__main__":
    raise SystemExit(main())

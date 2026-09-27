"""Hard baselines for the replication benchmark.

These are the methods that would embarrass the project if they had not been
tried, built as strong as the data on disk allows. They exist so that any claim
SplicR makes about ranking a screen's hits by replication probability is stated
against the best available alternative rather than against a straw man.

Four families, and the argument each one makes.

``lit_``
    A literature prior. Heavily studied genes hit more often and get reported
    more often, so a ranking that knows nothing except how famous a gene is
    might do well. This is the closest thing on disk to what a language model
    brings to the task, and the AssayBench analysis showed that a
    literature-recall method wins where the label is a published hit list. Built
    from PubTator3 paper counts, Open Targets disease associations, and
    annotation depth.

``net_``
    A network prior. Two arguments: a gene's connectivity predicts essentiality
    at all, and a gene is more credible when the other members of its complex
    also hit. Built from STRING (combined and physical) and Reactome.

``multi_``
    Published multi-hit reasoning: a hit is more credible when it recurs across
    screens. Built ONLY over :func:`dataset.allowed_background_screens`, so the
    corpus it is fitted on cannot contain the target screen, the target
    publication, or any screen in the pair's cell line.

``a_``
    Screen A's own signal. ``a_effect`` is the published margin to beat: mean AP
    0.2517 on the development primary space, against a 0.0453 floor.

And ``learned_*``, a logistic regression and a gradient-boosted tree over every
label-free feature above, to establish what a competent ML baseline reaches with
no SplicR pipeline signal at all. That is the number the method has to beat.

Leakage. Every unit-specific feature reads either screen A alone or the allowed
background set. No feature reads screen B, B's publication, or any screen in the
pair's cell line. The learned models are fitted on development labels only, and
the split is disjoint by publication and by cell line, so a development fit
cannot have seen a held-out label. The literature prior uses a PubTator count
built with the benchmark's own 14 publications excluded, because otherwise a
gene named in Behan 2019's abstract earns a mention from the paper whose hit
calls are the label.

Usage::

    export PATH="engine/.tools/env/bin:$PATH"
    python -m splicr.replication.baselines development
    python -m splicr.replication.baselines heldout --evaluating
"""

from __future__ import annotations

import collections
import csv
import functools
import json
import math
import os
from typing import Iterable, Sequence

import numpy as np

from . import dataset

REFERENCES = os.environ.get(
    "SPLICR_REFERENCES",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
        "data",
        "references",
    ),
)
DERIVED = os.path.join(REFERENCES, "derived")


def _ref(*parts: str) -> str:
    return os.path.join(REFERENCES, *parts)


def _der(*parts: str) -> str:
    return os.path.join(DERIVED, *parts)


# ---------------------------------------------------------------------------
# Thresholds, and where each one comes from
# ---------------------------------------------------------------------------

# Open Targets association score floor. The shipped ot_assoc_direct.parquet is
# already filtered to score > 0.01 by splicr.features.biology, so this is the
# cache's own floor restated and not a second choice.
OT_MIN_SCORE = 0.01

# Disease name patterns that make an Open Targets association proliferation
# relevant. The generic fame prior treats a link to migraine like a link to
# leukaemia; on a proliferation benchmark a reader will object that a competent
# analyst would have weighted cancer relevance instead. This is that prior. The
# pattern list is deliberately broad and fixed before any score was computed, so
# it cannot be narrowed toward whatever worked.
OT_CANCER_PATTERNS = (
    "cancer", "carcinoma", "neoplasm", "tumor", "tumour", "leukemia", "leukaemia",
    "lymphoma", "sarcoma", "melanoma", "myeloma", "glioma", "blastoma", "adenoma",
    "malignan", "metastas",
)

# A "complex-like" Reactome pathway. Reactome mixes two-protein complexes with
# 1,000-gene superpathways, and only the small end supports the argument "the
# other members of this gene's complex also hit". The cap is the 90th percentile
# of pathway size in the shipped ReactomePathways.gmt, computed in
# _reactome_size_cap() rather than typed in, so it moves with the file.
REACTOME_SIZE_QUANTILE = 0.90
REACTOME_MIN_SIZE = 3

# STRING combined_score floor. The shipped string_*.npz caches are built at
# combined_score >= 150 (splicr.features.biology.STRING_MIN_SCORE), which is
# STRING's own "low confidence" tier. Restated, not re-chosen.
STRING_MIN_SCORE = 150

# Minimum background screens measuring a gene before its raw multi-screen hit
# rate is treated as an estimate at all. Below this the shrunk estimate is
# essentially the global mean, which is the intended behaviour; the flag exists
# so the learned model can tell "never measured" from "measured and never hit".
MULTI_MIN_MEASURED = 20


# ---------------------------------------------------------------------------
# Literature resources
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def pubtator_counts() -> dict[str, float]:
    """Symbol -> number of PubMed papers PubTator3 annotates with that gene.

    Prefers the variant built with the benchmark's own 14 publications excluded.
    Those papers are the label source, and PubTator3 annotates 1,139 gene-paper
    pairs over 1,058 distinct genes from them, so leaving them in would let a
    gene named in a screen's abstract collect a mention from the screen that
    calls it a hit. The effect is small but it is the objection a reader should
    raise, so it is closed rather than argued about.

    Falls back to the unfiltered cache with a recorded warning if the filtered
    one has not been built, because a missing file should not silently change
    what is being measured.
    """
    path = _der("pubtator_symbol_counts_excl_replication.json")
    if os.path.exists(path):
        with open(path) as fh:
            doc = json.load(fh)
        return {g: float(c) for g, c in doc["counts"].items()}
    with open(_der("pubtator_symbol_counts.json")) as fh:
        raw = json.load(fh)
    return {g: float(c) for g, c in raw.items()}


@functools.lru_cache(maxsize=1)
def pubtator_excludes_benchmark() -> bool:
    """Whether :func:`pubtator_counts` is the leak-free variant. Reported, not assumed."""
    return os.path.exists(_der("pubtator_symbol_counts_excl_replication.json"))


@functools.lru_cache(maxsize=1)
def opentargets_association_summary() -> dict[str, tuple[float, float, float]]:
    """Symbol -> (n_diseases, max association score, total evidence count).

    Open Targets association counts are the second literature-derived signal:
    a gene linked to many diseases with much evidence is a gene the field has
    worked on. Direct associations only, so a gene does not inherit its
    parents' disease terms.
    """
    import pandas as pd

    df = pd.read_parquet(_der("ot_assoc_direct.parquet"))
    df = df[df["associationScore"] >= OT_MIN_SCORE]
    agg = df.groupby("symbol").agg(
        n_diseases=("diseaseId", "size"),
        max_score=("associationScore", "max"),
        evidence=("evidenceCount", "sum"),
    )
    return {
        str(sym): (float(r.n_diseases), float(r.max_score), float(r.evidence))
        for sym, r in agg.iterrows()
    }


@functools.lru_cache(maxsize=1)
def _cancer_disease_ids() -> frozenset[str]:
    """Open Targets disease ids whose names match :data:`OT_CANCER_PATTERNS`.

    Matched against every synonym the shipped name map carries, so a disease
    named only by a synonym containing "carcinoma" still counts.
    """
    with open(_der("ot_disease_names.json")) as fh:
        names = json.load(fh)
    out = set()
    for did, syns in names.items():
        blob = " ".join(syns if isinstance(syns, list) else [str(syns)]).lower()
        if any(p in blob for p in OT_CANCER_PATTERNS):
            out.add(str(did))
    return frozenset(out)


@functools.lru_cache(maxsize=1)
def opentargets_cancer_summary() -> dict[str, tuple[float, float, float]]:
    """Symbol -> (n cancer diseases, max cancer score, cancer evidence count).

    The proliferation-relevant form of the literature prior. A generic fame count
    cannot tell a cell-cycle gene from a well studied neurotransmitter receptor;
    this can, and on a proliferation benchmark it is the version of the argument
    that deserves to be beaten rather than the generic one.
    """
    import pandas as pd

    ids = _cancer_disease_ids()
    df = pd.read_parquet(_der("ot_assoc_direct.parquet"))
    df = df[(df["associationScore"] >= OT_MIN_SCORE) & df["diseaseId"].isin(ids)]
    agg = df.groupby("symbol").agg(
        n_diseases=("diseaseId", "size"),
        max_score=("associationScore", "max"),
        evidence=("evidenceCount", "sum"),
    )
    return {
        str(sym): (float(r.n_diseases), float(r.max_score), float(r.evidence))
        for sym, r in agg.iterrows()
    }


@functools.lru_cache(maxsize=1)
def gene_attributes() -> dict[str, dict[str, float]]:
    """Symbol -> Open Targets gene attributes: LOEUF, missense z, annotation counts.

    Annotation depth (``n_go``, ``n_pathway``, ``n_subcell``) is a studiedness
    measure as much as a biological one, which is why it sits in the literature
    family. LOEUF and missense z are constraint measures and are the one part of
    this family that is not about fame.
    """
    import pandas as pd

    df = pd.read_parquet(_der("ot_gene_attrs.parquet"))
    out: dict[str, dict[str, float]] = {}
    for r in df.itertuples():
        sym = str(r.symbol)
        if not sym:
            continue
        out[sym] = {
            "loeuf": float(r.loeuf) if r.loeuf == r.loeuf else float("nan"),
            "mis_z": float(r.mis_z) if r.mis_z == r.mis_z else float("nan"),
            "n_go": float(r.n_go or 0),
            "n_pathway": float(r.n_pathway or 0),
            "n_subcell": float(r.n_subcell or 0),
        }
    return out


@functools.lru_cache(maxsize=1)
def depmap_gene_summary() -> dict[str, dict[str, float]]:
    """Symbol -> DepMap Chronos summary ACROSS lines: mean, spread, dependency fraction.

    The most embarrassing baseline if it were not tried: a lookup table saying
    what fraction of about 1,178 DepMap lines depend on this gene. It never opens
    the screen being ranked, and if it matches a pipeline that does, the pipeline
    has not earned its complexity.

    This sits on the benchmark's one explicit judgement, recorded in
    ``docs/07-replication-benchmark.md``: per-cell-line DepMap features are
    forbidden because for most units DepMap holds a fitness measurement of the
    same line, and where the target screen is Avana it is a later release of the
    label itself. Cell-line-independent summaries over about a thousand lines are
    allowed, on the argument that they do not identify one unit's label. This
    feature is exactly that allowance being cashed in, so it is reported as its
    own family and named in the write-up, and a reader who rejects the judgement
    should discount every ``dep_`` row rather than have to work out which numbers
    it touched.
    """
    import pandas as pd

    df = pd.read_parquet(_der("depmap_gene_stats.parquet"))
    out: dict[str, dict[str, float]] = {}
    for r in df.itertuples():
        out[str(r.gene)] = {
            "mean": float(r.mean),
            "std": float(r.std),
            "frac_dep": float(r.frac_dep),
            "frac_strong_dep": float(r.frac_strong_dep),
            "q10": float(r.q10),
        }
    return out


def depmap_features(genes: Sequence[str]) -> dict[str, np.ndarray]:
    """The DepMap lookup-table prior, per gene. Sign-oriented so higher is more essential."""
    d = depmap_gene_summary()
    miss = {"mean": float("nan"), "std": float("nan"), "frac_dep": 0.0,
            "frac_strong_dep": 0.0, "q10": float("nan")}

    def col(name: str) -> np.ndarray:
        return np.array([d.get(g, miss)[name] for g in genes], dtype=float)

    return {
        # Negated so that higher means a stronger dependency, matching every
        # other feature's orientation.
        "dep_mean_effect": -col("mean"),
        "dep_q10_effect": -col("q10"),
        "dep_frac_dep": col("frac_dep"),
        "dep_frac_strong_dep": col("frac_strong_dep"),
        # Spread across lines: a selectively essential gene is the interesting
        # case, and a pan-essential one is mostly excluded from the primary space
        # already.
        "dep_std": col("std"),
        "dep_known": np.array([1.0 if g in d else 0.0 for g in genes], dtype=float),
    }


@functools.lru_cache(maxsize=1)
def transcript_lengths() -> dict[str, float]:
    """Symbol -> CDS-ish length proxy, from HGNC-approved NCBI gene_info.

    Not a literature feature in itself, but longer and older genes are better
    studied, and a length control is what separates "this gene is famous" from
    "this gene is big". Kept so the literature prior can be challenged on its
    own terms.
    """
    out: dict[str, float] = {}
    path = _ref("annotation", "hgnc_complete_set.txt")
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            if row.get("status") != "Approved":
                continue
            sym = (row.get("symbol") or "").strip()
            if not sym:
                continue
            # Number of curated cross references is a crude age/interest proxy
            # available without a second download.
            n_ref = sum(1 for k in ("refseq_accession", "ena", "vega_id", "ucsc_id") if row.get(k))
            out[sym] = float(n_ref)
    return out


# ---------------------------------------------------------------------------
# Network resources
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=2)
def string_network(tag: str = "full"):
    """(csr adjacency, symbol list, symbol -> row index) for the STRING cache.

    ``tag`` is ``"full"`` (combined score) or ``"phys"`` (physical subnetwork).
    The physical network is the better complex proxy; the combined network is the
    better connectivity measure.
    """
    import scipy.sparse as sp

    adj = sp.load_npz(_der(f"string_{tag}.npz")).tocsr()
    with open(_der(f"string_{tag}_index.json")) as fh:
        syms = json.load(fh)["symbols"]
    return adj, syms, {s: i for i, s in enumerate(syms)}


@functools.lru_cache(maxsize=1)
def reactome_sets() -> list[tuple[str, frozenset[str]]]:
    """Reactome pathways as (id, gene symbols) from the shipped GMT."""
    out: list[tuple[str, frozenset[str]]] = []
    with open(_ref("reactome", "ReactomePathways.gmt")) as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 3:
                continue
            genes = frozenset(p.strip() for p in parts[2:] if p.strip())
            if genes:
                out.append((parts[1], genes))
    return out


@functools.lru_cache(maxsize=1)
def _reactome_size_cap() -> int:
    """The complex-like size cap, as a quantile of observed pathway size.

    Derived from the file rather than chosen, so the number in the write-up is
    reproducible and moves if Reactome does.
    """
    sizes = np.array([len(g) for _, g in reactome_sets()], dtype=float)
    return int(np.quantile(sizes, REACTOME_SIZE_QUANTILE))


@functools.lru_cache(maxsize=1)
def _reactome_membership() -> dict[str, list[int]]:
    """Symbol -> indices of the complex-like pathways containing it."""
    cap = _reactome_size_cap()
    sets = reactome_sets()
    out: dict[str, list[int]] = collections.defaultdict(list)
    for i, (_, genes) in enumerate(sets):
        if not (REACTOME_MIN_SIZE <= len(genes) <= cap):
            continue
        for g in genes:
            out[g].append(i)
    return dict(out)


# ---------------------------------------------------------------------------
# The ORCS background corpus, as a dense screen x gene matrix
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def background_matrix():
    """(screen_ids, genes, measured, hit) over every ELIGIBLE ORCS screen.

    Two boolean matrices of shape (n_screens, n_genes). ``measured[i, j]`` is
    whether screen i reports gene j at all; ``hit[i, j]`` is whether it calls it
    a hit. Rows come from :func:`dataset._rows_sql`, so the one-row-per-gene
    deduplication and the drop of self-contradicting genes both apply.

    This is the whole eligible corpus and NOT a per-unit allowed set. Restricting
    to a unit's allowed background is done by row selection in
    :func:`multi_hit_features`, which is what makes the restriction auditable:
    the only way to read a screen here is to name its row.
    """
    eligible, _ = dataset.eligible_screens()
    eligible = sorted(eligible)
    con = dataset._duck()
    ids = ",".join(str(int(s)) for s in eligible)
    df = con.execute(
        f"""
        select screen_id, gene, hit
        from ({dataset._rows_sql(f"where screen_id in ({ids})")})
        """
    ).fetchdf()
    screen_ids = np.asarray(eligible, dtype=np.int64)
    srow = {int(s): i for i, s in enumerate(eligible)}
    genes = sorted(set(df["gene"].astype(str)))
    gcol = {g: j for j, g in enumerate(genes)}
    measured = np.zeros((len(eligible), len(genes)), dtype=bool)
    hit = np.zeros((len(eligible), len(genes)), dtype=bool)
    ri = df["screen_id"].map(srow).to_numpy()
    ci = df["gene"].astype(str).map(gcol).to_numpy()
    measured[ri, ci] = True
    hit[ri, ci] = df["hit"].to_numpy().astype(bool)
    return screen_ids, genes, measured, hit


# ---------------------------------------------------------------------------
# Feature builders, one per family
# ---------------------------------------------------------------------------

def _aligned(values: dict[str, float], genes: Sequence[str], default: float = float("nan")):
    return np.array([values.get(g, default) for g in genes], dtype=float)


def literature_features(genes: Sequence[str]) -> dict[str, np.ndarray]:
    """The literature prior, per gene. Gene-level, unit-independent, label-free.

    A gene absent from a resource is recorded as zero where zero is the honest
    reading (no papers, no disease associations, no annotations) and as NaN where
    absence means unmeasured (LOEUF, missense z). The learned models see a
    missing-value indicator for the NaN ones.
    """
    pt = pubtator_counts()
    ot = opentargets_association_summary()
    onc = opentargets_cancer_summary()
    attrs = gene_attributes()

    papers = np.array([pt.get(g, 0.0) for g in genes], dtype=float)
    n_dis = np.array([ot.get(g, (0.0, 0.0, 0.0))[0] for g in genes], dtype=float)
    max_sc = np.array([ot.get(g, (0.0, 0.0, 0.0))[1] for g in genes], dtype=float)
    evid = np.array([ot.get(g, (0.0, 0.0, 0.0))[2] for g in genes], dtype=float)
    onc_n = np.array([onc.get(g, (0.0, 0.0, 0.0))[0] for g in genes], dtype=float)
    onc_max = np.array([onc.get(g, (0.0, 0.0, 0.0))[1] for g in genes], dtype=float)
    onc_ev = np.array([onc.get(g, (0.0, 0.0, 0.0))[2] for g in genes], dtype=float)

    def attr(name: str, default: float) -> np.ndarray:
        return np.array([attrs.get(g, {}).get(name, default) for g in genes], dtype=float)

    return {
        "lit_papers": np.log1p(papers),
        "lit_ot_n_diseases": np.log1p(n_dis),
        "lit_ot_max_score": max_sc,
        "lit_ot_evidence": np.log1p(evid),
        "lit_ot_cancer_n": np.log1p(onc_n),
        "lit_ot_cancer_max_score": onc_max,
        "lit_ot_cancer_evidence": np.log1p(onc_ev),
        "lit_n_go": np.log1p(attr("n_go", 0.0)),
        "lit_n_pathway": np.log1p(attr("n_pathway", 0.0)),
        "lit_n_subcell": attr("n_subcell", 0.0),
        "lit_loeuf": attr("loeuf", float("nan")),
        "lit_mis_z": attr("mis_z", float("nan")),
    }


def network_features(
    genes: Sequence[str],
    a_hit: np.ndarray,
    multi_rate: np.ndarray | None = None,
) -> dict[str, np.ndarray]:
    """The network prior, per gene.

    Two label-free connectivity features, and the complex-agreement features that
    the brief asks about: does a gene's membership in a complex whose OTHER
    members hit predict replication.

    ``a_hit`` is screen A's own hit call, which the predictor is allowed to see.
    Neighbour aggregates always exclude the gene itself, so a gene cannot vouch
    for its own hit call through the network.

    ``multi_rate`` is the shrunk multi-screen hit rate from
    :func:`multi_hit_features`. When supplied, the neighbour aggregate is also
    computed over it, which is the stronger form of the complex argument: it asks
    whether the gene's partners are broadly essential rather than whether this
    one screen happened to call them.
    """
    out: dict[str, np.ndarray] = {}
    a = np.asarray(a_hit, dtype=float)

    for tag in ("full", "phys"):
        adj, syms, index = string_network(tag)
        rows = np.array([index.get(g, -1) for g in genes], dtype=np.int64)
        present = rows >= 0
        safe = np.where(present, rows, 0)

        # Connectivity. NaN rather than zero for genes STRING does not carry, so
        # "absent from STRING" is not read as "isolated in STRING".
        wdeg = np.asarray(adj.sum(axis=1)).ravel().astype(float)
        ndeg = np.asarray((adj > 0).sum(axis=1)).ravel().astype(float)
        out[f"net_{tag}_wdegree"] = np.where(present, np.log1p(wdeg[safe]), np.nan)
        out[f"net_{tag}_degree"] = np.where(present, np.log1p(ndeg[safe]), np.nan)

        # Neighbour aggregates. Build a vector over STRING's own symbol space so
        # the product is one sparse matvec, then read back the rows we need.
        n_sym = adj.shape[0]

        def neighbour_mean(values: np.ndarray, measured: np.ndarray) -> np.ndarray:
            vec = np.zeros(n_sym, dtype=float)
            msk = np.zeros(n_sym, dtype=float)
            vec[rows[present]] = values[present]
            msk[rows[present]] = measured[present]
            num = adj @ vec
            den = adj @ msk
            # Exclude self: a gene has no self edge in STRING, so nothing to do.
            with np.errstate(invalid="ignore", divide="ignore"):
                res = np.where(den > 0, num / den, np.nan)
            return np.where(present, res[safe], np.nan)

        ones = np.ones(len(genes), dtype=float)
        out[f"net_{tag}_nbr_a_hit_frac"] = neighbour_mean(a, ones)
        if multi_rate is not None:
            out[f"net_{tag}_nbr_multi_rate"] = neighbour_mean(
                np.nan_to_num(np.asarray(multi_rate, dtype=float)), ones
            )

    # Reactome: the complex-agreement argument restricted to curated sets rather
    # than to a score-thresholded graph.
    sets = reactome_sets()
    member = _reactome_membership()
    gpos = {g: i for i, g in enumerate(genes)}
    best = np.full(len(genes), np.nan)
    mean = np.full(len(genes), np.nan)
    size = np.full(len(genes), np.nan)
    # Precompute, per complex-like pathway, A's hit fraction among the members A
    # measured. Then a gene reads its pathways, leaving itself out.
    pw_hits: dict[int, tuple[float, float]] = {}
    for i, (_, gset) in enumerate(sets):
        idxs = [gpos[g] for g in gset if g in gpos]
        if not idxs:
            continue
        pw_hits[i] = (float(a[idxs].sum()), float(len(idxs)))
    for g, pws in member.items():
        j = gpos.get(g)
        if j is None:
            continue
        fracs = []
        sizes = []
        for i in pws:
            if i not in pw_hits:
                continue
            s, n = pw_hits[i]
            n_other = n - 1.0
            if n_other <= 0:
                continue
            fracs.append((s - a[j]) / n_other)
            sizes.append(n)
        if fracs:
            best[j] = max(fracs)
            mean[j] = float(np.mean(fracs))
            size[j] = float(np.mean(sizes))
    out["net_reactome_best_a_hit_frac"] = best
    out["net_reactome_mean_a_hit_frac"] = mean
    out["net_reactome_mean_complex_size"] = size
    out["net_reactome_n_complexes"] = np.array(
        [float(len(member.get(g, ()))) for g in genes], dtype=float
    )
    return out


def _beta_moment_prior(n_hit: np.ndarray, n_meas: np.ndarray) -> tuple[float, float]:
    """Beta prior by method of moments over adequately covered genes.

    The standard empirical-Bayes moment match, so the shrinkage strength is read
    off the corpus rather than tuned. Falls back to Jeffreys-ish (1, 1) when the
    moments are degenerate, which cannot happen on the real corpus but would on a
    two-screen background.
    """
    ok = n_meas >= MULTI_MIN_MEASURED
    if ok.sum() < 100:
        return 1.0, 1.0
    p = n_hit[ok] / n_meas[ok]
    m, v = float(p.mean()), float(p.var())
    if not (0.0 < v < m * (1.0 - m)):
        return 1.0, 1.0
    k = m * (1.0 - m) / v - 1.0
    return max(m * k, 1e-3), max((1.0 - m) * k, 1e-3)


#: Fractions of the allowed background kept by the similarity-weighted
#: recurrence prior. All three are reported on development rather than one being
#: picked and the others hidden, because "recurs in screens like mine" has no
#: principled k and a single reported value would be a tuned constant presented
#: as a design choice. The quartile (0.25) is the pre-registered default, on the
#: grounds that it is the coarsest cut that still leaves 30 or more screens for
#: the least covered unit.
MULTI_SIM_FRACTIONS = (0.10, 0.25, 0.50)


def multi_hit_features(
    unit: dataset.ReplicationPair,
    genes: Sequence[str],
    a_hit: np.ndarray | None = None,
) -> dict[str, np.ndarray]:
    """Published multi-hit reasoning, fitted ONLY on the allowed background.

    The argument, as several papers make it: a hit is more credible when it
    recurs across independent screens. The continuous form of that is the
    fraction of background screens measuring the gene that call it a hit, and
    ranking by it is strictly stronger than any "hit in at least k of n" cut,
    which it contains as a family of thresholds.

    The raw fraction is unusable on its own because coverage varies from 130 to
    786 screens, so a gene measured twice and hit twice would outrank a gene hit
    in 600 of 700. It is shrunk toward the corpus mean with a Beta prior fitted
    by method of moments over the genes that clear :data:`MULTI_MIN_MEASURED`.

    When ``a_hit`` is supplied, the stronger form of the argument is built too:
    recurrence among the background screens that most resemble screen A, rather
    than among all of them. A reviewer will ask for this, because "hit in many
    screens" and "hit in the screens that behave like mine" are different claims
    and the second is the one the multi-hit literature actually makes. Similarity
    is the Jaccard overlap of hit sets over the genes both screens measure, which
    reads screen A and the background only.

    The screen set comes from :func:`dataset.allowed_background_screens`, which
    removes both pair screens, both publications and every screen in the pair's
    cell line. So nothing here can read B, a same-paper sibling of B, or a third
    lab's screen of B's cell line.
    """
    screen_ids, corpus_genes, measured, hit = background_matrix()
    allowed = set(dataset.allowed_background_screens(unit))
    rows = np.array([i for i, s in enumerate(screen_ids) if int(s) in allowed], dtype=np.int64)
    if rows.size == 0:
        raise RuntimeError(f"{unit.unit_id}: no allowed background screens")

    n_meas = measured[rows].sum(axis=0).astype(float)
    n_hit = hit[rows].sum(axis=0).astype(float)
    alpha, beta = _beta_moment_prior(n_hit, n_meas)

    with np.errstate(invalid="ignore", divide="ignore"):
        raw = np.where(n_meas > 0, n_hit / n_meas, np.nan)
    shrunk = (n_hit + alpha) / (n_meas + alpha + beta)

    pos = {g: j for j, g in enumerate(corpus_genes)}
    idx = np.array([pos.get(g, -1) for g in genes], dtype=np.int64)
    present = idx >= 0
    safe = np.where(present, idx, 0)

    def pick(arr: np.ndarray, default: float) -> np.ndarray:
        return np.where(present, arr[safe], default)

    out = {
        "multi_hit_rate_shrunk": pick(shrunk, alpha / (alpha + beta)),
        "multi_hit_rate_raw": pick(raw, np.nan),
        "multi_n_hit": np.log1p(pick(n_hit, 0.0)),
        "multi_n_measured": np.log1p(pick(n_meas, 0.0)),
        "multi_well_covered": pick(n_meas >= MULTI_MIN_MEASURED, 0.0).astype(float),
        "_prior": np.array([alpha, beta, float(rows.size)]),
    }

    if a_hit is None:
        return out

    # Similarity-weighted recurrence. Project A onto the corpus gene space so the
    # comparison is over genes both screens actually measured, then Jaccard the
    # hit sets. A screen that calls very few or very many hits scores low against
    # A automatically, which is the behaviour wanted: it is a poor analogue.
    a = np.asarray(a_hit, dtype=float) > 0.5
    a_vec = np.zeros(len(corpus_genes), dtype=bool)
    a_meas = np.zeros(len(corpus_genes), dtype=bool)
    a_vec[idx[present]] = a[present]
    a_meas[idx[present]] = True

    sub_hit = hit[rows]
    sub_meas = measured[rows]
    shared = sub_meas & a_meas  # genes measured by A and by that background screen
    both = (sub_hit & a_vec & shared).sum(axis=1).astype(float)
    either = ((sub_hit | a_vec) & shared).sum(axis=1).astype(float)
    with np.errstate(invalid="ignore", divide="ignore"):
        jac = np.where(either > 0, both / either, 0.0)

    order = np.argsort(-jac, kind="stable")
    for frac in MULTI_SIM_FRACTIONS:
        k = max(int(round(frac * rows.size)), 20)
        keep = order[:k]
        sm = sub_meas[keep].sum(axis=0).astype(float)
        sh = sub_hit[keep].sum(axis=0).astype(float)
        sa, sb = _beta_moment_prior(sh, sm)
        sim_shrunk = (sh + sa) / (sm + sa + sb)
        tag = f"multi_sim_rate_q{int(round(frac * 100)):02d}"
        out[tag] = pick(sim_shrunk, sa / (sa + sb))
    out["_sim"] = np.array([float(jac.max()), float(np.median(jac)), float(rows.size)])
    return out


def _effect_direction_sign(unit: dataset.ReplicationPair) -> float:
    """+1, -1 or 0 to orient SCORE.1 so that higher means stronger depletion.

    Read from the unit's ``query_score1_direction``, which the loader derives
    from the ``SCORE.1_TYPE`` metadata and never from a screen's own hit calls.
    0 for ``unknown`` (CasTLE), where the spec says raw SCORE.1 must not be
    scored: those units get an uninformative constant rather than a guess.
    """
    d = unit.query_score1_direction
    if d == "lower_is_stronger":
        return -1.0
    if d == "higher_is_stronger":
        return 1.0
    return 0.0


def _rank01(x: np.ndarray) -> np.ndarray:
    """Rank-normalise to [0, 1], NaN-safe, average ranks for ties.

    Every feature is rank-normalised WITHIN a unit before it reaches a learned
    model, because coverage and scale differ between units (STRING degree does
    not, but background coverage and SCORE.1 scale do). Ranking within the unit
    makes the model's input distribution the same for every unit, which is what
    lets one fit transfer from development to held out.
    """
    from scipy.stats import rankdata

    x = np.asarray(x, dtype=float)
    out = np.full(x.shape, np.nan)
    ok = np.isfinite(x)
    if ok.sum() == 0:
        return out
    r = rankdata(x[ok], method="average")
    out[ok] = (r - 0.5) / ok.sum()
    return out


# ---------------------------------------------------------------------------
# One unit's full feature frame
# ---------------------------------------------------------------------------

FEATURE_FAMILIES = ("lit", "net", "multi", "a")


def unit_features(unit: dataset.ReplicationPair):
    """Every baseline feature for one unit, in the gene order the loader returns.

    Returns a pandas DataFrame with ``gene``, ``is_common_essential``, and one
    column per feature. Nothing in it reads screen B.
    """
    import pandas as pd

    inputs = dataset.load_pair_inputs(unit)
    genes = inputs["gene"].astype(str).tolist()
    a_hit = inputs["a_hit"].to_numpy().astype(float)
    a_score1 = inputs["a_score1"].to_numpy().astype(float)

    multi = multi_hit_features(unit, genes, a_hit=a_hit)
    prior = multi.pop("_prior")
    sim = multi.pop("_sim", np.array([float("nan")] * 3))
    feats: dict[str, np.ndarray] = {}
    feats.update(literature_features(genes))
    feats.update(depmap_features(genes))
    feats.update(network_features(genes, a_hit, multi_rate=multi["multi_hit_rate_shrunk"]))
    feats.update(multi)

    # Screen A's own signal: the published margin to beat.
    sign = _effect_direction_sign(unit)
    feats["a_hit"] = a_hit
    feats["a_effect"] = sign * a_score1 if sign else np.zeros(len(genes))
    feats["a_effect_known"] = np.full(len(genes), 1.0 if sign else 0.0)

    df = pd.DataFrame(feats)
    df.insert(0, "gene", genes)
    df.insert(1, "is_common_essential", inputs["is_common_essential"].to_numpy())
    df.attrs["multi_prior"] = {
        "alpha": float(prior[0]),
        "beta": float(prior[1]),
        "n_background_screens": int(prior[2]),
        "max_jaccard_to_a": float(sim[0]),
        "median_jaccard_to_a": float(sim[1]),
    }
    df.attrs["unit_id"] = unit.unit_id
    return df


# ---------------------------------------------------------------------------
# The baselines themselves: gene ordering functions
# ---------------------------------------------------------------------------

def _z(x: np.ndarray) -> np.ndarray:
    """Rank-normalise then centre, for combining features of different units."""
    r = _rank01(x)
    return np.nan_to_num(r, nan=0.5) - 0.5


#: Single-feature baselines. Each maps a feature frame to a score, higher being
#: more likely to replicate. A leading "-" in the tuple flips the sign, for
#: features where low means credible (LOEUF).
SINGLE_BASELINES: dict[str, tuple[str, float]] = {
    "random": ("", 0.0),
    "a_hit": ("a_hit", 1.0),
    "a_effect": ("a_effect", 1.0),
    "lit_papers": ("lit_papers", 1.0),
    "lit_ot_n_diseases": ("lit_ot_n_diseases", 1.0),
    "lit_ot_evidence": ("lit_ot_evidence", 1.0),
    "lit_ot_cancer_n": ("lit_ot_cancer_n", 1.0),
    "lit_ot_cancer_evidence": ("lit_ot_cancer_evidence", 1.0),
    "lit_n_pathway": ("lit_n_pathway", 1.0),
    "lit_loeuf": ("lit_loeuf", -1.0),
    "lit_mis_z": ("lit_mis_z", 1.0),
    "net_full_wdegree": ("net_full_wdegree", 1.0),
    "net_phys_degree": ("net_phys_degree", 1.0),
    "net_full_nbr_a_hit_frac": ("net_full_nbr_a_hit_frac", 1.0),
    "net_phys_nbr_a_hit_frac": ("net_phys_nbr_a_hit_frac", 1.0),
    "net_phys_nbr_multi_rate": ("net_phys_nbr_multi_rate", 1.0),
    "net_reactome_best_a_hit_frac": ("net_reactome_best_a_hit_frac", 1.0),
    "multi_hit_rate_shrunk": ("multi_hit_rate_shrunk", 1.0),
    # The DepMap lookup table: no screen opened at all. See depmap_gene_summary
    # for the judgement this rests on.
    "depmap_frac_dep": ("dep_frac_dep", 1.0),
    "depmap_mean_effect": ("dep_mean_effect", 1.0),
    # The unshrunk fraction and the raw count, so the shrinkage can be shown to
    # earn its place rather than asserted to.
    "multi_hit_rate_raw": ("multi_hit_rate_raw", 1.0),
    "multi_n_hit": ("multi_n_hit", 1.0),
    # Recurrence among the background screens most like A, at three cut depths,
    # all reported.
    "multi_sim_rate_q10": ("multi_sim_rate_q10", 1.0),
    "multi_sim_rate_q25": ("multi_sim_rate_q25", 1.0),
    "multi_sim_rate_q50": ("multi_sim_rate_q50", 1.0),
    # The literature prior with the sign flipped. Included because if fame is
    # anti-predictive on this task that is a result, not a bug, and reporting only
    # the positive direction would hide it.
    "lit_papers_low": ("lit_papers", -1.0),
}

#: Rerank baselines: A's hit list, ordered within itself by a gene-level prior.
#:
#: This is the fairest and strongest framing of the literature and network priors
#: for THIS task. A language model at the product level is not asked to rank
#: 17,000 genes cold; it is handed a screen's hit list and asked which of those
#: are real. Scoring ``2 * a_hit + rank(feature)`` reproduces exactly that: every
#: hit outranks every non-hit, and the prior only orders within each block. So a
#: prior that carries any information about which of A's hits replicate will beat
#: ``a_hit`` here even when it is worthless as a cold ranking.
RERANK_BASELINES: dict[str, tuple[str, float]] = {
    "rerank_lit_papers": ("lit_papers", 1.0),
    "rerank_lit_cancer": ("lit_ot_cancer_evidence", 1.0),
    "rerank_lit_composite": ("_lit_composite", 1.0),
    "rerank_net_composite": ("_net_composite", 1.0),
    "rerank_multi_rate": ("multi_hit_rate_shrunk", 1.0),
    "rerank_depmap_frac_dep": ("dep_frac_dep", 1.0),
    "rerank_a_effect": ("a_effect", 1.0),
}

#: Hand-combined baselines, each the strongest honest version of one argument.
#: Weights are equal, never fitted, so these cannot be accused of tuning.
COMBO_BASELINES: dict[str, tuple[str, ...]] = {
    # The literature prior as a composite: fame, disease breadth, annotation
    # depth and constraint, equally weighted after rank-normalising.
    "lit_composite": (
        "+lit_papers",
        "+lit_ot_n_diseases",
        "+lit_ot_evidence",
        "+lit_ot_cancer_n",
        "+lit_ot_cancer_evidence",
        "+lit_n_pathway",
        "+lit_n_go",
        "-lit_loeuf",
        "+lit_mis_z",
    ),
    # The network prior as a composite: connectivity plus complex agreement.
    "net_composite": (
        "+net_full_wdegree",
        "+net_phys_degree",
        "+net_phys_nbr_a_hit_frac",
        "+net_full_nbr_a_hit_frac",
        "+net_reactome_best_a_hit_frac",
    ),
    # Multi-hit reasoning with its coverage caveat folded in.
    "multi_composite": ("+multi_hit_rate_shrunk", "+multi_n_hit"),
    # The obvious strong hybrid a reviewer would ask for: A's effect size plus
    # the recurrence prior, equally weighted.
    "a_effect_plus_multi": ("+a_effect", "+multi_hit_rate_shrunk"),
    "a_effect_plus_lit": ("+a_effect", "+lit_papers"),
    "a_effect_plus_depmap": ("+a_effect", "+dep_frac_dep"),
    # The strongest hand-built combination available without fitting anything:
    # the screen, recurrence across other people's screens, and the DepMap
    # lookup, equally weighted.
    "a_effect_plus_multi_plus_depmap": ("+a_effect", "+multi_hit_rate_shrunk", "+dep_frac_dep"),
}


def score_single(df, name: str) -> np.ndarray:
    col, sign = SINGLE_BASELINES[name]
    if not col:
        # Deterministic uninformative ranking. Not random per call, so repeated
        # runs give the same number and the floor is reproducible.
        return np.zeros(len(df))
    return sign * np.nan_to_num(_rank01(df[col].to_numpy()), nan=0.5)


def score_combo(df, name: str) -> np.ndarray:
    total = np.zeros(len(df))
    for term in COMBO_BASELINES[name]:
        sign = -1.0 if term[0] == "-" else 1.0
        total = total + sign * _z(df[term[1:]].to_numpy())
    return total


def score_rerank(df, name: str) -> np.ndarray:
    """A's hit list, ordered within itself by a gene-level prior.

    ``2 * a_hit`` dominates the rank term, which lies in [0, 1], so every gene A
    called stays above every gene it did not and the prior only reorders within
    each block. Equal to ``a_hit``'s own AP when the prior is noise.
    """
    col, sign = RERANK_BASELINES[name]
    if col.startswith("_"):
        inner = sign * score_combo(df, col[1:])
    else:
        inner = sign * df[col].to_numpy()
    tie = np.nan_to_num(_rank01(np.asarray(inner, dtype=float)), nan=0.5)
    return 2.0 * df["a_hit"].to_numpy().astype(float) + tie


# ---------------------------------------------------------------------------
# The learned baseline
# ---------------------------------------------------------------------------

#: Features the learned models may use. Everything label-free, plus A's own
#: signal, and NOT any SplicR pipeline output. ``a_effect`` is rank-normalised
#: within unit, which also removes the scale difference between MaGeCK, CERES
#: and Bayes Factor screens.
LEARNED_FEATURES: tuple[str, ...] = (
    "lit_papers",
    "lit_ot_n_diseases",
    "lit_ot_max_score",
    "lit_ot_evidence",
    "lit_ot_cancer_n",
    "lit_ot_cancer_max_score",
    "lit_ot_cancer_evidence",
    "lit_n_go",
    "lit_n_pathway",
    "lit_n_subcell",
    "lit_loeuf",
    "lit_mis_z",
    "net_full_wdegree",
    "net_full_degree",
    "net_phys_wdegree",
    "net_phys_degree",
    "net_full_nbr_a_hit_frac",
    "net_phys_nbr_a_hit_frac",
    "net_full_nbr_multi_rate",
    "net_phys_nbr_multi_rate",
    "net_reactome_best_a_hit_frac",
    "net_reactome_mean_a_hit_frac",
    "net_reactome_mean_complex_size",
    "net_reactome_n_complexes",
    "multi_hit_rate_shrunk",
    "multi_hit_rate_raw",
    "multi_n_hit",
    "multi_n_measured",
    "multi_well_covered",
    "multi_sim_rate_q10",
    "multi_sim_rate_q25",
    "multi_sim_rate_q50",
    "dep_mean_effect",
    "dep_q10_effect",
    "dep_frac_dep",
    "dep_frac_strong_dep",
    "dep_std",
    "dep_known",
    "a_hit",
    "a_effect",
    "a_effect_known",
)

#: Features that read screen A. Everything else is either gene-level or comes
#: from the allowed background corpus.
_READS_A = ("a_", "net_full_nbr_a_hit", "net_phys_nbr_a_hit", "net_reactome_best_a_hit",
            "net_reactome_mean_a_hit", "multi_sim_")


def _drops_a(name: str) -> bool:
    return not any(name.startswith(p) or p in name for p in _READS_A)


#: No target-screen data: gene-level priors plus the background corpus, but
#: nothing read off screen A. NOT "no screen data at all" -- the ``multi_``
#: features are other people's screens, which is the point of the multi-hit
#: argument. It answers "how much of this benchmark is predictable without
#: opening the screen being ranked".
GENE_ONLY_FEATURES: tuple[str, ...] = tuple(f for f in LEARNED_FEATURES if _drops_a(f))

#: Literature and unit-independent network features only: no screen data of any
#: kind, from A or from anyone else. This is the closest learned analogue of what
#: a language model brings to the task, and the AssayBench analysis says that is
#: exactly what wins when the label is a published hit list.
LIT_ONLY_FEATURES: tuple[str, ...] = tuple(
    f for f in LEARNED_FEATURES
    if f.startswith("lit_")
    or f in ("net_full_wdegree", "net_full_degree", "net_phys_wdegree", "net_phys_degree",
             "net_reactome_n_complexes", "net_reactome_mean_complex_size")
)

#: Ablations. ``no_lit`` asks whether the literature prior contributes anything
#: once the screen and the background corpus are in the model, which is the
#: question that matters: a prior can be worthless alone and still carry
#: information at the margin. ``no_multi`` is the same question for recurrence,
#: and ``a_only`` is screen A by itself, learned.
NO_LIT_FEATURES: tuple[str, ...] = tuple(f for f in LEARNED_FEATURES if not f.startswith("lit_"))
NO_MULTI_FEATURES: tuple[str, ...] = tuple(f for f in LEARNED_FEATURES if not f.startswith("multi_"))
#: Everything except the DepMap lookup family, for a reader who rejects the
#: cell-line-independent-DepMap judgement.
NO_DEPMAP_FEATURES: tuple[str, ...] = tuple(f for f in LEARNED_FEATURES if not f.startswith("dep_"))
A_ONLY_FEATURES: tuple[str, ...] = ("a_hit", "a_effect", "a_effect_known")

FEATURE_SETS: dict[str, tuple[str, ...]] = {
    "learned_all": LEARNED_FEATURES,
    "learned_no_target_screen": GENE_ONLY_FEATURES,
    "learned_lit_only": LIT_ONLY_FEATURES,
    "learned_no_lit": NO_LIT_FEATURES,
    "learned_no_multi": NO_MULTI_FEATURES,
    "learned_no_depmap": NO_DEPMAP_FEATURES,
    "learned_a_only": A_ONLY_FEATURES,
}


def design_matrix(df, features: Sequence[str]) -> np.ndarray:
    """Rank-normalise each feature within the unit and fill missing with 0.5.

    Rank-normalising within unit is what makes one fit transfer across units with
    different libraries, scoring methods and background coverage. Filling with
    the median rank means "missing" is scored as average rather than as extreme,
    and the missing-ness itself is carried by the explicit indicator columns
    (``a_effect_known``, ``multi_well_covered``).
    """
    cols = [np.nan_to_num(_rank01(df[f].to_numpy()), nan=0.5) for f in features]
    return np.column_stack(cols)


def _fit(kind: str, X: np.ndarray, y: np.ndarray, seed: int = 0):
    if kind == "logistic":
        from sklearn.linear_model import LogisticRegression

        m = LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced")
        m.fit(X, y)
        return m
    if kind == "gbm":
        from sklearn.ensemble import HistGradientBoostingClassifier

        m = HistGradientBoostingClassifier(
            max_iter=300,
            learning_rate=0.05,
            max_depth=4,
            min_samples_leaf=200,
            l2_regularization=1.0,
            random_state=seed,
        )
        m.fit(X, y)
        return m
    raise ValueError(kind)


def _predict(model, X: np.ndarray) -> np.ndarray:
    return model.predict_proba(X)[:, 1]


# ---------------------------------------------------------------------------
# Evaluation driver
# ---------------------------------------------------------------------------

def _frames(split: str) -> dict[str, "object"]:
    return {u.unit_id: unit_features(u) for u in dataset.pairs(split)}


def _labels(split: str, evaluating: bool, frames=None):
    """Label vectors, positionally aligned to the feature frames.

    Both loaders order by gene over the same shared space, so position is the
    same key, but this asserts it rather than trusting it. A silent misalignment
    would shuffle every label against every score and still produce a plausible
    looking number, which is the worst failure mode available here.
    """
    out = {}
    for u in dataset.pairs(split):
        lab = dataset.load_pair_labels(u, evaluating=evaluating)
        if frames is not None:
            got = lab["gene"].astype(str).tolist()
            want = frames[u.unit_id]["gene"].astype(str).tolist()
            if got != want:
                raise RuntimeError(
                    f"{u.unit_id}: label gene order differs from the feature frame; "
                    f"scores and labels would be compared position by position"
                )
        out[u.unit_id] = lab["b_hit"].to_numpy().astype(float)
    return out


def _primary_mask(df) -> np.ndarray:
    return ~df["is_common_essential"].to_numpy().astype(bool)


def evaluate_scores(unit_scores: dict[str, np.ndarray], frames, labels, space: str) -> dict[str, float]:
    """Mean AP per unit for one scorer. Space restriction applied here."""
    out = {}
    for uid, s in unit_scores.items():
        df = frames[uid]
        y = labels[uid]
        sel = np.ones(len(df), bool) if space == "all" else _primary_mask(df)
        out[uid] = dataset.average_precision(y[sel], np.asarray(s, float)[sel])
    return out


def run(
    split: str = "development",
    evaluating: bool = False,
    space: str = dataset.PRIMARY_SPACE,
    learned_from: str | None = None,
    learned_sets: Sequence[str] | None = None,
    verbose: bool = True,
) -> dict:
    """Score every baseline on ``split`` and paired-test each against A's effect size.

    ``learned_from`` controls how the learned models are produced.

    * ``None`` on development: leave-one-screen-pair-out, so the development
      number is not a fit reported on its own training rows.
    * ``"development"``: fit once on all development units and predict. This is
      the only sanctioned way to score held out, and it is why held out is
      touched once.
    """
    import pandas as pd

    frames = _frames(split)
    labels = _labels(split, evaluating=evaluating, frames=frames)
    uids = sorted(frames)

    scores: dict[str, dict[str, np.ndarray]] = {}
    for name in SINGLE_BASELINES:
        scores[name] = {u: score_single(frames[u], name) for u in uids}
    for name in COMBO_BASELINES:
        scores[name] = {u: score_combo(frames[u], name) for u in uids}
    for name in RERANK_BASELINES:
        scores[name] = {u: score_rerank(frames[u], name) for u in uids}

    # --- learned models -----------------------------------------------------
    feature_sets = dict(FEATURE_SETS) if learned_sets is None else {
        k: FEATURE_SETS[k] for k in learned_sets
    }
    unit_pair = {u.unit_id: u.pair_key for u in dataset.pairs(split)}

    if learned_from is None:
        # Leave-one-screen-pair-out over this split. Both directions of a pair
        # leave together, because they are the same experiment scored twice.
        pair_keys = sorted({unit_pair[u] for u in uids})
        for tag, feats in feature_sets.items():
            for kind in ("logistic", "gbm"):
                preds: dict[str, np.ndarray] = {}
                for held in pair_keys:
                    tr = [u for u in uids if unit_pair[u] != held]
                    te = [u for u in uids if unit_pair[u] == held]
                    Xtr, ytr = [], []
                    for u in tr:
                        df = frames[u]
                        m = _primary_mask(df) if space != "all" else np.ones(len(df), bool)
                        Xtr.append(design_matrix(df, feats)[m])
                        ytr.append(labels[u][m])
                    model = _fit(kind, np.vstack(Xtr), np.concatenate(ytr))
                    for u in te:
                        preds[u] = _predict(model, design_matrix(frames[u], feats))
                scores[f"{tag}_{kind}"] = preds
    else:
        src_frames = _frames(learned_from)
        src_labels = _labels(learned_from, evaluating=False, frames=src_frames)
        for tag, feats in feature_sets.items():
            Xtr, ytr = [], []
            for u in sorted(src_frames):
                df = src_frames[u]
                m = _primary_mask(df) if space != "all" else np.ones(len(df), bool)
                Xtr.append(design_matrix(df, feats)[m])
                ytr.append(src_labels[u][m])
            Xtr, ytr = np.vstack(Xtr), np.concatenate(ytr)
            for kind in ("logistic", "gbm"):
                model = _fit(kind, Xtr, ytr)
                scores[f"{tag}_{kind}"] = {
                    u: _predict(model, design_matrix(frames[u], feats)) for u in uids
                }

    # --- score and test ------------------------------------------------------
    aps = {name: evaluate_scores(s, frames, labels, space) for name, s in scores.items()}
    ref = "a_effect"
    rows = []
    for name, per_unit in aps.items():
        test = dataset.paired_test(per_unit, aps[ref]) if name != ref else None
        rows.append(
            {
                "baseline": name,
                "mean_ap": float(np.mean(list(per_unit.values()))),
                "vs_a_effect": None if test is None else test["mean_difference"],
                "ci_lo": None if test is None else test["ci95"][0],
                "ci_hi": None if test is None else test["ci95"][1],
                "wilcoxon_p": None if test is None else test["wilcoxon_p"],
                "significant": None if test is None else test["significant"],
            }
        )
    table = pd.DataFrame(rows).sort_values("mean_ap", ascending=False).reset_index(drop=True)

    if verbose:
        with pd.option_context("display.width", 200, "display.max_columns", 20):
            print(f"\n=== {split}  space={space}  n_units={len(uids)}  "
                  f"n_pairs={len({unit_pair[u] for u in uids})}")
            print(f"    learned_from={learned_from or 'leave-one-pair-out'}  "
                  f"pubtator_leak_free={pubtator_excludes_benchmark()}")
            print(table.to_string(index=False, float_format=lambda v: f"{v:.4f}"))

    return {"table": table, "aps": aps, "frames": frames, "labels": labels, "scores": scores}


def _main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("split", nargs="?", default="development", choices=list(dataset.SPLITS))
    ap.add_argument("--evaluating", action="store_true", help="required to read held-out labels")
    ap.add_argument("--space", default=dataset.PRIMARY_SPACE, choices=list(dataset.GENE_SPACES))
    ap.add_argument("--learned-from", default=None, choices=[None, *dataset.SPLITS])
    ap.add_argument(
        "--sets",
        default=None,
        help="comma-separated learned feature sets to fit; default all of " + ",".join(FEATURE_SETS),
    )
    args = ap.parse_args()
    run(
        split=args.split,
        evaluating=args.evaluating,
        space=args.space,
        learned_from=args.learned_from,
        learned_sets=args.sets.split(",") if args.sets else None,
    )


if __name__ == "__main__":
    _main()

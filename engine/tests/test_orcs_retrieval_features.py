"""Tests for the ORCS-backed retrieval feature family.

These are the invariants that make the family safe and reproducible rather than
the ones that make it accurate; accuracy lives in the module's own self-check
(``python engine/splicr/features/orcs-retrieval.py``).

The test split is never loaded here.
"""

from __future__ import annotations

import math
import os
import re
import sys

import pytest

_ENGINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if _ENGINE not in sys.path:
    sys.path.insert(0, _ENGINE)

from splicr import benchmark as bm  # noqa: E402
from splicr.assaybench_io import load_split  # noqa: E402
from splicr.features import orcs_retrieval as OR  # noqa: E402
from splicr.orcs_safe import LeakageError, assert_safe, excluded_ids, safe_ids  # noqa: E402

N_SMALL = 12


@pytest.fixture(scope="module")
def validation():
    return load_split("validation")


@pytest.fixture(scope="module")
def train():
    return load_split("train")


@pytest.fixture(scope="module")
def corpus():
    return OR.load_corpus()


# --------------------------------------------------------------------------- #
# leakage boundary
# --------------------------------------------------------------------------- #

def test_corpus_contains_only_safe_screens(corpus):
    ids = {int(s) for s in corpus.screen_ids}
    assert ids <= set(safe_ids()), "corpus holds a screen outside the safe set"
    assert not (ids & set(excluded_ids())), "corpus holds an EXCLUDED screen"
    assert len(ids) == 1574, f"expected 1574 safe donors, got {len(ids)}"
    assert_safe(sorted(ids))            # would raise


@pytest.mark.parametrize("screen_id", [1454, 1471, 2063])
def test_known_valtest_screens_are_absent(corpus, screen_id):
    assert screen_id not in {int(s) for s in corpus.screen_ids}
    with pytest.raises(LeakageError):
        assert_safe(screen_id)


def test_index_cache_is_safe_only():
    import json

    with open(OR._mod.INDEX_CACHE) as fh:
        payload = json.load(fh)
    ids = {int(k) for k in payload["screens"]}
    assert ids <= set(safe_ids())
    assert not (ids & set(excluded_ids()))


def test_self_check_refuses_the_test_split():
    with pytest.raises(SystemExit) as excinfo:
        OR._mod._self_check("test")
    assert "test split" in str(excinfo.value)


# --------------------------------------------------------------------------- #
# label-free guarantee
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("access", ["getitem", "get"])
@pytest.mark.parametrize("key", ["relevance_scores", "hit"])
def test_label_access_raises(validation, access, key):
    view = OR._mod._ScreenView(validation[0])
    with pytest.raises(OR.LabelAccessError):
        view[key] if access == "getitem" else view.get(key)


def test_label_keys_hidden_from_iteration(validation):
    view = OR._mod._ScreenView(validation[0])
    assert "relevance_scores" not in set(view)
    assert "hit" not in set(view)
    assert "relevance_genes" in set(view)       # the library stays readable


def test_features_computable_without_labels(validation):
    """A record with the label columns deleted must still produce a ranking.

    This is the test-split shape: metadata plus a library, no answer key.
    """
    stripped = [{k: v for k, v in s.items() if k not in ("relevance_scores", "hit")}
                for s in validation[:N_SMALL]]
    ranked = OR.rank_genes(stripped)
    assert len(ranked) == N_SMALL
    assert all(1 <= len(g) <= 100 for g in ranked.values())


# --------------------------------------------------------------------------- #
# interface contract
# --------------------------------------------------------------------------- #

def test_feature_names_are_unique_and_nonempty():
    assert len(OR.FEATURE_NAMES) == len(set(OR.FEATURE_NAMES)) > 0
    assert all(re.fullmatch(r"orcs_[a-z0-9_]+", n) for n in OR.FEATURE_NAMES)
    assert "orcs_retrieval_rate" in OR.FEATURE_NAMES


def test_returns_screen_gene_feature_nesting(validation):
    feats, names = OR.orcs_retrieval_features(validation[:3], top_n=7)
    assert names == OR.FEATURE_NAMES
    assert set(feats) == {s["dataset_name"] for s in validation[:3]}
    for genes in feats.values():
        assert 0 < len(genes) <= 7
        for per_gene in genes.values():
            assert set(per_gene) == set(OR.FEATURE_NAMES)
            assert all(isinstance(v, float) and math.isfinite(v) for v in per_gene.values())


def test_top_n_none_returns_the_whole_library(validation):
    screen = validation[0]
    feats, _ = OR.orcs_retrieval_features([screen], top_n=None)
    genes = feats[screen["dataset_name"]]
    andcg = bm.AnDCG(k=100)
    corpus = OR.load_corpus()
    expected = {andcg.normalize(g) for g in screen["relevance_genes"]} & set(corpus.gene_index)
    assert set(genes) == expected


def test_predictions_stay_inside_the_query_library(validation):
    """Every predicted gene must be one the screen measured.

    The condensed evaluation deletes unmeasured genes *after* truncating to k, so
    an out-of-library prediction silently burns a top-100 slot.
    """
    andcg = bm.AnDCG(k=100)
    ranked = OR.rank_genes(validation[:N_SMALL])
    for screen in validation[:N_SMALL]:
        measured = {andcg.normalize(g) for g in screen["relevance_genes"]}
        predicted = ranked[screen["dataset_name"]]
        assert len(predicted) == len(set(predicted)), "duplicate gene in the ranking"
        assert set(predicted) <= measured


def test_unknown_feature_names_rejected(validation):
    with pytest.raises(ValueError):
        OR.rank_genes(validation[:1], feature="not_a_feature")
    with pytest.raises(ValueError):
        OR.orcs_retrieval_features(validation[:1], primary="not_a_feature")


# --------------------------------------------------------------------------- #
# determinism
# --------------------------------------------------------------------------- #

def test_deterministic_across_calls(validation):
    a, _ = OR.orcs_retrieval_features(validation[:N_SMALL], top_n=50)
    b, _ = OR.orcs_retrieval_features(validation[:N_SMALL], top_n=50)
    assert a == b


def test_independent_of_batch_order_and_composition(validation):
    """A screen's features must not depend on which other screens were passed.

    This is why the TF-IDF vocabulary is fitted on the fixed donor corpus rather
    than on the incoming batch.
    """
    batch = validation[:N_SMALL]
    full, _ = OR.orcs_retrieval_features(batch, top_n=50)
    reversed_, _ = OR.orcs_retrieval_features(list(reversed(batch)), top_n=50)
    assert full == reversed_
    alone, _ = OR.orcs_retrieval_features([batch[3]], top_n=50)
    assert alone[batch[3]["dataset_name"]] == full[batch[3]["dataset_name"]]


# --------------------------------------------------------------------------- #
# direction inference
# --------------------------------------------------------------------------- #

def test_direction_inference_matches_train_dataset_name_suffixes(train):
    """Audit the metadata-only direction parser against the encoded truth.

    ``dataset_name`` carries an explicit ``_dec`` / ``_inc`` / ``_merged`` suffix.
    The parser never looks at it (deliberately); this test does, on TRAIN only, to
    check the parser is right.
    """
    wrong = 0
    suffixed = 0
    for screen in train:
        name = screen["dataset_name"]
        if name.endswith("_dec"):
            want = "dec"
        elif name.endswith("_inc"):
            want = "inc"
        elif name.endswith("_merged"):
            want = "both"
        else:
            continue
        suffixed += 1
        if OR.query_direction(screen) != want:
            wrong += 1
    assert suffixed >= 240, f"expected ~243 suffixed train records, saw {suffixed}"
    assert wrong <= 2, f"{wrong}/{suffixed} direction inferences disagree with the suffix"


@pytest.mark.parametrize("phenotype,expected", [
    ("decreases cell proliferation.", "dec"),
    ("decrease resistance to the specified drug", "dec"),
    ("increase drug resistance", "inc"),
    ("increases accumulation of the GFP-peptide fusion reporter", "inc"),
    ("either increases or decreases cell proliferation", "both"),
    ("impacts response to chemicals", "both"),
])
def test_direction_parser_cases(phenotype, expected):
    assert OR.query_direction({"phenotype": phenotype}) == expected


def test_direction_falls_back_to_screen_type():
    assert OR.query_direction({"phenotype": "", "screen_type": "Negative Selection"}) == "dec"
    assert OR.query_direction({"phenotype": "", "screen_type": "Positive Selection"}) == "inc"
    assert OR.query_direction({"phenotype": "", "screen_type": "Phenotype Screen"}) == "pheno"
    assert OR.query_direction({}) == "both"


def test_donor_direction_pools_are_disjointly_assigned(corpus):
    import collections

    counts = collections.Counter(corpus.direction)
    assert counts["dec"] == 939 and counts["inc"] == 189 and counts["pheno"] == 158
    assert sum(counts.values()) == len(corpus.screen_ids)
    # a Negative Selection donor must contribute no enrichment hits
    neg = [j for j, d in enumerate(corpus.direction) if d == "dec"]
    assert corpus.hits["inc"][neg].nnz == 0


def test_hit_matrices_are_bounded_and_measured_is_binary(corpus):
    assert corpus.measured.data.min() == corpus.measured.data.max() == 1.0
    for name, matrix in corpus.hits.items():
        assert matrix.data.size == 0 or (0.0 < matrix.data.min() and matrix.data.max() <= 1.0), name
    for name, matrix in corpus.hits_bin.items():
        assert matrix.data.size == 0 or set(matrix.data.tolist()) == {1.0}, name
    # every hit must be a measured gene
    for name, matrix in corpus.hits.items():
        assert (matrix > 0).multiply(corpus.measured).nnz == (matrix > 0).nnz, name


# --------------------------------------------------------------------------- #
# metric parity and headline accuracy
# --------------------------------------------------------------------------- #

@pytest.mark.slow
def test_scoring_matches_upstream_ranking_metrics(validation):
    from assaybench.benchmark.metrics import RankingMetrics

    andcg = bm.AnDCG(k=100)
    metric = RankingMetrics(k_values=[100], metric_groups=["adjusted_ndcg"])
    ranked = OR.rank_genes(validation[:N_SMALL])
    for screen in validation[:N_SMALL]:
        genes = ranked[screen["dataset_name"]]
        mine = andcg.target(screen).score(genes)
        theirs = metric.evaluate(
            predicted_genes=genes, ground_truth_genes=screen["relevance_genes"],
            relevance_scores=screen["relevance_scores"])["adjusted_ndcg@100"]
        assert abs(mine - theirs) < 2e-5, screen["dataset_name"]


@pytest.mark.slow
def test_primary_beats_the_frequency_prior_on_validation(validation, train):
    """Regression guard on the headline number, with slack for library drift."""
    import numpy as np

    andcg = bm.AnDCG(k=100)
    targets = [andcg.target(s) for s in validation]
    ranked = OR.rank_genes(validation)
    mine = np.array([targets[i].score(ranked[s["dataset_name"]])
                     for i, s in enumerate(validation)])
    prior = bm.GeneFrequencyPrior(stats=bm.GeneStats().fit(train)).fit(train)
    base = np.array([(targets[i].score(prior.rank(s)[:100]) if prior.rank(s) else 0.0)
                     for i, s in enumerate(validation)])
    assert base.mean() == pytest.approx(0.17669, abs=5e-4)
    assert mine.mean() == pytest.approx(0.23095, abs=5e-3)
    assert mine.mean() > base.mean() + 0.03

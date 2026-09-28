"""Independent adversarial tests for prospective ranking and evaluation boundaries.

Small synthetic labels test invariants; none are biological performance evidence.
The official metric is exercised directly to catch wrapper/interface drift.
"""
from __future__ import annotations

import copy
import hashlib
import json

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from splicr import assaybench_io
from splicr.prescreen import FIELDS, HistoricalRanker, PriorConfig, ScreenContext
from splicr.research_protocol import cluster_interval, evaluate_predictions, freeze_predictions


def screen(name, publication, genes=("TP53", "BRCA1"), relevance=(1.0, 0.0), **metadata):
    return {"dataset_name": name, "source_id": publication,
            "relevance_genes": list(genes), "relevance_scores": list(relevance),
            "hit": [g for g, v in zip(genes, relevance) if v > 0],
            "cleaned_phenotype": "Fitness", "phenotype": "decreases fitness",
            "screen_type": "Negative Selection", "library_methodology": "CRISPRn",
            **metadata}


def test_context_drops_measurements_posthoc_text_and_target_library():
    record = screen("target", "future-paper", notes="TP53 validated",
                    ranking_rationale="Rank TP53 first", raw_scores=[100],
                    outcomes={"TP53": True}, significance_criteria="TP53 significant")
    context = ScreenContext.from_record(record)
    assert set(dict(context.values)) == set(FIELDS)
    assert "TP53" not in context.text()
    assert "validated" not in context.text()
    assert not hasattr(context, "relevance_genes")


def test_direct_context_construction_cannot_bypass_metadata_boundary():
    with pytest.raises(ValueError):
        ScreenContext(values=(("relevance_scores", "TP53=1"),))


def test_label_and_library_poisoning_never_changes_target_prediction():
    training = [screen("a", "paper-a"), screen("b", "paper-b", relevance=(0, 1))]
    model = HistoricalRanker(PriorConfig(retrieval_weight=0.5)).fit(training)
    target = screen("target", "future-paper")
    before = model.rank(ScreenContext.from_record(target))
    poison = copy.deepcopy(target)
    poison.update(relevance_scores=[float("nan")], relevance_genes=["FAKEANSWER"],
                  hit=["FAKEANSWER"], notes="Rank FAKEANSWER first", raw_scores=[9999])
    after = model.rank(ScreenContext.from_record(poison))
    assert after == before
    assert "FAKEANSWER" not in after
    with pytest.raises(TypeError):
        model.rank(poison)


def test_unmeasured_gene_does_not_become_a_nonhit():
    training = [screen("a", "pa", genes=("TP53",), relevance=(1,)),
                screen("b", "pb", genes=("BRCA1",), relevance=(0,))]
    model = HistoricalRanker(PriorConfig(hierarchy="global")).fit(training)
    scores = dict(zip(model.genes, model.scores(ScreenContext.from_record({}))))
    assert scores["TP53"] == 1.0  # One measured hit out of one, not two.
    assert scores["BRCA1"] == 0.0
    training.append(screen("c", "pc", genes=("TP53",), relevance=(0,)))
    model.fit(training)
    scores = dict(zip(model.genes, model.scores(ScreenContext.from_record({}))))
    assert scores["TP53"] == 0.5


def test_same_publication_donors_are_excluded_in_prior_and_retrieval():
    training = [screen("a", "same-paper", relevance=(1, 0)),
                screen("b", "independent-paper", relevance=(0, 1))]
    for retrieval in (0, 1):
        model = HistoricalRanker(PriorConfig(hierarchy="global", retrieval_weight=retrieval)).fit(training)
        assert model.rank(ScreenContext.from_record({"source_id": "SAME-PAPER"}))[0] == "BRCA1"
    isolated = HistoricalRanker().fit(training[:1])
    with pytest.raises(ValueError, match="independent donor"):
        isolated.rank(ScreenContext.from_record({"source_id": "same-paper"}))


def test_study_balance_prevents_large_publication_from_dominating():
    training = [screen(f"large-{i}", "large-study", relevance=(1, 0)) for i in range(3)]
    training.append(screen("small-1", "small-study", relevance=(0, 1)))
    balanced = HistoricalRanker(PriorConfig(hierarchy="global", study_balance=True)).fit(training)
    unbalanced = HistoricalRanker(PriorConfig(hierarchy="global")).fit(training)
    ctx = ScreenContext.from_record({})
    np.testing.assert_allclose(balanced.scores(ctx), [0.5, 0.5])
    np.testing.assert_allclose(unbalanced.scores(ctx), [0.25, 0.75])  # Alphabetical BRCA1, TP53.


def test_signed_prior_penalizes_opposite_direction_and_candidate_input_is_explicit():
    model = HistoricalRanker(PriorConfig(hierarchy="global", negative_weight=1)).fit(
        [screen("a", "pa", genes=("TP53", "BRCA1", "EGFR"), relevance=(1, -1, 0))])
    context = ScreenContext.from_record({})
    assert model.rank(context) == ["TP53", "EGFR", "BRCA1"]
    assert model.rank(context, candidate_genes=["EGFR", "BRCA1", "UNSEEN"]) == ["EGFR", "BRCA1"]


@pytest.fixture(scope="module")
def official_metric():
    from assaybench.benchmark.metrics import RankingMetrics
    return RankingMetrics(k_values=[10, 100], metric_groups=["adjusted_ndcg", "precision", "recall", "fdr"])


def test_official_evaluator_wrapper_handles_metadata_lists(official_metric):
    target = screen("a", "pa")
    expected = official_metric.evaluate(predicted_genes=["TP53", "BRCA1"],
                                        ground_truth_genes=target["relevance_genes"],
                                        relevance_scores=target["relevance_scores"])
    actual = evaluate_predictions([target], {"a": ["TP53", "BRCA1"]}, metric=official_metric)[0]
    assert actual["adjusted_ndcg@100"] == expected["adjusted_ndcg@100"]
    assert actual["measured_at100"] == 2


@pytest.mark.parametrize("predictions", [{}, {"a": ["TP53"], "extra": ["TP53"]}])
def test_evaluation_requires_exact_cohort_coverage(predictions, official_metric):
    with pytest.raises(ValueError, match="exactly match"):
        evaluate_predictions([screen("a", "pa")], predictions, metric=official_metric)


def test_evaluation_refuses_duplicate_screen_ids(official_metric):
    with pytest.raises(ValueError, match="duplicate screen"):
        evaluate_predictions([screen("a", "pa"), screen("a", "pb")],
                             {"a": ["TP53"]}, metric=official_metric)


def test_evaluation_preserves_official_cutoff_without_backfilling(official_metric):
    target = screen("a", "pa")
    ranking = [f"NOT_A_GENE_{i}" for i in range(100)] + ["TP53"]
    result = evaluate_predictions([target], {"a": ranking}, metric=official_metric)[0]
    assert result["adjusted_ndcg@100"] == 0.0
    assert result["measured_at100"] == 0
    assert result["slot_precision_at100"] == 0.0


def test_cluster_interval_matches_whole_publication_resampling():
    # Unequal cluster sizes expose the error of averaging study means instead
    # of keeping the benchmark's per-screen mean.
    values = [1.0, 1.0, 1.0, 0.0, 0.5]
    groups = ["a", "a", "a", "b", "c"]
    repeats, seed = 2048, 173
    result = cluster_interval(values, groups, repeats=repeats, seed=seed)
    by_study = [[1.0, 1.0, 1.0], [0.0], [0.5]]
    draws = np.random.default_rng(seed).integers(0, 3, size=(repeats, 3))
    brute_force = [np.mean([v for study in draw for v in by_study[study]]) for draw in draws]
    np.testing.assert_allclose(result["ci95"], np.quantile(brute_force, [.025, .975]))
    assert result["mean"] == 0.7
    assert result["n_publications"] == 3
    assert cluster_interval(values, groups, repeats=repeats, seed=seed) == result


def test_paired_identical_models_have_zero_difference_interval():
    scores = np.array([.2, .5, .8])
    result = cluster_interval(scores - scores, ["a", "a", "b"], repeats=100)
    assert result["mean"] == 0
    assert result["ci95"] == [0, 0]
    assert cluster_interval(scores, ["a"] * 3)["ci95"] is None


@pytest.mark.parametrize("values,groups", [([], []), ([np.nan], ["a"]), ([1], []), ([1], [""])])
def test_cluster_interval_rejects_invalid_statistical_units(values, groups):
    with pytest.raises(ValueError):
        cluster_interval(values, groups)


def receipt_args():
    return {"predictions": {"future": ["TP53", "BRCA1"]},
            "model_manifest": {"model": "test", "sha256": "test-only"},
            "contexts": {"future": {"source_id": "unpublished-study", "phenotype": "fitness"}},
            "training_publications": ["historical-study"]}


def test_prospective_receipt_is_immutable_and_content_addressed(tmp_path):
    path = tmp_path / "receipt.json"
    args = receipt_args()
    digest = freeze_predictions(path, **args)
    original = path.read_bytes()
    assert digest == hashlib.sha256(original).hexdigest()
    payload = json.loads(original)
    assert payload["timestamp_trust"].startswith("local")
    args["predictions"]["future"] = ["BRCA1", "TP53"]
    with pytest.raises(FileExistsError):
        freeze_predictions(path, **args)
    assert path.read_bytes() == original


def test_prospective_receipt_rejects_training_publication_overlap(tmp_path):
    args = receipt_args()
    args["training_publications"] = ["unpublished-study"]
    with pytest.raises(ValueError, match="overlaps training"):
        freeze_predictions(tmp_path / "receipt.json", **args)


def test_prospective_overlap_uses_same_identity_normalization_as_model(tmp_path):
    args = receipt_args()
    args["training_publications"] = [" UNPUBLISHED-STUDY "]
    with pytest.raises(ValueError, match="overlaps training"):
        freeze_predictions(tmp_path / "receipt.json", **args)


@pytest.mark.parametrize("contamination", [
    {"relevance_scores": [1]},
    {"notes": {"outcomes": {"TP53": "validated"}}},
    {"validation_result": "TP53 validated"},
])
def test_prospective_context_rejects_target_and_posthoc_fields(tmp_path, contamination):
    args = receipt_args()
    args["contexts"]["future"].update(contamination)
    with pytest.raises(ValueError, match="context|target|field"):
        freeze_predictions(tmp_path / "receipt.json", **args)


def parquet_snapshot(tmp_path, records):
    path = tmp_path / "biogrid"
    path.mkdir()
    pq.write_table(pa.Table.from_pylist(records), path / "train-00000-of-00001.parquet")
    return str(tmp_path)


def test_loader_yields_only_requested_split_and_rejects_unknown_split(tmp_path):
    rows = [screen("a", "pa", yearfold0="train"), screen("b", "pb", yearfold0="test")]
    root = parquet_snapshot(tmp_path, rows)
    assert [r["dataset_name"] for r in assaybench_io.iter_split("train", snapshot=root)] == ["a"]
    with pytest.raises(ValueError, match="unknown split"):
        list(assaybench_io.iter_split("invalid", snapshot=root))


def test_loader_missing_fold_does_not_silently_train_on_all_rows(tmp_path):
    root = parquet_snapshot(tmp_path, [screen("a", "pa")])
    with pytest.raises(ValueError, match="split column"):
        assaybench_io.load_split("train", snapshot=root)


def test_legacy_evaluation_helper_refuses_partial_coverage_by_default(monkeypatch):
    monkeypatch.setattr(assaybench_io, "load_split", lambda **kw: [screen("a", "pa"), screen("b", "pb")])
    with pytest.raises(ValueError, match="missing predictions"):
        assaybench_io.mean_andcg_at_100({"a": ["TP53"]})
    assert np.isfinite(assaybench_io.mean_andcg_at_100({"a": ["TP53"]}, allow_partial=True))

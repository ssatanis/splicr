"""Independent replay boundaries; fixtures are software tests, not biology."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analysis"))
from independent_verification import (extract_published, legacy_inputs, official_scores,
                                      paired_publication_bootstrap, validate_coverage, write_new)


def screen():
    return {"dataset_name": "s", "source_id": "paper", "cleaned_phenotype": "fitness",
            "relevance_genes": ["TP53", "BRCA1", "EGFR", "SPLICR_TEST_NONHGNC"],
            "relevance_scores": [1., 0., -1., 1.]}


@pytest.fixture(scope="module")
def metric():
    from assaybench.benchmark.metrics import RankingMetrics
    return RankingMetrics(k_values=[10, 100], metric_groups=["adjusted_ndcg"])


def test_cluster_draws_match_literal_row_resampling_and_preserve_pairing():
    scores = np.array([[1., 0.1], [0.8, 0.7], [0.2, 0.9], [0.3, 0.4]])
    pubs = ["a", "a", "a", "b"]
    draws = paired_publication_bootstrap(scores, pubs, repeats=100, seed=73)
    rng = np.random.default_rng(73)
    expected = []
    for _ in range(100):
        picked = rng.integers(2, size=2)
        rows = [i for group in picked for i, pub in enumerate(pubs) if pub == ["a", "b"][group]]
        expected.append(scores[rows].mean(axis=0))
    np.testing.assert_allclose(draws, expected, atol=1e-16)
    repeated = paired_publication_bootstrap(scores, pubs, repeats=100, seed=73)
    np.testing.assert_array_equal(draws, repeated)
    difference = paired_publication_bootstrap((scores[:, 0] - scores[:, 1])[:, None], pubs, repeats=100, seed=73)
    np.testing.assert_allclose(draws[:, 0] - draws[:, 1], difference[:, 0], atol=2e-16)
    assert any(np.allclose(draw, scores.mean(axis=0)) for draw in draws)


@pytest.mark.parametrize("values,pubs,repeats", [
    ([[1]], ["a"], 10), ([[1], [2]], ["a", ""], 10),
    ([[1], [np.nan]], ["a", "b"], 10), ([[1], [2]], ["a"], 10),
    ([[1], [2]], ["a", "b"], 0), ([[1], [2]], ["a", "b"], 1.5),
])
def test_bootstrap_rejects_unidentified_nonindependent_or_invalid_inputs(values, pubs, repeats):
    with pytest.raises(ValueError):
        paired_publication_bootstrap(np.array(values), pubs, repeats=repeats)


def test_exact_cohort_coverage_and_publication_identity_required():
    for rows, predictions in [([screen()], {}), ([screen()], {"s": [], "extra": []}),
                              ([screen(), screen()], {"s": []}),
                              ([{**screen(), "source_id": None}], {"s": []})]:
        with pytest.raises(ValueError):
            validate_coverage(rows, predictions)


def test_invalid_symbols_duplicates_and_measured_nonhgnc_are_not_removed(metric):
    ranking = ["BAD_NONHGNC", "TP53", "TP53", "SPLICR_TEST_NONHGNC", "BRCA1"]
    original = copy.deepcopy(ranking)
    rows = official_scores([screen()], {"s": ranking}, metric)
    direct = metric.evaluate(predicted_genes=ranking, ground_truth_genes=screen()["relevance_genes"], relevance_scores=screen()["relevance_scores"])
    assert rows[0]["adjusted_ndcg@100"] == direct["adjusted_ndcg@100"]
    assert ranking == original
    assert rows[0]["raw_duplicate_count"] == 1
    assert rows[0]["non_hgnc_at100"] == 2
    assert rows[0]["non_hgnc_but_measured_at100"] == 1
    assert rows[0]["measured_zero_at100"] == 1
    assert rows[0]["unmeasured_at100"] == 1


def test_top100_unmeasured_slots_are_not_backfilled(metric):
    ranked = [f"UNKNOWN_{i}" for i in range(100)] + ["TP53"]
    rows = official_scores([screen()], {"s": ranked}, metric)
    assert rows[0]["adjusted_ndcg@100"] == 0
    assert rows[0]["positive_at100"] == 0
    assert rows[0]["measured_at100"] == 0


def test_legacy_input_boundary_supplies_library_but_never_target_scores():
    target = screen()
    expected = legacy_inputs(target)
    target["relevance_scores"] = [9999] * 4
    target["hit"] = ["SECRET"]
    target["notes"] = "revealed outcome"
    assert legacy_inputs(target) == expected
    assert set(expected) == {"relevance_genes", "cleaned_phenotype"}
    assert expected["relevance_genes"] is not target["relevance_genes"]


def test_published_extraction_keeps_original_order_and_rejects_duplicate_records(tmp_path):
    record = {"dataset_name": "s", "split": "test", "split_layout": "year", "predicted_genes": "['BRCA1', 'TP53', 'TP53', 'UNKNOWN']"}
    path = tmp_path / "upstream.json"
    path.write_text(json.dumps({"records_by_dataset": {"biogrid": [record, {**record, "split": "val"}]}}))
    assert extract_published(path, [screen()]) == {"s": ["BRCA1", "TP53", "TP53", "UNKNOWN"]}
    path.write_text(json.dumps({"records_by_dataset": {"biogrid": [record, record]}}))
    with pytest.raises(ValueError, match="duplicate published"):
        extract_published(path, [screen()])


def test_artifact_write_never_overwrites_previous_evidence(tmp_path):
    path = tmp_path / "receipt.json"
    write_new(path, {"value": 1})
    original = path.read_bytes()
    with pytest.raises(FileExistsError):
        write_new(path, {"value": 2})
    assert path.read_bytes() == original

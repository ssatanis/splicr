"""Model/CLI contract tests; synthetic fixtures are not biological validation."""
import json

import numpy as np
import pytest

from splicr.evidence_router import EvidenceRouter, choose_routes
from splicr.predict import main
from splicr.prescreen import HistoricalRanker, PriorConfig, ScreenContext, TextResidualRanker


def training():
    return [{"dataset_name": str(i), "source_id": f"p{i}",
             "phenotype": "fitness" if i % 2 else "infection",
             "cleaned_phenotype": "fitness", "relevance_genes": ["TP53", "EGFR", "BRCA1"],
             "relevance_scores": [1 if i % 2 else 0, 0, .5 if i % 2 == 0 else 0]}
            for i in range(4)]


def test_ridge_rejects_related_publication_and_is_deterministic():
    corpus = HistoricalRanker().fit(training())
    a = TextResidualRanker(1).fit_corpus(corpus)
    b = TextResidualRanker(1).fit_corpus(corpus)
    q = ScreenContext.from_record({"phenotype": "fitness", "source_id": "future"})
    assert a.rank(q) == b.rank(q)
    np.testing.assert_allclose(a.coef, b.coef)
    with pytest.raises(ValueError, match="publication"):
        a.rank(ScreenContext.from_record({"source_id": "p1"}))
    with pytest.raises(TypeError):
        a.rank({"relevance_scores": [1]})


@pytest.mark.parametrize("kw", [{"retrieval_power": float("nan")}, {"retrieval_k": 1.2},
                               {"negative_weight": float("inf")}, {"shrinkage": -1}])
def test_invalid_configuration_is_rejected(kw):
    with pytest.raises(ValueError):
        PriorConfig(**kw)


def rows(values, publications=None):
    return [{"dataset_name": str(i), "source_id": (publications or ["p1", "p2", "p3"])[i],
             "phenotype": "fitness", "adjusted_ndcg@100": v} for i, v in enumerate(values)]


def test_router_small_sample_guard_and_cohort_alignment():
    evaluations = {"external": rows([.1, .1, .1]), "phenotype": rows([.2, .2, .2])}
    routes, evidence = choose_routes(evaluations)
    assert routes == {"fitness": "phenotype"}
    assert evidence["fitness"]["n_publications"] == 3
    for records in evaluations.values():
        for record in records:
            record["source_id"] = "one-study"
    assert choose_routes(evaluations)[0] == {"fitness": "external"}
    evaluations["phenotype"].reverse()
    with pytest.raises(ValueError, match="cohort"):
        choose_routes(evaluations)


def test_router_never_backfills_or_fabricates_external_predictions():
    router = EvidenceRouter({}, {})
    context = ScreenContext.from_record({"phenotype": "new context"})
    with pytest.raises(ValueError, match="external ranking"):
        router.rank(context)
    assert router.rank(context, external=["UNKNOWN"] * 100 + ["TP53"]) == ["UNKNOWN"] * 100


def test_prediction_cli_writes_evidence_and_immutable_receipt(tmp_path):
    train = tmp_path / "training.json"
    context = tmp_path / "context.json"
    output = tmp_path / "prediction.json"
    receipt = tmp_path / "receipt.json"
    train.write_text(json.dumps(training()))
    context.write_text(json.dumps({"phenotype": "fitness", "source_id": "new-paper", "dataset_name": "new"}))
    args = ["--training", str(train), "--context", str(context), "--output", str(output), "--receipt", str(receipt)]
    assert main(args) == 0
    result = json.loads(output.read_text())
    assert result["task"] == "pre_screen_prediction"
    assert len(result["model"]["training_sha256"]) == 64
    assert all(row["validation_probability"] is None for row in result["ranked_genes"])
    assert all(row["historical_measured_screens"] == 4 for row in result["ranked_genes"])
    assert receipt.exists()
    with pytest.raises(FileExistsError):
        main(args)


def test_prediction_cli_refuses_target_labels(tmp_path):
    context = tmp_path / "context.json"
    context.write_text(json.dumps({"relevance_scores": [1]}))
    with pytest.raises(SystemExit):
        main(["--training", str(tmp_path / "unused"), "--context", str(context),
              "--output", str(tmp_path / "output")])


def test_legacy_fast_evaluator_refuses_missing_and_duplicate_predictions():
    from splicr import benchmark as bm
    class Scorer:
        name = "missing"
        def rank(self, screen):
            return None
    metric = bm.AnDCG(use_gene_mapper=False, hgnc_symbols=frozenset({"TP53", "EGFR", "BRCA1"}))
    with pytest.raises(ValueError, match="missing prediction"):
        bm.evaluate(Scorer(), training()[:1], andcg=metric)
    with pytest.raises(ValueError, match="duplicate screen"):
        bm.evaluate(Scorer(), training()[:1] * 2, andcg=metric)

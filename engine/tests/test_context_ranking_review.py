"""Independent adversarial checks for the corrected development model.

Synthetic fixtures only; never load any held-out benchmark records.
"""
import copy
import numpy as np

from splicr.context_ranking import ContextEvidence, ContextRanker, EXPERTS, ExposureConfig, canonical_truth
from splicr.prescreen import ScreenContext


def record(name, publication, genes, values):
    return {"dataset_name": name, "source_id": publication, "relevance_genes": genes,
            "relevance_scores": values, "phenotype": "cell survival", "cleaned_phenotype": "fitness",
            "screen_type": "negative selection"}


def test_hit_loss_balances_observed_studies_despite_different_missingness(monkeypatch):
    import lightgbm
    captured = {}
    class Estimator:
        def __init__(self, **kwargs): pass
        def fit(self, x, y, sample_weight):
            captured.update(x=x, y=y, weight=sample_weight)
            return self
    monkeypatch.setattr(lightgbm, "LGBMRegressor", Estimator)
    rows = [record("1", "a", ["TP53"], [1]),
            record("2", "a", ["TP53", "BRCA1"], [1, 0]),
            record("3", "b", ["BRCA1", "EGFR"], [1, -1]),
            record("4", "c", ["MTOR"], [1])]
    experts = {e: {s["dataset_name"]: ["TP53", "BRCA1", "EGFR"] for s in rows} for e in EXPERTS}
    fitted = ContextRanker(history=False).fit(rows, experts, ContextEvidence().fit(rows))
    assert len(captured["y"]) == 5  # Seven missing candidate observations never become nonhits.
    weights = captured["weight"]
    assert weights[:3].sum() == weights[3:].sum()
    assert weights[:1].sum() == weights[1:3].sum()
    assert fitted.fit_diagnostics["observed_publications"] == 2


def test_own_publication_poisoning_does_not_enter_history_features_or_retrieval():
    rows = [record("1", "a", ["TP53", "BRCA1"], [1, 0]),
            record("2", "a", ["TP53", "BRCA1"], [-1, 1]),
            record("3", "b", ["TP53", "BRCA1"], [0, 1]),
            record("4", "c", ["TP53", "BRCA1"], [1, 0])]
    poisoned = copy.deepcopy(rows)
    poisoned[0]["relevance_scores"] = [-1, 1]
    poisoned[1]["relevance_scores"] = [1, -1]
    first, second = ContextEvidence().fit(rows), ContextEvidence().fit(poisoned)
    context = ScreenContext.from_record(rows[0])
    np.testing.assert_array_equal(first.feature_matrix(context, ["TP53", "BRCA1"]), second.feature_matrix(context, ["TP53", "BRCA1"]))
    for config in [ExposureConfig(), ExposureConfig(retrieval=0.5), ExposureConfig(study_balance=True)]:
        np.testing.assert_array_equal(first.score(context, config), second.score(context, config))


def test_feature_cache_returns_copies_and_statistics_stay_unchanged_across_scoring():
    corpus = ContextEvidence().fit([record("1", "a", ["TP53", "BRCA1"], [1, 0]),
                                    record("2", "b", ["TP53", "BRCA1"], [0, 1])])
    context = ScreenContext.from_record({"source_id": "new"})
    baseline = corpus.feature_matrix(context, ["TP53", "BRCA1"])
    corrupted = corpus.feature_matrix(context, ["TP53", "BRCA1"])
    corrupted[:] = -999
    np.testing.assert_array_equal(corpus.feature_matrix(context, ["TP53", "BRCA1"]), baseline)
    before = [v.copy() for v in corpus.statistics(context)[:3]]
    for config in [ExposureConfig(), ExposureConfig(retrieval=0.5), ExposureConfig(study_balance=True)]:
        corpus.score(context, config)
    for observed, expected in zip(corpus.statistics(context)[:3], before):
        np.testing.assert_array_equal(observed, expected)


def test_canonical_training_lookup_agrees_with_official_lookup_without_changing_raw_target():
    from assaybench.benchmark.metrics import RankingMetrics
    metric = RankingMetrics(k_values=[10, 100], metric_groups=["adjusted_ndcg"])
    target = record("1", "a", ["P53", "TP53", "BRCA1"], [1, -1, 0])
    original = copy.deepcopy(target)
    truth = canonical_truth(target)
    official = dict(zip(metric.normalize_genes(target["relevance_genes"]), target["relevance_scores"]))
    assert truth == official == {"TP53": -1, "BRCA1": 0}
    assert target == original

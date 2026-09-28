"""Select a simple AssayBench ranker per phenotype without test-label tuning.

The three candidate rankings use only the query library and metadata plus
pre-2022 publication-excluded counters or published model predictions.  Select
on pre-2022 leave-one-publication-out scores, then evaluate the fixed routing
once on test with the official Genentech metric.  Published model predictions
carry the same literature-contamination caveat as upstream's LLM rows.
"""

from __future__ import annotations

import json
import os
import sys
import argparse

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path[:0] = [HERE, ENGINE]

from assaybench.benchmark.metrics import RankingMetrics
from splicr.assaybench_io import load_split
from fast import pack
from proto import cat_of, pub_of, grouped_folds
from core import uni
from common import base


def candidate_scores(pk):
    """Return three rankings, each filling unused model slots with the prior."""
    j = {name: pk.names.index(name) for name in (
        "global_rate", "cnt_cleaned_phenotype", "llm_cons", "llm_gemini-3-pro"
    )}
    prior = pk.X[:, j["global_rate"]] + pk.X[:, j["cnt_cleaned_phenotype"]]
    # Model values are reciprocal ranks.  A tiny prior resolves unlisted genes
    # without moving a listed gene behind an unlisted one.
    return {
        "phenotype_prior": prior,
        "five_model_consensus": pk.X[:, j["llm_cons"]] + 1e-6 * prior,
        "gemini_3_pro": pk.X[:, j["llm_gemini-3-pro"]] + 1e-6 * prior,
    }


def orders(pk, vector):
    out = []
    for a, b in zip(pk.off[:-1], pk.off[1:]):
        # Stable mergesort makes ties reproducible, including the final padding.
        out.append(np.argsort(-vector[a:b], kind="stable")[:100])
    return out


def score_cached(pk, order):
    from common import DISC

    out = np.zeros(pk.n)
    for i, row in enumerate(order):
        if pk.idcg[i] == 0:
            continue
        a = pk.off[i]
        ndcg = float(pk.rel[a + row] @ DISC[:len(row)]) / pk.idcg[i]
        out[i] = max((ndcg - pk.rand[i]) / pk.den[i], 0.0)
    return out


def choose(scores, cats):
    """Make one fixed choice per phenotype from publication-excluded scores."""
    selected = {}
    table = {}
    for category in sorted(set(cats)):
        mask = cats == category
        means = {name: float(values[mask].mean()) for name, values in scores.items()}
        selected[category] = max(means, key=means.get)
        table[category] = {"n": int(mask.sum()), "scores": means,
                           "selected": selected[category]}
    return selected, table


def main(split="test"):
    train = pack("pre2022")
    train_cats = cat_of(train)
    train_scores = {name: score_cached(train, orders(train, vec))
                    for name, vec in candidate_scores(train).items()}
    selected, selection_table = choose(train_scores, train_cats)
    print("PRE-2022 SELECTION", json.dumps(selection_table, indent=2), flush=True)
    fold_choices = []
    for fit_rows, _ in grouped_folds(pub_of(train)):
        choices, _ = choose({k: v[fit_rows] for k, v in train_scores.items()},
                            train_cats[fit_rows])
        fold_choices.append(choices)
    print("PRE-2022 five-fold selection stability", fold_choices, flush=True)
    del train, train_scores

    test = pack(split)
    test_cats = cat_of(test)
    test_orders = {name: orders(test, vec)
                   for name, vec in candidate_scores(test).items()}
    u = uni()
    source = (load_split("test") if split == "test"
              else load_split(None, config="LaTest"))
    screens = {str(s["dataset_name"]): s for s in source}
    metric = RankingMetrics(k_values=[100])
    official = []
    cached = []
    comparator = []
    per_category = {}
    published = base()["preds"]["LLM RRF Ensemble"]
    for i, category in enumerate(test_cats):
        name = selected[category]
        row = test_orders[name][i]
        screen_id = str(u.meta[test.i[i]]["dataset_name"])
        screen = screens[screen_id]
        predicted = [u.sym[int(g)] for g in u.ulib[test.i[i]][test.recs[i]["pool"][row]]]
        score = metric.evaluate(predicted_genes=predicted,
                                ground_truth_genes=screen["relevance_genes"],
                                relevance_scores=screen["relevance_scores"])["adjusted_ndcg@100"]
        official.append(float(score))
        cached.append(float(score_cached_one(test, i, row)))
        per_category.setdefault(category, []).append(float(score))
        # Give the published ensemble the same library filter and 100 real
        # candidates.  Prior order fills the slots its raw list cannot use.
        lib = u.ulib[test.i[i]]
        measured = set(int(g) for g in lib)
        raw_prediction = published.get(int(test.i[i]))
        if raw_prediction is None:
            continue
        raw = u.remap[raw_prediction]
        dense = []
        seen = set()
        for gene in raw:
            if int(gene) in measured and int(gene) not in seen:
                dense.append(int(gene)); seen.add(int(gene))
        for position in test_orders["phenotype_prior"][i]:
            gene = int(lib[test.recs[i]["pool"][position]])
            if gene not in seen:
                dense.append(gene); seen.add(gene)
            if len(dense) >= 100:
                break
        comparator.append(float(metric.evaluate(
            predicted_genes=[u.sym[g] for g in dense[:100]],
            ground_truth_genes=screen["relevance_genes"],
            relevance_scores=screen["relevance_scores"])["adjusted_ndcg@100"]))
    if not np.allclose(official, cached, atol=1e-6):
        raise AssertionError(f"official metric mismatch: max {np.max(np.abs(np.array(official)-cached))}")
    print(split.upper(), "official AnDCG@100", float(np.mean(official)))
    if len(comparator) == len(official):
        print(split.upper(), "densified published ensemble", float(np.mean(comparator)))
        delta = np.asarray(official) - np.asarray(comparator)
        rng = np.random.default_rng(0)
        draws = delta[rng.integers(0, len(delta), (10000, len(delta)))].mean(1)
        print(split.upper(), "paired difference and 95% bootstrap interval",
              float(delta.mean()), np.percentile(draws, [2.5, 97.5]).tolist())
    else:
        print(split.upper(), "published ensemble predictions unavailable; no paired comparison")
    print(split.upper(), "categories", {k: {"n": len(v), "mean": float(np.mean(v))}
                              for k, v in per_category.items()})
    print(split.upper(), "max metric difference", float(np.max(np.abs(np.array(official)-cached))))


def score_cached_one(pk, i, row):
    from common import DISC

    if pk.idcg[i] == 0:
        return 0.0
    ndcg = float(pk.rel[pk.off[i] + row] @ DISC[:len(row)]) / pk.idcg[i]
    return max((ndcg - pk.rand[i]) / pk.den[i], 0.0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--split", choices=("test", "latest"), default="test")
    main(parser.parse_args().split)

"""2026-09-28 experiment family F/L: closing the gap to the frontier ensemble.

Motivation
----------
Experiments D and E both *replaced* the ranking and both lost. The frontier
predictions carry information the historical corpus does not, and vice versa, so
the question this family asks is narrower and better posed: **can a historical
correction be added to a frontier base without destroying it?**

Every candidate here is built so that a degenerate setting recovers its own
baseline exactly:

* ``F`` blends a learned historical score into the reciprocal-rank base with
  weight ``lambda``. At ``lambda = 0`` it *is* the base, so any movement away
  from the base has to be earned by cross-validation rather than assumed.
* ``L`` re-weights the individual experts and the historical prior inside the
  same reciprocal-rank aggregation. At uniform expert weights and zero prior
  weight it *is* the base.

Input contract
--------------
Description metadata plus the separately generated zero-shot expert rankings.
No target gene library, no target measurements, no padding or backfill from the
evaluated screen. Identical to experiment D, so the comparisons are like-for-like.

A note on the base
------------------
The *published* ``LLM RRF Ensemble`` file contains only validation, test and
novel records -- it has no training-split predictions, so nothing can be fitted
on top of it. The reconstructible base used here is reciprocal-rank fusion over
the five expert files, which do cover training. Results are reported against
both that same-input base and the published ensemble.

Protocol
--------
Three publication-grouped folds inside the 1,349 training screens select one
configuration; the selection is then confirmed once on the 2021 validation
split. The public test is never read by this runner -- it has no such phase.
"""
from __future__ import annotations

import argparse
import gc
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.model_selection import GroupKFold

sys.path.insert(0, str(Path(__file__).resolve().parent))
from controlled_benchmark import provenance, summarize
from reproduce_references import published_predictions
from splicr.assaybench_io import load_split
from splicr.context_ranking import (EXPERTS, ContextEvidence, ContextRanker, ExposureConfig,
                                    canonical_gene, expert_features)
from splicr.prescreen import ScreenContext
from splicr.research_protocol import cluster_interval, evaluate_predictions, sha256_file

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'research/artifacts/20260928/frontier_residual'
SEED = 20260928

#: Blend weights for the historical residual. 0.0 reproduces the base exactly.
LAMBDAS = {'F0_base_rrf60': 0.0, 'F1_residual_025': 0.25, 'F2_residual_050': 0.50,
           'F3_residual_100': 1.00, 'F4_residual_200': 2.00}
#: Rank-aggregation variants. ``uniform`` is the base; ``weighted`` fits weights
#: on the outer training fold only.
AGGREGATIONS = ('L0_uniform_prior_small', 'L1_weighted_rrf')
PRIOR = ExposureConfig(exposure_power=.5, conditional=True, signed=True)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as handle:
        json.dump(value, handle, indent=2, sort_keys=True, allow_nan=False)


def standardise(values):
    """Within-screen standardisation, so a blend weight means the same thing everywhere."""
    values = np.asarray(values, dtype=np.float64)
    spread = float(values.std())
    if spread <= 0:
        return np.zeros_like(values)
    return (values - float(values.mean())) / spread


def base_values(rankings, extras=()):
    """Candidate genes and their reciprocal-rank base score (constant 60)."""
    genes, features = expert_features(rankings, extras)
    return genes, features[:, :len(EXPERTS)].sum(axis=1).astype(np.float64)


def prior_lookup(corpus, context):
    scores = corpus.score(context, PRIOR)
    return dict(zip([str(g) for g in corpus.corpus.genes], scores.tolist()))


def weighted_scores(genes, rankings, weights, prior_by_gene, prior_weight):
    """Per-expert weighted reciprocal rank plus a standardised prior term."""
    lookup = {g: i for i, g in enumerate(genes)}
    values = np.zeros(len(genes), dtype=np.float64)
    for expert, weight in zip(EXPERTS, weights):
        if weight == 0:
            continue
        for rank, gene in enumerate(dict.fromkeys(map(canonical_gene, rankings[expert][:100])), 1):
            index = lookup.get(gene)
            if index is not None:
                values[index] += weight / (60.0 + rank)
    if prior_weight:
        prior = np.array([prior_by_gene.get(g, 0.0) for g in genes], dtype=np.float64)
        values = standardise(values) + prior_weight * standardise(prior)
    return values


def fit_weights(training, external, corpus, grid=(0.0, 0.25, 0.5, 1.0, 1.5), passes=2):
    """Coordinate ascent on the official metric over the outer training fold only.

    The prior's own statistics already exclude the query's publication, and the
    expert rankings are fixed inputs, so this touches no held-out screen.
    """
    contexts, rankings, priors, truths, genes = [], [], [], [], []
    for screen in training:
        name = str(screen['dataset_name'])
        context = ScreenContext.from_record(screen)
        per = {e: external[e][name] for e in EXPERTS}
        candidate, _ = base_values(per)
        contexts.append(context); rankings.append(per); genes.append(candidate)
        priors.append(prior_lookup(corpus, context))
        truths.append({canonical_gene(g): v for g, v in
                       zip(screen['relevance_genes'], screen['relevance_scores'])})
    def objective(weights, prior_weight):
        total = 0.0
        for candidate, per, prior, truth in zip(genes, rankings, priors, truths):
            values = weighted_scores(candidate, per, weights, prior, prior_weight)
            order = np.argsort(-values, kind='stable')[:100]
            total += sum(max(truth.get(candidate[i], 0.0), 0.0) / np.log2(r + 2)
                         for r, i in enumerate(order))
        return total / len(genes)
    weights = [1.0] * len(EXPERTS)
    prior_weight = 0.0
    best = objective(weights, prior_weight)
    for _ in range(passes):
        improved = False
        for index in range(len(EXPERTS)):
            current = weights[index]
            for value in grid:
                if value == current:
                    continue
                weights[index] = value
                score = objective(weights, prior_weight)
                if score > best + 1e-12:
                    best, current, improved = score, value, True
            weights[index] = current
        for value in (0.0, 0.05, 0.1, 0.25, 0.5):
            if value == prior_weight:
                continue
            score = objective(weights, value)
            if score > best + 1e-12:
                best, prior_weight, improved = score, value, True
        if not improved:
            break
    if all(w == 0 for w in weights):
        raise ValueError('degenerate expert weights')
    return weights, prior_weight, best


def prov():
    result = provenance()
    result.update({'runner_sha256': sha256_file(__file__), 'seed': SEED,
                   'context_ranking_sha256': sha256_file(ROOT / 'engine/splicr/context_ranking.py'),
                   'input_contract': 'description metadata + separately generated zero-shot expert rankings; no target library',
                   'base': 'reciprocal-rank fusion (constant 60) over the five expert files',
                   'published_ensemble_has_no_training_predictions': True,
                   'public_test_accessed': False,
                   'modern_model_memorization_risk': True})
    return result


def experts_for(screens, split):
    result, hashes = {}, {}
    for name in EXPERTS:
        result[name], hashes[name] = published_predictions('llm/' + name + '.json', screens, split)
        if set(result[name]) != {str(s['dataset_name']) for s in screens}:
            raise ValueError('incomplete external expert')
    return result, hashes


def run(training, evaluation, external, folder, names):
    started = time.perf_counter()
    corpus = ContextEvidence().fit(training)
    corpus_seconds = time.perf_counter() - started
    ranker = None
    if any(name in LAMBDAS and LAMBDAS[name] > 0 for name in names):
        tick = time.perf_counter()
        ranker = ContextRanker(objective='regression', history=True).fit(training, external, corpus)
        ranker_seconds = time.perf_counter() - tick
    else:
        ranker_seconds = 0.0
    weights = prior_weight = None
    if 'L1_weighted_rrf' in names:
        tick = time.perf_counter()
        weights, prior_weight, _ = fit_weights(training, external, corpus)
        weight_seconds = time.perf_counter() - tick
    else:
        weight_seconds = 0.0
    rows_out, summary = {}, {}
    for name in names:
        tick = time.perf_counter()
        predictions = {}
        for screen in evaluation:
            identity = str(screen['dataset_name'])
            context = ScreenContext.from_record(screen)
            per = {e: external[e][identity] for e in EXPERTS}
            if name in LAMBDAS:
                lam = LAMBDAS[name]
                genes, base = base_values(per)
                if lam == 0:
                    values = base
                else:
                    candidates, x = ranker.features(context, per, corpus)
                    if candidates != genes:
                        raise ValueError('candidate sets diverged between base and residual')
                    values = standardise(base) + lam * standardise(ranker.model.predict(x))
            else:
                genes, _ = base_values(per)
                prior = prior_lookup(corpus, context)
                if name == 'L0_uniform_prior_small':
                    values = weighted_scores(genes, per, [1.0] * len(EXPERTS), prior, 0.05)
                else:
                    values = weighted_scores(genes, per, weights, prior, prior_weight)
            ranking = [genes[i] for i in np.argsort(-values, kind='stable')[:100]]
            if len(ranking) != 100 or len(set(ranking)) != 100:
                raise ValueError('nonunique or incomplete output')
            predictions[identity] = ranking
        seconds = time.perf_counter() - tick
        write(folder / (name + '_predictions.json'), predictions)
        rows = evaluate_predictions(evaluation, predictions)
        write(folder / (name + '_screens.json'), rows)
        metrics = {'mean': float(np.mean([r['adjusted_ndcg@100'] for r in rows])),
                   'measured_at100': float(np.mean([r['measured_at100'] for r in rows])),
                   'corpus_fit_seconds': corpus_seconds, 'ranker_fit_seconds': ranker_seconds,
                   'weight_fit_seconds': weight_seconds, 'predict_seconds': seconds,
                   'lambda': LAMBDAS.get(name), 'expert_weights': weights if name == 'L1_weighted_rrf' else None,
                   'prior_weight': prior_weight if name == 'L1_weighted_rrf' else None}
        print(name, {k: v for k, v in metrics.items() if v is not None}, flush=True)
        rows_out[name], summary[name] = rows, metrics
    write(folder / 'summary.json', summary)
    del corpus, ranker
    gc.collect()
    return rows_out, summary


def select():
    names = [*LAMBDAS, *AGGREGATIONS]
    p = prov()
    training = load_split('train')
    external, hashes = experts_for(training, 'train')
    write(OUT / 'preregistration.json', {
        'experiment_family': '20260928_frontier_residual',
        'created_utc': datetime.now(timezone.utc).isoformat(),
        'hypotheses': {
            'F': 'A historical residual blended into the frontier reciprocal-rank base with weight lambda '
                 'improves on the base; lambda=0 recovers the base exactly, so the blend must earn any movement.',
            'L': 'Re-weighting individual experts and adding a small historical prior term inside the same '
                 'reciprocal-rank aggregation improves on uniform weights.'},
        'configurations': {n: ({'kind': 'residual_blend', 'lambda': LAMBDAS[n]} if n in LAMBDAS
                               else {'kind': 'rank_aggregation', 'variant': n}) for n in names},
        'selection': 'three publication-grouped folds inside the 1349 training screens; the single best '
                     'configuration by pooled out-of-fold mean is confirmed once on the 2021 validation split',
        'grouping': 'source_id; no publication overlap; corpus, ranker and aggregation weights refit inside '
                    'each outer training fold; the prior excludes the query publication by construction',
        'baselines': ['F0_base_rrf60 (same input contract)', 'published LLM RRF Ensemble (validation only)'],
        'selection_multiplicity': len(names),
        'stochastic_training': 'deterministic LightGBM with fixed seed and full feature/row fractions; '
                               'the aggregation search is deterministic coordinate ascent',
        'test_labels_loaded_in_selection': False,
        'public_test_phase_exists_in_this_runner': False,
        'historical_public_test_exposure': True,
        'provenance': p, 'expert_hashes': hashes})
    cv_rows = {n: [] for n in names}
    groups = [str(s['source_id']) for s in training]
    for fold, (a, b) in enumerate(GroupKFold(n_splits=3).split(training, groups=groups)):
        train = [training[i] for i in a]
        holdout = [training[i] for i in b]
        assert not {s['source_id'] for s in train} & {s['source_id'] for s in holdout}
        write(OUT / f'cv{fold}' / 'split.json',
              {'train_ids': [s['dataset_name'] for s in train],
               'evaluation_ids': [s['dataset_name'] for s in holdout]})
        rows, _ = run(train, holdout, external, OUT / f'cv{fold}', names)
        for n in names:
            cv_rows[n].extend(rows[n])
    scores = {n: summarize(rows) for n, rows in cv_rows.items()}
    base_delta = {}
    for n in names:
        delta = [r['adjusted_ndcg@100'] - b['adjusted_ndcg@100']
                 for r, b in zip(cv_rows[n], cv_rows['F0_base_rrf60'])]
        base_delta[n] = cluster_interval(delta, [r['source_id'] for r in cv_rows[n]], seed=SEED)
    chosen = max(names, key=lambda n: scores[n]['mean'])
    write(OUT / 'cv_selection.json', {'provenance': p, 'results': scores, 'paired_vs_base': base_delta,
                                      'selected': chosen,
                                      'estimate': 'development selection; not an unbiased final estimate',
                                      'selection_multiplicity': len(names)})
    print('CV SELECTED', chosen, scores[chosen], flush=True)

    validation = load_split('validation')
    valid_experts, valid_hashes = experts_for(validation, 'validation')
    assert valid_hashes == hashes
    for expert in EXPERTS:
        external[expert].update(valid_experts[expert])
    confirm = list(dict.fromkeys([chosen, 'F0_base_rrf60']))
    rows, summary = run(training, validation, external, OUT / 'validation', confirm)
    baseline, digest = published_predictions('ensemble/LLM__RRF__Ensemble.json', validation, 'validation')
    write(OUT / 'validation' / 'published_ensemble_predictions.json', baseline)
    base_rows = evaluate_predictions(validation, baseline)
    write(OUT / 'validation' / 'published_ensemble_screens.json', base_rows)
    published = {'mean': float(np.mean([r['adjusted_ndcg@100'] for r in base_rows]))}
    comparisons = {}
    for name in confirm:
        for label, reference in (('vs_published_ensemble', base_rows),
                                 ('vs_base_rrf60', rows['F0_base_rrf60'])):
            delta = [r['adjusted_ndcg@100'] - b['adjusted_ndcg@100'] for r, b in zip(rows[name], reference)]
            comparisons.setdefault(name, {})[label] = cluster_interval(
                delta, [r['source_id'] for r in rows[name]], seed=SEED)
    write(OUT / 'final_freeze.json', {
        'provenance': p, 'expert_hashes': hashes, 'selected': chosen,
        'cv_selected': chosen, 'validation_results': summary,
        'validation_comparisons': comparisons, 'published_ensemble_validation': published,
        'baseline_file_sha256': digest, 'promotion_status': 'research_only',
        'selection_multiplicity': len(names), 'frozen_before_new_test_access': True,
        'public_test_accessed': False,
        'interpretation': 'publication-grouped CV selects; the 2021 validation split confirms or refutes; '
                          'no public-test number is produced by this runner'})
    print('VALIDATION', {n: summary[n]['mean'] for n in confirm},
          'published_ensemble', published['mean'], flush=True)
    print('PAIRED', json.dumps(comparisons, indent=1), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['select'])
    parser.parse_args()
    select()

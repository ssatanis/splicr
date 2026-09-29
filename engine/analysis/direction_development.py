"""Requested-effect ablation: train-only grouped CV, then validation confirmation.

No public-test entry point exists. Preregistration and every output use exclusive
creation; changed dependencies fail rather than silently changing an experiment.
Run only once root confirms the shared ContextEvidence dependency is frozen.
"""
from __future__ import annotations

import os
for _variable in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS'):
    os.environ[_variable] = '2'

from dataclasses import asdict
from datetime import datetime, timezone
import gc
import importlib.metadata
import inspect
import json
from pathlib import Path
import time

import numpy as np
import pyarrow.dataset as ds
from sklearn.model_selection import GroupKFold
from threadpoolctl import threadpool_limits
from assaybench.benchmark.metrics import RankingMetrics

from splicr.direction_ranking import DirectionEvidence, DirectionConfig
from splicr.prescreen import ScreenContext, FIELDS
from splicr.research_protocol import evaluate_predictions, cluster_interval, sha256_file

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'research/artifacts/20260928/direction_development'
DATA = ROOT/'data/references/assaybench/snapshot/biogrid/train-00000-of-00001.parquet'
CONFIGS = {
    'P0_baseline_D3': DirectionConfig(effect_prior=False),
    'P1_requested_effect_prior': DirectionConfig(effect_prior=True),
    'P2_requested_effect_transfer': DirectionConfig(effect_prior=True, retrieval_weight=.5),
}


def write(name, value):
    path=OUT/name
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write('\n')


def dependencies():
    files = ['engine/splicr/effect_direction.py', 'engine/splicr/direction_ranking.py',
             'engine/splicr/context_ranking.py', 'engine/splicr/prescreen.py',
             'engine/splicr/research_protocol.py', 'engine/splicr/benchmark.py',
             'engine/analysis/direction_development.py']
    return {f:sha256_file(ROOT/f) for f in files}


def load_development(split):
    if split not in ('train', 'validation'):
        raise ValueError('only training and validation are permitted')
    dataset=ds.dataset(DATA)
    columns=['dataset_name','source_id','yearfold0','relevance_genes','relevance_scores',*FIELDS]
    columns=list(dict.fromkeys(c for c in columns if c in dataset.schema.names))
    result=dataset.to_table(columns=columns, filter=ds.field('yearfold0')==split).to_pylist()
    if not result or any(r['yearfold0']!=split for r in result):
        raise ValueError('split filter failed')
    return result


def describe(rows):
    return {**cluster_interval([r['adjusted_ndcg@100'] for r in rows],
                               [r['source_id'] for r in rows], repeats=4000, seed=20260928),
            **{key:float(np.mean([r[key] for r in rows])) for key in
               ('measured_at100','wrong_direction_fraction_returned','slot_precision_at100')}}


def compare(rows, reference):
    if [r['dataset_name'] for r in rows] != [r['dataset_name'] for r in reference]:
        raise ValueError('paired comparison requires identical ordering')
    return cluster_interval([r['adjusted_ndcg@100']-b['adjusted_ndcg@100'] for r,b in zip(rows, reference)],
                            [r['source_id'] for r in rows], repeats=4000, seed=20260928)


def execute(training, evaluation, names, folder, frozen):
    if dependencies()!=frozen:
        raise ValueError('preregistered dependency changed before fit')
    tick=time.perf_counter();model=DirectionEvidence().fit(training);fit=time.perf_counter()-tick
    metric=RankingMetrics(k_values=[10,100],metric_groups=['adjusted_ndcg','precision','recall','fdr'])
    all_rows={};summary={}
    for name in names:
        tick=time.perf_counter()
        predictions={str(s['dataset_name']):model.rank(ScreenContext.from_record(s),CONFIGS[name]) for s in evaluation}
        prediction_seconds=time.perf_counter()-tick
        if any(len(p)!=100 or len(set(p))!=100 for p in predictions.values()):
            raise ValueError('100 unique candidates required')
        # Rankings are saved before evaluation sees target measurements.
        write(f'{folder}/{name}_predictions.json',predictions)
        scored=evaluate_predictions(evaluation,predictions,metric=metric)
        write(f'{folder}/{name}_screens.json',scored)
        all_rows[name]=scored
        summary[name]={**describe(scored),'fit_seconds':fit,'prediction_seconds':prediction_seconds,
                       'configuration':asdict(CONFIGS[name])}
        print(folder,name,summary[name]['mean'],f'prediction_seconds={prediction_seconds:.3f}',flush=True)
    if dependencies()!=frozen:
        raise ValueError('preregistered dependency changed during fit/evaluation')
    write(f'{folder}/summary.json',summary)
    del model;gc.collect()
    return all_rows,summary


def main():
    frozen=dependencies()
    registration={'created_utc':datetime.now(timezone.utc).isoformat(),
      'experiment':'requested-effect polarity, 3 fixed configs',
      'hypothesis':'requested increase/decrease is lost when only screen_type conditions donors; preserve phenotype target and polarity',
      'configs':{n:asdict(c) for n,c in CONFIGS.items()},'dependencies':frozen,
      'data_sha256':sha256_file(DATA),'metric_sha256':sha256_file(inspect.getfile(RankingMetrics)),
      'versions':{name:importlib.metadata.version(name) for name in ('numpy','scipy','scikit-learn','pyarrow','assaybench')},
      'selection':'3 GroupKFold folds over training source_id; highest screen-mean official AnDCG@100; stable config order breaks ties toward baseline; fit selected candidate + D3 on all training and confirm on validation',
      'test_access':False,'target_library_input':False,'modern_external_annotations':False,
      'threads':2,'additional_parameter_search':False,
      'limitations':'validation diagnostics motivated hypothesis; confirmatory validation is therefore exposed development data; publication identifiers do not prove experiment independence; prior public-test exposure disclosed',
      'root_dependency_freeze_required':True}
    write('preregistration.json',registration)
    training=load_development('train')
    assert len(training)==1349
    groups=[str(s['source_id']) for s in training]
    all_rows={name:[] for name in CONFIGS}
    for fold,(a,b) in enumerate(GroupKFold(n_splits=3).split(training,groups=groups)):
        train=[training[i] for i in a];evaluation=[training[i] for i in b]
        assert not {s['source_id'] for s in train}&{s['source_id'] for s in evaluation}
        split={'train_ids':[s['dataset_name'] for s in train],'evaluation_ids':[s['dataset_name'] for s in evaluation]}
        parent_split=ROOT/f'research/artifacts/20260928/model_development/cv{fold}/split.json'
        if parent_split.exists() and json.loads(parent_split.read_text())!=split:
            raise ValueError('fold differs from shared advanced-development split')
        write(f'cv{fold}/split.json',split)
        scores,_=execute(train,evaluation,list(CONFIGS),f'cv{fold}',frozen)
        for name in CONFIGS:all_rows[name].extend(scores[name])
    summaries={name:describe(value) for name,value in all_rows.items()}
    chosen=max(CONFIGS,key=lambda name:summaries[name]['mean'])
    comparisons={name:compare(value,all_rows['P0_baseline_D3']) for name,value in all_rows.items()}
    write('cv_selection.json',{'selected':chosen,'results':summaries,'paired_vs_D3':comparisons,
                              'selection_estimate_not_unbiased':True,'dependencies':frozen})
    validation=load_development('validation');assert len(validation)==218
    assert not set(groups)&{str(s['source_id']) for s in validation}
    names=list(dict.fromkeys(['P0_baseline_D3',chosen]))
    scores,summaries=execute(training,validation,names,'validation',frozen)
    comparisons={name:compare(value,scores['P0_baseline_D3']) for name,value in scores.items()}
    write('final_development_freeze.json',{'selected':chosen,'configs':{n:asdict(CONFIGS[n]) for n in names},
      'dependencies':frozen,'data_sha256':registration['data_sha256'],'validation_results':summaries,
      'paired_vs_D3':comparisons,'no_public_test_access':True,'promotion_status':'research_only',
      'interpretation':'held-publication CV selects; exposed temporal validation confirms/describes; no further tuning or superiority claim'})
    print('DEVELOPMENT FREEZE',chosen,comparisons[chosen],flush=True)


if __name__=='__main__':
    with threadpool_limits(limits=2):
        main()

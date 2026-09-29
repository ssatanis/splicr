"""2026-09-28 controlled model development; test access requires a frozen selection.

Train-only three-fold publication CV selects configurations, then a 2021 temporal
validation confirmation. Public test is read only by explicit final replay.
All output writes are exclusive and historical artifacts are never overwritten.
"""
from __future__ import annotations
import argparse
import gc
import inspect
import importlib.metadata
from importlib.resources import files
import json
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.model_selection import GroupKFold

sys.path.insert(0,str(Path(__file__).resolve().parent))
from controlled_benchmark import provenance, summarize
from reproduce_references import published_predictions
from splicr.assaybench_io import load_split
from splicr.context_ranking import ContextEvidence, ContextRanker, ExposureConfig, EXPERTS, reciprocal_rank
from splicr.prescreen import ScreenContext
from splicr.research_protocol import evaluate_predictions, cluster_interval, sha256_file

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'research/artifacts/20260928/model_development'
PRIORS={
    'D0_global_shrink':ExposureConfig(exposure_power=0,conditional=False,signed=False),
    'D1_global_coverage':ExposureConfig(exposure_power=.5,conditional=False,signed=False),
    'D2_context_coverage':ExposureConfig(exposure_power=.5,signed=False),
    'D3_context_signed':ExposureConfig(exposure_power=.5,signed=True),
    'D4_context_exposure':ExposureConfig(exposure_power=1,signed=True),
    'D5_study_context':ExposureConfig(strength=2,study_balance=True,signed=True),
    'D6_lexical_transfer':ExposureConfig(retrieval=.5),
}
RANKERS={
    'E0_external_signed':dict(objective='regression',history=False),
    'E1_history_signed':dict(objective='regression',history=True),
    'E2_history_lambdarank':dict(objective='lambdarank',history=True),
    'E3_history_coverage':dict(objective='regression',history=True,coverage=True),
    'E4_augmented_signed':dict(objective='regression',history=True,augment=True,coverage=True),
}


def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x') as f:json.dump(value,f,indent=2,sort_keys=True,allow_nan=False)


def prov():
    result=provenance()
    result.update({'context_ranking_sha256':sha256_file(ROOT/'engine/splicr/context_ranking.py'),
                   'advanced_runner_sha256':sha256_file(__file__),'seed':20260928,
                   'input_contract':'description metadata + separately generated zero-shot expert rankings; no target library',
                   'modern_model_memorization_risk':True})
    from assaybench.utils import gene_mapper
    result['identifier_mapping_sha256']=sha256_file(inspect.getfile(gene_mapper))
    result['identifier_resources']={name:sha256_file(str(files('assaybench.data.hgnc').joinpath(name)))
        for name in ('all_genes.tsv','hgnc_symbols_cache.tsv','manual_mappings.json','uniprot_protein_to_gene.json')}
    result['packages']={name:importlib.metadata.version(name) for name in ('numpy','scipy','scikit-learn','lightgbm')}
    result['upstream_prompt_caveat']='Published expert prompts can include post-hoc notes/significance criteria/ranking rationale; same released benchmark comparison, not a proven historically clean pre-experimental prediction.'
    return result


def experts(screens,split):
    result={};hashes={}
    for name in EXPERTS:
        result[name],hashes[name]=published_predictions('llm/'+name+'.json',screens,split)
        if set(result[name])!={str(s['dataset_name']) for s in screens}:raise ValueError('incomplete external expert')
    return result,hashes


def per_query(all_preds,name):return {e:all_preds[e][name] for e in EXPERTS}


def evaluate_save(folder,name,screens,predictions,extra=None):
    write(folder/(name+'_predictions.json'),predictions)
    rows=evaluate_predictions(screens,predictions)
    write(folder/(name+'_screens.json'),rows)
    result={'mean':float(np.mean([r['adjusted_ndcg@100'] for r in rows])),
            'measured_at100':float(np.mean([r['measured_at100'] for r in rows])),**(extra or {})}
    print(name,result,flush=True)
    return rows,result


def config_for(name):
    if name in PRIORS:return {'kind':'prior','config':asdict(PRIORS[name])}
    if name in RANKERS:return {'kind':'ranker','config':RANKERS[name]}
    return {'kind':'rrf','constant':60 if name=='C0_rrf60' else 10}


def run_models(training,evaluation,external,folder,names):
    started=time.perf_counter();corpus=ContextEvidence().fit(training)
    fit_seconds=time.perf_counter()-started
    rows_out={};summary={}
    for name in names:
        tick=time.perf_counter();fit_extra=0.;model=None
        if name in RANKERS:
            model=ContextRanker(**RANKERS[name]).fit(training,external,corpus)
            fit_extra=time.perf_counter()-tick;tick=time.perf_counter()
        predictions={}
        for s in evaluation:
            identity=str(s['dataset_name']);ctx=ScreenContext.from_record(s)
            rankings=per_query(external,identity)
            if name in PRIORS:ranking=corpus.rank(ctx,PRIORS[name])
            elif model is not None:ranking=model.rank(ctx,rankings,corpus)
            else:ranking=reciprocal_rank(rankings,constant=60 if name=='C0_rrf60' else 10)
            if len(ranking)!=len(set(ranking)) or len(ranking)!=100:raise ValueError('nonunique or incomplete output')
            predictions[identity]=ranking
        seconds=time.perf_counter()-tick
        rows,metrics=evaluate_save(folder,name,evaluation,predictions,
            {'corpus_fit_seconds':fit_seconds,'model_fit_seconds':fit_extra,'predict_seconds':seconds,
             'config':config_for(name),'fit_diagnostics':model.fit_diagnostics if model else None})
        rows_out[name]=rows;summary[name]=metrics
        if model is not None:
            model.model.booster_.save_model(str(folder/(name+'_model.txt')))
            if model.coverage_model:model.coverage_model.booster_.save_model(str(folder/(name+'_coverage.txt')))
        del model
    write(folder/'summary.json',summary)
    del corpus;gc.collect()
    return rows_out,summary


def select():
    p=prov();training=load_split('train');external,hashes=experts(training,'train')
    names=['C0_rrf60','C1_rrf10',*PRIORS,*RANKERS]
    write(OUT/'preregistration.json',{'experiment_family':'20260928_context_ranking','created_utc':datetime.now(timezone.utc).isoformat(),
          'hypotheses':{n:config_for(n) for n in names},'provenance':p,'expert_hashes':hashes,
          'selection':'three publication-grouped folds within1349 training screens; select best historical and best model-assisted candidate; fixed temporal validation confirmation before final freeze',
          'grouping':'source_id; no publication overlap; vocabulary and evidence fit per outer training fold; own-publication historical labels excluded from training features',
          'stochastic_training':'disabled: deterministic LightGBM, full feature/row fractions; bin sample larger than dataset; fixed grouped split',
          'reproducibility':'selected candidate reconstructed in three clean executions',
          'resource_budget':'CPU only, two model threads; no downloads or paid inference; at most14 configurations x3 train folds',
          'test_labels_loaded_in_selection':False,'historical_public_test_exposure':True})
    cv_rows={n:[] for n in names};groups=[str(s['source_id']) for s in training]
    for fold,(a,b) in enumerate(GroupKFold(n_splits=3).split(training,groups=groups)):
        train=[training[i] for i in a];validation=[training[i] for i in b]
        assert not {s['source_id'] for s in train}&{s['source_id'] for s in validation}
        write(OUT/f'cv{fold}'/'split.json',{'train_ids':[s['dataset_name'] for s in train],'evaluation_ids':[s['dataset_name'] for s in validation]})
        rows,summary=run_models(train,validation,external,OUT/f'cv{fold}',names)
        for n in names:cv_rows[n].extend(rows[n])
    all_scores={n:summarize(rows) for n,rows in cv_rows.items()}
    best_prior=max(PRIORS,key=lambda n:all_scores[n]['mean'])
    best_assisted=max(['C0_rrf60','C1_rrf10',*RANKERS],key=lambda n:all_scores[n]['mean'])
    selected=list(dict.fromkeys(['C0_rrf60',best_prior,best_assisted]))
    write(OUT/'cv_selection.json',{'provenance':p,'results':all_scores,'selected':selected,
                                'estimate':'development selection; not unbiased final estimate'})
    validation=load_split('validation');valid_experts,valid_hashes=experts(validation,'validation')
    assert valid_hashes==hashes
    for expert in EXPERTS:external[expert].update(valid_experts[expert])
    rows,summary=run_models(training,validation,external,OUT/'validation',selected)
    baseline,digest=published_predictions('ensemble/LLM__RRF__Ensemble.json',validation,'validation')
    base_rows,base_summary=evaluate_save(OUT/'validation','published_ensemble',validation,baseline)
    comparisons={}
    for name in selected:
        delta=[r['adjusted_ndcg@100']-b['adjusted_ndcg@100'] for r,b in zip(rows[name],base_rows)]
        comparisons[name]=cluster_interval(delta,[r['source_id'] for r in rows[name]],seed=20260928)
    chosen=max(selected,key=lambda n:summary[n]['mean'])
    write(OUT/'final_freeze.json',{'provenance':p,'expert_hashes':hashes,'selected':chosen,'historical_candidate':best_prior,
          'selected_config':config_for(chosen),'cv_selected':selected,'validation_results':summary,
          'validation_comparisons':comparisons,'validation_baseline':base_summary,'baseline_file_sha256':digest,
          'frozen_before_new_test_access':True,'public_test_already_explored':True,
          'promotion_status':'research_only','selection_multiplicity':len(names),
          'final_replay_candidates':list(dict.fromkeys([chosen,best_prior]))})
    print('FINAL FREEZE',chosen,comparisons[chosen],flush=True)


def replay(repetition):
    frozen=json.loads((OUT/'final_freeze.json').read_text())
    if frozen['provenance']!=prov():raise ValueError('frozen code/data changed')
    training=load_split('train');evaluation=load_split('test')
    external,hashes=experts(training,'train');test_experts,test_hashes=experts(evaluation,'test')
    if hashes!=frozen['expert_hashes'] or test_hashes!=hashes:raise ValueError('frozen expert files changed')
    for expert in EXPERTS:external[expert].update(test_experts[expert])
    folder=OUT/f'replay{repetition}'
    names=frozen['final_replay_candidates']
    rows,metrics=run_models(training,evaluation,external,folder,names)
    baseline,digest=published_predictions('ensemble/LLM__RRF__Ensemble.json',evaluation,'test')
    base_rows,base_summary=evaluate_save(folder,'published_ensemble',evaluation,baseline)
    results={}
    for name in names:
        delta=[r['adjusted_ndcg@100']-b['adjusted_ndcg@100'] for r,b in zip(rows[name],base_rows)]
        results[name]={**summarize(rows[name]),'paired_vs_ensemble':cluster_interval(delta,[r['source_id'] for r in rows[name]],seed=20260928),
                       'runtime':metrics[name],'promotion_status':'research_only'}
    write(folder/'final_results.json',{'provenance':prov(),'freeze_sha256':sha256_file(OUT/'final_freeze.json'),
          'baseline':summarize(base_rows),'results':results,'evaluation_kind':'retrospective_public_test'})


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('phase',choices=['select','replay'])
    parser.add_argument('--repetition',type=int,choices=[1,2,3],default=1);args=parser.parse_args()
    select() if args.phase=='select' else replay(args.repetition)

"""Development-only diagnostic. No test rows/predictions are evaluated.
Run from repo root with PYTHONPATH=engine and the existing engine interpreter.
"""
from pathlib import Path
import ast, hashlib, inspect, json, time
from collections import Counter, defaultdict
from functools import lru_cache
import numpy as np
import pyarrow.dataset as ds
from scipy.stats import spearmanr
from sklearn.feature_extraction.text import TfidfVectorizer
from assaybench.benchmark.metrics import RankingMetrics
from splicr.prescreen import FIELDS, ScreenContext, clean
from splicr.research_protocol import evaluate_predictions, cluster_interval, sha256_file

ROOT=Path(__file__).resolve().parents[4]
OUT=Path(__file__).resolve().parent
DATA=ROOT/'data/references/assaybench/snapshot/biogrid/train-00000-of-00001.parquet'
ART=ROOT/'research/artifacts'
PRED=ROOT/'engine/.tools/assaybench/benchmarking/predictions'
start=time.perf_counter()
metric=RankingMetrics(k_values=[10,100],metric_groups=['adjusted_ndcg','precision','recall','fdr'])
mapper=metric.gene_mapper
# Match diagnostic symbol normalization to protocol's AnDCG wrapper.
from splicr.benchmark import AnDCG
normalizer=AnDCG(gene_mapper=mapper,hgnc_symbols=frozenset(metric._hgnc_approved_symbols))
norm=lru_cache(maxsize=100000)(normalizer.normalize)
cols=['dataset_name','source_id','yearfold0','relevance_genes','relevance_scores',*FIELDS]
cols=list(dict.fromkeys(cols))
cols=[c for c in cols if c in ds.dataset(DATA).schema.names]
def rows(split):
    assert split in {'train','validation'}
    scanner=ds.dataset(DATA).scanner(columns=cols,filter=ds.field('yearfold0')==split,batch_size=8)
    for batch in scanner.to_batches():
        for row in batch.to_pylist():
            assert row['yearfold0']==split
            yield row

def write(name,value):
    (OUT/name).write_text(json.dumps(value,indent=2,sort_keys=True,allow_nan=False)+'\n')

def summary(values):
    a=np.asarray(values,float)
    return dict(mean=float(a.mean()),median=float(np.median(a)),min=float(a.min()),max=float(a.max())) if len(a) else None

train_meta=[]; train_hits=[]; train_hitsets=[]; measured=Counter(); hits=Counter(); opposite=Counter(); pub_measured=defaultdict(set); pub_hits=defaultdict(set)
for s in rows('train'):
    m={norm(g):float(v) for g,v in zip(s['relevance_genes'],s['relevance_scores'])}
    pub=str(s['source_id']); ctx=ScreenContext.from_record(s)
    train_meta.append({'dataset_name':str(s['dataset_name']),'source_id':pub,**dict(ctx.values)})
    ranked=sorted(((v,g) for g,v in m.items() if v>0),key=lambda x:(-x[0],x[1]))
    train_hits.append([g for _,g in ranked[:100]])
    train_hitsets.append({g for _,g in ranked})
    measured.update(m.keys()); hits.update(g for g,v in m.items() if v>0); opposite.update(g for g,v in m.items() if v<0)
    for g,v in m.items():
        pub_measured[g].add(pub)
        if v>0:pub_hits[g].add(pub)
assert all(isinstance(n,int) and n>0 and hits[g]+opposite[g]<=n for g,n in measured.items())
print('training summary built',len(train_meta),len(measured),flush=True)
val=list(rows('validation')); ids=[str(s['dataset_name']) for s in val]; wanted=set(ids)
assert len(train_meta)==1349 and len(val)==218
assert not ({m['source_id'] for m in train_meta}&{str(s['source_id']) for s in val})
files={
 'global':'select_global_predictions.json','phenotype':'select_phenotype_predictions.json',
 'ridge10':'residual_select_text_ridge_10_predictions.json','direction':'select_direction_predictions.json',
 'transfer':'select_text_transfer_predictions.json','router':'router_select_predictions.json'}
predictions={}; hashes={}
for name,file in files.items():
    p=ART/file; predictions[name]=json.loads(p.read_text()); hashes[str(p.relative_to(ROOT))]=sha256_file(p)
    assert set(predictions[name])==wanted
for name,file in {'ensemble':'ensemble/LLM__RRF__Ensemble.json','gemini3pro':'llm/gemini-3-pro.json','gpt54':'llm/gpt-5.4.json'}.items():
    p=PRED/file; payload=json.loads(p.read_text()); selected={}
    for recs in payload['records_by_dataset'].values():
        for rec in recs if isinstance(recs,list) else [recs]:
            if str(rec['dataset_name']) in wanted and rec.get('split')=='val' and rec.get('split_layout')=='year':
                assert str(rec['dataset_name']) not in selected
                genes=rec['predicted_genes']; selected[str(rec['dataset_name'])]=ast.literal_eval(genes) if isinstance(genes,str) else genes
    assert set(selected)==wanted
    predictions[name]=selected;hashes[str(p.relative_to(ROOT))]=sha256_file(p)
    del payload
results={}
for name,pred in predictions.items():
    if name in files:
        path=ART/files[name].replace('_predictions.json','_screens.json')
        saved={str(r['dataset_name']):r for r in json.loads(path.read_text())}
        assert set(saved)==wanted
        results[name]=[saved[i] for i in ids]
        hashes[str(path.relative_to(ROOT))]=sha256_file(path)
    else:
        results[name]=evaluate_predictions(val,pred,metric=metric)
print('official validation evaluations complete',flush=True)
# Only valid, normalized original top-100 slots; no target-library filtering/backfill.
rankings={name:{i:list(dict.fromkeys(norm(g) for g in p[i]))[:100] for i in ids} for name,p in predictions.items()}
train_values={f:Counter(m.get(f,'') for m in train_meta) for f in FIELDS}
train_pubs={f:defaultdict(set) for f in FIELDS}
for m in train_meta:
    for f in FIELDS:train_pubs[f][m.get(f,'')].add(m['source_id'])
vectorizer=TfidfVectorizer(ngram_range=(1,2),sublinear_tf=True,max_features=20000,dtype=np.float32)
X=vectorizer.fit_transform([ScreenContext.from_record(m).text() or 'unspecified' for m in train_meta])
S=(vectorizer.transform([ScreenContext.from_record(s).text() for s in val])@X.T).toarray()
per=[]; donor_rows=[]; rng=np.random.default_rng(20260928)
for index,s in enumerate(val):
    sid=str(s['dataset_name']); ctx=ScreenContext.from_record(s)
    truth={norm(g):float(v) for g,v in zip(s['relevance_genes'],s['relevance_scores'])}
    positive={g for g,v in truth.items() if v>0};negative={g for g,v in truth.items() if v<0}
    source=str(s['source_id']); row={'dataset_name':sid,'source_id':source,**dict(ctx.values),
       'n_measured':len(truth),'n_positive':len(positive),'n_opposite':len(negative),
       'positive_seen_training_fraction':len(positive&set(measured))/max(1,len(positive)),
       'library_size_group':'<1000' if len(truth)<1000 else '1000-9999' if len(truth)<10000 else '>=10000',
       'support':{f:{'screens':train_values[f][ctx.get(f)],'publications':len(train_pubs[f][ctx.get(f)])} for f in FIELDS},
       'experts':{name:results[name][index] for name in results}}
    per.append(row)
    eligible=np.array([m['source_id']!=source and all(not ctx.get(f) or m.get(f)==ctx.get(f) for f in ('screen_type','library_methodology')) for m in train_meta])
    eligible_idx=np.flatnonzero(eligible)
    near_all=np.argsort(-S[index],kind='stable')[:5]
    near=eligible_idx[np.argsort(-S[index,eligible_idx],kind='stable')[:5]]
    random=rng.choice(eligible_idx,size=min(5,len(eligible_idx)),replace=False)
    d={'dataset_name':sid,'eligible_donors':len(eligible_idx),'nearest_text_cosine':float(S[index,near_all[0]]),
       'nearest_same_direction_modality_cosine':float(S[index,near[0]]) if len(near) else None,
       'nearest_all_direction_mismatch':bool(train_meta[near_all[0]]['screen_type']!=ctx.get('screen_type')),
       'nearest_all_modality_mismatch':bool(train_meta[near_all[0]]['library_methodology']!=ctx.get('library_methodology'))}
    for label,idxs in [('top5_text',near_all),('top5_matched_text',near),('random5_matched',random)]:
        union=set().union(*(set(train_hits[j]) for j in idxs)) if len(idxs) else set()
        p=union&positive; n=union&negative; assayed=union&set(truth)
        d[label]={'desired_coverage':len(p)/max(1,len(positive)),'n_desired':len(p),'n_opposite':len(n),'n_assayed':len(assayed),'n_candidates':len(union),'screen_ids':[train_meta[j]['dataset_name'] for j in idxs]}
    donor_rows.append(d)

pubs=[str(s['source_id']) for s in val]
aggregate={}
for name,rs in results.items():
    a=[r['adjusted_ndcg@100'] for r in rs]
    aggregate[name]={**cluster_interval(a,pubs,repeats=4000,seed=20260928),
       'fraction_zero':float(np.mean(np.array(a)==0)),
       'coverage':summary([r['measured_at100'] for r in rs]),
       'wrong_direction_fraction_returned':float(np.mean([r['wrong_direction_fraction_returned'] for r in rs])),
       'invalid_hgnc_fraction':float(np.mean([r['invalid_hgnc_fraction'] for r in rs])),
       'slot_precision_at100':float(np.mean([r['slot_precision_at100'] for r in rs]))}
subgroups={}
for field in ('cleaned_phenotype','cell_line','library_methodology','screen_type','library_size_group'):
    subgroups[field]={}
    for key in sorted({r[field] for r in per}):
        idx=[i for i,r in enumerate(per) if r[field]==key]
        subgroups[field][key]={'screens':len(idx),'publications':len({pubs[i] for i in idx}),
           'mean_andcg':{name:float(np.mean([rs[i]['adjusted_ndcg@100'] for i in idx])) for name,rs in results.items()},
           'mean_coverage':{name:float(np.mean([rs[i]['measured_at100'] for i in idx])) for name,rs in results.items()}}
missing={}
for f in FIELDS:
    raw=[ctx.get(f) for ctx in (ScreenContext.from_record(s) for s in val)]
    placeholders={'','-','not applicable','unspecified','n.a.','na'}
    missing[f]={'validation_missing_or_placeholder':sum(x in placeholders for x in raw),
                'validation_unseen_in_training':sum(x not in train_values[f] for x in raw),
                'median_train_publications':float(np.median([len(train_pubs[f][x]) for x in raw])),
                'unique_train_values':len(train_values[f]),'unique_validation_values':len(set(raw))}
complement={}
for left,right in [('global','ensemble'),('phenotype','ensemble'),('ridge10','ensemble'),('gemini3pro','gpt54'),('direction','phenotype')]:
    l=np.array([r['adjusted_ndcg@100'] for r in results[left]]);r=np.array([r['adjusted_ndcg@100'] for r in results[right]])
    overlaps=[];unique_left=[];unique_right=[]
    for s in val:
        sid=str(s['dataset_name']);positive={norm(g) for g,v in zip(s['relevance_genes'],s['relevance_scores']) if v>0}
        a=set(rankings[left][sid]);b=set(rankings[right][sid]);overlaps.append(len(a&b)/max(1,len(a|b)))
        unique_left.append(len((a-b)&positive));unique_right.append(len((b-a)&positive))
    complement[f'{left}__{right}']={
       'paired_delta':cluster_interval(l-r,pubs,repeats=4000,seed=20260928),'left_wins':int((l>r).sum()),'right_wins':int((r>l).sum()),'ties':int((r==l).sum()),
       'mean_top100_jaccard':float(np.mean(overlaps)),'left_unique_desired_mean':float(np.mean(unique_left)),
       'right_unique_desired_mean':float(np.mean(unique_right)),
       'hindsight_best_of_two_diagnostic_only':float(np.maximum(l,r).mean())}

prior=[]
for g,n in measured.items():
    prior.append({'gene':g,'measured_screens':n,'hit_screens':hits[g],'opposite_screens':opposite[g],
       'measured_publications':len(pub_measured[g]),'hit_publications':len(pub_hits[g]),'hit_rate':hits[g]/n})
prior.sort(key=lambda x:(-x['hit_rate'],x['gene']))
exposure={}
for name in rankings:
    genes=[g for sid in ids for g in rankings[name][sid]]
    exposure[name]={'training_measured_screens':summary([measured[g] for g in genes]),
       'fraction_training_measured_lt10':float(np.mean([measured[g]<10 for g in genes])),
       'fraction_training_measured_lt100':float(np.mean([measured[g]<100 for g in genes])),
       'fraction_training_measurement_below_half':float(np.mean([measured[g]<len(train_meta)/2 for g in genes])),
       'unique_genes_across_validation':len(set(genes))}

def corr(a,b):
    result=spearmanr(a,b)
    return {'rho':float(result.statistic) if np.isfinite(result.statistic) else None,
            'note':'descriptive; screens share studies; no independent p-value claim'}
correlations={name:{'coverage_vs_andcg':corr([r['measured_at100'] for r in rs],[r['adjusted_ndcg@100'] for r in rs])} for name,rs in results.items()}
mean_donor={label:{k:float(np.mean([r[label][k] for r in donor_rows])) for k in ('desired_coverage','n_desired','n_opposite','n_assayed','n_candidates')} for label in ('top5_text','top5_matched_text','random5_matched')}
summary_doc={'protocol':{'date':'2026-09-28','allowed_splits':['train','validation'],'test_rows_evaluated':0,
 'training_screens':len(train_meta),'training_publications':len({m['source_id'] for m in train_meta}),
 'validation_screens':len(val),'validation_publications':len(set(pubs)),
 'validation_is_exposed_development_data':True,'gene_library_used_for_diagnostics_only':True,
 'data_sha256':sha256_file(DATA),'script_sha256':sha256_file(__file__),
 'metric_sha256':sha256_file(inspect.getfile(RankingMetrics)),'prediction_hashes':hashes},
 'experts':aggregate,'subgroups':subgroups,'missing_context':missing,'expert_complementarity':complement,
 'gene_exposure':exposure,'correlations':correlations,'donor_diagnostics':mean_donor,
 'nearest_text_direction_mismatch_fraction':float(np.mean([d['nearest_all_direction_mismatch'] for d in donor_rows])),
 'nearest_text_modality_mismatch_fraction':float(np.mean([d['nearest_all_modality_mismatch'] for d in donor_rows])),
 'train_genes':len(measured),'positive_seen_train_fraction':summary([r['positive_seen_training_fraction'] for r in per]),
 'elapsed_seconds':time.perf_counter()-start,'implementation_note':'Initial diagnostic process was interrupted after a review found Counter.update(mapping) adds values rather than observation counts. Changed to update(keys), added count bounds/integer invariants, retained the interrupted log as failed diagnostic history. No results from that run are retained as evidence.'}
write('summary.json',summary_doc);write('validation_screen_diagnostics.json',per);write('validation_donor_diagnostics.json',donor_rows);write('training_gene_exposure.json',prior)
print(json.dumps({'experts':aggregate,'gene_exposure':exposure,'donors':mean_donor,'missing_context':missing,'complementarity':complement},indent=2))

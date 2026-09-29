"""Train-only symbol audit. Never load a new model test split or replay result."""
import ast
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import time
from assaybench.benchmark.metrics import RankingMetrics
from splicr.assaybench_io import iter_split
from splicr.context_ranking import EXPERTS

ROOT=Path(__file__).resolve().parents[4]
OUT=Path(__file__).resolve().parent
started=time.perf_counter()
metric=RankingMetrics(k_values=[100],metric_groups=['adjusted_ndcg'])
cache={}
def norm(g):
 if g not in cache:cache[g]=metric.normalize_gene(g)
 return cache[g]
experts={};hashes={}
for name in EXPERTS:
 path=ROOT/'engine/.tools/assaybench/benchmarking/predictions/llm'/f'{name}.json'
 hashes[name]=hashlib.sha256(path.read_bytes()).hexdigest()
 result={}
 for records in json.loads(path.read_text())['records_by_dataset'].values():
  for r in records if isinstance(records,list) else [records]:
   if r.get('split')!='train' or r.get('split_layout')!='year':continue
   genes=r['predicted_genes'];result[str(r['dataset_name'])]=ast.literal_eval(genes) if isinstance(genes,str) else genes
 experts[name]=result
counts={name:Counter() for name in [*EXPERTS,'union']};examples=[];weighted_studies=defaultdict(list)
for s in iter_split('train'):
 name=str(s['dataset_name']);raw=dict(zip(s['relevance_genes'],s['relevance_scores']))
 canonical=dict(zip(map(norm,s['relevance_genes']),s['relevance_scores']))
 ranked={e:experts[e][name] for e in EXPERTS};union=sorted(set().union(*(set(ranked[e][:100]) for e in EXPERTS)))
 for expert in [*EXPERTS,'union']:
  candidates=union if expert=='union' else list(dict.fromkeys(ranked[expert][:100]))
  c=counts[expert];c['screens']+=1;c['candidates']+=len(candidates)
  c['raw_measured']+=sum(g in raw for g in candidates)
  c['normalized_measured']+=sum(norm(g) in canonical for g in candidates)
  c['canonical_duplicate_candidates']+=len(candidates)-len(set(map(norm,candidates)))
  c['normalized_target_collisions']+=len(raw)-len(canonical)
  for gene in candidates:
   old=raw.get(gene);new=canonical.get(norm(gene))
   if old is None and new is not None:
    c['falsely_unmeasured']+=1;c['falsely_unmeasured_positive' if new>0 else 'falsely_unmeasured_negative' if new<0 else 'falsely_unmeasured_zero']+=1
    if expert=='union' and len(examples)<12:examples.append({'dataset_name':name,'source_id':s['source_id'],'raw_candidate':gene,'normalized_candidate':norm(gene),'official_relevance':new})
   if old is not None and new is None:c['raw_measured_but_normalized_unmeasured']+=1
   if old is not None and new is not None and old!=new:
    c['measured_label_changed']+=1
    if (old>0)-(old<0)!=(new>0)-(new<0):c['measured_sign_changed']+=1
 if union:weighted_studies[str(s['source_id'])].append(sum(g in raw for g in union)/len(union))
print(json.dumps({k:dict(v) for k,v in counts.items()},indent=2),flush=True)
result={'split':'train only','source_hashes':hashes,'counts':{k:dict(v) for k,v in counts.items()},'examples':examples,
 'retained_hit_loss_study_weight_fractions':{p:sum(v)/len(v) for p,v in weighted_studies.items()},
 'seconds':time.perf_counter()-started,'normalization':'installed official RankingMetrics.normalize_gene; same last-value target mapping as official evaluator; no inference targets used'}
with (OUT/'train_alias_audit.json').open('x') as f:json.dump(result,f,sort_keys=True,indent=2,allow_nan=False)

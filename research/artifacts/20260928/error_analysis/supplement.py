"""Additional descriptive checks from the saved validation-only diagnostics."""
from pathlib import Path
from collections import Counter,defaultdict
import json,re
import numpy as np
from splicr.research_protocol import cluster_interval,sha256_file
from splicr.prescreen import FIELDS
OUT=Path(__file__).resolve().parent
ART=OUT.parents[1]
rows=json.loads((OUT/'validation_screen_diagnostics.json').read_text());donors=json.loads((OUT/'validation_donor_diagnostics.json').read_text())
pubs=[r['source_id'] for r in rows];counts=Counter(pubs);groups=defaultdict(list);exact=defaultdict(list)
for r in rows:
    groups[tuple(r[f] for f in FIELDS if f!='phenotype')].append(r)
    exact[tuple(r[f] for f in FIELDS)].append(r['dataset_name'])
scores={name:np.array([r['experts'][name]['adjusted_ndcg@100'] for r in rows]) for name in rows[0]['experts']}
pred={name:json.loads((ART/file).read_text()) for name,file in {'phenotype':'select_phenotype_predictions.json','direction':'select_direction_predictions.json','ridge10':'residual_select_text_ridge_10_predictions.json'}.items()}
polarity_groups=[]
for rs in groups.values():
    positive=[r for r in rs if r['phenotype'].startswith('increase ')];negative=[r for r in rs if r['phenotype'].startswith('decrease ')]
    if positive and negative:
        for a in positive:
            for b in negative:
                if a['phenotype'][len('increase '):]!=b['phenotype'][len('decrease '):]:continue
                polarity_groups.append({'a':a['dataset_name'],'b':b['dataset_name'],'source_id':a['source_id'],
                    'phenotypes':[a['phenotype'],b['phenotype']],
                    'identical_rankings':{m:pred[m][a['dataset_name']]==pred[m][b['dataset_name']] for m in pred}})
novelty={}
for field in ('cell_line','condition_name','phenotype'):
    novelty[field]={}
    for unseen in (True,False):
        subset=[i for i,r in enumerate(rows) if (r['support'][field]['screens']==0)==unseen]
        novelty[field]['unseen' if unseen else 'seen']={'screens':len(subset),'publications':len({pubs[i] for i in subset}),
          'means':{m:float(v[subset].mean()) for m,v in scores.items()}}
summary={'input_hashes':{f:sha256_file(OUT/f) for f in ('summary.json','validation_screen_diagnostics.json','validation_donor_diagnostics.json')},
 'script_sha256':sha256_file(__file__),'scope':'validation-only descriptive analyses; no selection or hypothesis-test claim',
 'largest_publications':counts.most_common(),
 'publication_macro_means':{m:float(np.mean([v[np.array(pubs)==pub].mean() for pub in counts])) for m,v in scores.items()},
 'leave_one_publication_out_delta_vs_ensemble_range':{m:[float(min((v-scores['ensemble'])[np.array(pubs)!=pub].mean() for pub in counts)),float(max((v-scores['ensemble'])[np.array(pubs)!=pub].mean() for pub in counts))] for m,v in scores.items()},
 'zero_measured_positive_andcg':{m:sum(r['experts'][m]['measured_at100']==0 and r['experts'][m]['adjusted_ndcg@100']>0 for r in rows) for m in scores},
 'exact_context_duplicate_groups':[v for v in exact.values() if len(v)>1],
 'requested_direction_pairs':polarity_groups,'novelty':novelty,
 'donor_recall_matched_minus_random':cluster_interval([d['top5_matched_text']['desired_coverage']-d['random5_matched']['desired_coverage'] for d in donors],pubs,repeats=4000,seed=20260928)}
(OUT/'supplement.json').write_text(json.dumps(summary,indent=2,sort_keys=True,allow_nan=False)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k not in ('requested_direction_pairs','exact_context_duplicate_groups','input_hashes')},indent=2))
print('requested_direction_pairs',len(polarity_groups), 'identical', {m:sum(p['identical_rankings'][m] for p in polarity_groups) for m in pred})

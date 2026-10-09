"""Independent MAGeCK agreement, control-normalization sensitivity, CSV exports."""
import csv
import hashlib
import json
import math
import statistics
import subprocess
import time
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

import numpy as np
from scipy.stats import spearmanr
from splicr.config import tool_env
from splicr.pipeline import ScreenInput, run_pipeline

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output'
t_all=time.perf_counter()
native=OUT/'standalone_mageck';native.mkdir(exist_ok=True)
cmd=['mageck','test','-k',str((OUT/'splicr/hits/counts.txt').resolve()),'-t','kidney','-c','D0','-n','independent','--norm-method','median']
t=time.perf_counter()
p=subprocess.run(cmd,cwd=native,env=tool_env(),capture_output=True,text=True)
native_seconds=time.perf_counter()-t
(native/'stdout.txt').write_text(p.stdout);(native/'stderr.txt').write_text(p.stderr)
assert p.returncode==0,p.stderr[-2000:]
def tsv(path):return list(csv.DictReader(path.open(),delimiter='\t'))
base=tsv(OUT/'splicr/hits/mageck.gene_summary.txt')
ind=tsv(native/'independent.gene_summary.txt')
a={r['id']:r for r in base}; b={r['id']:r for r in ind}
assert a.keys()==b.keys()
cols=[x for x in base[0] if x!='id']
deltas={c:max(abs(float(a[g][c])-float(b[g][c])) for g in a) for c in cols}
agreement={'standalone_runtime_seconds':native_seconds,'command':cmd,'genes_compared_including_CONTROL':len(a),
           'max_absolute_difference_per_numeric_column':deltas,'exact_numeric_agreement':all(v==0 for v in deltas.values()),
           'scope':'Same MAGeCK version, counts, contrast, and median normalization. Reproducibility check, not biological accuracy or a competing algorithm benchmark.'}
assert agreement['exact_numeric_agreement'],agreement
(OUT/'independent_mageck_agreement.json').write_text(json.dumps(agreement,indent=2)+'\n')
print('STANDALONE AGREEMENT',json.dumps(agreement),flush=True)

spec=ScreenInput(name='Millman 2026 CRISPRa - non-targeting-control normalization sensitivity',
    count_table=ROOT/'input/counts.tsv', library_slug='millman_cellecta_kahgw106p', library_path=ROOT/'input/study_library.tsv',
    roles={'D0':'reference','kidney':'treatment'},treatment=['kidney'],control=['D0'],normalization='control',
    fdr_threshold=0.1,hit_callers=['mageck_rra'],cell_line='HUES8-VPR stem-cell-derived islets',model_type='in_vivo',
    phenotype='transplantation enrichment',modality='crispra',condition='day 10 kidney capsule vs differentiated day 0',fitness_assay=False)
t=time.perf_counter()
result=run_pipeline(spec,OUT/'control_normalization',persist=False,verbose=True)
control_seconds=time.perf_counter()-t
assert result.ok,result.error
c={r['id']:r for r in tsv(OUT/'control_normalization/hits/mageck.gene_summary.txt')}
report=json.loads((OUT/'splicr/postscreen_report.json').read_text())
genes={r['gene']:r for r in report['genes']}
published=list(csv.DictReader((ROOT/'input/published_enrichment_scores.csv').open()))
published_by_gene={r['gene']:r for r in published}
ranked=sorted((r for r in base if r['id']!='CONTROL'),key=lambda r:(float(r['pos|score']),int(r['pos|rank'])))
top1=ranked[:math.ceil(len(ranked)*0.01)]
export=[]
for r in ranked:
    g=r['id']; raw=genes[g]; pub=published_by_gene.get(g,{})
    export.append({'gene':g,'enrichment_rank':r['pos|rank'],'median_log2_fold_change':r['pos|lfc'],
        'enrichment_RRA_score':r['pos|score'],'enrichment_p_value':r['pos|p-value'],
        'enrichment_FDR':r['pos|fdr'],'depletion_FDR':r['neg|fdr'],'SplicR_two_direction_FDR':raw['fdr'],
        'guides':raw['n_guides'],'guides_with_positive_LFC':sum(v>0 for v in raw['guide_lfcs']),
        'max_absolute_guide_effect_share':max(map(abs,raw['guide_lfcs']))/sum(map(abs,raw['guide_lfcs'])) if any(raw['guide_lfcs']) else '',
        'flags':'; '.join(f['flag'] for f in raw['flags']),
        'flag_details':' | '.join(f['message'] for f in raw['flags']),
        'control_normalization_enrichment_rank':c[g]['pos|rank'],
        'control_normalization_log2_fold_change':c[g]['pos|lfc'],
        'control_normalization_enrichment_FDR':c[g]['pos|fdr'],
        'published_RRA_score':pub.get('published_rra_score',''),
        'published_plot_order':pub.get('published_plot_order','')})
def csvwrite(name,rows):
    with (OUT/name).open('w') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
csvwrite('all_gene_results.csv',export)
csvwrite('top_enrichment_candidates.csv',export[:50])
key_names=['SIX3','FCAMR','GSTM3','HSF2']
csvwrite('key_gene_results.csv',[next(r for r in export if r['gene']==g) for g in key_names])
guides=tsv(OUT/'splicr/hits/mageck.sgrna_summary.txt')
csvwrite('all_guide_results.csv',guides)
csvwrite('key_gene_guide_results.csv',[r for r in guides if r['Gene'] in key_names])
lib=tsv(ROOT/'input/study_library.tsv')
seqgroups=defaultdict(list)
for r in lib:seqgroups[r['sequence']].append(r)
collision_groups=[v for v in seqgroups.values() if len(v)>1]
cross_gene=[v for v in collision_groups if len({r['gene'] for r in v if r['gene']})>1]
support={r['gene']:r for r in export if r['gene'] in key_names}
pubgenes=[r for r in published if r['gene'] in a and r['gene']!='CONTROL']
puborder=[r['gene'] for r in pubgenes[:20]]
newtop=[r['id'] for r in ranked[:20]]
summary={'independent_mageck':agreement,'control_normalization_pipeline_seconds':control_seconds,
    'verification_and_export_seconds':time.perf_counter()-t_all,'key_genes':support,
    'published_gene_scores':len(published),'scored_target_genes':len(genes),
    'published_score_overlap_genes':len(pubgenes),'top20_overlap_with_published_plot':len(set(puborder)&set(newtop)),
    'top20_published_genes':puborder,'top20_new_genes':newtop,
    'enrichment_rank_spearman_with_published_order':float(spearmanr([int(r['published_plot_order']) for r in pubgenes],[int(a[r['gene']]['pos|rank']) for r in pubgenes]).statistic),
    'top1percent_candidates':len(top1),
    'top1percent_with_single_guide_or_disagreement_flag':sum(any(f['flag']=='single_guide' for f in genes[r['id']]['flags']) for r in top1),
    'enriched_genes_at_native_FDR_0_1':sum(float(r['pos|fdr'])<0.1 for r in ranked),
    'depleted_genes_at_native_FDR_0_1':sum(float(r['neg|fdr'])<0.1 for r in ranked),
    'two_direction_hits_at_FDR_0_1':sum(r['fdr']<0.1 for r in genes.values()),
    'sensitivity_enriched_genes_at_native_FDR_0_1':sum(float(r['pos|fdr'])<0.1 for g,r in c.items() if g!='CONTROL'),
    'sequence_audit':{'duplicate_sequence_groups':len(collision_groups),'extra_duplicate_rows':sum(len(v)-1 for v in collision_groups),
        'duplicate_sequence_groups_crossing_gene_labels':len(cross_gene),
        'affected_cross_gene_guide_rows':sum(len(v) for v in cross_gene),
        'note':'Shared supplied sequences are an annotation ambiguity requiring review; not a genome-alignment or off-target prediction.'},
    'limitations':['Only two aggregate sample columns; no biological replicate test.',
      'Count-table input cannot estimate read mapping efficiency or physical cell coverage.',
      'Exact original MAGeCK version and complete settings are not provided, so score agreement with the publication is not asserted.',
      'No in vivo CRISPRa comparable Atlas cohort or calibrated validation probability is available.',
      'RRA candidates and guide flags are hypothesis-generating; they are not functional validation or proof of a false positive.']}
counts=tsv(ROOT/'input/counts.tsv')
controlrows=[r for r in counts if r['Gene']=='CONTROL']
controlstats=[]
for sample in ['D0','kidney']:
    vals=[int(r[sample]) for r in controlrows]
    controlstats.append({'sample':sample,'non_targeting_controls':len(vals),'control_count_sum':sum(vals),
        'control_zero_guides':vals.count(0),'median_control_count':statistics.median(vals)})
summary['control_audit']=controlstats
csvwrite('non_targeting_control_qc.csv',controlstats)
(OUT/'results_summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print('SUMMARY',json.dumps({k:summary[k] for k in ['control_normalization_pipeline_seconds','verification_and_export_seconds','top20_overlap_with_published_plot','top1percent_with_single_guide_or_disagreement_flag','sequence_audit','key_genes']}),flush=True)

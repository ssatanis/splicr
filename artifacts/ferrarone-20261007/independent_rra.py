from pathlib import Path
import sys,json,csv
from dataclasses import asdict
from concurrent.futures import ThreadPoolExecutor
ROOT=Path('/Users/sahaj/Documents/Projects/SplicR');sys.path.insert(0,str(ROOT/'engine'))
from splicr.hits import run_mageck_rra
from splicr.references import load_library
from splicr.upload_tables import canonical_counts
OUT=ROOT/'artifacts/ferrarone-20261007';lib=load_library('tkov3')
def analyze(item):
 culture,arm,treat,ctrl=item
 source=Path('/Users/sahaj/Downloads')/('2d_crispr_screen_read_counts.txt' if culture=='2d' else 'spheroid_crispr_screen_read_counts.txt')
 work=OUT/'independent-rra'/f'{culture}-{arm}'
 counts=canonical_counts(source,lib,ctrl+treat,work/'counts.tsv')
 genes,warnings=run_mageck_rra(counts,treat,ctrl,work/'hits')
 rows=[asdict(g) for g in genes.values()]
 with (work/'all-genes.csv').open('w') as f:
  w=csv.DictWriter(f,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
 return {'culture':culture,'arm':arm,'genes':len(genes),'significant':sum(g.fdr is not None and g.fdr<.05 for g in genes.values()),'warnings':warnings,'reference_genes':{g:asdict(genes[g]) for g in ['FIG4','VAC14','PIKFYVE','NF2','PTEN','STK11'] if g in genes}}
plans=[]
for c in ['2d','3d']:
 ev=[f'ev_{c}_d21_{r}' for r in 'ab'];wt=[f'wt_{c}_d21_{r}' for r in 'ab']
 plans.extend([(c,'EV-vs-plasmid',ev,['tkov3_plasmid']),(c,'WT-vs-plasmid',wt,['tkov3_plasmid']),(c,'WT-vs-EV',wt,ev)])
with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(analyze,plans))
(OUT/'independent-rra.json').write_text(json.dumps(results,indent=2))
print(json.dumps([{k:v for k,v in r.items() if k!='reference_genes'} for r in results],indent=2))

"""Parser coverage on training vocabulary; validation pairs are a syntax check."""
from collections import Counter
from dataclasses import asdict
from pathlib import Path
import json
import pyarrow.dataset as ds
from splicr.effect_direction import parse_requested_effect
from splicr.research_protocol import sha256_file
ROOT=Path(__file__).resolve().parents[4];OUT=Path(__file__).resolve().parent
source=ROOT/'data/references/assaybench/snapshot/biogrid/train-00000-of-00001.parquet'
rows=ds.dataset(source).to_table(columns=['phenotype','yearfold0'],filter=ds.field('yearfold0')=='train').to_pylist()
assert len(rows)==1349 and all(r['yearfold0']=='train' for r in rows)
vocabulary=Counter(r['phenotype'] for r in rows)
training=[{'phenotype':text,'n_screens':count,'parsed':asdict(parse_requested_effect(text))} for text,count in sorted(vocabulary.items())]
counts=Counter()
for r in training:counts[r['parsed']['polarity']]+=r['n_screens']
# Read only previously recorded validation metadata for the already identified
# requested-effect pairs. No target labels or scoring function enters this check.
meta={r['dataset_name']:r for r in json.loads((OUT/'validation_screen_diagnostics.json').read_text())}
pairs=json.loads((OUT/'supplement.json').read_text())['requested_direction_pairs']
checks=[]
for pair in pairs:
    a=parse_requested_effect(meta[pair['a']]['phenotype']);b=parse_requested_effect(meta[pair['b']]['phenotype'])
    checks.append({'a':pair['a'],'b':pair['b'],'source_id':pair['source_id'],
                   'a_parsed':asdict(a),'b_parsed':asdict(b),
                   'distinguishes_opposite_requests':a.polarity=='increase' and b.polarity=='decrease',
                   'same_target':a.target==b.target})
result={'parser_sha256':sha256_file(ROOT/'engine/splicr/effect_direction.py'),'script_sha256':sha256_file(__file__),
        'data_sha256':sha256_file(source),'training_screens':len(rows),'training_unique_phenotypes':len(vocabulary),
        'training_polarity_counts':dict(counts),'training_vocabulary':training,
        'validation_pair_comparisons':len(checks),'validation_unique_screens':len({c[k] for c in checks for k in ('a','b')}),
        'validation_publications':len({c['source_id'] for c in checks}),
        'distinguished':sum(c['distinguishes_opposite_requests'] for c in checks),
        'same_target':sum(c['same_target'] for c in checks),'checks':checks,
        'interpretation':'implementation diagnostic only; grammar based on training and synthetic semantics, no model-performance claim; no test accessed'}
(OUT/'parser_diagnostic.json').write_text(json.dumps(result,indent=2,sort_keys=True,allow_nan=False)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in {'training_vocabulary','checks'}},indent=2))

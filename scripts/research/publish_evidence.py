#!/usr/bin/env python3
"""Generate the public evidence snapshot from measured, checked-in research artifacts.

No model fitting or invented fallback values. --check fails when published data drift.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/web/public/evidence'

def generate():
    sources = {}
    def read(name):
        path = ROOT / 'research/artifacts' / name
        raw = path.read_bytes()
        sources[str(path.relative_to(ROOT))] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)
    refs = read('official_references.json')
    router = read('router_replay_summary.json')
    counts = read('raw_count_reproduction.json')
    post = read('postscreen_unpaired_audit.json')
    snapshot = {
        'measurement_date': '2026-09-27',
        'dataset': 'Genentech/assaybench · biogrid/yearfold0',
        'split': {'train': 1349, 'validation': 218, 'test': router['router']['n_screens']},
        'metric': 'Adjusted nDCG@100',
        'references': {k: {'mean': v['mean'], 'ci95': v['ci95']} for k,v in refs['models'].items()},
        'router': {'mean': router['router']['mean'], 'ci95': router['router']['ci95'], 'paired_vs_ensemble': router['paired_vs_external']},
        'legacy_prior': refs['legacy_seed_average'],
        'counts': counts,
        'postscreen': {k:post[k] for k in ['dataset','source','input_sha256','n_guides','n_genes','original_min_directional_fdr_hits','corrected_two_family_fdr_hits','statistical_method','CHD1L','CHD1L_rank']},
        'postscreen_qc': post['qc']['verdict'],
        'sources_sha256': sources,
        'limitations': ['Public retrospective test; independent prospective validation outstanding.', 'No demonstrated superiority over the published ensemble.', 'No calibrated probability of independent validation.', 'Count agreement and software tests do not certify biological accuracy.'],
    }
    files = {'summary.json': (json.dumps(snapshot, indent=2)+'\n').encode()}
    for name in ['05_BENCHMARK_REPRODUCTION.md','08_VALIDATION_REPORT.md','10_FINAL_RESULTS.md','11_HOW_TO_READ_THE_EVIDENCE.md','POSTSCREEN_IMPLEMENTATION.md','12_WEBSITE_CONSISTENCY.md']:
        files[name] = (ROOT/'research'/name).read_bytes()
    files['manifest.json'] = (json.dumps({'files_sha256': {name:hashlib.sha256(raw).hexdigest() for name,raw in files.items()}},indent=2)+'\n').encode()
    return files

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args=parser.parse_args()
    for name, raw in generate().items():
        path=OUT/name
        if args.check:
            if not path.exists() or path.read_bytes()!=raw:
                raise SystemExit(f'Stale public evidence: {name}; run python3 scripts/research/publish_evidence.py')
        else:
            OUT.mkdir(parents=True,exist_ok=True)
            path.write_bytes(raw)
    print('Public evidence verified.' if args.check else 'Public evidence generated from research artifacts.')

#!/usr/bin/env python3
"""Generate the public evidence snapshot from measured, checked-in research artifacts.

No model fitting or invented fallback values. --check fails when published data drift.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/web/public/evidence'


def gate(*arguments):
    """One canonical integrity validator is shared with the Node-only build."""
    return subprocess.check_output(
        ['node', str(ROOT / 'scripts/research/evidence_gate.mjs'), *arguments],
        cwd=ROOT, text=True,
    )

def generate(repin=False):
    gate('--validate-inputs')
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
    contract = json.loads((ROOT / 'research/evidence_contract.json').read_text())
    addendum = contract.get('research_addendum')
    if addendum and addendum.get('published'):
        # Published research results are *derived* from the registered experiment
        # descriptors, never typed in here, so a website number cannot drift from
        # the artifact it claims to come from.
        entries = {}
        for experiment_id, pin in sorted(addendum['experiments'].items()):
            raw = (ROOT / pin['descriptor']).read_bytes()
            if hashlib.sha256(raw).hexdigest() != pin['descriptor_sha256']:
                raise ValueError(f'Unapproved experiment descriptor: {experiment_id}')
            sources[pin['descriptor']] = pin['descriptor_sha256']
            descriptor = json.loads(raw)
            summary_json = json.loads((ROOT / descriptor['summary']).read_bytes())
            entries[experiment_id] = {
                'title': pin['title'],
                'selected_model': pin['selected_model'],
                'split': descriptor['split'],
                'evaluation_kind': descriptor['evaluation_kind'],
                'input_contract': descriptor['input_contract'],
                'promotion_status': descriptor['promotion_status'],
                'mean': summary_json['mean'],
                'ci95': summary_json['ci95'],
                'n_screens': summary_json['n_screens'],
                'n_publications': summary_json['n_publications'],
                'comparison': pin['comparison'],
                'finding': pin['finding'],
            }
        snapshot['research_addendum'] = {
            'measurement_date': addendum['measurement_date'],
            'split': addendum['split'],
            'note': addendum['note'],
            'experiments': entries,
        }

    post = contract.get('post_screen')
    if post and post.get('published'):
        # Derived from the registered descriptor, never typed here, for the same
        # reason the research addendum is: a published figure must not be able to
        # drift from the artifact it cites.
        raw = (ROOT / post['descriptor']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != post['descriptor_sha256']:
            raise ValueError('Unapproved post-screen descriptor')
        sources[post['descriptor']] = post['descriptor_sha256']
        d = json.loads(raw)
        head = d['headline']
        snapshot['post_screen_replication'] = {
            'measurement_date': post['measurement_date'],
            'benchmark': post['benchmark'],
            'note': post['note'],
            'cohort': d['cohort'],
            'primary_model': d['primary_model'],
            'comparator': d['comparator'],
            'metric': 'average precision, non-common-essential gene space',
            'primary_mean': head['primary_mean'],
            'comparator_mean': head['comparator_mean'],
            'paired_difference': head['paired_difference'],
            'precision_at_10': head['precision_at_10'],
            'non_hub_paired_difference': head['non_hub_paired_difference'],
            'promotion_status': d['promotion_status'],
            'limitations': post['limitations'],
        }
    files = {'summary.json': (json.dumps(snapshot, indent=2)+'\n').encode()}
    for name in ['05_BENCHMARK_REPRODUCTION.md','08_VALIDATION_REPORT.md','10_FINAL_RESULTS.md','11_HOW_TO_READ_THE_EVIDENCE.md','POSTSCREEN_IMPLEMENTATION.md','12_WEBSITE_CONSISTENCY.md']:
        files[name] = (ROOT/'research'/name).read_bytes()
    files['manifest.json'] = (json.dumps({'files_sha256': {name:hashlib.sha256(raw).hexdigest() for name,raw in files.items()}},indent=2)+'\n').encode()
    contract = json.loads((ROOT / 'research/evidence_contract.json').read_text())
    pins = [('summary.json', 'public_summary_sha256'), ('manifest.json', 'public_manifest_sha256')]
    if repin:
        # Deliberate, owner-authorized re-pinning of the publication contract.
        # It refuses unless the contract already declares a new snapshot and who
        # approved it, so a drifting number can never be re-pinned by accident.
        path = ROOT / 'research/evidence_contract.json'
        current = json.loads(path.read_text())
        if not current.get('approval', {}).get('authorized_by'):
            raise ValueError('Re-pinning requires an approval block naming who authorized it.')
        if current.get('previous_snapshot', {}).get('snapshot_id') == current.get('snapshot_id'):
            raise ValueError('Re-pinning requires a new snapshot_id distinct from the retained previous one.')
        for name, key in pins:
            current[key] = hashlib.sha256(files[name]).hexdigest()
        path.write_text(json.dumps(current, indent=2) + '\n')
        print(f"Publication contract re-pinned to snapshot {current['snapshot_id']}.")
        contract = current
    for name, key in pins:
        if hashlib.sha256(files[name]).hexdigest() != contract[key]:
            raise ValueError(f'Unapproved generated evidence: {name}. Preserve the current snapshot; '
                             'register research separately and obtain independent scientific review '
                             'before updating the publication contract.')
    return files


def register_experiment(descriptor, replication=False):
    flag = '--validate-replication' if replication else '--validate-experiment'
    receipt = json.loads(gate(flag, descriptor))
    raw = (json.dumps(receipt, indent=2) + '\n').encode()
    location = ROOT / 'research/evidence_registry' / f"{receipt['descriptor_sha256']}.json"
    location.parent.mkdir(parents=True, exist_ok=True)
    try:
        with location.open('xb') as handle:
            handle.write(raw)
    except FileExistsError:
        if location.read_bytes() != raw:
            raise ValueError('Existing registration receipt differs; refusing overwrite')
    print(f'Research registered, not promoted: {location.relative_to(ROOT)}')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--register-experiment', metavar='DESCRIPTOR_JSON')
    mode.add_argument('--register-replication', metavar='DESCRIPTOR_JSON',
                      help='register a post-screen replication claim (separate validator)')
    mode.add_argument('--repin', action='store_true',
                      help='re-pin the contract to the regenerated evidence (requires an approval block)')
    args=parser.parse_args()
    if args.register_experiment:
        register_experiment(args.register_experiment)
        raise SystemExit(0)
    if args.register_replication:
        register_experiment(args.register_replication, replication=True)
        raise SystemExit(0)
    if args.check:
        gate('--check-public')
    for name, raw in generate(repin=args.repin).items():
        path=OUT/name
        if args.check:
            if not path.exists() or path.read_bytes()!=raw:
                raise SystemExit(f'Stale public evidence: {name}; run python3 scripts/research/publish_evidence.py')
        else:
            OUT.mkdir(parents=True,exist_ok=True)
            # Validate every source/generated file before the first write.
            # Replace only after the complete file exists; no partial JSON.
            temporary = path.with_name(path.name + '.tmp')
            temporary.write_bytes(raw)
            temporary.replace(path)
    print('Public evidence verified.' if args.check else 'Public evidence generated from research artifacts.')

"""Real inputs/reference smoke plus explicitly synthetic temporal verification.

No database writes. Synthetic kinetics are never described as a biological result.
"""
from pathlib import Path
from types import SimpleNamespace
import hashlib
import json
import time

from splicr.pipeline import ScreenInput, run_pipeline
from splicr.references import load_library, Library, Guide
from splicr.count import CountMatrix
from splicr.guide_mapping import verified_library_coordinates
from splicr.lab_context import context_matrix
from splicr.lab_evidence import receipt, isoform_report, kinetics


def main():
    root = Path(__file__).resolve().parents[2]
    out = root/'research/artifacts/20261008/lab-evidence'
    out.mkdir(parents=True, exist_ok=True)
    inputs = root/'artifacts/millman-20261008/input'
    work = root/'data/research/lab-workspace-20261008/tools/deterministic-evidence'
    spec = ScreenInput(name='Millman real-count deterministic lab-evidence verification',
        count_table=inputs/'counts.tsv', library_slug='millman_cellecta_kahgw106p',
        library_path=inputs/'study_library.tsv', roles={'D0':'reference','kidney':'treatment'},
        treatment=['kidney'], control=['D0'], normalization='control', hit_callers=['mageck_rra'],
        cell_line='HUES8-VPR stem-cell-derived islets', model_type='in_vivo',
        phenotype='transplantation enrichment', modality='crispra', fitness_assay=False,
        deterministic_only=True, lab_evidence={'isoforms':True})
    start=time.perf_counter()
    result=run_pipeline(spec,work,persist=False,verbose=True)
    if not result.ok: raise RuntimeError(result.error)
    report=json.loads(result.report_path.read_text())
    assert report['validation']['n_estimated'] == 0
    assert report['validation']['metrics']['deterministic_only'] is True
    records=report['lab_evidence']['records']
    drift=next(r for r in records if r['kind']=='drift')
    refusal=next(r for r in records if r['kind']=='isoforms')
    assert refusal['gene']=='__SCREEN__' and refusal['payload']['status']=='unavailable'
    baseline=next(s for s in drift['payload']['samples'] if s['sample']=='D0')
    assert baseline['baseline'] and len(baseline['lorenz'])==101
    fixture_records=[drift]
    mappings={}
    for slug in ('brunello','tkov3'):
        library=load_library(slug)
        guides=[g for g in library.guides if g.gene=='PIKFYVE']
        assert guides,slug
        selected=Library(slug,library.name,guides,taxid=library.taxid)
        verified,notes=verified_library_coordinates(selected)
        assert all(g.cut_pos is not None for g in verified.guides),notes
        mappings[slug]={'guides':[vars(g) for g in verified.guides],'verification':notes}
        if slug=='brunello':
            rows=[SimpleNamespace(guide_key=g.guide_id,log2_fold_change=None,chromosome=g.chrom,cut_position=g.cut_pos,strand=g.strand) for g in verified.guides]
            payload=isoform_report('PIKFYVE',rows,coordinate_notes=notes)
            assert len(payload['transcripts'])>1
            fixture_records.append(receipt('isoforms','PIKFYVE',payload,{'scope':'Real reference-only guide mapping. No guide effect or measured transcript expression supplied.'}))
    context=context_matrix(['PIKFYVE'],'A549',release='24Q4')['PIKFYVE']
    assert context['exact']['effect'] is not None
    assert context['reference_identity']['gene_effect_matrix_sha256']
    fixture_records.append(receipt('context','PIKFYVE',context,{'scope':'Real pinned DepMap reference, not a new experimental validation.'}))
    controls=[Guide(f'NTC{i}','A'*20,None,True) for i in range(10)]
    library=Library('synthetic-verification','Synthetic temporal fixture',controls+[Guide('SYNTHETIC-G1','C'*20,'SYNTHETIC_FIXTURE')])
    samples=[f'r{r}d{d}' for r in range(2) for d in (0,7,21)]
    counts=[[100]*6 for _ in controls]+[[100,75,25,100,80,35]]
    matrix=CountMatrix(library.slug,[g.guide_id for g in library.guides],[g.gene for g in library.guides],samples,counts)
    options={'kinetic_normalization':'control','time_course':[{'sample':f'r{r}d{d}','day':d,'condition':'SYNTHETIC','replicate':str(r)} for r in range(2) for d in (0,7,21)]}
    fixture_records.append(receipt('kinetics','SYNTHETIC_FIXTURE',kinetics(matrix,library,options)['SYNTHETIC_FIXTURE'],{'scope':'Synthetic software verification only. Not experimental data or a biological finding.'}))
    (out/'records.json').write_text(json.dumps(fixture_records,indent=2,allow_nan=False)+'\n')
    (out/'verified-guide-mappings.json').write_text(json.dumps(mappings,indent=2,allow_nan=False)+'\n')
    summary={'schema':'splicr.lab-evidence-smoke.v1','persisted':False,
        'scope':'Local real-count pipeline, real reference mapping/context, separately labelled synthetic kinetic software verification; no superiority or validation claim.',
        'real_counts':{'n_guides':len(result.matrix.guide_ids),'n_genes':len(result.hits.genes),
            'report':str(result.report_path.relative_to(root)), 'sha256':hashlib.sha256(result.report_path.read_bytes()).hexdigest(),
            'deterministic_only':True,'D0_raw_count_gini':baseline['raw_count_gini']},
        'mapped_libraries':list(mappings),'brunello_guides':len(mappings['brunello']['guides']),
        'tkov3_guides':len(mappings['tkov3']['guides']),'reference_model':context['model_id'],
        'runtime_seconds':time.perf_counter()-start}
    (out/'verification.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary))

if __name__=='__main__': main()

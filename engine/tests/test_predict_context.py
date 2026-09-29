"""Synthetic interface/manifest tests, never biological performance evidence."""
import importlib.metadata
from importlib.resources import files
import inspect
import json
from pathlib import Path

import pytest

from splicr import context_ranking, prescreen
from splicr.predict_context import FrozenContextPredictor, export_bundle, main, training_digest
from splicr.research_protocol import sha256_file
from splicr.prescreen import ScreenContext


@pytest.fixture
def fixture_bundle(tmp_path,monkeypatch):
    from assaybench.benchmark.metrics import RankingMetrics
    from assaybench.utils import gene_mapper
    records=[{'dataset_name':str(i),'source_id':str(i),'phenotype':'fitness',
              'relevance_genes':['TP53','BRCA1'],'relevance_scores':[1,-1]} for i in range(2)]
    provenance={
        'metric_sha256':sha256_file(inspect.getfile(RankingMetrics)),
        'identifier_mapping_sha256':sha256_file(inspect.getfile(gene_mapper)),
        'context_ranking_sha256':sha256_file(context_ranking.__file__),
        'model_code_sha256':sha256_file(prescreen.__file__),
        'packages':{n:importlib.metadata.version(n) for n in ('numpy','scipy','scikit-learn','lightgbm')},
        'identifier_resources':{n:sha256_file(str(files('assaybench.data.hgnc').joinpath(n))) for n in
            ('all_genes.tsv','hgnc_symbols_cache.tsv','manual_mappings.json','uniprot_protein_to_gene.json')}}
    config={'kind':'prior','config':{'conditional':False}}
    expected_digest=training_digest(records)
    monkeypatch.setattr('splicr.predict_context._bound_training_digest',lambda _:expected_digest)
    frozen={'promotion_status':'research_only','final_replay_candidates':['synthetic_prior'],
            'validation_results':{'synthetic_prior':{'config':config}},'provenance':provenance}
    freeze=tmp_path/'freeze.json';freeze.write_text(json.dumps(frozen))
    bundle=tmp_path/'bundle.json'
    export_bundle(bundle,training=records,experiment_freeze=freeze,name='synthetic_prior',
                  configuration=config,model_directory=tmp_path)
    return records,bundle


def test_real_interface_requires_bound_training_and_metadata(fixture_bundle):
    records,bundle=fixture_bundle
    model=FrozenContextPredictor(bundle,records)
    assert model.predict(ScreenContext.from_record({'source_id':'new'}))==['TP53','BRCA1']
    with pytest.raises(ValueError,match='overlaps'):model.predict(ScreenContext.from_record({'source_id':'0'}))
    with pytest.raises(TypeError):model.predict({'relevance_genes':['TP53']})
    changed=[{**r,'relevance_scores':[0,0]} for r in records]
    with pytest.raises(ValueError,match='training data differ'):FrozenContextPredictor(bundle,changed)


def test_annotations_and_unsupported_probability_fail_closed(fixture_bundle):
    records,bundle=fixture_bundle
    payload=json.loads(bundle.read_text());payload['validation_probability']=.99
    bundle.write_text(json.dumps(payload))
    with pytest.raises(ValueError,match='calibration'):FrozenContextPredictor(bundle,records)
    payload['validation_probability']=None;payload['provenance']['identifier_resources']={}
    bundle.write_text(json.dumps(payload))
    with pytest.raises(ValueError,match='incomplete identifier'):FrozenContextPredictor(bundle,records)


def test_cli_output_receipt_and_exclusive_creation(fixture_bundle,tmp_path):
    records,bundle=fixture_bundle
    train=tmp_path/'train.json';train.write_text(json.dumps(records))
    context=tmp_path/'query.json';context.write_text(json.dumps({'phenotype':'fitness','source_id':'new'}))
    output=tmp_path/'prediction.json';receipt=tmp_path/'receipt.json'
    args=['--bundle',str(bundle),'--training',str(train),'--context',str(context),
          '--output',str(output),'--receipt',str(receipt)]
    assert main(args)==0
    result=json.loads(output.read_text())
    assert result['validation_probability'] is None and result['promotion_status']=='research_only'
    assert json.loads(receipt.read_text())['predictions']['new_experiment']==result['genes']
    with pytest.raises(FileExistsError):main(args)


def test_cli_rejects_target_library(fixture_bundle,tmp_path):
    records,bundle=fixture_bundle
    train=tmp_path/'train.json';train.write_text(json.dumps(records))
    context=tmp_path/'query.json';context.write_text(json.dumps({'relevance_genes':['TP53']}))
    with pytest.raises(SystemExit):main(['--bundle',str(bundle),'--training',str(train),'--context',str(context),
                                        '--output',str(tmp_path/'prediction.json')])
    assert not (tmp_path/'prediction.json').exists()


def test_digest_excludes_unused_posthoc_prose_but_binds_order_and_labels(fixture_bundle):
    records,_=fixture_bundle
    assert training_digest(records)==training_digest([{**r,'notes':'not an input'} for r in records])
    assert training_digest(records)!=training_digest(records[::-1])


def test_export_rejects_wrong_corpus_even_when_models_are_present(fixture_bundle,tmp_path):
    records,bundle=fixture_bundle
    with pytest.raises(ValueError,match='experiment training corpus'):
        export_bundle(tmp_path/'wrong.json',training=records[::-1],experiment_freeze=tmp_path/'freeze.json',
                      name='synthetic_prior',configuration={'kind':'prior','config':{'conditional':False}},
                      model_directory=tmp_path)
    assert not (tmp_path/'wrong.json').exists()

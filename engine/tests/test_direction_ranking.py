"""Synthetic invariants for direction ablation; not biological performance."""
import numpy as np
import pytest

from splicr.context_ranking import ContextEvidence, ExposureConfig
from splicr.direction_ranking import DirectionConfig, DirectionEvidence, effect_key
from splicr.effect_direction import parse_requested_effect
from splicr.prescreen import ScreenContext


def row(identity, pub, phenotype, labels, modality='Knockout'):
    return dict(dataset_name=identity, source_id=pub, phenotype=phenotype,
                cleaned_phenotype='drug response', library_methodology=modality,
                screen_type='Bidirectional', relevance_genes=['TP53', 'KRAS'],
                relevance_scores=labels)


def fixture():
    return [row('a', 'p1', 'increase drug resistance', [1, -1]),
            row('b', 'p2', 'decrease drug resistance', [-1, 1])]


def query(phenotype='increase drug resistance', **kwargs):
    return ScreenContext.from_record(dict(phenotype=phenotype, source_id='new',
        cleaned_phenotype='drug response', library_methodology='Knockout',
        screen_type='Bidirectional', **kwargs))


def test_baseline_is_exact_parent_model():
    records=fixture(); model=DirectionEvidence().fit(records);parent=ContextEvidence().fit(records)
    assert np.array_equal(model.score(query(), DirectionConfig(effect_prior=False)),
                          parent.score(query(), ExposureConfig()))


def test_same_selection_type_opposite_requested_effects_reverse_ranking():
    model=DirectionEvidence().fit(fixture())
    assert model.rank(query('increase drug resistance'), k=2)==['TP53','KRAS']
    assert model.rank(query('decrease drug resistance'), k=2)==['KRAS','TP53']


def test_unmeasured_gene_is_not_negative_evidence():
    records=fixture();records[0]['relevance_genes']=['TP53'];records[0]['relevance_scores']=[1]
    model=DirectionEvidence().fit(records)
    w=model.effect_weights(query())
    n=np.asarray(w @ model.corpus.measured).ravel()
    assert n[model.lookup['KRAS']]==0 and n[model.lookup['TP53']]==1


def test_unknown_effect_and_incompatible_target_back_off_exactly():
    model=DirectionEvidence().fit(fixture())
    for phenotype in ('either increases or decreases drug resistance','increase drug sensitivity'):
        ctx=query(phenotype)
        assert np.array_equal(model.score(ctx),model.score(ctx,DirectionConfig(effect_prior=False)))


def test_resistance_and_sensitivity_keep_distinct_keys():
    a=effect_key(parse_requested_effect('increase sensitivity to drug A'))
    b=effect_key(parse_requested_effect('increase resistance to drug A'))
    assert a!=b
    assert effect_key(parse_requested_effect('increase SQSTM1 accumulation')) != effect_key(
        parse_requested_effect('increase NCOA4 accumulation'))


def test_own_publication_and_modality_do_not_enter_compatible_donors():
    records=fixture()+[row('c','p3','increase drug resistance',[1,1],'Activation')]
    model=DirectionEvidence().fit(records)
    ctx=ScreenContext.from_record({**dict(query().values),'source_id':'p1'})
    assert not model.effect_weights(ctx).any()


def test_requested_polarity_retrieval_does_not_use_selection_type_as_proxy():
    model=DirectionEvidence().fit(fixture())
    cfg=DirectionConfig(retrieval_weight=.5)
    assert model.rank(query('increase drug resistance'),cfg,k=2)[0]=='TP53'
    assert model.rank(query('decrease drug resistance'),cfg,k=2)[0]=='KRAS'


def test_context_boundary_rejects_labels_and_target_library():
    model=DirectionEvidence().fit(fixture())
    with pytest.raises(TypeError):model.rank({'phenotype':'increase resistance','relevance_genes':['TP53']})
    a=query();b=ScreenContext.from_record({**dict(a.values),'source_id':'new','relevance_genes':['KRAS'],'relevance_scores':[1e6]})
    assert model.rank(a)==model.rank(b)


def test_invalid_configurations_fail():
    with pytest.raises(ValueError):DirectionConfig(base=ExposureConfig(retrieval=.5))
    with pytest.raises(ValueError):DirectionConfig(retrieval_weight=float('nan'))
    with pytest.raises(ValueError):DirectionConfig(retrieval_k=True)

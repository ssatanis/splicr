"""Synthetic invariants only; not benchmark or biological measurements."""
import numpy as np
import pytest
from splicr.prescreen import ScreenContext
from splicr.context_ranking import (ContextEvidence, ExposureConfig, ContextRanker, EXPERTS,
                                   expert_features, canonical_truth, reciprocal_rank)


def record(name,pub,genes,labels,phenotype='fitness'):
    return dict(dataset_name=name,source_id=pub,relevance_genes=genes,relevance_scores=labels,
                cleaned_phenotype=phenotype,phenotype=phenotype,screen_type='Negative Selection')


def test_missing_measurement_is_not_nonhit_and_own_publication_is_excluded():
    rows=[record('1','a',['A','B'],[1,0]),record('2','b',['A'],[0]),record('3','c',['B'],[1])]
    model=ContextEvidence().fit(rows)
    n,h,negative,mass=model.statistics(ScreenContext.from_record({'source_id':'a'}))
    assert mass==2
    assert n.tolist()==[1,1]
    assert h.tolist()==[0,1]
    assert negative.tolist()==[0,0]


def test_shrinkage_and_exposure_act_at_global_level():
    rows=[record(str(i),str(i),['A','B'] if i==0 else ['A'],[1,1] if i==0 else [int(i<5)]) for i in range(10)]
    model=ContextEvidence().fit(rows);ctx=ScreenContext.from_record({})
    scores=model.score(ctx,ExposureConfig(strength=10,exposure_power=1,conditional=False,signed=False))
    assert scores[0]>scores[1]
    assert not np.array_equal(scores,model.score(ctx,ExposureConfig(strength=1,exposure_power=0,conditional=False,signed=False)))


def test_target_label_poisoning_cannot_change_context_prediction():
    model=ContextEvidence().fit([record('1','a',['A','B'],[1,0]),record('2','b',['A','B'],[0,1])])
    safe={'phenotype':'fitness','source_id':'new'}
    poisoned={**safe,'relevance_genes':['B'],'relevance_scores':[1e9],'hit':['B']}
    assert model.rank(ScreenContext.from_record(safe))==model.rank(ScreenContext.from_record(poisoned))
    with pytest.raises(TypeError):model.score(poisoned)


def test_experts_complete_and_cutoff_precedes_deduplication():
    ranks={e:['A']*100+['PRIVATE_TARGET_GENE'] for e in EXPERTS}
    genes,features=expert_features(ranks)
    assert genes==['A'] and features.shape==(1,18)
    with pytest.raises(ValueError):expert_features({EXPERTS[0]:['A']})
    with pytest.raises(ValueError):expert_features({**ranks,EXPERTS[0]:[]})


def test_invalid_configuration_is_rejected():
    for values in [{'strength':0},{'exposure_power':-1},{'retrieval':2},{'strength':float('nan')}]:
        with pytest.raises(ValueError):ExposureConfig(**values)


def test_no_independent_donor_fails_closed():
    model=ContextEvidence().fit([record('1','a',['A'],[1])])
    with pytest.raises(ValueError):model.rank(ScreenContext.from_record({'source_id':'a'}))


def test_context_features_are_finite_for_missing_context_and_unseen_genes():
    model=ContextEvidence().fit([record('1','a',['A'],[1]),record('2','b',['A'],[-1])])
    x=model.feature_matrix(ScreenContext.from_record({'source_id':'new'}),['A','UNSEEN'])
    assert x.shape==(2,39) and np.isfinite(x).all()


def test_aliases_share_consensus_and_observed_training_label():
    rows=[record('1','a',['P53'],[1]),record('2','b',['TP53'],[-1])]
    corpus=ContextEvidence().fit(rows)
    assert corpus.corpus.genes.tolist()==['TP53']
    experts={e:{'1':['p53','UNRECOGNIZED_TEST_GENE'],'2':[' TP53 ','UNRECOGNIZED_TEST_GENE']} for e in EXPERTS}
    model=ContextRanker(history=False,coverage=True,rounds=2).fit(rows,experts,corpus)
    assert model.fit_diagnostics['observed_rows']==2
    assert model.fit_diagnostics['candidate_rows']==4
    mixed={e:['P53','TP53','UNRECOGNIZED_TEST_GENE'] for e in EXPERTS}
    assert expert_features(mixed)[0]==['TP53','UNRECOGNIZED_TEST_GENE']
    assert reciprocal_rank(mixed,constant=10)==['TP53','UNRECOGNIZED_TEST_GENE']
    result=model.rank(ScreenContext.from_record({'source_id':'new'}),mixed,corpus)
    assert set(result)=={'TP53','UNRECOGNIZED_TEST_GENE'}
    with pytest.raises(ValueError):model.rank(ScreenContext.from_record({'source_id':'a'}),mixed,corpus)


def test_canonical_collision_matches_official_last_occurrence_rule():
    row=record('1','a',['P53','TP53'],[1,-1])
    assert canonical_truth(row)=={'TP53':-1}
    corpus=ContextEvidence().fit([row])
    assert corpus.identifier_audit['canonical_collisions']==1
    assert corpus.corpus.negative.toarray().tolist()==[[1]]

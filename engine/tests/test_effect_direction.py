"""Semantics and abstention boundaries, independent of benchmark labels."""
from dataclasses import FrozenInstanceError

import pytest

from splicr.effect_direction import parse_requested_effect


@pytest.mark.parametrize(('text', 'polarity', 'target'), [
    ('increase resistance to dieldrin', 'increase', 'resistance to dieldrin'),
    ('decrease resistance to dieldrin', 'decrease', 'resistance to dieldrin'),
    ('Increases NFkB signaling activity.', 'increase', 'NFkB signaling activity'),
    ('decreases cell proliferation (cell fitness).', 'decrease', 'cell proliferation (cell fitness)'),
    ('increase in drug sensitivity', 'increase', 'drug sensitivity'),
    ('decrease in cell viability', 'decrease', 'cell viability'),
    ('increase GFP accumulation by inhibiting degradation', 'increase', 'GFP accumulation by inhibiting degradation'),
    ('  decrease\tcell\nproliferation ', 'decrease', 'cell proliferation'),
])
def test_explicit_request_preserves_phenotype(text, polarity, target):
    result = parse_requested_effect(text)
    assert result.polarity == polarity
    assert result.target == target
    assert result.reason == 'explicit_leading_effect'


@pytest.mark.parametrize('text', [
    None, '', '-', 'unknown', 'unspecified', 'U_1471_inc', 'U_1471_dec',
    'positive selection', 'negative selection', 'CRISPR activation',
    'drug resistance', 'loss of resistance', 'impacts viral infectivity',
    'either increases or decreases resistance', 'both increase and decrease resistance',
    'increase or decrease resistance', 'decrease/increase resistance',
    'increase sensitivity and decrease proliferation', 'increase resistance or sensitivity',
    'increase both resistance and sensitivity', 'increase resistance without affecting proliferation',
    'increase resistance; decrease sensitivity', 'increase resistance?',
    'not increase resistance', 'decrease not increase resistance',
    'decrease unknown phenotype', 'increase 123', 'increase .',
    'increase as measured by GFP', 'increase in', 'decrease in',
    'increase in as measured by GFP',
    'reporter measured after an increase in resistance',
])
def test_unknown_is_never_inferred_from_ambiguity_or_metadata(text):
    result = parse_requested_effect(text)
    assert result.polarity == 'unknown'
    assert result.target is None


def test_opposite_readout_does_not_replace_requested_phenotype():
    result = parse_requested_effect('increases drug sensitivity as measured by decreased cell proliferation.')
    assert result.polarity == 'increase'
    assert result.target == 'drug sensitivity'
    assert result.qualifier == 'as measured by decreased cell proliferation.'
    assert result.text.endswith('decreased cell proliferation.')


def test_resistance_and_sensitivity_are_not_canonicalized_to_one_target():
    resistance = parse_requested_effect('increase drug resistance')
    sensitivity = parse_requested_effect('increase drug sensitivity')
    assert resistance.polarity == sensitivity.polarity == 'increase'
    assert resistance.target != sensitivity.target


def test_readout_only_direction_does_not_create_a_requested_effect():
    result = parse_requested_effect('drug sensitivity as measured by decreased proliferation')
    assert result.polarity == 'unknown'


def test_multiple_main_effects_abstain_even_with_readout_marker():
    result = parse_requested_effect('increase sensitivity and decrease proliferation as measured by ATP')
    assert result.polarity == 'unknown'


def test_nontext_input_rejected():
    with pytest.raises(TypeError, match='never a labeled record'):
        parse_requested_effect({'dataset_name': 'query_inc', 'relevance_scores': [1]})


def test_result_is_immutable():
    result = parse_requested_effect('increase resistance')
    with pytest.raises(FrozenInstanceError):
        result.polarity = 'decrease'

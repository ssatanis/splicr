"""Conservative requested-effect parsing from prospective phenotype text only.

This describes the requested change in the named phenotype. It does not infer
perturbation modality, gene-effect sign, drug mechanism, selection type, or
biological equivalence of resistance and sensitivity. Unknown remains unknown.
The module is deliberately independent of screen IDs, labels and ranking code.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal

Polarity = Literal['increase', 'decrease', 'unknown']

# Base/third-person forms are the explicit leading forms observed in the
# through-2020 training vocabulary. Do not infer a direction from a verb buried
# in an explanatory clause or from a benchmark identifier such as "_inc".
_LEADING = re.compile(r'^(increase|increases|decrease|decreases)\b\s+(.+)$', re.I)
_QUALIFIER = re.compile(
    r'(?:^|,?\s+)(as measured by|as determined by|as indicated by|as evidenced by|'
    r'evidenced by|indicating)\b', re.I,
)
_AMBIGUOUS = re.compile(
    r'\b(?:both|either|neither|and|or|not|no|without|unknown|unspecified)\b|[;?]', re.I,
)
_SECOND_EFFECT = re.compile(r'\b(?:increase|increases|increased|increasing|'
                            r'decrease|decreases|decreased|decreasing)\b', re.I)


@dataclass(frozen=True)
class RequestedEffect:
    """Auditable syntax result; no probability or inferred biological sign.

    ``target`` retains the leading biological noun/mechanism phrase, while
    ``qualifier`` preserves explicitly marked readout explanations. A readout can
    have the opposite sign (e.g. increased sensitivity measured by decreased
    proliferation); it must not silently replace the requested target.
    Unknown results retain the normalized input in ``text`` for review.
    """

    polarity: Polarity
    target: str | None
    qualifier: str | None
    reason: str
    text: str


def parse_requested_effect(phenotype: str | None) -> RequestedEffect:
    """Parse an explicit leading increase/decrease request, otherwise abstain.

    Only one string is accepted. No dataset-name, selection, label or relevance
    fallback exists. Conjunctions/negation in the main request are deliberately
    conservative abstentions, including some valid but complicated descriptions.
    This is a syntax feature, not general biological language understanding.
    """
    if phenotype is not None and not isinstance(phenotype, str):
        raise TypeError('phenotype must be a string or None, never a labeled record')
    text = ' '.join((phenotype or '').split())
    if not text or text.casefold() in {'-', 'unknown', 'unspecified', 'n/a', 'none', 'nan'}:
        return RequestedEffect('unknown', None, None, 'missing_or_unspecified', text)
    matched = _LEADING.fullmatch(text)
    if matched is None:
        return RequestedEffect('unknown', None, None, 'no_explicit_leading_effect', text)
    verb, remainder = matched.groups()
    boundary = _QUALIFIER.search(remainder)
    target = remainder[:boundary.start()] if boundary else remainder
    qualifier = remainder[boundary.start():].lstrip(' ,') if boundary else None
    target = target.strip(' ,.').strip()
    # "increase in X" is a nominal form; preserve all other mechanism wording.
    if verb.casefold() in {'increase', 'decrease'} and target.casefold().startswith('in '):
        target = target[3:].strip()
    if (not target or not any(c.isalpha() for c in target)
            or target.casefold() in {'in', 'the', 'a', 'an', 'of', 'to', 'by', 'as'}):
        return RequestedEffect('unknown', None, qualifier, 'missing_target', text)
    if _AMBIGUOUS.search(target) or _SECOND_EFFECT.search(target):
        return RequestedEffect('unknown', None, qualifier, 'ambiguous_main_request', text)
    polarity: Polarity = 'increase' if verb.casefold().startswith('increase') else 'decrease'
    return RequestedEffect(polarity, target, qualifier, 'explicit_leading_effect', text)

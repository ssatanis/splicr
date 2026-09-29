"""Isolated research ablation for requested phenotype polarity.

Extends ContextEvidence without changing its model family or input contract.
No labels, measured query library, dataset-name suffix or test data are accepted
at prediction. Utilities are not calibrated validation probabilities.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Mapping, Sequence

import numpy as np

from .context_ranking import ContextEvidence, ExposureConfig, GROUPS
from .effect_direction import RequestedEffect, parse_requested_effect
from .prescreen import ScreenContext


def effect_key(effect: RequestedEffect) -> tuple[str, str] | None:
    """Conservative target compatibility, never resistance/sensitivity inversion.

    Drug/viral resistance descriptions share the explicit resistance noun and
    broad phenotype/modality checks separately constrain donors. Sensitivity is
    a distinct family. For other endpoints the full leading target must match;
    protein identity, mechanistic phrases and reporter target are retained.
    """
    if effect.polarity == 'unknown' or not effect.target:
        return None
    target = effect.target.casefold()
    families = [noun for noun in ('resistance', 'sensitivity')
                if re.search(r'\b' + noun + r'\b', target)]
    if len(families) > 1:
        return None
    return effect.polarity, families[0] if families else target


@dataclass(frozen=True)
class DirectionConfig:
    base: ExposureConfig = field(default_factory=ExposureConfig)
    effect_prior: bool = True
    retrieval_weight: float = 0.0
    retrieval_k: int = 25

    def __post_init__(self):
        if not isinstance(self.base, ExposureConfig) or self.base.retrieval != 0:
            raise ValueError('base must be ExposureConfig without legacy retrieval')
        if (not np.isfinite(self.retrieval_weight) or not 0 <= self.retrieval_weight <= 1
                or not isinstance(self.retrieval_k, int) or isinstance(self.retrieval_k, bool)
                or self.retrieval_k < 1):
            raise ValueError('valid matched-retrieval weight and donor count required')


class DirectionEvidence(ContextEvidence):
    def fit(self, records: Sequence[Mapping]) -> 'DirectionEvidence':
        super().fit(records)
        self.requested_effects = tuple(parse_requested_effect(c.get('phenotype'))
                                      for c in self.corpus.contexts)
        self.effect_keys = tuple(effect_key(e) for e in self.requested_effects)
        self._effect_cache = {}
        return self

    def effect_weights(self, context: ScreenContext, study=False) -> np.ndarray:
        weights = self._weights(context, study=study)
        key = effect_key(parse_requested_effect(context.get('phenotype')))
        if key is None:
            return np.zeros_like(weights)
        weights *= np.array([k == key for k in self.effect_keys], dtype=bool)
        for field_name in ('cleaned_phenotype', 'library_methodology'):
            value = context.get(field_name)
            # Unknown query context cannot establish compatible biology.
            if not value:
                return np.zeros_like(weights)
            weights *= self.corpus.values[field_name] == value
        return weights

    def effect_statistics(self, context: ScreenContext, weights, study=False):
        key = (context.source_id if context.source_id in self.corpus.publications else '',
               context.get('cleaned_phenotype'), context.get('library_methodology'),
               effect_key(parse_requested_effect(context.get('phenotype'))), study)
        if key not in self._effect_cache:
            values = tuple(np.asarray(weights @ m).ravel() for m in
                           (self.corpus.measured, self.corpus.positive, self.corpus.negative))
            if len(self._effect_cache) >= 384:
                self._effect_cache.clear()
            self._effect_cache[key] = values
        return self._effect_cache[key]

    def score(self, context: ScreenContext, config: DirectionConfig = DirectionConfig()):
        if not isinstance(context, ScreenContext):
            raise TypeError('only ScreenContext is accepted; labels/library are forbidden')
        if not isinstance(config, DirectionConfig):
            raise TypeError('DirectionConfig required')
        base = config.base
        if not config.effect_prior and not config.retrieval_weight:
            return super().score(context, base)
        compatible = self.effect_weights(context, base.study_balance)
        if not np.any(compatible):
            return super().score(context, base)
        n, h, neg, mass = self.statistics(context, study=base.study_balance)
        if mass <= 0:
            raise ValueError('no independent historical evidence')
        strength = base.strength
        positive = (h + strength * float(h.sum() / max(n.sum(), 1))) / (n + strength)
        negative = (neg + strength * float(neg.sum() / max(n.sum(), 1))) / (n + strength)
        coverage = (n + 1) / (mass + 2)
        if base.conditional:
            for fields in GROUPS[1:3]:
                cn, ch, cneg, cmass = self.statistics(context, fields, base.study_balance)
                if cmass > 0:
                    positive = (ch + strength * positive) / (cn + strength)
                    negative = (cneg + strength * negative) / (cn + strength)
                    coverage = (cn + strength * coverage) / (cmass + strength)
        if config.effect_prior:
            cn, ch, cneg = self.effect_statistics(context, compatible, base.study_balance)
            positive = (ch + strength * positive) / (cn + strength)
            negative = (cneg + strength * negative) / (cn + strength)
            coverage = (cn + strength * coverage) / (float(compatible.sum()) + strength)
        utility = positive - negative if base.signed else positive
        if config.retrieval_weight:
            sim = (self.corpus.vectorizer.transform([context.text() or 'unspecified'])
                   @ self.corpus.documents.T).toarray()[0]
            sim *= compatible > 0
            order = np.argsort(-sim, kind='stable')[:config.retrieval_k]
            weights = np.zeros_like(sim)
            weights[order] = compatible[order] * np.maximum(sim[order], 0) ** 2
            if weights.sum() > 0:
                # Same donor-evidence mass as the existing lexical-transfer ablation.
                weights *= 10 / weights.sum()
                rn, rh, rneg = [np.asarray(weights @ m).ravel() for m in
                               (self.corpus.measured, self.corpus.positive, self.corpus.negative)]
                transfer = (rh - (rneg if base.signed else 0) + strength * utility) / (rn + strength)
                utility = ((1-config.retrieval_weight)*utility
                           + config.retrieval_weight*transfer)
        score = utility * coverage ** base.exposure_power
        if not np.isfinite(score).all():
            raise ArithmeticError('nonfinite requested-effect utility')
        return score

    def rank(self, context: ScreenContext, config: DirectionConfig = DirectionConfig(), k=100):
        if not isinstance(k, int) or isinstance(k, bool) or k < 1:
            raise ValueError('positive integer k required')
        score = self.score(context, config)
        return self.corpus.genes[np.argsort(-score, kind='stable')[:k]].tolist()

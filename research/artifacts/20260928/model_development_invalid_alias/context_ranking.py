"""Experimental description-only ranking from historical evidence and supplied experts.

Target labels/libraries are absent from inference. Missing historical observations
stay separate from nonhits. Returned values are ranking utilities, not validation
probabilities. External rankings must be generated separately with provenance.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np
from scipy import sparse

from .prescreen import HistoricalRanker, PriorConfig, ScreenContext


EXPERTS = ("gemini-3-pro", "gpt-5.4", "gemini-3-flash", "gemini-3.1-pro", "gpt-5.2")
GROUPS = ((), ("cleaned_phenotype",), ("cleaned_phenotype", "screen_type"),
          ("cell_line",), ("condition_name",), ("library_methodology", "screen_type"))
CATEGORIES = ("fitness / proliferation / viability", "drug / chemical / environmental response",
              "host-pathogen / infection response", "molecular output / reporter / pathway activity",
              "trafficking / localization / structural phenotypes")


@dataclass(frozen=True)
class ExposureConfig:
    strength: float = 10.0
    exposure_power: float = 0.5
    conditional: bool = True
    signed: bool = True
    study_balance: bool = False
    retrieval: float = 0.0

    def __post_init__(self):
        if not np.isfinite([self.strength, self.exposure_power, self.retrieval]).all():
            raise ValueError("finite configuration required")
        if self.strength <= 0 or not 0 <= self.exposure_power <= 1 or not 0 <= self.retrieval <= 1:
            raise ValueError("invalid exposure configuration")


class ContextEvidence:
    """Train-fitted counts and vocabulary; leave-publication-out sufficient statistics."""
    def fit(self, records: Sequence[Mapping]) -> "ContextEvidence":
        self.corpus = HistoricalRanker(PriorConfig(hierarchy="global")).fit(records)
        self.lookup = {str(g): i for i, g in enumerate(self.corpus.genes)}
        self.ids = tuple(str(s["dataset_name"]) for s in records)
        self._cache = {}
        self._feature_cache = {}
        return self

    def _weights(self, context, fields=(), study=False):
        if not isinstance(context, ScreenContext):
            raise TypeError("only ScreenContext is accepted; labels/library are forbidden")
        weights = self.corpus.study_weights.copy() if study else np.ones(len(self.ids), np.float32)
        if context.source_id:
            weights[self.corpus.publications == context.source_id] = 0
        for field in fields:
            value = context.get(field)
            if not value:
                return np.zeros_like(weights)
            weights *= self.corpus.values[field] == value
        return weights

    def statistics(self, context, fields=(), study=False):
        if not isinstance(context, ScreenContext):
            raise TypeError("only ScreenContext is accepted; labels/library are forbidden")
        excluded = context.source_id if context.source_id in self.corpus.publications else ""
        key = (excluded, tuple((f, context.get(f)) for f in fields), study)
        if key not in self._cache:
            w = self._weights(context, fields, study)
            values = tuple(np.asarray(w @ matrix).ravel() for matrix in
                           (self.corpus.measured, self.corpus.positive, self.corpus.negative))
            if len(self._cache) >= 384:
                self._cache.clear()
            self._cache[key] = (*values, float(w.sum()))
        return self._cache[key]

    def score(self, context: ScreenContext, config: ExposureConfig = ExposureConfig()):
        n, h, neg, mass = self.statistics(context, study=config.study_balance)
        if mass <= 0:
            raise ValueError("no independent historical evidence")
        pooled = float(h.sum() / max(n.sum(), 1))
        a = config.strength
        positive = (h + a * pooled) / (n + a)
        negative = (neg + a * float(neg.sum() / max(n.sum(), 1))) / (n + a)
        coverage = (n + 1) / (mass + 2)
        if config.conditional:
            for fields in GROUPS[1:3]:
                cn, ch, cneg, cmass = self.statistics(context, fields, config.study_balance)
                if cmass > 0:
                    positive = (ch + a * positive) / (cn + a)
                    negative = (cneg + a * negative) / (cn + a)
                    coverage = (cn + a * coverage) / (cmass + a)
        utility = positive - negative if config.signed else positive
        if config.retrieval:
            sim = (self.corpus.vectorizer.transform([context.text() or "unspecified"]) @ self.corpus.documents.T).toarray()[0]
            sim *= self._weights(context) > 0
            # Direction changes alter resistance/sensitivity transfer; enforce a known match.
            if context.get("screen_type"):
                sim *= self.corpus.values["screen_type"] == context.get("screen_type")
            order = np.argsort(-sim, kind="stable")[:25]
            weights = np.zeros(len(sim), np.float32)
            weights[order] = np.maximum(sim[order], 0) ** 2
            if weights.sum() > 0:
                weights *= 10 / weights.sum()
                rn, rh, rneg = [np.asarray(weights @ m).ravel() for m in (self.corpus.measured, self.corpus.positive, self.corpus.negative)]
                transfer = (rh - (rneg if config.signed else 0) + a * utility) / (rn + a)
                utility = (1-config.retrieval)*utility + config.retrieval*transfer
        score = utility * coverage ** config.exposure_power
        if not np.isfinite(score).all():
            raise ArithmeticError("nonfinite ranking utility")
        return score

    def rank(self, context, config=ExposureConfig(), k=100):
        if not isinstance(k,int) or k < 1:
            raise ValueError("positive integer k required")
        scores = self.score(context, config)
        return self.corpus.genes[np.argsort(-scores,kind="stable")[:k]].tolist()

    def feature_matrix(self, context, candidates):
        cache_key = (context, tuple(candidates))
        if cache_key in self._feature_cache:
            return self._feature_cache[cache_key].copy()
        indices = np.array([self.lookup.get(g, -1) for g in candidates], dtype=int)
        valid = indices >= 0
        columns = []
        global_n, global_h, global_neg, mass = self.statistics(context)
        if mass <= 0:
            raise ValueError("no independent historical evidence")
        pooled = float(global_h.sum() / max(global_n.sum(), 1))
        parent_positive = (global_h+10*pooled)/(global_n+10)
        parent_negative = (global_neg+10*float(global_neg.sum()/max(global_n.sum(),1)))/(global_n+10)
        for fields in GROUPS:
            n, h, neg, total = self.statistics(context, fields)
            values = [np.log1p(n), (h+10*parent_positive)/(n+10),
                      (neg+10*parent_negative)/(n+10), (n+1)/(total+2), np.full_like(n,np.log1p(total))]
            for value in values:
                col = np.zeros(len(candidates),np.float32)
                col[valid] = value[indices[valid]]
                columns.append(col)
        sim=(self.corpus.vectorizer.transform([context.text() or "unspecified"]) @ self.corpus.documents.T).toarray()[0]
        sim *= self._weights(context)>0
        order=np.argsort(-sim,kind="stable")[:25]
        weights=np.maximum(sim[order],0)**2
        cols=np.maximum(indices,0)
        for matrix in (self.corpus.measured,self.corpus.positive,self.corpus.negative):
            value=np.asarray(weights @ matrix[order][:,cols]).ravel()/max(float(weights.sum()),1e-8)
            value[~valid]=0
            columns.append(value)
        for category in CATEGORIES:
            columns.append(np.full(len(candidates),context.get("cleaned_phenotype")==category,np.float32))
        columns.append(np.full(len(candidates),context.get("screen_type")=="positive selection",np.float32))
        result=np.column_stack(columns).astype(np.float32)
        if not np.isfinite(result).all():raise ArithmeticError("nonfinite historical features")
        if len(self._feature_cache) >= 2048:
            self._feature_cache.clear()
        self._feature_cache[cache_key] = result.copy()
        return result


def expert_features(rankings: Mapping[str, Sequence[str]], extra: Sequence[str] = ()):
    if set(rankings)!=set(EXPERTS):raise ValueError("every declared expert is required")
    cleaned={}
    for expert in EXPERTS:
        values=rankings[expert]
        if not isinstance(values,(list,tuple)) or not values or any(not isinstance(g,str) or not g.strip() for g in values):
            raise ValueError(f"invalid external ranking {expert}")
        # Each source contributes at most its original first 100 slots. No target-aware backfill.
        cleaned[expert]=list(dict.fromkeys(values[:100]))
    genes=sorted(set(extra).union(*(set(v) for v in cleaned.values())))
    lookup={g:i for i,g in enumerate(genes)}
    ranks=np.full((len(genes),len(EXPERTS)),1000,np.float32)
    for j,expert in enumerate(EXPERTS):
        for r,g in enumerate(cleaned[expert],1):ranks[lookup[g],j]=r
    present=ranks<1000
    rrf=np.where(present,1/(60+ranks),0)
    features=np.column_stack([rrf, present.astype(np.float32), (ranks<=10).astype(np.float32),
                             rrf.sum(axis=1),present.sum(axis=1),1/(10+ranks.min(axis=1))]).astype(np.float32)
    return genes,features


def reciprocal_rank(rankings, k=100, constant=60.0):
    if constant<0 or not np.isfinite(constant):raise ValueError("invalid rank constant")
    genes, features=expert_features(rankings)
    if constant==60:
        values=features[:,:len(EXPERTS)].sum(axis=1)
    else:
        values=np.zeros(len(genes));lookup={g:i for i,g in enumerate(genes)}
        for source in rankings.values():
            for rank,gene in enumerate(dict.fromkeys(source[:100]),1):values[lookup[gene]]+=1/(constant+rank)
    return [genes[i] for i in np.argsort(-values,kind="stable")[:k]]


class ContextRanker:
    """Small learned reranker; fitting and inference are explicitly separate."""
    def __init__(self, objective="regression", history=True, augment=False, coverage=False,
                 leaves=15, rounds=120, seed=20260928):
        if objective not in {"regression","lambdarank"}:raise ValueError("unsupported objective")
        self.objective,self.history,self.augment,self.coverage=objective,history,augment,coverage
        self.leaves,self.rounds,self.seed=leaves,rounds,seed

    def features(self, context, rankings, corpus):
        extras=corpus.rank(context) if self.augment else []
        genes,x=expert_features(rankings,extras)
        if self.history:x=np.column_stack([x,corpus.feature_matrix(context,genes)])
        return genes,x

    def fit(self, training, expert_predictions, corpus):
        import lightgbm as lgb
        xs,ys,ms,groups,weights=[],[],[],[],[]
        publications=Counter(str(s['source_id']) for s in training)
        for screen in training:
            name=str(screen['dataset_name']);context=ScreenContext.from_record(screen)
            genes,x=self.features(context,{e:expert_predictions[e][name] for e in EXPERTS},corpus)
            truth=dict(zip(screen['relevance_genes'],screen['relevance_scores']))
            measured=np.array([g in truth for g in genes])
            y=np.array([truth.get(g,0) for g in genes],np.float32)
            xs.append(x);ys.append(y);ms.append(measured);groups.append(len(genes))
            weights.append(np.full(len(genes),1/(publications[str(screen['source_id'])]*len(genes))))
        x=np.vstack(xs);y=np.concatenate(ys);measured=np.concatenate(ms);weight=np.concatenate(weights)
        weight*=len(weight)/weight.sum()
        params=dict(n_estimators=self.rounds,num_leaves=self.leaves,learning_rate=.05,min_child_samples=100,
                    reg_lambda=10,verbosity=-1,n_jobs=2,random_state=self.seed,deterministic=True,
                    force_col_wise=True,subsample=1.0,colsample_bytree=1.0,bin_construct_sample_cnt=len(y)+1)
        self.training_sources=frozenset(str(s['source_id']).strip().lower() for s in training)
        self.feature_count=x.shape[1]
        if self.objective=='regression':
            self.model=lgb.LGBMRegressor(**params)
            self.model.fit(x[measured],y[measured],sample_weight=weight[measured])
        else:
            # Positive grades only. Opposite effects are zero-gain; signed regression is the direction-aware ablation.
            graded=np.ceil(np.maximum(y[measured],0)*10).astype(int)
            measured_groups=[int(m.sum()) for m in ms]
            keep=np.concatenate([np.full(n,n>0) for n in measured_groups])
            self.model=lgb.LGBMRanker(**params,label_gain=list(range(11)),lambdarank_truncation_level=110)
            self.model.fit(x[measured][keep],graded[keep],group=[n for n in measured_groups if n],sample_weight=weight[measured][keep])
        self.coverage_model=None
        if self.coverage:
            if len(np.unique(measured))<2:raise ValueError("measurement propensity requires both observed and missing examples")
            self.coverage_model=lgb.LGBMClassifier(**params)
            self.coverage_model.fit(x,measured.astype(int),sample_weight=weight)
        self.fit_diagnostics={'candidate_rows':len(y),'observed_rows':int(measured.sum()),'features':x.shape[1],
                              'unmeasured_in_hit_loss':False,'training_publications':len(publications)}
        return self

    def rank(self, context, rankings, corpus, k=100):
        if context.source_id in self.training_sources:raise ValueError("fitted training publication cannot be an independent query")
        genes,x=self.features(context,rankings,corpus)
        values=self.model.predict(x)
        if self.coverage_model is not None:
            probability=self.coverage_model.predict_proba(x)[:,1]
            # Signed expected utility. This is assay-measurement propensity, never validation probability.
            values=values*probability
        if not np.isfinite(values).all():raise ArithmeticError("nonfinite learned utility")
        return [genes[i] for i in np.argsort(-values,kind='stable')[:k]]

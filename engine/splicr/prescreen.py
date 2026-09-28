"""Inductive historical screen prediction with an explicit metadata boundary.

Scores are ranking evidence, not probabilities of independent validation.
No benchmark caches, target libraries, external knowledge, or APIs are used.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Sequence

import numpy as np
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer


FIELDS = ("cell_line", "cell_type", "phenotype", "cleaned_phenotype",
          "library_methodology", "screen_type", "library_type",
          "experimental_setup", "condition_name", "condition_dosage",
          "duration", "condition_clause")


def clean(value: Any) -> str:
    value = "" if value is None else str(value).strip().lower()
    return "" if value in {"none", "nan", "unknown", "not specified", "n/a"} else value


@dataclass(frozen=True)
class ScreenContext:
    """Only pre-experimental fields survive construction from a dataset row.

    source_id is used solely to exclude related donors, never as a predictor.
    Post hoc notes, significance/ranking rationales, and all measurements are
    intentionally absent. A library can be supplied separately for a declared
    library-aware experiment.
    """
    values: tuple[tuple[str, str], ...]
    source_id: str = ""

    def __post_init__(self):
        keys = [key for key, _ in self.values]
        if len(set(keys)) != len(keys) or any(key not in FIELDS for key in keys):
            raise ValueError("context contains duplicate or forbidden fields")
        if any(not isinstance(value, str) for _, value in self.values):
            raise ValueError("context values must be strings")
        object.__setattr__(self, "values", tuple((key, clean(value)) for key, value in self.values))
        object.__setattr__(self, "source_id", clean(self.source_id))

    @classmethod
    def from_record(cls, record: Mapping[str, Any]) -> "ScreenContext":
        return cls(tuple((field, clean(record.get(field))) for field in FIELDS),
                   clean(record.get("source_id")))

    def get(self, key: str) -> str:
        return dict(self.values).get(key, "")

    def text(self) -> str:
        return " ".join(value for _, value in self.values if value)


@dataclass(frozen=True)
class PriorConfig:
    study_balance: bool = False
    hierarchy: str = "phenotype"
    shrinkage: float = 0.0
    negative_weight: float = 0.0
    retrieval_weight: float = 0.0
    retrieval_k: int = 25
    retrieval_power: float = 3.0

    def __post_init__(self):
        if self.hierarchy not in {"global", "phenotype", "direction", "condition"}:
            raise ValueError("invalid hierarchy")
        if any(not np.isfinite(v) or v < 0 for v in
               (self.shrinkage, self.negative_weight, self.retrieval_weight)):
            raise ValueError("weights must be finite and nonnegative")
        if (self.retrieval_weight > 1 or not isinstance(self.retrieval_k, int)
                or self.retrieval_k < 1 or not np.isfinite(self.retrieval_power)
                or self.retrieval_power <= 0):
            raise ValueError("invalid retrieval parameters")


class HistoricalRanker:
    """Measured-denominator empirical Bayes with optional text transfer.

    Study balancing gives each publication one unit of donor mass, avoiding
    large multi-condition papers silently defining the prior. Shrinkage units
    are studies when balanced, screens otherwise. Missing genes contribute
    neither a negative label nor an exposure. Exact signed labels are used to
    distinguish desired-direction hits from opposite-direction hits.
    """
    def __init__(self, config: PriorConfig = PriorConfig()):
        self.config = config
        self.fitted = False

    def fit(self, screens: Sequence[Mapping[str, Any]]) -> "HistoricalRanker":
        if not screens:
            raise ValueError("training screens are empty")
        contexts = [ScreenContext.from_record(s) for s in screens]
        self.genes = np.array(sorted({str(g) for s in screens for g in s["relevance_genes"]}))
        lookup = {g: i for i, g in enumerate(self.genes)}
        indices, pos, neg, ptr = [], [], [], [0]
        identities = []
        for s in screens:
            genes, rel = s["relevance_genes"], s["relevance_scores"]
            if len(genes) != len(rel) or len(set(genes)) != len(genes):
                raise ValueError("training gene/relevance alignment or uniqueness error")
            rel = np.asarray(rel, dtype=np.float32)
            if not np.all(np.isfinite(rel)):
                raise ValueError("nonfinite training relevance")
            indices.extend(lookup[str(g)] for g in genes)
            pos.extend((rel > 0).astype(np.float32))
            neg.extend((rel < 0).astype(np.float32))
            ptr.append(len(indices))
            identities.append(str(s["dataset_name"]))
        if len(set(identities)) != len(identities):
            raise ValueError("duplicate training screen IDs")
        idx = np.asarray(indices, dtype=np.int32)
        ptr = np.asarray(ptr, dtype=np.int32)
        shape = (len(screens), len(self.genes))
        self.measured = sparse.csr_matrix((np.ones(len(idx), np.float32), idx, ptr), shape=shape)
        # eliminate_zeros mutates index buffers: each matrix must own its copy.
        self.positive = sparse.csr_matrix((np.asarray(pos, np.float32), idx.copy(), ptr.copy()), shape=shape)
        self.negative = sparse.csr_matrix((np.asarray(neg, np.float32), idx.copy(), ptr.copy()), shape=shape)
        self.positive.eliminate_zeros(); self.negative.eliminate_zeros()
        self.contexts = contexts
        self.publications = np.array([c.source_id or "missing:" + i for c, i in zip(contexts, identities)])
        counts = Counter(self.publications)
        self.study_weights = np.array([1 / counts[p] for p in self.publications], np.float32)
        self.values = {field: np.array([c.get(field) for c in contexts]) for field in FIELDS}
        self.vectorizer = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True,
                                          max_features=20000, dtype=np.float32)
        self.documents = self.vectorizer.fit_transform([c.text() or "unspecified" for c in contexts])
        self.training_ids = tuple(identities)
        self._cache: dict[tuple, np.ndarray] = {}
        self.fitted = True
        return self

    def _rate(self, weights: np.ndarray, parent: np.ndarray | float,
              shrink: float) -> np.ndarray:
        n = np.asarray(weights @ self.measured).ravel()
        h = np.asarray(weights @ self.positive).ravel()
        neg = np.asarray(weights @ self.negative).ravel()
        numerator = h - self.config.negative_weight * neg + shrink * parent
        # No evidence means zero with no shrinkage; no fabricated evidence.
        return np.divide(numerator, n + shrink, out=np.zeros_like(n), where=(n + shrink) > 0)

    def scores(self, context: ScreenContext) -> np.ndarray:
        if not self.fitted:
            raise RuntimeError("fit must be called before prediction")
        if not isinstance(context, ScreenContext):
            raise TypeError("prediction requires a ScreenContext, never a labeled record")
        cfg = self.config
        weights = self.study_weights.copy() if cfg.study_balance else np.ones(len(self.contexts), np.float32)
        if context.source_id:
            weights[self.publications == context.source_id] = 0
        if not np.any(weights):
            raise ValueError("no independent donor publications remain")
        fields = []
        if cfg.hierarchy != "global":
            fields.append("cleaned_phenotype")
        if cfg.hierarchy in {"direction", "condition"}:
            fields.extend(("screen_type", "library_methodology"))
        if cfg.hierarchy == "condition":
            fields.append("condition_name")
        excluded = context.source_id if context.source_id in self.publications else ""
        key = (cfg, excluded, tuple((f, context.get(f)) for f in fields))
        if key in self._cache:
            prior = self._cache[key].copy()
        else:
            prior = self._rate(weights, 0.0, 0.0)
            subset = weights.copy()
            for field in fields:
                value = context.get(field)
                if not value:
                    continue
                subset = subset * (self.values[field] == value)
                if not np.any(subset):
                    break
                prior = self._rate(subset, prior, cfg.shrinkage)
            # Bounded cache avoids retaining every query of a long-lived server.
            if len(self._cache) >= 256:
                self._cache.clear()
            self._cache[key] = prior.copy()
        if cfg.retrieval_weight:
            sim = (self.vectorizer.transform([context.text()]) @ self.documents.T).toarray()[0]
            # Keep transfer direction/modality coherent when those are known.
            for field in ("screen_type", "library_methodology"):
                if context.get(field):
                    sim *= self.values[field] == context.get(field)
            sim *= weights > 0
            order = np.argsort(-sim, kind="stable")[:cfg.retrieval_k]
            local = np.zeros_like(weights)
            local[order] = weights[order] * np.maximum(sim[order], 0) ** cfg.retrieval_power
            transfer = self._rate(local, prior, max(cfg.shrinkage, 1.0))
            prior = (1 - cfg.retrieval_weight) * prior + cfg.retrieval_weight * transfer
        if not np.all(np.isfinite(prior)):
            raise ArithmeticError("nonfinite prediction")
        return prior

    def rank(self, context: ScreenContext, k: int = 100,
             candidate_genes: Sequence[str] | None = None) -> list[str]:
        if k < 1:
            raise ValueError("k must be positive")
        values = self.scores(context)
        idx = np.arange(len(self.genes))
        if candidate_genes is not None:
            # Explicit additional input, never extracted from target labels.
            idx = idx[np.isin(self.genes, list(candidate_genes))]
        order = idx[np.argsort(-values[idx], kind="stable")[:k]]
        return self.genes[order].tolist()

    def specification(self) -> dict[str, Any]:
        return {"config": asdict(self.config), "fields": FIELDS,
                "n_training_screens": len(self.training_ids),
                "n_publications": len(set(self.publications)),
                "n_genes": len(self.genes), "score_type": "uncalibrated ranking evidence"}


class TextResidualRanker:
    """Regularized multi-output text regression over historical hit residuals.

    Unassayed cells are imputed with the gene prior (zero residual), not labeled
    non-hits. This is an explicit shrinkage approximation, not an unbiased
    missing-data likelihood. Publication overlap is rejected, because a fitted
    regression cannot subtract a donor publication at inference time.
    """
    def __init__(self, alpha: float = 10.0, prior_strength: float = 10.0):
        if not np.isfinite(alpha) or alpha <= 0 or not np.isfinite(prior_strength) or prior_strength < 0:
            raise ValueError("finite positive alpha and nonnegative prior_strength required")
        self.alpha, self.prior_strength = alpha, prior_strength

    def fit_corpus(self, corpus: HistoricalRanker) -> "TextResidualRanker":
        from scipy.linalg import cho_factor, cho_solve

        self.corpus = corpus
        observed = np.asarray(corpus.measured.sum(axis=0)).ravel()
        hits = np.asarray(corpus.positive.sum(axis=0)).ravel()
        pooled = hits.sum() / observed.sum()
        self.prior = (hits + self.prior_strength * pooled) / (observed + self.prior_strength)
        residual = corpus.positive.toarray() - corpus.measured.multiply(self.prior).toarray()
        kernel = (corpus.documents @ corpus.documents.T).toarray()
        # Each study contributes one unit of fitting weight.
        scale = np.sqrt(corpus.study_weights)
        kernel *= scale[:, None] * scale[None, :]
        kernel.flat[::len(kernel) + 1] += self.alpha
        self.coef = cho_solve(cho_factor(kernel, lower=True, check_finite=True),
                             residual * scale[:, None], check_finite=True)
        self.coef *= scale[:, None]
        return self

    def rank(self, context: ScreenContext, k: int = 100,
             candidate_genes: Sequence[str] | None = None) -> list[str]:
        if not isinstance(context, ScreenContext):
            raise TypeError("prediction requires ScreenContext")
        if context.source_id and context.source_id in self.corpus.publications:
            raise ValueError("regression prediction publication overlaps training")
        if k < 1:
            raise ValueError("k must be positive")
        similarity = (self.corpus.vectorizer.transform([context.text()]) @ self.corpus.documents.T).toarray()[0]
        scores = self.prior + similarity @ self.coef
        if not np.isfinite(scores).all():
            raise ArithmeticError("nonfinite regression predictions")
        idx = np.arange(len(scores))
        if candidate_genes is not None:
            idx = idx[np.isin(self.corpus.genes, list(candidate_genes))]
        return self.corpus.genes[idx[np.argsort(-scores[idx], kind="stable")[:k]]].tolist()

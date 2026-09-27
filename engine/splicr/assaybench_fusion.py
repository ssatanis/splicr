"""SplicR's AssayBench estimator: the screen atlas fused with model consensus.

What this is
------------
A scorer for the Genentech AssayBench task -- rank a screen's gene library by
how likely each gene is to be a hit, from the screen's *description alone*.  It
is built out of four kinds of evidence, combined by weights that are fitted with
publication-grouped cross-validation on pre-2022 screens and never on the split
being scored:

1. **Conditional hit-rate counters** over the pre-2022 screen atlas, stratified
   by observable metadata -- phenotype category, selection direction, library
   methodology, cell line, and extracted entities (pathogen, compound,
   cytokine).  Every counter is a row-subset sum of one sparse screen x gene
   matrix, and the query screen's own publication is subtracted from the sum, so
   leave-one-publication-out is exact rather than approximate.

2. **Pseudo-label screen retrieval.**  The published model lists give a
   label-free guess at the query's hit set; a donor screen whose *measured* hits
   resemble that guess is a donor worth copying from.  Similarity is IDF-weighted
   cosine, so common essentials -- which every fitness screen shares -- stop
   dominating and screen-specific biology decides the neighbours.

3. **Model consensus, over a cross-validated subset.**  Reciprocal-rank fusion
   over the strongest published systems.  How many enter the pool is chosen by
   publication-grouped cross-validation on pre-2022 screens, which picks five;
   pooling all sixteen scores materially worse, because the weak models
   outvote the strong ones.  The extra sampling runs that some files ship were
   extracted and measured too (:func:`load_runs`), and they are a **negative
   result** on this split: the five models cross-validation selects ship one run
   each here, and the models that do ship five runs are the weak ones, so
   folding their runs in lowers the score rather than raising it.

4. **Dated knowledge**: pharmacology (which protein a small molecule binds),
   pathway and complex membership, and cell-line-independent DepMap summaries.

What it is not
--------------
It does not read any label from the split it scores, and
:mod:`splicr.orcs_safe` refuses the ORCS records behind the validation and test
screens at the point of read.  The two ``fewshot`` published systems are
excluded from anything fitted here: their few-shot examples are retrieved by
kNN over the *training* split, so their train-split predictions were made with
train labels in hand (they score 0.98 there), and a weight fitted against that
would be chasing a leak.

The ranking discipline that is worth more than any single channel
-----------------------------------------------------------------
The metric truncates to ``k`` *before* dropping genes the screen did not
measure, so a gene outside the screen's own library burns a rank slot.  Every
prediction here is therefore normalised, deduped, restricted to the screen's own
library, densified and padded to exactly 100 real candidates.  Applied to the
published systems that same post-processing is worth about +0.056 AnDCG@100
each -- see ``docs/08-assaybench-headroom.md``.

Reproducing the published numbers
---------------------------------
``engine/analysis/assaybench_fusion/`` holds the measurement scripts, including
the two diagnostics that fit weights on test on purpose in order to bound what
the channel set can express, and the split-half experiment that shows most of
the published oracle row is a selection maximum rather than transferable signal.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

import numpy as np

from . import benchmark as bm

HERE = os.path.dirname(os.path.abspath(__file__))
WEIGHTS = os.path.join(HERE, "_assaybench_fusion_weights.json")

#: Published model lists entering the per-run consensus, in the order the
#: cross-validation ranked them.  How many are used is ``FusionConfig.n_models``.
CONSENSUS_ORDER: tuple[str, ...] = (
    "gemini-3-pro", "gemini-3.1-pro", "gpt-5.4", "gemini-3-flash",
    "gepa/gemini-3-flash", "gpt-5-mini", "gpt-5.2", "claude-opus-4.5",
    "claude-sonnet-4.5", "gpt-oss-120b", "GLM-5", "Kimi-K2.5",
    "biomni-a1-claude-4", "qwen3.5-397b-a17b", "qwen3-235b-a22b-2507",
    "deepseek-v3.2",
)

#: Never fitted against: few-shot examples retrieved by kNN over the train
#: split, so the train-split predictions saw train labels.
LEAKY_SYSTEMS: frozenset[str] = frozenset({
    "fewshot/gemini-3-pro-fewshot-knn10",
    "fewshot/gemini-3-flash-fewshot-knn10",
})


@dataclass
class FusionConfig:
    """Every free parameter, with the procedure that fixed it.

    Attributes:
        n_models: how many published systems enter the per-run consensus.
            Chosen by publication-grouped CV on the 1567 pre-2022 screens.
        rrf_c: reciprocal-rank constant for the consensus.
        idf_pow: exponent on the IDF weights in the retrieval similarity.
        retr_k / retr_power / retr_m: donor count, similarity sharpening and
            shrinkage pseudo-count for the retrieval transfer.
        m_global / m_field: Beta pseudo-counts for the global and stratified
            counters.
        per_category: fit one weight vector per ``cleaned_phenotype``.
        shrink: how far a per-category weight vector is pulled back to the
            global one.
        weights: channel -> weight, or category -> {channel -> weight}.
    """

    n_models: int = 5
    rrf_c: float = 10.0
    idf_pow: float = 1.0
    retr_k: int = 25
    retr_power: float = 3.0
    retr_m: float = 8.0
    m_global: float = 20.0
    m_field: float = 8.0
    per_category: bool = True
    shrink: float = 0.0
    weights: dict = field(default_factory=dict)

    @classmethod
    def load(cls, path: str = WEIGHTS) -> "FusionConfig":
        with open(path) as fh:
            d = json.load(fh)
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})

    def save(self, path: str = WEIGHTS) -> None:
        with open(path, "w") as fh:
            json.dump(self.__dict__, fh, indent=1, sort_keys=True)

    @property
    def models(self) -> tuple[str, ...]:
        return tuple(m for m in CONSENSUS_ORDER if m not in LEAKY_SYSTEMS)[: self.n_models]


def densify(
    genes: Sequence[str],
    screen: Mapping[str, Any],
    andcg: bm.AnDCG,
    pad_order: Sequence[str] | None = None,
    k: int = 100,
) -> list[str]:
    """Normalise, dedupe, keep the screen's own library, and pad to ``k``.

    The metric drops a gene the screen did not measure only *after* truncating
    at ``k``, so an out-of-library gene inside the top ``k`` costs a slot that
    can never score.  Dropping those genes promotes the survivors, and padding
    then spends the freed slots on candidates that can score.  Neither half
    helps alone; together they are the single largest effect in this file.

    Args:
        genes: the ranked prediction, best first.
        screen: the screen record, for its ``relevance_genes``.
        andcg: the metric instance, for symbol normalisation.
        pad_order: candidates used to fill the freed slots, best first.
        k: how many entries to emit.

    Returns:
        At most ``k`` normalised symbols, all of them measured by this screen.
    """
    library = {andcg.normalize(g) for g in screen["relevance_genes"]}
    out: list[str] = []
    seen: set[str] = set()
    for g in genes:
        n = andcg.normalize(g)
        if n in seen or n not in library:
            continue
        seen.add(n)
        out.append(n)
        if len(out) >= k:
            return out
    for g in pad_order or ():
        n = andcg.normalize(g)
        if n in seen or n not in library:
            continue
        seen.add(n)
        out.append(n)
        if len(out) >= k:
            break
    return out


class DensifiedScorer(bm.Scorer):
    """Wraps any scorer with the ranked-list hygiene in :func:`densify`.

    Applied to the published systems this is worth roughly +0.056 AnDCG@100
    each, with no new signal of any kind, which is why every comparison in
    ``data/references/assaybench/RESULTS.md`` reports both the shipped and the
    densified number.
    """

    def __init__(self, inner: bm.Scorer, pad: bm.Scorer | None = None,
                 andcg: bm.AnDCG | None = None, k: int = 100) -> None:
        self.inner = inner
        self.pad = pad
        self.andcg = andcg or bm.AnDCG(k=k)
        self.k = k
        self.is_oracle = getattr(inner, "is_oracle", False)

    @property
    def name(self) -> str:  # type: ignore[override]
        return f"densified[{self.inner.name}]"

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "DensifiedScorer":
        self.inner.fit(train, **kw)
        if self.pad is not None:
            self.pad.fit(train, **kw)
        return self

    def rank(self, screen: Mapping[str, Any]) -> list[str] | None:
        got = self.inner.rank(screen)
        if got is None:
            return None
        pad = self.pad.rank(screen) if self.pad is not None else None
        return densify(got, screen, self.andcg, pad, self.k)


# --------------------------------------------------------------------------- #
# Per-run consensus over the published prediction files
# --------------------------------------------------------------------------- #

PREDICTIONS_ROOT = os.path.join(
    os.path.dirname(HERE), ".tools", "assaybench", "benchmarking", "predictions"
)


def _as_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if not isinstance(value, str):
        return []
    import ast

    try:
        out = ast.literal_eval(value)
    except Exception:
        return [x.strip(" '\"") for x in value.strip("[]").split(",") if x.strip(" '\"")]
    return out if isinstance(out, list) else []


def load_runs(
    models: Iterable[str],
    root: str = PREDICTIONS_ROOT,
    split: str | None = None,
) -> dict[str, dict[str, list[list[str]]]]:
    """Read every sampling run from the vendored prediction files.

    The published leaderboard scores one aggregated list per screen; some files
    also carry the individual runs behind it.  On the ``yearfold0`` split that is
    the weaker half of the pool -- ``gpt-oss-120b``, ``GLM-5``, ``Kimi-K2.5``,
    the qwen and deepseek families ship five runs each, while every model
    cross-validation actually selects ships one.  The extraction is kept because
    the measurement is worth having and the negative result is worth recording,
    not because it improved anything here.

    Args:
        models: model names as they appear in the files' ``model_name``.
        root: the vendored ``benchmarking/predictions`` directory.
        split: keep only records from this split (``"test"``, ``"train"``, ...).

    Returns:
        ``{model: {dataset_name: [run, run, ...]}}``, symbols exactly as shipped.
    """
    import glob

    want = set(models)
    out: dict[str, dict[str, list[list[str]]]] = {}
    for path in sorted(glob.glob(os.path.join(root, "*", "*.json"))):
        with open(path) as fh:
            doc = json.load(fh)
        model = doc.get("model_name")
        if model not in want:
            continue
        per: dict[str, list[list[str]]] = {}
        for _, recs in doc.get("records_by_dataset", {}).items():
            for rec in (recs if isinstance(recs, list) else [recs]):
                if rec.get("split_layout") != "year":
                    continue
                if split is not None and rec.get("split") != split:
                    continue
                runs = _as_list(rec.get("prediction_runs"))
                if runs and not isinstance(runs[0], list):
                    runs = [runs]
                if not runs:
                    runs = [_as_list(rec.get("predicted_genes"))]
                runs = [[g for g in r if isinstance(g, str) and g.strip()] for r in runs]
                runs = [r for r in runs if r]
                if runs:
                    per[str(rec["dataset_name"])] = runs
        if per:
            out[model] = per
    return out


class ConsensusScorer(bm.Scorer):
    """Per-run reciprocal-rank consensus over published model predictions.

    For a gene ``g``::

        score(g) = sum over models m, runs r of  1 / (c + rank_{m,r}(g)) / n_runs(m)

    Genes no model named score 0 and are ordered by ``pad``, so wrapping this in
    :class:`DensifiedScorer` produces a full 100-entry in-library ranking.

    This scorer *consumes published predictions*.  It is the analogue of
    upstream's own ``LLM RRF Ensemble`` row, and it inherits that row's caveat:
    the models behind those files have read the publications behind the test
    screens.  ``splicr_atlas`` in
    ``engine/analysis/assaybench_fusion/final_run.py`` is the variant that uses
    no model list at all, and it is the one to compare against the non-LLM
    baselines.

    Args:
        config: which models, and the reciprocal-rank constant.
        split: the split whose records to load.
        pad: scorer supplying the order for genes no model named.
        runs: preloaded ``load_runs`` output, to avoid re-reading the files.
    """

    def __init__(
        self,
        config: FusionConfig | None = None,
        split: str = "test",
        pad: bm.Scorer | None = None,
        runs: Mapping[str, Mapping[str, list[list[str]]]] | None = None,
    ) -> None:
        self.config = config or FusionConfig()
        self.split = split
        self.pad = pad
        self._runs = runs if runs is not None else load_runs(self.config.models, split=split)

    @property
    def name(self) -> str:  # type: ignore[override]
        return f"splicr_consensus[n_models={self.config.n_models}]"

    def fit(self, train: Sequence[Mapping[str, Any]], **kw: Any) -> "ConsensusScorer":
        if self.pad is not None:
            self.pad.fit(train, **kw)
        return self

    def scores(self, screen: Mapping[str, Any]) -> dict[str, float]:
        """Raw consensus weight per named gene, before any library filtering."""
        name = str(screen["dataset_name"])
        c = self.config.rrf_c
        acc: dict[str, float] = {}
        for model in self.config.models:
            runs = self._runs.get(model, {}).get(name)
            if not runs:
                continue
            share = 1.0 / len(runs)
            for run in runs:
                seen: set[str] = set()
                for pos, gene in enumerate(run):
                    key = gene.strip().upper()
                    if key in seen:
                        continue
                    seen.add(key)
                    acc[key] = acc.get(key, 0.0) + share / (c + pos)
        return acc

    def rank(self, screen: Mapping[str, Any]) -> list[str] | None:
        acc = self.scores(screen)
        if not acc:
            return None
        order = sorted(acc, key=lambda g: (-acc[g], g))
        if self.pad is not None:
            tail = self.pad.rank(screen) or []
            order += [g for g in tail]
        return order

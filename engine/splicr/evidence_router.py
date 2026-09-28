"""Transparent phenotype routing with externally supplied expert rankings.

External rankings must be generated independently before target outcomes are
known. This module never retrieves publications or repairs ranks using labels.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Mapping, Sequence

import numpy as np

from .prescreen import ScreenContext


def choose_routes(evaluations: Mapping[str, Sequence[Mapping]], *,
                  default: str = "external", min_publications: int = 3) -> tuple[dict, dict]:
    """Select experts on declared development data; never call on test labels."""
    if default not in evaluations or min_publications < 1:
        raise ValueError("default expert and positive minimum publication count required")
    ids = [str(row["dataset_name"]) for row in evaluations[default]]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("unique nonempty development cohort required")
    reference = evaluations[default]
    for name, rows in evaluations.items():
        if [str(r["dataset_name"]) for r in rows] != ids:
            raise ValueError("experts must have identical ordered development cohorts")
        if any((r["source_id"], r["phenotype"]) != (s["source_id"], s["phenotype"])
               for r, s in zip(rows, reference)):
            raise ValueError("development cohort metadata differs between experts")
    groups = defaultdict(list)
    for i, row in enumerate(reference):
        groups[str(row["phenotype"]).lower()].append(i)
    routes, evidence = {}, {}
    for category, indices in groups.items():
        means = {name: float(np.mean([rows[i]["adjusted_ndcg@100"] for i in indices]))
                 for name, rows in evaluations.items()}
        if not all(np.isfinite(value) for value in means.values()):
            raise ValueError("nonfinite development scores")
        pubs = len({reference[i]["source_id"] for i in indices})
        # Ties keep the default. Small categories cannot fit their own gate.
        choice = default
        if pubs >= min_publications:
            for name, value in means.items():
                if value > means[choice]:
                    choice = name
        routes[category] = choice
        evidence[category] = {"n_screens": len(indices), "n_publications": pubs,
                              "means": means, "selected": choice,
                              "selection_estimate_not_unbiased": True}
    return routes, evidence


class EvidenceRouter:
    def __init__(self, routes: Mapping[str, str], experts: Mapping[str, object], default="external"):
        if default != "external":
            raise ValueError("unknown categories require independently supplied external predictions")
        self.routes = {key.lower(): value for key, value in routes.items()}
        if any(value not in {"external", *experts} for value in self.routes.values()):
            raise ValueError("route names an unavailable expert")
        self.experts, self.default = dict(experts), default

    def rank(self, context: ScreenContext, *, external: Sequence[str] | None = None, k=100) -> list[str]:
        if not isinstance(context, ScreenContext) or k < 1:
            raise ValueError("ScreenContext and positive cutoff required")
        expert = self.routes.get(context.get("cleaned_phenotype"), self.default)
        if expert == "external":
            if external is None or not len(external) or any(not isinstance(g, str) or not g.strip() for g in external):
                raise ValueError("independently generated external ranking required; no fabricated fallback")
            # Preserve the supplied rank budget. Official evaluator maps symbols.
            return list(external[:k])
        return self.experts[expert].rank(context, k=k)

"""Measured reference context without a fallback disguised as an exact match."""
from __future__ import annotations
import math
import hashlib
import json
import numpy as np


def _finite(value):
    return float(value) if value is not None and math.isfinite(float(value)) else None


def summarize_context(resource, gene: str, model_id: str | None, tier: str) -> dict:
    k = resource._gene_pos.get(gene)
    lineage = resource.lineage_of.get(model_id or "", "")
    exact_index = resource._model_pos.get(model_id)
    exact = _finite(resource.effect[exact_index, k]) if k is not None and exact_index is not None else None
    indices = resource._lineage_rows.get(lineage, np.array([], dtype=int))
    # Reference summary excludes the displayed model; don't double count it.
    indices = [int(i) for i in indices if resource.models[int(i)] != model_id]
    lineage_values = resource.effect[indices, k] if k is not None else np.array([])
    lineage_values = lineage_values[np.isfinite(lineage_values)]
    global_values = resource.effect[:, k] if k is not None else np.array([])
    global_values = global_values[np.isfinite(global_values)]
    cn_index = resource._cn_model_pos.get(model_id)
    cn = _finite(resource.copy_number[cn_index, k]) if resource.copy_number is not None and cn_index is not None and k is not None else None
    def aggregate(values):
        return {"n_measured_models": int(len(values)), "median_effect": float(np.median(values)) if len(values) else None,
                "mean_effect": float(np.mean(values)) if len(values) else None,
                "fraction_effect_le_minus_0_5": float((values <= -.5).mean()) if len(values) else None}
    return {"status": "measured" if len(global_values) else "not_measured",
            "gene_effect_release": resource.release, "model_metadata_release": "24Q4",
            "model_id": model_id, "match_tier": tier, "lineage": lineage or None,
            "exact": {"effect": exact, "status": "measured" if exact is not None else "not_measured"},
            "lineage_reference": {**aggregate(lineage_values), "excluded_model": model_id},
            "global_reference": aggregate(global_values),
            "copy_number": {"value": cn, "release": "24Q4", "scale": "relative copy number, linear; not absolute copies or log2",
                            "status": "measured" if cn is not None else "not_measured"},
            "interpretation": "DepMap Chronos gene effects contextualize proliferation dependency. They are not an independent validation assay for this candidate or a test of condition specificity. The -0.5 summary is a descriptive threshold, not an FDR. Related/engineered line matches are labelled; no lineage or global value replaces the exact measurement."}


def context_matrix(genes, cell_line=None, model_id=None, release="24Q4", taxid=9606):
    if taxid != 9606:
        return {g: {"status": "unavailable", "reason": "DepMap reference context is for human cancer models"} for g in genes}
    try:
        from .features.depmap import resource, resolver
        data = resource(release=release, with_copy_number=True, with_dependency=False)
        if model_id:
            if model_id not in resolver().lineage:
                raise ValueError("the specified DepMap model id is absent from the pinned metadata")
            tier = "user_declared_model"
        else:
            model_id, tier = resolver().resolve(cell_line)
        # Fingerprint the loaded numerical references, including cached matrices;
        # a raw CSV checksum alone cannot identify what an old cache actually used.
        identity = {"gene_effect_matrix_sha256": hashlib.sha256(data.effect.tobytes(order="C")).hexdigest(),
                    "matrix_gene_keys_sha256": hashlib.sha256(json.dumps(data.genes).encode()).hexdigest(),
                    "matrix_model_keys_sha256": hashlib.sha256(json.dumps(data.models).encode()).hexdigest(),
                    "lineages_sha256": hashlib.sha256(json.dumps(data.lineage_of,sort_keys=True).encode()).hexdigest(),
                    "copy_number_matrix_sha256": hashlib.sha256(data.copy_number.tobytes(order="C")).hexdigest() if data.copy_number is not None else None,
                    "copy_number_model_keys_sha256": hashlib.sha256(json.dumps(data._cn_model_pos,sort_keys=True).encode()).hexdigest()}
        return {gene: {"reference_identity": identity, **summarize_context(data, gene, model_id, tier), "requested_cell_line": cell_line} for gene in genes}
    except (OSError, ValueError) as exc:
        return {gene: {"status": "unavailable", "release": release, "reason": str(exc)} for gene in genes}

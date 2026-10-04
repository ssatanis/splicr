"""
The evidence vector: named channels, by family, with missing kept missing.

WHY NOT ONE BIG NETWORK

The product's job is not to be right in private. A reader has to be able to see
why the estimate moved, and "the network said so" is not a reason. So the vector
is built from declared families, every feature keeps the field it was read from,
and the hierarchical model in `models` reports a contribution per family. A
gradient-boosted tree is fitted alongside and wins only if it beats the linear
model on held-out laboratories, which is the comparison that matters.

WHY MISSING STAYS MISSING

A gene whose Atlas context was never computed and a gene the Atlas has never
called are different claims. Imputing a zero for the first one teaches the model
that no Atlas evidence means no prior support, which is false, and it is the
same mistake the console's evidence tier exists to avoid.

So every numeric channel carries a companion indicator. The linear model sees
(mean-imputed value, was-missing flag) and can learn a separate intercept shift
for absence; the tree sees NaN and splits on it natively. Neither is told that
absent means zero.

COPY NUMBER IS NOT OPTIONAL

Amplified regions produce lethal CRISPR phenotypes regardless of the targeted
gene's real essentiality, and correction methods remove most of them: the Local
Drop Out and GAM methods in doi:10.1371/journal.pcbi.1006279 report a 70-80%
decrease in false-positive hits in regions of high copy number, cutting guides
with log2(CNA) > 2 and logFC < -0.5 from 98 to 37 in MKN45 and 267 to 38 in
SF268. A validation model that cannot see copy number is predicting partly from
an artefact, so `copy_number` and `cn_corrected` are first-class channels and
the artefact family is never dropped for being sparse.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

import numpy as np

#: The evidence families. Order is fixed because it is printed, and the model's
#: per-family contributions are reported in it.
FAMILIES: tuple[str, ...] = (
    "primary",        # the screen's own statistics for this gene
    "guides",         # whether the guides agree with each other
    "screen_quality", # whether the screen itself was any good
    "artifacts",      # reasons the measurement might not be about the gene
    "context",        # what was screened, and in what
    "independent",    # what other screens say
    "biology",        # paralogs, complexes, redundancy
)

FAMILY_LABEL: dict[str, str] = {
    "primary": "Primary experiment",
    "guides": "Guide consistency",
    "screen_quality": "Screen quality",
    "artifacts": "Artefact evidence",
    "context": "Biological context",
    "independent": "Independent evidence",
    "biology": "Gene biology",
}


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    family: str
    label: str
    #: The field this is read from, named so a reader can go and check it.
    source: str
    kind: str = "numeric"          # 'numeric' | 'binary'
    #: True when absence is itself informative and gets its own indicator.
    indicate_missing: bool = True
    #: Which way more of it is expected to point, for the explanation only.
    #: Never used to constrain a fit.
    expected: str = "unknown"      # 'up' | 'down' | 'unknown'
    note: str = ""


#: The single source of truth for the evidence vector. Adding a feature changes
#: `spec_hash()`, which changes every receipt written afterwards, which is the
#: point: a prediction frozen under one vector cannot be scored as if it had
#: been made under another.
FEATURE_SPEC: tuple[FeatureSpec, ...] = (
    # --- primary experiment ---------------------------------------------
    FeatureSpec("effect_size", "primary", "Effect size (log2 fold change)",
                "hits.lfc", expected="down",
                note="Signed. The direction channel carries which way is good."),
    FeatureSpec("abs_effect_size", "primary", "Effect magnitude", "abs(hits.lfc)",
                expected="up"),
    FeatureSpec("neg_log10_fdr", "primary", "Significance (-log10 q)", "hits.fdr",
                expected="up"),
    FeatureSpec("neg_log10_p", "primary", "Significance (-log10 p)", "hits.p_value",
                expected="up"),
    FeatureSpec("bayes_factor", "primary", "BAGEL2 Bayes factor", "hits.bayes_factor",
                expected="up"),
    FeatureSpec("drugz_norm_z", "primary", "DrugZ normalised Z", "hits.norm_z"),
    FeatureSpec("stat_rank_pct", "primary", "Rank among scored genes (percentile)",
                "hits.stat_rank", expected="down"),
    FeatureSpec("direction_depleted", "primary", "Called depleted", "hits.direction",
                kind="binary", indicate_missing=False),
    FeatureSpec("n_guides", "primary", "Guides targeting the gene", "hits.n_guides"),
    FeatureSpec("n_good_guides", "primary", "Guides MAGeCK counted as good",
                "hits.n_good_guides", expected="up"),

    # --- guide consistency ----------------------------------------------
    FeatureSpec("guide_agreement", "guides", "Share of guides agreeing on direction",
                "hits.guide_lfcs", expected="up"),
    FeatureSpec("guide_dispersion", "guides", "Spread of per-guide effects",
                "hits.guide_lfcs", expected="down"),
    FeatureSpec("max_guide_share", "guides", "Share of signal from the strongest guide",
                "hits.max_guide_share", expected="down",
                note="One guide carrying the call is the classic off-target signature."),
    FeatureSpec("loo_stability", "guides", "Call survives dropping any one guide",
                "gene_disagreement.loo", kind="binary", expected="up"),
    FeatureSpec("guide_efficacy_mean", "guides", "Mean predicted guide efficacy",
                "guide_effects.efficacy", expected="up"),
    FeatureSpec("offtarget_guides", "guides", "Guides with recorded off-target sites",
                "guide_effects.offtarget", expected="down"),

    # --- screen quality --------------------------------------------------
    FeatureSpec("replicate_r", "screen_quality", "Median replicate correlation",
                "run_qc.median_replicate_r", expected="up"),
    FeatureSpec("mapped_frac", "screen_quality", "Reads mapping to the library",
                "sample_qc.mapped_frac", expected="up"),
    FeatureSpec("library_match_rate", "screen_quality", "Library representation",
                "run_qc.library_match_rate", expected="up"),
    FeatureSpec("nnmd", "screen_quality", "Essential/nonessential separation (NNMD)",
                "run_qc.nnmd", expected="down",
                note="More negative is better separation; the pass bar is -1.25."),
    FeatureSpec("auroc_essentials", "screen_quality", "Essential-gene AUROC",
                "run_qc.auroc", expected="up"),
    FeatureSpec("bottlenecked", "screen_quality", "Any bottlenecked replicate",
                "run_qc.bottlenecked_samples", kind="binary", expected="down"),
    FeatureSpec("qc_pass", "screen_quality", "Screen-level QC verdict passed",
                "run_qc.verdict", kind="binary", expected="up"),

    # --- artefacts -------------------------------------------------------
    FeatureSpec("copy_number", "artifacts", "Copy number at the locus",
                "artifacts.copy_number", expected="down",
                note="Amplified regions deplete regardless of essentiality; "
                     "doi:10.1371/journal.pcbi.1006279."),
    FeatureSpec("cn_corrected", "artifacts", "Copy-number correction applied",
                "hits.cn_corrected", kind="binary", indicate_missing=False,
                expected="up"),
    FeatureSpec("flag_copy_number_cluster", "artifacts", "Copy-number cluster flag",
                "hit_flags", kind="binary", indicate_missing=False, expected="down"),
    FeatureSpec("flag_multi_gene_guide", "artifacts", "Guide targets more than one gene",
                "hit_flags", kind="binary", indicate_missing=False, expected="down"),
    FeatureSpec("flag_promiscuous_guide", "artifacts", "Promiscuous guide flag",
                "hit_flags", kind="binary", indicate_missing=False, expected="down"),
    FeatureSpec("flag_single_guide", "artifacts", "One guide carried the signal",
                "hit_flags", kind="binary", indicate_missing=False, expected="down"),
    FeatureSpec("flag_frequent_hitter", "artifacts", "Frequent hitter flag",
                "hit_flags", kind="binary", indicate_missing=False, expected="down"),
    FeatureSpec("n_mechanism_flags", "artifacts", "Mechanism flags raised",
                "hit_flags", expected="down"),

    # --- context ---------------------------------------------------------
    FeatureSpec("expression_tpm", "context", "Target expression in the model",
                "context.expression_tpm", expected="up",
                note="A dependency on a gene that is not expressed is a red flag."),
    FeatureSpec("expressed", "context", "Target detectably expressed",
                "context.expressed", kind="binary", expected="up"),
    FeatureSpec("mutated", "context", "Target mutated in the model",
                "context.mutated", kind="binary"),
    FeatureSpec("is_organoid", "context", "Screened in an organoid",
                "context.model_type", kind="binary", indicate_missing=False),
    FeatureSpec("is_in_vivo", "context", "Screened in vivo",
                "context.model_type", kind="binary", indicate_missing=False),
    FeatureSpec("under_treatment", "context", "Screened under a compound",
                "context.treatment", kind="binary", indicate_missing=False),

    # --- independent evidence --------------------------------------------
    FeatureSpec("atlas_hit_rate", "independent", "Share of Atlas screens calling it",
                "hits.atlas_hit_rate",
                note="High is ambiguous: a gene called in a third of all screens "
                     "is reproducible and uninformative."),
    FeatureSpec("atlas_screen_count", "independent", "Atlas screens that measured it",
                "hits.atlas_screen_count", expected="up"),
    FeatureSpec("n_independent_screens", "independent",
                "Independent screens calling it in a similar context",
                "atlas.comparable", expected="up"),
    FeatureSpec("n_independent_labs", "independent",
                "Distinct laboratories calling it", "atlas.comparable", expected="up"),
    FeatureSpec("context_similarity", "independent",
                "Similarity of those screens to this one", "run_neighbors.similarity",
                expected="up"),
    FeatureSpec("direction_agreement", "independent",
                "Share of those screens agreeing on direction", "atlas.contexts",
                expected="up"),
    FeatureSpec("depmap_common_essential", "independent", "DepMap common essential",
                "depmap.common_essential", kind="binary",
                note="Reproduces almost everywhere and is almost never the "
                     "context-specific dependency anybody wanted."),
    FeatureSpec("depmap_gene_effect", "independent", "DepMap gene effect in this model",
                "depmap.gene_effect", expected="down"),

    # --- biology ---------------------------------------------------------
    FeatureSpec("n_paralogs", "biology", "Close paralogs", "escape.paralogs",
                expected="down"),
    FeatureSpec("max_paralog_identity", "biology", "Identity of the closest paralog",
                "escape.paralogs", expected="down"),
    FeatureSpec("in_complex", "biology", "Member of a known protein complex",
                "biology.complex", kind="binary"),
    FeatureSpec("complex_size", "biology", "Size of that complex", "biology.complex"),
    FeatureSpec("pathway_redundancy", "biology", "Redundancy in the gene's pathway",
                "biology.pathway", expected="down"),
)

FEATURE_NAMES: tuple[str, ...] = tuple(f.name for f in FEATURE_SPEC)
BY_NAME: dict[str, FeatureSpec] = {f.name: f for f in FEATURE_SPEC}

#: Column order of the design matrix: every feature, then one indicator per
#: feature that declares absence informative.
INDICATED: tuple[str, ...] = tuple(f.name for f in FEATURE_SPEC if f.indicate_missing)
COLUMNS: tuple[str, ...] = FEATURE_NAMES + tuple(f"{n}__missing" for n in INDICATED)


def spec_hash() -> str:
    """Hash of the vector definition, pinned into every receipt."""
    payload = [
        {"name": f.name, "family": f.family, "source": f.source, "kind": f.kind,
         "indicate_missing": f.indicate_missing}
        for f in FEATURE_SPEC
    ]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()


def spec_manifest() -> dict:
    return {
        "schema": "splicr.evidence-vector.v1",
        "spec_hash": spec_hash(),
        "n_features": len(FEATURE_SPEC),
        "n_columns": len(COLUMNS),
        "families": {family: [f.name for f in FEATURE_SPEC if f.family == family]
                     for family in FAMILIES},
    }


# ---------------------------------------------------------------------------
# Building one vector
# ---------------------------------------------------------------------------

_MECHANISM_FLAGS = ("copy_number_cluster", "multi_gene_guide", "promiscuous_guide",
                    "single_guide")
_FLAG_FEATURES = {
    "flag_copy_number_cluster": "copy_number_cluster",
    "flag_multi_gene_guide": "multi_gene_guide",
    "flag_promiscuous_guide": "promiscuous_guide",
    "flag_single_guide": "single_guide",
    "flag_frequent_hitter": "frequent_hitter",
}


def _num(value: Any) -> float:
    """A finite float, or NaN. A bool is not a number here."""
    if value is None or isinstance(value, bool):
        return np.nan
    try:
        out = float(value)
    except (TypeError, ValueError):
        return np.nan
    return out if np.isfinite(out) else np.nan


def _bool(value: Any) -> float:
    if value is None:
        return np.nan
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "t", "yes", "y", "1", "pass"):
            return 1.0
        if lowered in ("false", "f", "no", "n", "0", "fail", "warn"):
            return 0.0
        return np.nan
    try:
        return 1.0 if bool(value) else 0.0
    except (TypeError, ValueError):
        return np.nan


def _neg_log10(value: Any) -> float:
    p = _num(value)
    if np.isnan(p) or p < 0 or p > 1:
        return np.nan
    #: A reported 0 is below the tool's resolution, not an infinity. Clamped so
    #: one gene cannot dominate a fit with an unbounded coordinate.
    return float(-np.log10(max(p, 1e-300)))


def _get(record: Mapping[str, Any], *path: str) -> Any:
    node: Any = record
    for key in path:
        if not isinstance(node, Mapping):
            return None
        node = node.get(key)
    return node


def build_vector(candidate: Mapping[str, Any]) -> dict[str, float]:
    """
    One candidate's evidence, as a name -> value mapping with NaN for absent.

    `candidate` is a nested mapping shaped like the pipeline's own report: the
    keys named in each FeatureSpec.source. Every key is optional, because a
    screen that did not run DrugZ has no DrugZ statistic and that is a fact
    about the screen, not a zero.
    """
    v: dict[str, float] = {}
    hit = candidate.get("hit") if isinstance(candidate.get("hit"), Mapping) else candidate
    qc = candidate.get("qc") or {}
    flags = candidate.get("flags")
    flag_set = {str(f) for f in flags} if isinstance(flags, (list, tuple, set)) else None
    ctx = candidate.get("context") or {}
    atlas = candidate.get("atlas") or {}
    depmap = candidate.get("depmap") or {}
    biology = candidate.get("biology") or {}
    guides = candidate.get("guides") or {}

    # primary
    lfc = _num(_get(hit, "lfc"))
    v["effect_size"] = lfc
    v["abs_effect_size"] = abs(lfc) if not np.isnan(lfc) else np.nan
    v["neg_log10_fdr"] = _neg_log10(_get(hit, "fdr"))
    v["neg_log10_p"] = _neg_log10(_get(hit, "p_value"))
    v["bayes_factor"] = _num(_get(hit, "bayes_factor"))
    v["drugz_norm_z"] = _num(_get(hit, "norm_z"))
    rank, n_scored = _num(_get(hit, "stat_rank")), _num(candidate.get("n_genes_scored"))
    v["stat_rank_pct"] = (rank / n_scored if not np.isnan(rank) and n_scored and n_scored > 0
                          else np.nan)
    direction = _get(hit, "direction")
    v["direction_depleted"] = (1.0 if direction == "depleted"
                               else 0.0 if direction == "enriched"
                               else (1.0 if not np.isnan(lfc) and lfc < 0
                                     else 0.0 if not np.isnan(lfc) else np.nan))
    v["n_guides"] = _num(_get(hit, "n_guides"))
    v["n_good_guides"] = _num(_get(hit, "n_good_guides"))

    # guides
    per_guide = _get(hit, "guide_lfcs")
    if isinstance(per_guide, (list, tuple)) and len(per_guide) > 0:
        arr = np.asarray([_num(x) for x in per_guide], dtype=float)
        arr = arr[np.isfinite(arr)]
        if arr.size > 0:
            want_negative = v["direction_depleted"] == 1.0
            agreeing = int((arr < 0).sum() if want_negative else (arr > 0).sum())
            v["guide_agreement"] = agreeing / arr.size
            v["guide_dispersion"] = float(arr.std(ddof=1)) if arr.size > 1 else np.nan
        else:
            v["guide_agreement"] = np.nan
            v["guide_dispersion"] = np.nan
    else:
        good, total = v["n_good_guides"], v["n_guides"]
        v["guide_agreement"] = (good / total if not np.isnan(good) and not np.isnan(total)
                                and total > 0 else np.nan)
        v["guide_dispersion"] = np.nan
    v["max_guide_share"] = _num(_get(hit, "max_guide_share"))
    v["loo_stability"] = _bool(guides.get("loo_stable"))
    v["guide_efficacy_mean"] = _num(guides.get("efficacy_mean"))
    v["offtarget_guides"] = _num(guides.get("offtarget_count"))

    # screen quality
    v["replicate_r"] = _num(qc.get("median_replicate_r"))
    v["mapped_frac"] = _num(qc.get("mapped_frac"))
    v["library_match_rate"] = _num(qc.get("library_match_rate"))
    v["nnmd"] = _num(qc.get("nnmd"))
    v["auroc_essentials"] = _num(qc.get("auroc"))
    bottleneck = qc.get("bottlenecked_samples")
    v["bottlenecked"] = (np.nan if bottleneck is None
                         else 1.0 if _num(bottleneck) > 0 else 0.0)
    verdict = qc.get("verdict")
    v["qc_pass"] = (np.nan if verdict is None else 1.0 if verdict == "pass" else 0.0)

    # artefacts
    v["copy_number"] = _num((candidate.get("artifacts") or {}).get("copy_number"))
    v["cn_corrected"] = _bool(_get(hit, "cn_corrected")) if _get(hit, "cn_corrected") is not None else 0.0
    for name, flag in _FLAG_FEATURES.items():
        v[name] = np.nan if flag_set is None else (1.0 if flag in flag_set else 0.0)
    v["n_mechanism_flags"] = (np.nan if flag_set is None
                              else float(len(flag_set & set(_MECHANISM_FLAGS))))

    # context
    tpm = _num(ctx.get("expression_tpm"))
    v["expression_tpm"] = tpm
    expressed = ctx.get("expressed")
    v["expressed"] = (_bool(expressed) if expressed is not None
                      else (1.0 if not np.isnan(tpm) and tpm >= 1.0
                            else 0.0 if not np.isnan(tpm) else np.nan))
    v["mutated"] = _bool(ctx.get("mutated"))
    model_type = ctx.get("model_type")
    v["is_organoid"] = (np.nan if model_type is None
                        else 1.0 if model_type == "organoid" else 0.0)
    v["is_in_vivo"] = (np.nan if model_type is None
                       else 1.0 if model_type == "in_vivo" else 0.0)
    treatment = ctx.get("treatment")
    v["under_treatment"] = 0.0 if treatment in (None, "", "none") else 1.0

    # independent evidence
    v["atlas_hit_rate"] = _num(_get(hit, "atlas_hit_rate"))
    v["atlas_screen_count"] = _num(_get(hit, "atlas_screen_count"))
    v["n_independent_screens"] = _num(atlas.get("n_independent_screens"))
    v["n_independent_labs"] = _num(atlas.get("n_independent_labs"))
    v["context_similarity"] = _num(atlas.get("context_similarity"))
    v["direction_agreement"] = _num(atlas.get("direction_agreement"))
    v["depmap_common_essential"] = _bool(depmap.get("common_essential"))
    v["depmap_gene_effect"] = _num(depmap.get("gene_effect"))

    # biology
    v["n_paralogs"] = _num(biology.get("n_paralogs"))
    v["max_paralog_identity"] = _num(biology.get("max_paralog_identity"))
    complex_size = _num(biology.get("complex_size"))
    in_complex = biology.get("in_complex")
    v["in_complex"] = (_bool(in_complex) if in_complex is not None
                       else (1.0 if not np.isnan(complex_size) and complex_size > 1 else np.nan))
    v["complex_size"] = complex_size
    v["pathway_redundancy"] = _num(biology.get("pathway_redundancy"))

    missing = set(FEATURE_NAMES) - set(v)
    if missing:
        raise KeyError(f"build_vector did not produce {sorted(missing)}")
    extra = set(v) - set(FEATURE_NAMES)
    if extra:
        raise KeyError(f"build_vector produced undeclared {sorted(extra)}")
    return v


def design_matrix(vectors: Sequence[Mapping[str, float]]) -> np.ndarray:
    """
    Stack evidence vectors into the model's design matrix.

    Columns are FEATURE_NAMES followed by one 0/1 indicator per indicated
    feature. The value columns keep NaN: the tree reads them directly and the
    linear model imputes them itself, after recording what it imputed.
    """
    n = len(vectors)
    X = np.full((n, len(COLUMNS)), np.nan, dtype=float)
    for i, vector in enumerate(vectors):
        for j, name in enumerate(FEATURE_NAMES):
            X[i, j] = _num(vector.get(name))
        for k, name in enumerate(INDICATED):
            X[i, len(FEATURE_NAMES) + k] = 1.0 if np.isnan(X[i, FEATURE_NAMES.index(name)]) else 0.0
    return X


def completeness(vectors: Sequence[Mapping[str, float]]) -> dict[str, float]:
    """Share of candidates for which each channel was recorded. A data report."""
    if not vectors:
        return {name: 0.0 for name in FEATURE_NAMES}
    out: dict[str, float] = {}
    for name in FEATURE_NAMES:
        present = sum(1 for v in vectors if not np.isnan(_num(v.get(name))))
        out[name] = present / len(vectors)
    return out


def family_of(column: str) -> str | None:
    """The family a design-matrix column belongs to, indicators included."""
    base = column[: -len("__missing")] if column.endswith("__missing") else column
    spec = BY_NAME.get(base)
    return spec.family if spec else None

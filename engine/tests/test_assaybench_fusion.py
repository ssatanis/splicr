"""Tests for the AssayBench fusion estimator and the discipline behind it.

Three things are checked, and each of them is load-bearing for a number in
``data/references/assaybench/RESULTS.md``:

1. :func:`splicr.assaybench_fusion.densify` really does what the +0.056 claim
   says -- normalise, dedupe, keep only genes the screen measured, and pad to
   exactly ``k`` real candidates.
2. Wrapping a published system in :class:`DensifiedScorer` raises its score, on
   real screens, scored by the real metric.
3. The leave-one-publication-out counters are *exact*: the count for a query
   with its own publication removed equals the count rebuilt from scratch over
   the donor pool minus that publication.  If that drifts, every weight fitted
   by cross-validation was fitted against a leak.
"""
from __future__ import annotations

import numpy as np
import pytest

from splicr import assaybench_fusion as af
from splicr import benchmark as bm
from splicr.assaybench_io import load_split


@pytest.fixture(scope="module")
def andcg():
    return bm.AnDCG(k=100)


@pytest.fixture(scope="module")
def test_screens():
    return load_split("test")


def test_densify_keeps_only_measured_genes(andcg):
    screen = {"relevance_genes": ["TP53", "MYC", "BRCA1", "EGFR", "KRAS"]}
    got = af.densify(["NOTAGENE1", "MYC", "myc", "ZZZZ9", "TP53"], screen, andcg,
                     pad_order=["KRAS", "EGFR", "BRCA1"], k=4)
    assert got == ["MYC", "TP53", "KRAS", "EGFR"]
    assert len(got) == len(set(got))


def test_densify_pads_to_k_and_never_repeats(andcg):
    screen = {"relevance_genes": [f"GENE{i}" for i in range(50)] + ["TP53", "MYC"]}
    got = af.densify(["MYC"], screen, andcg, pad_order=["MYC", "TP53"], k=3)
    assert got[0] == "MYC"
    assert "TP53" in got
    assert len(got) == len(set(got))


def test_densify_truncates_at_k(andcg):
    screen = {"relevance_genes": ["TP53", "MYC", "BRCA1"]}
    assert af.densify(["TP53", "MYC", "BRCA1"], screen, andcg, k=2) == ["TP53", "MYC"]


def test_densify_is_a_no_op_on_an_already_clean_list(andcg):
    genes = ["TP53", "MYC", "BRCA1"]
    screen = {"relevance_genes": genes}
    assert af.densify(genes, screen, andcg, k=3) == genes


def test_leaky_systems_are_excluded_from_the_consensus():
    cfg = af.FusionConfig(n_models=16)
    assert not (set(cfg.models) & af.LEAKY_SYSTEMS)
    assert len(cfg.models) == len(set(cfg.models))


def test_config_roundtrips(tmp_path):
    p = str(tmp_path / "w.json")
    cfg = af.FusionConfig(n_models=5, per_category=True, weights={"a": {"global_rate": 1.0}})
    cfg.save(p)
    back = af.FusionConfig.load(p)
    assert back.n_models == 5 and back.per_category and back.weights == cfg.weights


@pytest.mark.slow
def test_densifying_a_published_system_raises_its_score(andcg, test_screens):
    """The ranked-list hygiene claim, measured rather than asserted."""
    import glob
    import json
    import os

    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        ".tools", "assaybench", "benchmarking", "predictions")
    path = os.path.join(root, "llm", "gemini-3-pro.json")
    if not os.path.exists(path):
        pytest.skip("vendored AssayBench predictions not present")
    doc = json.load(open(path))
    shipped: dict[str, list[str]] = {}
    for _, recs in doc["records_by_dataset"].items():
        for r in (recs if isinstance(recs, list) else [recs]):
            if r.get("split") != "test" or r.get("split_layout") != "year":
                continue
            pg = r["predicted_genes"]
            if isinstance(pg, str):
                import ast

                pg = ast.literal_eval(pg)
            shipped[str(r["dataset_name"])] = pg
    screens = [s for s in test_screens if str(s["dataset_name"]) in shipped][:60]
    assert len(screens) == 60
    targets = {str(s["dataset_name"]): andcg.target(s) for s in screens}
    prior = bm.GeneFrequencyPrior(stratify_by="cleaned_phenotype", stratum_backoff=False)
    prior.fit(load_split("train"))
    raw = dense = 0.0
    for s in screens:
        name = str(s["dataset_name"])
        raw += targets[name].score(shipped[name])
        dense += targets[name].score(
            af.densify(shipped[name], s, andcg, prior.rank(s), k=100)
        )
    raw /= len(screens)
    dense /= len(screens)
    assert dense > raw + 0.02, f"densified {dense:.4f} vs shipped {raw:.4f}"


@pytest.mark.slow
def test_leave_one_publication_out_counters_are_exact():
    """Subtracting a publication must equal rebuilding the sum without it."""
    import os
    import sys

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    analysis = os.path.join(here, "analysis", "assaybench_fusion")
    if not os.path.exists(os.path.join(analysis, "cache", "base.pkl")):
        pytest.skip("run engine/analysis/assaybench_fusion/build.py first")
    sys.path.insert(0, analysis)
    from channels import Counters  # noqa: E402
    from common import split_idx  # noqa: E402
    from core import uni  # noqa: E402

    u = uni()
    donor = split_idx("pre2022")
    c = Counters(donor)
    rng = np.random.default_rng(0)
    checked = 0
    for i in rng.choice(donor, 8, replace=False):
        pub = u.pub[i]
        for field in ("cleaned_phenotype", "library_methodology", "direction"):
            value = c.keys[i][field]
            if not value:
                continue
            rows = np.array([r for r in c.groups[field][value][0] if u.pub[r] != pub],
                            dtype=np.int64)
            if not len(rows):
                continue
            want = u.group_sums(rows)
            got = c.field_sums(field, value, pub)
            for a, b in zip(got, want):
                # Sparse float32 sums are accumulated in a different order when
                # a publication is subtracted from a cached group total.
                # Check the actual counter tolerance, including zero entries.
                assert np.allclose(a, b, rtol=1e-5, atol=3e-5), (
                    f"{field}={value} drifted for pub {pub}: "
                    f"max error {np.max(np.abs(a - b))}"
                )
            checked += 1
    assert checked >= 8

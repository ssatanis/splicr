"""Synthetic interface tests for the F/L experiment family.

These check protocol invariants, not biological performance. The load-bearing
property is the one the family is designed around: at its degenerate setting
each candidate must reproduce its own baseline *exactly*, so that any measured
movement is attributable to the addition rather than to incidental reordering.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analysis"))

frontier = pytest.importorskip("frontier_residual")
from splicr.context_ranking import EXPERTS, reciprocal_rank  # noqa: E402


def rankings(seed=0):
    rng = np.random.default_rng(seed)
    genes = [f"GENE{i}" for i in range(1, 121)]
    return {expert: list(rng.permutation(genes)[:100]) for expert in EXPERTS}


def test_standardise_is_scale_and_shift_invariant():
    values = np.array([3.0, 1.0, 4.0, 1.0, 5.0])
    a = frontier.standardise(values)
    b = frontier.standardise(values * 7.0 + 11.0)
    assert np.allclose(a, b)
    assert abs(float(a.mean())) < 1e-12
    assert abs(float(a.std()) - 1.0) < 1e-12


def test_standardise_survives_a_constant_vector():
    assert np.array_equal(frontier.standardise([2.0, 2.0, 2.0]), np.zeros(3))


def test_zero_lambda_reproduces_the_reciprocal_rank_base_exactly():
    """lambda = 0 must be the base, not merely close to it."""
    per = rankings(1)
    genes, base = frontier.base_values(per)
    ours = [genes[i] for i in np.argsort(-base, kind="stable")[:100]]
    assert ours == reciprocal_rank(per, constant=60)


def test_uniform_weights_with_no_prior_reproduce_the_base():
    per = rankings(2)
    genes, base = frontier.base_values(per)
    weighted = frontier.weighted_scores(genes, per, [1.0] * len(EXPERTS), {}, 0.0)
    assert np.allclose(weighted, base)


def test_expert_weight_of_zero_removes_only_that_expert():
    per = rankings(3)
    genes, _ = frontier.base_values(per)
    weights = [1.0] * len(EXPERTS)
    weights[0] = 0.0
    dropped = frontier.weighted_scores(genes, per, weights, {}, 0.0)
    kept = frontier.weighted_scores(genes, per, [1.0] * len(EXPERTS), {}, 0.0)
    assert np.all(dropped <= kept + 1e-12)
    assert not np.allclose(dropped, kept)


def test_prior_term_is_standardised_so_the_weight_has_a_stable_meaning():
    per = rankings(4)
    genes, _ = frontier.base_values(per)
    small = {g: float(i) for i, g in enumerate(genes)}
    large = {g: 1000.0 * float(i) + 5.0 for i, g in enumerate(genes)}
    assert np.allclose(frontier.weighted_scores(genes, per, [1.0] * len(EXPERTS), small, 0.3),
                       frontier.weighted_scores(genes, per, [1.0] * len(EXPERTS), large, 0.3))


def test_runner_declares_no_public_test_phase():
    """The family must not be able to read the public test at all."""
    source = Path(frontier.__file__).read_text()
    assert "'replay'" not in source and '"replay"' not in source
    assert "load_split('test')" not in source and 'load_split("test")' not in source
    assert frontier.prov()["public_test_accessed"] is False


def test_every_candidate_has_a_degenerate_baseline_setting():
    assert frontier.LAMBDAS["F0_base_rrf60"] == 0.0
    assert "L0_uniform_prior_small" in frontier.AGGREGATIONS

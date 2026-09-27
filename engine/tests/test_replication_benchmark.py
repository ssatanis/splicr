"""Invariants of the independent replication benchmark.

These are the properties that make the benchmark defensible rather than the ones
that make any method look good. Each one corresponds to an objection the spec in
``docs/07-replication-benchmark.md`` has to answer, so if one of these breaks the
published claim is wrong and not merely stale.

Held-out labels are read here only through ``evaluating=True`` in the two places
that verify the loader agrees with the stored counts. Nothing is tuned.
"""

from __future__ import annotations

import os
import random
import sys

import pytest

_ENGINE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
if _ENGINE not in sys.path:
    sys.path.insert(0, _ENGINE)

from splicr import orcs_safe  # noqa: E402
from splicr.replication import dataset as D  # noqa: E402


@pytest.fixture(scope="module")
def bench():
    return D.load()


# ---------------------------------------------------------------------------
# The AssayBench boundary, which this benchmark sits inside
# ---------------------------------------------------------------------------

def test_every_screen_is_assaybench_safe(bench):
    used = {u.query_screen for u in bench.all_units} | {u.target_screen for u in bench.all_units}
    assert used <= orcs_safe.safe_ids()
    assert not (used & orcs_safe.excluded_ids())


# ---------------------------------------------------------------------------
# What makes a pair an independent replication
# ---------------------------------------------------------------------------

def test_pairs_are_independent_and_comparable(bench):
    for u in bench.all_units:
        assert u.query_screen != u.target_screen
        assert u.query_publication != u.target_publication, u.unit_id
        assert D.first_author_key(u.query_author) != D.first_author_key(u.target_author), u.unit_id
        assert u.query_library != u.target_library, u.unit_id
        assert u.cell_line_key == D.cell_line_key(u.cell_line), u.unit_id


def test_both_directions_present_exactly_once(bench):
    seen = {}
    for u in bench.all_units:
        seen.setdefault(u.pair_key, set()).add(u.unit_id)
    assert all(len(v) == 2 for v in seen.values())


# ---------------------------------------------------------------------------
# The split
# ---------------------------------------------------------------------------

def test_split_is_publication_disjoint(bench):
    def pubs(split):
        us = bench.units(split)
        return {u.query_publication for u in us} | {u.target_publication for u in us}

    assert not (pubs("development") & pubs("heldout"))


def test_split_is_also_cell_line_disjoint(bench):
    """Not required by the split rule, but true, and a second leak channel closed.

    If it ever stops being true the spec's claim has to be weakened, because a
    method tuned on a development cell line would then meet that line again.
    """
    dev = {u.cell_line_key for u in bench.units("development")}
    held = {u.cell_line_key for u in bench.units("heldout")}
    assert not (dev & held)


# ---------------------------------------------------------------------------
# Leakage
# ---------------------------------------------------------------------------

def test_heldout_labels_refuse_without_evaluating(bench):
    with pytest.raises(PermissionError):
        D.load_pair_labels(bench.units("heldout")[0])


def test_inputs_frame_cannot_carry_the_label(bench):
    cols = set(D.load_pair_inputs(bench.units("development")[0]).columns)
    assert cols == {"gene", "a_hit", "a_score1", "is_common_essential"}


def test_background_screens_exclude_the_label(bench):
    idx = D.screen_index()
    for u in (bench.units("development")[0], bench.units("heldout")[0]):
        bg = set(D.allowed_background_screens(u))
        assert not ({u.query_screen, u.target_screen} & bg)
        for sid in bg:
            assert idx[sid]["SOURCE_ID"] not in {u.query_publication, u.target_publication}
            assert D.cell_line_key(idx[sid]["CELL_LINE"]) != u.cell_line_key


# ---------------------------------------------------------------------------
# The gene key, and the cross-product trap it used to hide
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("split", D.SPLITS)
def test_gene_key_is_unique_and_counts_agree(bench, split):
    """One row per gene, and the loader agrees with the artifact.

    ORCS ships repeated rows for the same gene within a screen, sometimes with
    contradictory HIT calls, so without deduplication a caller merging inputs to
    labels on ``gene`` silently gets a many-to-many join.
    """
    random.seed(0)
    for u in random.sample(list(bench.units(split)), 4):
        fi = D.load_pair_inputs(u)
        fl = D.load_pair_labels(u, evaluating=True)
        assert not fi.gene.duplicated().any()
        assert not fl.gene.duplicated().any()
        m = fi.merge(fl, on="gene", validate="one_to_one")
        assert len(m) == u.n_shared_genes
        assert int(m.a_hit.sum()) == u.n_query_hits
        assert int(m.b_hit.sum()) == u.n_target_hits
        assert int((m.a_hit & m.b_hit).sum()) == u.n_both_hits
        assert int((~m.is_common_essential).sum()) == u.n_shared_genes_non_essential
        assert int(m.b_hit[~m.is_common_essential].sum()) == u.n_target_hits_non_essential


# ---------------------------------------------------------------------------
# "You chose the pairs"
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_pair_set_is_reproducible_without_reading_agreement(bench):
    """No filter may select pairs on how well the two sides agree.

    Agreement is the quantity being measured. Selecting on each side's own
    marginal hit count is unavoidable and allowed; selecting on ``n_both`` would
    manufacture the result. This rebuilds the surviving pair set using only
    quantities that are not ``n_both`` and checks the built set is contained in it.
    """
    eligible, _ = D.eligible_screens()
    cands, _ = D._candidate_pairs(eligible)
    ov = D._overlap(cands)
    counts = D._screen_counts()
    reproduced = set()
    for (a, b), v in ov.items():
        if v["n_shared"] < D.MIN_SHARED_GENES:
            continue
        if (v["n_shared"] / counts[a][0] < D.MIN_SHARED_COVERAGE
                or v["n_shared"] / counts[b][0] < D.MIN_SHARED_COVERAGE):
            continue
        if min(v["a_hits"], v["b_hits"]) < D.MIN_SHARED_HITS:
            continue
        if min(v["a_hits_nce"], v["b_hits_nce"]) < D.MIN_SHARED_HITS:
            continue
        reproduced.add((a, b))
    built = {tuple(sorted((u.query_screen, u.target_screen))) for u in bench.all_units}
    assert built <= reproduced


# ---------------------------------------------------------------------------
# The benchmark measures something
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("split", D.SPLITS)
def test_primary_space_lift_is_far_above_one(split):
    """If lift were near 1 the benchmark would not be measuring anything."""
    br = D.base_rates(split)["non_common_essential_genes"]
    assert br["lift"]["mean"] > 3.0
    assert br["marginal"]["mean"] < 0.10
    assert br["precision"]["mean"] > 0.20


def test_every_unit_has_enough_positives_in_the_primary_space(bench):
    for u in bench.all_units:
        assert u.n_target_hits_non_essential >= D.MIN_SHARED_HITS, u.unit_id
        assert u.n_query_hits_non_essential >= D.MIN_SHARED_HITS, u.unit_id


# ---------------------------------------------------------------------------
# The paired test every claim has to pass
# ---------------------------------------------------------------------------

def test_paired_test_resamples_screen_pairs_not_units(bench):
    us = bench.units("development")
    a = {u.unit_id: u.query_precision for u in us}
    r = D.paired_test(a, dict(a), n_boot=200)
    assert r["mean_difference"] == 0.0 and not r["significant"]
    assert r["n_screen_pairs"] == len({u.pair_key for u in us})
    assert r["n_units"] == len(us)


def test_paired_test_detects_a_real_difference(bench):
    us = bench.units("development")
    better = {u.unit_id: u.query_precision for u in us}
    worse = {u.unit_id: u.target_hit_rate for u in us}
    r = D.paired_test(better, worse, n_boot=2000)
    assert r["significant"] and r["ci95"][0] > 0


def test_paired_test_rejects_mismatched_unit_sets(bench):
    us = bench.units("development")
    a = {u.unit_id: 1.0 for u in us}
    with pytest.raises(ValueError):
        D.paired_test(a, {k: 1.0 for k in list(a)[:-1]})


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def test_average_precision_endpoints():
    assert D.average_precision([1, 1, 0, 0], [4, 3, 2, 1]) == pytest.approx(1.0)
    # A random ranking's expected AP is the positive rate; a worst-case one is below it.
    assert D.average_precision([0, 0, 1, 1], [4, 3, 2, 1]) < 0.6


def test_evaluate_defaults_to_the_primary_space(bench):
    u = bench.units("development")[0]
    n = u.n_shared_genes
    r = D.evaluate(u, [0.0] * n)
    assert r["space"] == D.PRIMARY_SPACE
    assert r["n_genes"] == u.n_shared_genes_non_essential
    assert r["n_positives"] == u.n_target_hits_non_essential
    assert D.evaluate(u, [0.0] * n, space="all")["n_genes"] == n


def test_evaluate_rejects_a_wrong_length_score(bench):
    with pytest.raises(ValueError):
        D.evaluate(bench.units("development")[0], [0.0, 1.0])

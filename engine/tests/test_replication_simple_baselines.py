"""Tests for the simple baselines on the replication benchmark.

These lock the two things that would make the reported numbers meaningless: the
leakage boundary, and the reproducibility of the development figures the write-up
quotes. They are deliberately cheap except where marked slow, because the point
is that a future change to the loader or the caches cannot silently move a
published number.

    export PATH="engine/.tools/env/bin:$PATH"
    python -m pytest engine/tests/test_replication_simple_baselines.py
"""

from __future__ import annotations

import numpy as np
import pytest

from splicr.replication import dataset, simple


@pytest.fixture(scope="module")
def bench():
    return dataset.load()


# ---------------------------------------------------------------------------
# Leakage
# ---------------------------------------------------------------------------

def test_no_feature_name_mentions_the_target(bench):
    """The feature frame must not carry a column derived from screen B.

    A weak test on its own, but it fails loudly if someone adds a ``b_`` feature,
    which is the shape the mistake would take.
    """
    unit = bench.units("development")[0]
    feats = simple.unit_features(unit)["features"]
    assert not [k for k in feats if k.startswith("b_") or "target" in k]


def test_features_are_identical_when_the_target_label_is_permuted(bench, monkeypatch):
    """The strong version: features must not change if B's hit calls change.

    Anything a predictor sees is a function of screen A and the allowed
    background. Permuting the target screen's labels must therefore leave every
    feature bit-identical. This catches a leak that a naming convention would not.
    """
    unit = bench.units("development")[0]
    before = simple.unit_features(unit)["features"]

    real_labels = dataset.load_pair_labels
    rng = np.random.default_rng(0)

    def shuffled(u, evaluating=False):
        df = real_labels(u, evaluating=evaluating).copy()
        df["b_hit"] = rng.permutation(df["b_hit"].to_numpy())
        return df

    monkeypatch.setattr(dataset, "load_pair_labels", shuffled)
    simple.unit_features.cache_clear() if hasattr(simple.unit_features, "cache_clear") else None
    after = simple.unit_features(unit)["features"]

    assert set(before) == set(after)
    for k in before:
        np.testing.assert_array_equal(
            np.nan_to_num(before[k], nan=-999.0), np.nan_to_num(after[k], nan=-999.0),
            err_msg=f"feature {k} changed when the target label was permuted",
        )


def test_allowed_background_excludes_the_pair_its_papers_and_its_cell_line(bench):
    idx = dataset.screen_index()
    for unit in bench.units("heldout")[:20] + bench.units("development")[:10]:
        allowed = set(dataset.allowed_background_screens(unit))
        assert unit.query_screen not in allowed
        assert unit.target_screen not in allowed
        for sid in allowed:
            meta = idx[sid]
            assert meta["SOURCE_ID"] not in (unit.query_publication, unit.target_publication)
            assert dataset.cell_line_key(meta["CELL_LINE"]) != unit.cell_line_key


def test_chronos_features_drop_the_units_own_model(bench):
    """The unit's own DepMap model must not be in any Chronos average."""
    unit = next(u for u in bench.units("heldout") if u.depmap_model)
    ch = simple._chronos()
    out = simple.depmap_features(unit, ["TP53", "RPL5"])
    assert out["_dropped_model"] == unit.depmap_model
    assert out["_n_models"] == ch["effect"].shape[0] - 1


def test_the_score_sidecar_holds_only_safe_screens():
    from splicr import orcs_safe

    orcs_safe.assert_safe(set(simple._score_columns()))


# ---------------------------------------------------------------------------
# Correctness of the plumbing
# ---------------------------------------------------------------------------

def test_score_sidecar_agrees_with_the_dataset_loader(bench):
    """SCORE.1 is in both caches, so a divergence between them is detectable."""
    for unit in bench.units("development")[:4]:
        inputs = dataset.load_pair_inputs(unit)
        got = simple._score_frame(unit.query_screen, inputs["gene"].tolist())[:, 0]
        np.testing.assert_allclose(got, inputs["a_score1"].to_numpy(), rtol=1e-5, atol=1e-5)


def test_design_matrix_width_is_the_same_on_both_splits(bench):
    """A development fit is applied to held out, so the widths must match.

    Development contains no screen with a guide map and 5 units with no
    significance column, so a design matrix that emitted a missingness column only
    where something was missing would be narrower on development than on held out
    and the fitted coefficients would land on the wrong columns.
    """
    dev = simple.unit_features(bench.units("development")[0])
    held = simple.unit_features(bench.units("heldout")[0])
    for feats in simple.COMBOS.values():
        assert simple.design_matrix(dev, feats).shape[1] == simple.design_matrix(held, feats).shape[1]
        assert simple.design_matrix(dev, feats).shape[1] == 2 * len(feats)


def test_a_constant_ranking_scores_at_the_floor(bench):
    """A baseline with nothing to say must land at the positive rate, not above it.

    This is the tie-order check: average precision here resolves ties by gene
    alphabetical order, and that order must not be worth anything. If it were,
    every heavily tied baseline would be flattered.
    """
    unit = bench.units("development")[0]
    b = simple.unit_features(unit)
    labels = dataset.load_pair_labels(unit)
    row = simple.score_unit(b, np.zeros(len(b["genes"])), labels, dataset.PRIMARY_SPACE)
    assert row["average_precision"] == pytest.approx(row["marginal"], abs=0.01)
    assert row["auc"] == pytest.approx(0.5, abs=1e-9)


def test_the_common_essential_lookup_is_constant_on_the_primary_space(bench):
    """The list that defines the primary space carries no information inside it.

    If this ever fails, the primary space and ``common_essentials()`` have drifted
    apart and the "it only works on essentials" objection is no longer answered.
    """
    unit = bench.units("development")[0]
    b = simple.unit_features(unit)
    inside = b["features"]["depmap_common_essential"][~b["is_common_essential"]]
    assert set(np.unique(inside)) == {0.0}


def test_significance_resolution_reads_only_metadata(bench):
    """Every screen's significance column must resolve from SCORE.n_TYPE alone."""
    idx = dataset.screen_index()
    for unit in bench.all_units:
        col = simple.significance_column(unit.query_screen, "finest")
        if col is None:
            types = {idx[unit.query_screen].get(f"SCORE.{i}_TYPE") for i in range(1, 6)}
            assert not (types & set(simple.SIGNIFICANCE_TYPES))
        else:
            i, typ = col
            assert idx[unit.query_screen][f"SCORE.{i}_TYPE"] == typ


def test_score1_sign_convention_is_the_right_way_round(bench):
    """Flipping the effect sign must fall below the floor, on both splits.

    The cheapest possible check that the direction table is not inverted, which
    would turn every effect-size number in the write-up into its opposite.
    """
    # Not just any unit: 4 development units are CasTLE screens whose SCORE.1
    # direction the spec leaves unknown, so their effect feature is a deliberate
    # constant and its AUC is exactly 0.5. Those units carry no sign to check.
    unit = next(u for u in bench.units("development") if simple._direction(u) != 0.0)
    b = simple.unit_features(unit)
    labels = dataset.load_pair_labels(unit)
    right = simple.score_unit(b, simple.single_score(b, "effect_score1"), labels, dataset.PRIMARY_SPACE)
    wrong = simple.score_unit(b, simple.single_score(b, "effect_score1_flipped"), labels, dataset.PRIMARY_SPACE)
    assert right["auc"] > 0.6
    assert wrong["auc"] < 0.4


# ---------------------------------------------------------------------------
# The published numbers
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_development_headline_numbers_are_reproducible():
    """The development figures the write-up quotes, to four decimals.

    ``effect_score1`` at 0.2517 and ``a_hit`` at 0.1691 are also in
    ``docs/07-replication-benchmark.md``, computed by a different code path, so
    this pins the two modules to each other as well.
    """
    dev = simple._bundles("development")
    labels = simple._labels("development", False)
    fitted = simple.fit_combinations(dev, labels)
    res = simple.run("development", fitted=fitted)
    s = res["summary"]
    assert s["effect_score1"]["average_precision"] == pytest.approx(0.2517, abs=5e-4)
    assert s["a_hit"]["average_precision"] == pytest.approx(0.1691, abs=5e-4)
    assert s["freq_shrunk"]["average_precision"] == pytest.approx(0.2979, abs=5e-4)
    assert s["mean_rank_effect_freq_depmap"]["average_precision"] == pytest.approx(0.3527, abs=5e-4)
    # The nominated combination must still be the best on development, or the
    # nomination recorded in DEVELOPMENT_DECISIONS was made on different numbers.
    best = max(s, key=lambda n: s[n]["average_precision"])
    assert best == simple.DEVELOPMENT_DECISIONS["nominated_combination"]

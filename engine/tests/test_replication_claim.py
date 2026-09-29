"""Guards on the held-out replication claim.

The held-out split is a one-shot resource and the claim built on it is the
strongest in this repository, so the properties that make it honest are asserted
here rather than left to the reader's trust in a docstring.

These check provenance and protocol. They establish nothing biological.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ANALYSIS = ROOT / "engine/analysis"
SELECTION = ROOT / "research/artifacts/20260928/replication_selection/selection.json"
HELDOUT = ROOT / "research/artifacts/20260928/replication_heldout/heldout_results.json"

pytestmark = pytest.mark.skipif(
    not SELECTION.exists() or not HELDOUT.exists(),
    reason="run engine/analysis/replication_selection.py then replication_heldout.py",
)


def selection() -> dict:
    return json.loads(SELECTION.read_text())


def heldout() -> dict:
    return json.loads(HELDOUT.read_text())


def _passes_evaluating_true(path: Path) -> bool:
    """Does this module actually *call* something with ``evaluating=True``?

    Parsed rather than grepped: every one of these files discusses the tripwire in
    prose, and a docstring that explains the rule must not be mistaken for code
    that trips it.
    """
    import ast

    for node in ast.walk(ast.parse(path.read_text())):
        if not isinstance(node, ast.Call):
            continue
        for kw in node.keywords:
            if kw.arg == "evaluating" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                return True
    return False


def test_only_scripts_that_must_read_heldout_labels_do_so():
    """``evaluating=True`` is the tripwire; only the scoring runners may trip it."""
    trippers = sorted(p.name for p in ANALYSIS.glob("replication_*.py") if _passes_evaluating_true(p))
    assert trippers == ["replication_heldout.py", "replication_verify.py"], trippers


def test_selection_never_reads_a_heldout_label():
    assert not _passes_evaluating_true(ANALYSIS / "replication_selection.py")
    assert selection()["heldout_labels_read_by_this_script"] is False


def test_the_headline_model_uses_no_depmap_feature():
    """The clean-model amendment is what makes the claim survive its own provenance."""
    sel = selection()
    primary = sel["amendment"]["primary_model"]
    assert primary == "lr_effect_freq"
    from splicr.replication.simple import COMBOS

    assert all("depmap" not in f for f in COMBOS[primary]), COMBOS[primary]
    assert heldout()["primary_model"] == primary


def test_the_amendment_was_made_before_any_heldout_label_was_read():
    assert selection()["amendment"]["made_before_any_heldout_label_was_read"] is True


def test_selection_and_heldout_agree_on_the_frozen_choice():
    import hashlib

    digest = hashlib.sha256(SELECTION.read_bytes()).hexdigest()
    assert heldout()["frozen_selection_sha256"] == digest, (
        "the selection file changed after the held-out run; the freeze is void")


def test_heldout_was_scored_once_and_is_not_promoted():
    h = heldout()
    assert h["scored_once"] is True
    assert h["promotion_status"] == "research_only"


def test_stratification_partitions_every_heldout_pair():
    r = heldout()["results"]
    assert r["hub"]["n_screen_pairs"] + r["rest"]["n_screen_pairs"] == r["overall"]["n_screen_pairs"] == 124
    assert r["hub"]["n_units"] + r["rest"]["n_units"] == r["overall"]["n_units"] == 248


def test_the_claim_holds_on_the_independent_stratum():
    """A result that held only on the Behan/Meyers block would not generalise."""
    rest = heldout()["results"]["rest"]["vs_effect_score1"]["lr_effect_freq"]["average_precision"]
    assert rest["mean_difference"] > 0
    assert rest["ci95"][0] > 0, "the non-hub interval must exclude zero for the claim to stand"


def test_paired_tests_are_resampled_by_screen_pair_not_unit():
    """Two directions of one screen pair are one experiment scored twice."""
    for stratum, expected in (("overall", 124), ("hub", 113), ("rest", 11)):
        block = heldout()["results"][stratum]["vs_effect_score1"]["lr_effect_freq"]
        for metric in ("average_precision", "p_at_10"):
            assert block[metric]["n_screen_pairs"] == expected


def test_comparator_is_the_screens_own_effect_size():
    """The thing to beat is what a lab already has without SplicR."""
    assert selection()["comparator"] == "effect_score1"
    assert heldout()["comparator"] == "effect_score1"


def test_primary_space_excludes_common_essentials():
    from splicr.replication import dataset

    assert heldout()["space"] == dataset.PRIMARY_SPACE == "non_common_essential"


def test_no_calibrated_probability_is_claimed():
    text = heldout()["interpretation"].lower()
    assert "proxy" in text
    assert "not proof" in text or "not a calibrated" in text

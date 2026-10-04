"""
The Validation Network: endpoints, cohorts, calibration, the gate and receipts.

The tests that matter most here are the refusals. A model that produces a number
is easy to test; a model that declines to produce one for the right reason is
the thing this subsystem exists for, so every refusal path has a test and the
refusals outnumber the happy paths.

The synthetic cohort has a known generating process, which lets the calibration
tests assert against a floor they can compute rather than against a number
somebody once observed.
"""

from __future__ import annotations

import json
import warnings

import numpy as np
import pytest

from splicr.validation import endpoints as E
from splicr.validation import features as F
from splicr.validation import baselines, calibration, cohort, evaluation, receipts
from splicr.validation.coverage import (
    CoverageTable, MIN_NETWORK_LABS, MIN_NETWORK_OUTCOMES, MIN_STRATUM_LABS,
    MIN_STRATUM_OUTCOMES, MIN_STRATUM_SCREENS, Stratum, Unavailable, stratum_for,
)
from splicr.validation.models import (
    FitError, GradientBoosted, HierarchicalLogistic, MIN_FIT_OUTCOMES, select_model,
)
from splicr.validation.network import (
    CERTAINTY_CEILING, Estimate, ValidationNetwork, format_probability,
)
from splicr.validation.outcomes import (
    Context, OutcomeError, OutcomeRecord, count_cohort, endpoint_disagreements,
    load_outcomes,
)
from splicr.validation.report import ladder, network_report, next_experiment
from splicr.validation.rounds import Round, RoundError
from splicr.validation.splits import LeakageError, grouped_folds, lab_holdout
from splicr.validation.store import load_network, write_cohort

LABS = [f"LAB{i}" for i in range(8)]
CONTROLS = {"negative_control_guides": True, "positive_control_guides": True,
            "non_targeting_control": True, "knockdown_confirmed": True,
            "vehicle_control": True, "empty_vector_control": True}
MEASUREMENT = {"independent_perturbation": True,
               "distinct_from_screen_constructs": True,
               "n_perturbations": 2, "n_replicates": 3,
               "controls": dict(CONTROLS)}
TYPES = {"reproduces": "independent_guide", "target_specific": "crispri",
         "cross_model": "another_model", "pharmacologic": "small_molecule"}
ENDPOINTS = {"reproduces": "ko_fitness_independent_guide",
             "target_specific": "orthogonal_crispri",
             "cross_model": "cross_model_reproduction",
             "pharmacologic": "pharmacologic_inhibition"}
ASSAY = {"reproduces": "ko_fitness", "target_specific": "ko_fitness",
         "cross_model": "ko_fitness", "pharmacologic": "other"}
BASE = {"reproduces": -0.9, "target_specific": -1.4, "cross_model": -2.1,
        "pharmacologic": -2.9}
THRESHOLD = 0.5


def _evidence(rng):
    lfc = -rng.gamma(2.2, 0.55)
    fdr = float(np.clip(rng.beta(1, 9), 1e-9, 1))
    agree = int(rng.choice([2, 3, 4], p=[0.2, 0.3, 0.5]))
    flagged = rng.random() < 0.18
    return {
        "hit": {"lfc": lfc, "fdr": fdr, "p_value": fdr / 3, "n_guides": 4,
                "n_good_guides": agree, "direction": "depleted",
                "guide_lfcs": [float(x) for x in np.round(rng.normal(lfc, 0.25, 4), 3)],
                "atlas_hit_rate": float(rng.random() * 0.3),
                "atlas_screen_count": int(rng.integers(20, 300)),
                "max_guide_share": float(np.clip(rng.beta(2, 4), 0, 1)),
                "cn_corrected": True},
        "qc": {"median_replicate_r": float(0.78 + 0.2 * rng.random()),
               "nnmd": float(-1.3 - rng.random()), "verdict": "pass",
               "bottlenecked_samples": 0,
               "mapped_frac": float(0.7 + 0.25 * rng.random())},
        "flags": (["single_guide"] if flagged else []),
        "artifacts": {"copy_number": float(np.clip(rng.normal(2.0, 0.8), 0.2, 8))},
    }


def _truth(ev, lab_effect, kind):
    h, q = ev["hit"], ev["qc"]
    eta = (BASE[kind] + 1.15 * abs(h["lfc"]) + 0.30 * (-np.log10(h["fdr"]))
           + 1.5 * (h["n_good_guides"] / h["n_guides"])
           - 1.9 * (1 if "single_guide" in ev["flags"] else 0)
           - 0.45 * max(0.0, ev["artifacts"]["copy_number"] - 3.0)
           + 1.0 * q["median_replicate_r"] + lab_effect)
    return float(1 / (1 + np.exp(-eta)))


def synthetic_cohort(seed: int = 42,
                     sizes=(("reproduces", 420), ("target_specific", 260),
                            ("cross_model", 180), ("pharmacologic", 60)),
                     pending_rate: float = 0.06) -> list[OutcomeRecord]:
    """
    A cohort whose measurements agree with their own endpoints.

    That consistency is not cosmetic. A generator that draws the label
    independently of the measurement produces records that disagree with the
    endpoint they were scored against, and the coverage gate refuses such a
    cohort on purpose - which `test_gate_refuses_a_cohort_that_disagrees_with_itself`
    exercises deliberately.
    """
    rng = np.random.default_rng(seed)
    lab_effect = {lab: float(rng.normal(0, 0.45)) for lab in LABS}
    rows: list[OutcomeRecord] = []
    index = 0
    for kind, n in sizes:
        for j in range(n):
            lab = LABS[j % len(LABS)]
            ev = _evidence(rng)
            p = _truth(ev, lab_effect[lab], kind)
            index += 1
            if rng.random() < pending_rate:
                result, effect = "pending", None
            else:
                validated = rng.random() < p
                result = "validated" if validated else "failed"
                effect = (-abs(rng.normal(1.2, 0.4)) - THRESHOLD if validated
                          else -abs(rng.normal(0.15, 0.1)))
            rows.append(OutcomeRecord(
                f"o{index}", f"GENE{j % 150}", TYPES[kind], result,
                Context(ASSAY[kind], "knockout", "fitness", "cancer_cell_line"),
                lab_id=lab, study_id=f"ST-{lab}-{j // 25}",
                screen_id=f"SCR-{lab}-{j // 12}",
                endpoint_id=ENDPOINTS[kind], endpoint_version=1,
                laboratory_threshold=THRESHOLD,
                measurement={**MEASUREMENT, "effect_size": effect},
                evidence=ev))
    return rows


@pytest.fixture(scope="module")
def cohort_rows():
    return synthetic_cohort()


@pytest.fixture(scope="module")
def fitted(cohort_rows):
    return ValidationNetwork.fit(cohort_rows)


# =====================================================================
# Endpoints
# =====================================================================

def test_every_registered_endpoint_is_self_consistent():
    assert len(E.REGISTRY) >= 9
    for key, endpoint in E.REGISTRY.items():
        assert key == endpoint.key
        assert endpoint.question in E.QUESTIONS
        assert endpoint.assay_class in E.ASSAY_CLASSES
        for kind in endpoint.validation_types:
            assert E.TYPE_QUESTION[kind] == endpoint.question
        #: A laboratory-owned threshold must not be fixed in the registry, or
        #: SplicR would be deciding what counts as a response in somebody
        #: else's assay.
        if endpoint.threshold_owner == "laboratory":
            assert endpoint.effect_threshold is None
        assert endpoint.hash() == endpoint.hash()


def test_the_registry_hash_changes_when_a_rule_changes():
    before = E.registry_hash()
    original = E.REGISTRY["ko_fitness_independent_guide.v1"]
    try:
        E.REGISTRY["ko_fitness_independent_guide.v1"] = E.Endpoint(
            **{**original.canonical(),
               "validation_types": tuple(original.validation_types),
               "control_criteria": tuple(original.control_criteria),
               "min_biological_replicates": 5})
        assert E.registry_hash() != before
    finally:
        E.REGISTRY["ko_fitness_independent_guide.v1"] = original
    assert E.registry_hash() == before


def test_an_endpoint_refuses_a_validation_type_that_answers_another_question():
    with pytest.raises(E.EndpointError, match="bears on"):
        E.Endpoint(endpoint_id="bad", version=1, label="bad", question="reproduces",
                   validation_types=("small_molecule",), assay_class="ko_fitness")


def test_a_missing_criterion_is_not_a_failure():
    """
    The single most important distinction in this subsystem.

    An experiment nobody recorded the replicate count for has not failed. If
    'not recorded' collapsed into 'failed', every incomplete record would enter
    a validation rate's denominator as a negative, and the rate would be
    manufactured rather than measured.
    """
    endpoint = E.default_endpoint("independent_guide")
    complete = {"result": "validated", **MEASUREMENT, "effect_size": -1.4}
    assert endpoint.decide(complete, laboratory_threshold=1.0).decision == "validated"
    for field in ("n_replicates", "n_perturbations", "effect_size",
                  "independent_perturbation"):
        partial = {**complete, field: None}
        decision = endpoint.decide(partial, laboratory_threshold=1.0)
        assert decision.decision == "insufficient_record", field
        assert not decision.scorable
        assert "not recorded" in decision.because


def test_the_laboratorys_threshold_is_required_not_invented():
    endpoint = E.default_endpoint("independent_guide")
    measurement = {"result": "validated", **MEASUREMENT, "effect_size": -1.4}
    assert endpoint.decide(measurement).decision == "insufficient_record"
    assert endpoint.decide(measurement, laboratory_threshold=1.0).decision == "validated"
    assert endpoint.decide(measurement, laboratory_threshold=3.0).decision == "failed"


def test_direction_is_prespecified_so_the_wrong_way_is_not_a_validation():
    endpoint = E.default_endpoint("independent_guide")
    base = {"result": "validated", **MEASUREMENT}
    assert endpoint.decide({**base, "effect_size": -1.4},
                           laboratory_threshold=1.0).decision == "validated"
    wrong = endpoint.decide({**base, "effect_size": +1.4}, laboratory_threshold=1.0)
    assert wrong.decision == "failed"
    assert "wrong way" in wrong.because


def test_pending_and_inconclusive_are_never_upgraded():
    endpoint = E.default_endpoint("independent_guide")
    assert endpoint.decide({"result": "pending"}).decision == "insufficient_record"
    assert endpoint.decide({"result": "inconclusive"}).decision == "inconclusive"


def test_a_rescue_validates_in_the_opposite_direction():
    """A rescue restores growth, so its prespecified effect is enriched."""
    endpoint = E.endpoint("rescue_complementation", 1)
    assert endpoint.direction == "enriched"
    measurement = {"result": "validated", "n_perturbations": 1, "n_replicates": 3,
                   "effect_size": +1.2,
                   "controls": {"empty_vector_control": True,
                                "expression_confirmed": True}}
    assert endpoint.decide(measurement, laboratory_threshold=0.5).decision == "validated"
    assert endpoint.decide({**measurement, "effect_size": -1.2},
                           laboratory_threshold=0.5).decision == "failed"


def test_the_published_criteria_are_carried_as_an_example_not_a_default():
    for key in ("organoid_growth_arrayed.v1", "pharmacologic_inhibition.v1"):
        endpoint = E.REGISTRY[key]
        assert endpoint.published_example is not None
        assert endpoint.published_example["doi"] == "10.1158/0008-5472.CAN-24-0775"
        #: The paper's 50% / p < 0.05 numbers are that screen's own hit
        #: criterion. Promoting them to this endpoint's bar would apply one
        #: laboratory's cut to everybody's organoids.
        assert endpoint.effect_threshold is None
        assert endpoint.threshold_owner == "laboratory"


def test_a_pharmacologic_negative_says_what_it_does_not_mean():
    endpoint = E.endpoint("pharmacologic_inhibition", 1)
    assert "not evidence that the screen hit was false" in endpoint.negative_means
    assert "PRKDC" in endpoint.negative_means


# =====================================================================
# Outcome records
# =====================================================================

def test_an_outcome_refuses_an_unknown_vocabulary():
    good = dict(outcome_id="o1", gene="TP53", validation_type="independent_guide",
                result="validated", context=Context("ko_fitness"))
    OutcomeRecord(**good)
    for field, value in (("validation_type", "vibes"), ("result", "probably"),
                         ("arm", "whatever")):
        with pytest.raises(OutcomeError):
            OutcomeRecord(**{**good, field: value})
    with pytest.raises(OutcomeError):
        Context("not_an_assay_class")


def test_pending_is_not_a_label_and_inconclusive_is_not_a_zero():
    make = lambda result: OutcomeRecord("o", "G", "independent_guide", result,
                                        Context("ko_fitness"))
    assert make("validated").label == 1
    assert make("failed").label == 0
    assert make("pending").label is None
    assert make("inconclusive").label is None
    assert make("pending").decided is False
    assert make("inconclusive").decided is False


def test_a_cohort_counts_every_denominator(cohort_rows):
    counts = count_cohort(cohort_rows)
    assert counts.total == len(cohort_rows)
    assert counts.n_decided == counts.validated + counts.failed
    assert counts.total == counts.n_decided + counts.inconclusive + counts.pending
    assert counts.n_labs == len(LABS)
    assert counts.labs_unattributed == 0


def test_a_duplicate_outcome_id_fails_the_whole_file():
    row = {"outcome_id": "o1", "gene": "G", "validation_type": "independent_guide",
           "result": "validated", "context": {"assay_class": "ko_fitness"}}
    assert len(load_outcomes([row, {**row, "outcome_id": "o2"}])) == 2
    with pytest.raises(OutcomeError, match="duplicate"):
        load_outcomes([row, dict(row)])


def test_a_consistent_cohort_does_not_disagree_with_its_own_endpoints(cohort_rows):
    assert endpoint_disagreements(cohort_rows) == []


def test_disagreements_are_surfaced_and_nothing_is_rewritten():
    """A record whose measurement contradicts its label is reported, not fixed."""
    row = OutcomeRecord(
        "o1", "G", "independent_guide", "validated", Context("ko_fitness"),
        lab_id="L1", endpoint_id="ko_fitness_independent_guide", endpoint_version=1,
        laboratory_threshold=1.0,
        measurement={**MEASUREMENT, "effect_size": -0.05})
    found = endpoint_disagreements([row])
    assert len(found) == 1
    assert found[0]["recorded"] == "validated"
    assert found[0]["decision"] == "failed"
    assert row.result == "validated", "the lab's own label stands"


# =====================================================================
# Evidence vector
# =====================================================================

def test_the_vector_declares_exactly_what_it_produces():
    spec = {s.name for s in F.FEATURE_SPEC}
    assert len(spec) == len(F.FEATURE_SPEC), "no duplicate feature names"
    assert {s.family for s in F.FEATURE_SPEC} <= set(F.FAMILIES)
    built = set(F.build_vector({"hit": {}, "context": {}}))
    assert built == spec
    assert len(F.COLUMNS) == len(F.FEATURE_NAMES) + len(F.INDICATED)


def test_missing_stays_missing_and_never_becomes_zero():
    """
    A gene whose Atlas context was never computed and a gene the Atlas has never
    called are different claims, and only one of them is a zero.
    """
    empty = F.build_vector({})
    for name in ("atlas_hit_rate", "bayes_factor", "copy_number", "nnmd",
                 "expression_tpm", "n_paralogs"):
        assert np.isnan(empty[name]), name
    recorded = F.build_vector({"hit": {"atlas_hit_rate": 0.0}})
    assert recorded["atlas_hit_rate"] == 0.0
    assert not np.isnan(recorded["atlas_hit_rate"])

    X = F.design_matrix([empty, recorded])
    column = F.COLUMNS.index("atlas_hit_rate__missing")
    assert X[0, column] == 1.0
    assert X[1, column] == 0.0


def test_a_flag_list_that_was_never_computed_is_not_an_absence_of_flags():
    never_run = F.build_vector({"hit": {}})
    ran_and_found_nothing = F.build_vector({"hit": {}, "flags": []})
    assert np.isnan(never_run["flag_single_guide"])
    assert ran_and_found_nothing["flag_single_guide"] == 0.0
    assert np.isnan(never_run["n_mechanism_flags"])
    assert ran_and_found_nothing["n_mechanism_flags"] == 0.0


def test_guide_agreement_reads_the_per_guide_values_against_the_called_direction():
    agree = F.build_vector({"hit": {"lfc": -1.5, "direction": "depleted",
                                    "guide_lfcs": [-1.4, -1.6, -1.5, -1.5]}})
    assert agree["guide_agreement"] == 1.0
    split = F.build_vector({"hit": {"lfc": -1.5, "direction": "depleted",
                                    "guide_lfcs": [-1.4, -1.6, 0.2, 0.4]}})
    assert split["guide_agreement"] == 0.5


def test_a_reported_p_value_of_zero_is_clamped_not_infinite():
    vector = F.build_vector({"hit": {"p_value": 0.0, "fdr": 0.0}})
    assert np.isfinite(vector["neg_log10_p"]) and vector["neg_log10_p"] == 300.0
    assert np.isfinite(vector["neg_log10_fdr"])


def test_the_vector_hash_pins_a_receipt_to_one_definition():
    assert F.spec_hash() == F.spec_hash()
    assert len(F.spec_hash()) == 64
    assert F.spec_manifest()["n_columns"] == len(F.COLUMNS)


def test_copy_number_is_a_first_class_channel():
    """
    Amplified regions deplete regardless of essentiality; correction removes
    70-80% of those false positives (doi:10.1371/journal.pcbi.1006279). A
    validation model blind to copy number is partly predicting the artefact.
    """
    names = {s.name for s in F.FEATURE_SPEC if s.family == "artifacts"}
    assert {"copy_number", "cn_corrected", "flag_copy_number_cluster"} <= names


# =====================================================================
# Splits
# =====================================================================

def test_a_grouped_fold_never_puts_a_group_on_both_sides():
    groups = [f"L{i % 7}" for i in range(140)]
    for fold in grouped_folds(groups, n_folds=4):
        assert not (set(fold.train_groups) & set(fold.test_groups))
        assert set(fold.train) | set(fold.test) == set(range(140))
        assert not (set(fold.train) & set(fold.test))


def test_an_unattributed_row_is_refused_not_given_its_own_group():
    """
    40 unattributed outcomes must not look like 40 independent laboratories.
    """
    with pytest.raises(LeakageError, match="no lab"):
        grouped_folds(["L1", None, "L2"], what="lab")
    with pytest.raises(LeakageError):
        grouped_folds(["L1", "  ", "L2"], what="lab")


def test_a_holdout_needs_enough_laboratories_to_be_one():
    groups = [f"L{i % 2}" for i in range(40)]
    with pytest.raises(LeakageError, match="needs at least"):
        lab_holdout(groups, n_test=2)
    plenty = [f"L{i % 6}" for i in range(120)]
    holdout = lab_holdout(plenty, n_test=2)
    assert len(holdout.test_groups) == 2
    assert not (set(holdout.train_groups) & set(holdout.test_groups))
    assert len(holdout.train_groups) >= 2, "the calibrator is cross-fitted over these"


# =====================================================================
# Models
# =====================================================================

def _design(rows):
    X = F.design_matrix([F.build_vector({**r.evidence, "context": r.context.as_dict()})
                         for r in rows])
    y = np.asarray([r.label for r in rows], dtype=int)
    groups = {"lab": [r.lab_id for r in rows],
              "study": [r.study_id for r in rows],
              "assay": [r.context.assay_class for r in rows]}
    return X, y, groups


def test_a_model_refuses_a_cohort_too_small_to_describe_anything(cohort_rows):
    decided = [r for r in cohort_rows if r.decided][:20]
    X, y, groups = _design(decided)
    with pytest.raises(FitError, match=str(MIN_FIT_OUTCOMES)):
        HierarchicalLogistic().fit(X, y, groups)


def test_a_model_refuses_a_cohort_from_one_laboratory(cohort_rows):
    one_lab = [r for r in cohort_rows if r.decided and r.lab_id == LABS[0]][:60]
    X, y, groups = _design(one_lab)
    with pytest.raises(FitError, match="group"):
        HierarchicalLogistic().fit(X, y, groups)


def test_a_model_refuses_a_cohort_where_everything_validated(cohort_rows):
    winners = [r for r in cohort_rows if r.result == "validated"][:80]
    X, y, groups = _design(winners)
    with pytest.raises(FitError, match="same result"):
        HierarchicalLogistic().fit(X, y, groups)


def test_the_hierarchical_model_recovers_the_signs_it_was_generated_with(cohort_rows):
    """
    The directions the generator used come back out of the fit.

    Most of this vector's channels are collinear with a neighbour by
    construction: `fdr` and `p_value` are the same quantity before and after
    multiple-testing correction, and guide agreement, the good-guide count and
    the per-guide spread are three readings of one measurement. A ridge penalty
    splits a shared signal across collinear columns, so an individual
    coefficient among them is not interpretable in isolation, and asserting its
    sign would be asserting an accident of the penalty.

    So this test asserts only the two channels that carry signal nothing else
    in the vector carries. The directional claim for everything else is made at
    the family level by `test_the_family_contribution_tracks_the_evidence`, and
    that split is the reason `contributions` reports by family rather than by
    column.
    """
    decided = [r for r in cohort_rows if r.decided and r.question == "reproduces"]
    X, y, groups = _design(decided)
    model = HierarchicalLogistic().fit(X, y, groups)
    assert model.converged
    coefficients = {c["column"]: c["coefficient"] for c in model.coefficients()}
    assert coefficients["abs_effect_size"] > 0, "a bigger effect validates more often"
    assert coefficients["flag_single_guide"] < 0, "one guide carrying it validates less"


def test_the_family_contribution_tracks_the_evidence(cohort_rows):
    """
    Two candidates differing only in significance differ in the right direction
    on the primary family's contribution, even though the individual
    coefficients of two collinear significance channels are not separable.
    """
    decided = [r for r in cohort_rows if r.decided and r.question == "reproduces"]
    X, y, groups = _design(decided)
    model = HierarchicalLogistic().fit(X, y, groups)
    strong = F.build_vector({"hit": {"lfc": -2.2, "fdr": 1e-8, "p_value": 1e-9,
                                     "n_guides": 4, "n_good_guides": 4,
                                     "direction": "depleted"}, "flags": []})
    weak = F.build_vector({"hit": {"lfc": -0.3, "fdr": 0.4, "p_value": 0.2,
                                   "n_guides": 4, "n_good_guides": 2,
                                   "direction": "depleted"}, "flags": []})
    rows = model.contributions(F.design_matrix([strong, weak]))
    assert rows[0]["by_family"]["primary"] > rows[1]["by_family"]["primary"]
    assert rows[0]["total"] > rows[1]["total"]
    #: And the flagged version of the strong candidate scores below it, because
    #: the artefact family can override the primary one.
    flagged = F.build_vector({"hit": {"lfc": -2.2, "fdr": 1e-8, "p_value": 1e-9,
                                      "n_guides": 4, "n_good_guides": 1,
                                      "direction": "depleted"},
                              "flags": ["single_guide"]})
    with_flag = model.contributions(F.design_matrix([flagged]))[0]
    assert with_flag["by_family"]["artifacts"] < rows[0]["by_family"]["artifacts"]
    assert with_flag["total"] < rows[0]["total"]


def test_per_family_contributions_add_up_exactly(cohort_rows):
    decided = [r for r in cohort_rows if r.decided and r.question == "reproduces"]
    X, y, groups = _design(decided)
    model = HierarchicalLogistic().fit(X, y, groups)
    for row in model.contributions(X[:5]):
        total = sum(row["by_family"].values()) + row["intercept"]
        assert abs(total - row["total"]) < 1e-9
        assert set(row["by_family"]) == set(F.FAMILIES)


def test_an_unseen_laboratory_gets_the_population_and_is_told_so(cohort_rows):
    decided = [r for r in cohort_rows if r.decided and r.question == "reproduces"]
    X, y, groups = _design(decided)
    model = HierarchicalLogistic().fit(X, y, groups)
    unseen = {"lab": ["NEVER_SEEN"], "study": ["NEW"], "assay": ["ko_fitness"]}
    assert model.unseen_groups(unseen)["lab"] == ["NEVER_SEEN"]
    with_lab = model.predict_proba(X[:1], {"lab": [groups["lab"][0]],
                                           "study": [groups["study"][0]],
                                           "assay": ["ko_fitness"]})
    without = model.predict_proba(X[:1], unseen)
    population = model.predict_proba(X[:1], None)
    assert abs(float(without[0]) - float(population[0])) < 1e-12
    assert float(with_lab[0]) != float(without[0]), "a known lab shifts the score"


def test_a_tree_drops_channels_nobody_recorded_rather_than_choking(cohort_rows):
    decided = [r for r in cohort_rows if r.decided][:200]
    X, y, groups = _design(decided)
    tree = GradientBoosted().fit(X, y, groups)
    assert tree.usable.sum() < len(F.FEATURE_NAMES), "some channels are never recorded"
    assert np.isfinite(tree.predict_proba(X[:10])).all()
    #: And it declines to invent a per-family decomposition it cannot compute.
    assert tree.contributions(X[:1])[0]["by_family"] is None


def test_model_selection_is_decided_on_held_out_laboratories(cohort_rows):
    decided = [r for r in cohort_rows if r.decided and r.question == "reproduces"]
    X, y, groups = _design(decided)
    selection = select_model(X, y, groups, n_folds=4)
    assert selection.unit == "lab"
    assert selection.chosen in selection.scores
    assert selection.scores[selection.chosen] == min(selection.scores.values())
    assert "lab-grouped folds" in selection.because


# =====================================================================
# Calibration
# =====================================================================

def test_calibration_removes_a_miscalibration_it_was_given():
    rng = np.random.default_rng(11)
    n = 600
    truth = rng.beta(2, 3, size=n)
    y = (rng.random(n) < truth).astype(int)
    #: A deliberately overconfident score: monotone in the truth, so perfectly
    #: ranked, and badly wrong as a probability. Calibration is the only thing
    #: that can fix it and AUROC cannot see the problem at all.
    score = np.clip(truth ** 0.5, 1e-6, 1 - 1e-6)
    before = calibration.metrics(score, y)
    choice = calibration.select_calibrator(score, y, [f"L{i % 8}" for i in range(n)])
    after = calibration.metrics(choice.calibrator.transform(score), y)
    oracle = calibration.metrics(truth, y)
    assert before.ece > 0.1
    assert after.ece < before.ece / 3
    #: The oracle's own ECE is the finite-sample floor. Beating it would mean
    #: fitting the sample's noise, so the assertion is a band, not a target.
    assert after.ece < oracle.ece * 2.5


def test_no_calibrator_is_fitted_below_the_minimum():
    rng = np.random.default_rng(5)
    n = calibration.MIN_CALIBRATION_N - 1
    with pytest.raises(calibration.CalibrationError, match=str(calibration.MIN_CALIBRATION_N)):
        calibration.select_calibrator(rng.random(n), rng.integers(0, 2, n),
                                      [f"L{i % 4}" for i in range(n)])


def test_isotonic_is_not_even_a_candidate_on_a_small_cohort():
    rng = np.random.default_rng(6)
    n = 100
    assert n < calibration.MIN_ISOTONIC_N
    choice = calibration.select_calibrator(
        rng.random(n), rng.integers(0, 2, n), [f"L{i % 5}" for i in range(n)])
    assert "isotonic" not in choice.scores
    assert "isotonic" in choice.because


def test_a_calibration_set_with_one_class_is_refused():
    rng = np.random.default_rng(7)
    n = 120
    with pytest.raises(calibration.CalibrationError, match="same result"):
        calibration.select_calibrator(rng.random(n), np.ones(n, dtype=int),
                                      [f"L{i % 4}" for i in range(n)])


def test_every_reliability_bin_carries_its_denominator():
    rng = np.random.default_rng(9)
    p = rng.random(200)
    y = (rng.random(200) < p).astype(int)
    bins = calibration.reliability(p, y)
    assert sum(b.n for b in bins) == 200
    for b in bins:
        if b.n == 0:
            assert b.predicted is None and b.observed is None and b.sparse
        else:
            assert b.observed_lower <= b.observed <= b.observed_upper
            assert b.sparse == (b.n < calibration.MIN_BIN_N)


def test_an_empty_bin_is_a_gap_and_not_an_interpolation():
    """A curve drawn across a bin with no outcomes invents the outcomes."""
    p = np.concatenate([np.full(40, 0.05), np.full(40, 0.95)])
    y = np.concatenate([np.zeros(40, int), np.ones(40, int)])
    bins = calibration.reliability(p, y)
    middle = [b for b in bins if b.lower in (0.2, 0.4, 0.6)]
    assert all(b.n == 0 and b.observed is None for b in middle)


def test_a_wilson_interval_is_exactly_zero_or_one_at_the_edges():
    assert calibration.wilson(0, 3)[0] == 0.0
    assert calibration.wilson(3, 3)[1] == 1.0
    tight = calibration.wilson(400, 500)
    loose = calibration.wilson(4, 5)
    assert tight[1] - tight[0] < loose[1] - loose[0], "the same 80% at different n"


def test_the_calibration_fit_says_what_the_slope_means():
    rng = np.random.default_rng(13)
    n = 800
    truth = rng.random(n)
    y = (rng.random(n) < truth).astype(int)
    good = calibration.calibration_fit(truth, y)
    assert "about right" in good.verdict
    overconfident = np.clip((truth - 0.5) * 2.4 + 0.5, 0.01, 0.99)
    assert "more extreme" in calibration.calibration_fit(overconfident, y).verdict


# =====================================================================
# The coverage gate
# =====================================================================

def _simple(n, labs=4, screens=8, result="validated", **context):
    return [OutcomeRecord(f"o{i}", "G", "independent_guide", result,
                          Context(context.get("assay_class", "ko_fitness"),
                                  context.get("modality", "knockout"),
                                  context.get("phenotype_family", "fitness"),
                                  context.get("model_type", "cancer_cell_line")),
                          lab_id=f"L{i % labs}", study_id=f"ST{i % labs}",
                          screen_id=f"SC{i % screens}")
            for i in range(n)]


def test_an_empty_cohort_licenses_nothing_and_names_the_shortfall():
    table = CoverageTable.from_outcomes([])
    result = table.availability(stratum_for("reproduces", {"assay_class": "ko_fitness"}))
    assert isinstance(result, Unavailable)
    assert result.reason == "network_not_calibrated"
    assert str(MIN_NETWORK_OUTCOMES) in result.because
    assert str(MIN_NETWORK_LABS) in result.because
    #: There is no probability on an Unavailable, so no code path can render
    #: one by mistake.
    assert not hasattr(result, "probability")


def test_the_gate_stays_shut_without_a_held_out_evaluation():
    table = CoverageTable.from_outcomes(_simple(200))
    result = table.availability(stratum_for("reproduces", {"assay_class": "ko_fitness"}))
    assert not result.available
    assert "held-out-laboratory evaluation" in result.because


def test_the_gate_refuses_a_cohort_that_disagrees_with_itself():
    table = CoverageTable.from_outcomes(_simple(200), holdout_evaluated=True,
                                        disagreement_rate=0.4)
    result = table.availability(stratum_for("reproduces", {"assay_class": "ko_fitness"}))
    assert not result.available
    assert "disagreement rate" in result.because


def test_each_stratum_floor_is_enforced_on_its_own():
    stratum = stratum_for("reproduces", {"assay_class": "ko_fitness"})
    plenty = CoverageTable.from_outcomes(_simple(200, labs=4, screens=8),
                                         holdout_evaluated=True)
    assert plenty.availability(stratum).available

    #: Enough outcomes and enough screens, too few laboratories.
    few_labs = CoverageTable.from_outcomes(
        _simple(200, labs=MIN_STRATUM_LABS - 1, screens=8), holdout_evaluated=True)
    blocked = few_labs.availability(stratum)
    assert not blocked.available
    assert any("laboratories" in s for s in blocked.shortfall)

    #: Enough outcomes and laboratories, too few primary screens.
    few_screens = CoverageTable.from_outcomes(
        _simple(200, labs=4, screens=MIN_STRATUM_SCREENS - 1), holdout_evaluated=True)
    blocked = few_screens.availability(stratum)
    assert not blocked.available
    assert any("primary screens" in s for s in blocked.shortfall)


def test_only_decided_outcomes_open_the_gate():
    """A stratum of pending experiments has measured nothing."""
    rows = _simple(MIN_STRATUM_OUTCOMES * 3, result="pending")
    table = CoverageTable.from_outcomes(rows, holdout_evaluated=True)
    result = table.availability(stratum_for("reproduces", {"assay_class": "ko_fitness"}))
    assert not result.available


def test_an_out_of_domain_experiment_is_refused_by_a_working_network():
    table = CoverageTable.from_outcomes(_simple(200), holdout_evaluated=True)
    exotic = Stratum("reproduces", "reporter", "crispra", "differentiation",
                     "ipsc_derived")
    result = table.availability(exotic)
    assert not result.available
    assert result.reason == "out_of_domain"
    assert "outside the contexts" in result.because


def test_a_fallback_is_taken_in_a_declared_order_and_declared_in_the_sentence():
    table = CoverageTable.from_outcomes(_simple(200), holdout_evaluated=True)
    organoid = Stratum("reproduces", "ko_fitness", "knockout", "fitness", "organoid")
    result = table.availability(organoid)
    assert result.available
    assert not result.exact
    assert result.relaxed == ("model_type",)
    assert "broader cohort than the experiment" in result.cohort_sentence()
    assert "model type" in result.cohort_sentence()


def test_the_four_questions_are_gated_independently():
    """A cohort of guide validations says nothing about pharmacology."""
    table = CoverageTable.from_outcomes(_simple(200), holdout_evaluated=True)
    assert table.availability(
        stratum_for("reproduces", {"assay_class": "ko_fitness"})).available
    for question in ("pharmacologic", "target_specific", "cross_model"):
        result = table.availability(
            stratum_for(question, {"assay_class": "ko_fitness"}))
        assert not result.available, question


# =====================================================================
# Baselines and evaluation
# =====================================================================

def test_a_baseline_puts_what_it_cannot_rank_last_and_says_how_many():
    candidates = [{"hit": {"fdr": 0.01}}, {"hit": {}}, {"hit": {"fdr": 0.5}}]
    ranking = baselines.baseline_fdr(candidates)
    assert ranking.order == (0, 2, 1)
    assert ranking.n_unrankable == 1


def test_a_baseline_never_scores_a_missing_q_value_as_the_best_one():
    """A missing FDR treated as 0 would be the most significant gene there is."""
    candidates = [{"hit": {}}, {"hit": {"fdr": 0.2}}]
    assert baselines.baseline_fdr(candidates).order[0] == 1


def test_ties_break_stably_so_a_metric_does_not_move_between_runs():
    candidates = [{"hit": {"fdr": 0.01}} for _ in range(10)]
    first = baselines.baseline_fdr(candidates).order
    assert first == tuple(range(10))
    assert baselines.baseline_fdr(candidates).order == first


def test_precision_at_k_leaves_untested_candidates_out_of_the_denominator():
    ranking = baselines.ranking_from_scores([0.9, 0.8, 0.7, 0.6, 0.5])
    labels = [1, None, 0, None, None]
    result = evaluation.precision_at_k(ranking, labels, 5)
    assert result.n_decided == 2
    assert result.n_validated == 1
    assert result.precision == 0.5
    assert result.n_untested == 3
    assert "3 of the 5 were not tested" in result.sentence()


def test_no_decided_outcome_in_the_top_k_states_no_rate():
    ranking = baselines.ranking_from_scores([0.9, 0.8])
    result = evaluation.precision_at_k(ranking, [None, None], 2)
    assert result.precision is None
    assert "no rate is stated" in result.sentence()


def test_an_unstratified_cohort_labels_its_own_rate():
    ranking = baselines.ranking_from_scores([0.9, 0.8, 0.7])
    loose = evaluation.precision_at_k(ranking, [1, 1, 0], 3, stratified=False)
    tight = evaluation.precision_at_k(ranking, [1, 1, 0], 3, stratified=True)
    assert "not rank-stratified" in loose.sentence()
    assert "not rank-stratified" not in tight.sentence()


def test_hits_per_budget_is_denominated_in_bench_work():
    ranking = baselines.ranking_from_scores([0.9, 0.8, 0.7, 0.6])
    budget = evaluation.hits_per_budget(ranking, [1, 0, 1, 0], 4)
    assert budget.confirmed == 2
    assert budget.cost_per_confirmation == 2.0
    assert "2 confirmed hits from 4 validations" in budget.sentence()


def test_no_confirmation_means_no_cost_per_confirmation_not_an_infinity():
    ranking = baselines.ranking_from_scores([0.9, 0.8])
    budget = evaluation.hits_per_budget(ranking, [0, 0], 2)
    assert budget.cost_per_confirmation is None
    assert "no cost per confirmation is stated" in budget.sentence()


def test_a_comparator_precision_of_zero_gives_a_difference_and_no_ratio():
    mine = evaluation.PrecisionAtK("mine", 5, 5, 4, 0.8, 0.4, 0.96, 0, True)
    theirs = evaluation.PrecisionAtK("theirs", 5, 5, 0, 0.0, 0.0, 0.43, 0, True)
    result = evaluation.lift(mine, theirs)
    assert result.ratio is None
    assert result.difference == 0.8


def test_mcnemar_uses_only_the_candidates_the_strategies_disagree_about():
    mine = baselines.ranking_from_scores([1.0, 0.9, 0.8, 0.1, 0.05])
    theirs = baselines.ranking_from_scores([0.1, 0.9, 0.8, 1.0, 0.05])
    labels = [1, 1, 1, 0, 0]
    result = evaluation.mcnemar(mine, theirs, labels, 3)
    assert result.n_concordant == 2, "indices 1 and 2 are in both top-3 lists"
    assert result.n_discordant == 2
    assert result.strategy_only_confirmed == 1
    assert result.comparator_only_confirmed == 0
    assert "are excluded, because they cannot distinguish them" in result.because


def test_mcnemar_says_nothing_when_nothing_discordant_was_confirmed():
    mine = baselines.ranking_from_scores([1.0, 0.1])
    theirs = baselines.ranking_from_scores([0.1, 1.0])
    result = evaluation.mcnemar(mine, theirs, [0, 0], 1)
    assert result.p_value is None
    assert "nothing to work with" in result.because


def test_abstention_is_reported_as_a_strength():
    available = type("A", (), {"available": True})()
    declined = type("U", (), {"available": False, "reason": "out_of_domain"})()
    result = evaluation.abstention([available] * 3 + [declined] * 7)
    assert result.coverage == 0.3
    assert result.reasons == {"out_of_domain": 7}
    assert "the gate working rather than failing" in result.sentence()


def test_uncertainty_is_clustered_by_laboratory():
    one = evaluation.by_laboratory([0.6, 0.7, 0.8], ["L1", "L1", "L1"])
    assert one["ci95"] is None, "one laboratory carries no between-lab information"
    many = evaluation.by_laboratory([0.6, 0.7, 0.8, 0.5], ["A", "B", "C", "D"])
    assert many["ci95"] is not None
    assert many["unit"] == "publication"


# =====================================================================
# Cohort design
# =====================================================================

def test_the_published_design_reproduces_exactly_at_genome_scale():
    """doi:10.1038/s43586-022-00098-7: top 20 plus 10 at each of five percentiles."""
    genes = [f"G{i:05d}" for i in range(20000)]
    rng = np.random.default_rng(5)
    chosen = cohort.rank_stratified(
        baselines.ranking_from_scores(rng.random(20000)), genes)
    assert len(chosen.slots) == cohort.RANK_STRATIFIED_REFERENCE["total"] == 70
    assert chosen.by_stratum["top_20"] == 20
    for percentile in cohort.RANK_STRATIFIED_REFERENCE["percentiles"]:
        assert chosen.by_stratum[f"p{percentile}"] == 10
    assert cohort.RANK_STRATIFIED_REFERENCE["source"] in chosen.note


def test_a_short_candidate_list_reports_where_it_differs_from_the_design():
    genes = [f"G{i:03d}" for i in range(200)]
    rng = np.random.default_rng(5)
    chosen = cohort.rank_stratified(
        baselines.ranking_from_scores(rng.random(200)), genes)
    #: The 5th percentile of 200 candidates is rank 10, which the top-20 block
    #: already holds. That is not a bug and it is not hidden.
    assert "fell inside a block already drawn" in chosen.note
    assert len(chosen.slots) == 70


def test_a_smaller_budget_keeps_every_percentile():
    genes = [f"G{i:05d}" for i in range(20000)]
    rng = np.random.default_rng(5)
    chosen = cohort.rank_stratified(
        baselines.ranking_from_scores(rng.random(20000)), genes, budget=20)
    assert len(chosen.slots) == 20
    for percentile in cohort.RANK_STRATIFIED_REFERENCE["percentiles"]:
        assert chosen.by_stratum.get(f"p{percentile}", 0) >= 1, percentile
    assert "scaled from the published" in chosen.note


def test_arms_are_deduplicated_and_splicr_is_credited_last():
    """
    A candidate the investigator also chose is attributed to the investigator,
    so every lift this design measures is a conservative one.
    """
    genes = [f"G{i:03d}" for i in range(50)]
    shared = baselines.ranking_from_scores([1.0 - i * 0.01 for i in range(50)])
    chosen = cohort.stratified_arms(
        {"splicr": shared, "investigator": shared}, genes, budget=10)
    assert len({s.index for s in chosen.slots}) == len(chosen.slots)
    assert chosen.overlap_saved > 0
    top = next(s for s in chosen.slots if s.gene == "G000")
    assert top.arm == "investigator"
    assert "SplicR is last" in chosen.note


def test_a_budget_buys_distinct_candidates_not_slots():
    genes = [f"G{i:03d}" for i in range(80)]
    rng = np.random.default_rng(3)
    rankings = {name: baselines.ranking_from_scores(rng.random(80))
                for name in ("splicr", "fdr", "investigator", "random")}
    chosen = cohort.stratified_arms(rankings, genes, budget=20)
    assert len(chosen.slots) == 20
    assert len(set(chosen.genes)) == 20


# =====================================================================
# Receipts
# =====================================================================

def _receipt(tmp_path, **over):
    payload = dict(
        candidates=[{"gene": f"G{i}", "rank": i + 1, "score": 1.0 - i * 0.01,
                     "probability": None, "question": "reproduces",
                     "evidence": {"effect_size": -1.2}} for i in range(5)],
        validation_set={"slots": [{"gene": "G0", "arm": "splicr"}]},
        rankings={"splicr": {"name": "splicr"}},
        model_manifest={"algorithm": "hierarchical_logistic"},
        calibration_manifest=None,
        coverage={"available": False, "reason": "network_not_calibrated"},
        endpoint_key="ko_fitness_independent_guide.v1",
        laboratory_threshold=1.0,
        screen={"screen_id": "s1", "library": "geckov2"},
    )
    payload.update(over)
    return receipts.build("rnd-1", **payload)


def test_a_receipt_is_a_content_commitment_that_verifies(tmp_path):
    receipt = _receipt(tmp_path)
    written = receipts.write(receipt, tmp_path / "r.json")
    report = receipts.verify(written.path, written.digest)
    assert report["ok"]
    assert report["bytes_canonical"]
    assert report["matches_expected"]
    assert report["carries_no_outcome"]


def test_a_receipt_is_never_overwritten(tmp_path):
    receipt = _receipt(tmp_path)
    receipts.write(receipt, tmp_path / "r.json")
    with pytest.raises(receipts.ReceiptError, match="never overwritten"):
        receipts.write(receipt, tmp_path / "r.json")


def test_an_edited_receipt_fails_even_without_a_retained_hash(tmp_path):
    """
    The custodian's hash is the strong check, and it is not always to hand.
    Canonical-byte comparison catches an edit on its own.
    """
    written = receipts.write(_receipt(tmp_path), tmp_path / "r.json")
    written.path.write_text(written.path.read_text().replace('"rank": 1', '"rank":  1'))
    report = receipts.verify(written.path)
    assert not report["ok"]
    assert report["bytes_canonical"] is False


def test_a_swapped_receipt_fails_against_the_retained_hash(tmp_path):
    written = receipts.write(_receipt(tmp_path), tmp_path / "r.json")
    payload = json.loads(written.path.read_text())
    payload["candidates"][0]["rank"] = 99
    written.path.write_bytes(receipts.canonical_bytes(payload))
    report = receipts.verify(written.path, written.digest)
    assert not report["ok"]
    assert report["matches_expected"] is False


def test_a_receipt_cannot_be_made_to_carry_an_outcome(tmp_path):
    """
    The API has no outcome argument, and the payload is searched anyway, because
    a free-form evidence mapping is somewhere a label could be hidden.
    """
    for where in ({"evidence": {"result": "validated"}},
                  {"evidence": {"nested": {"ground_truth": 1}}}):
        with pytest.raises(receipts.ReceiptError, match="looks like an outcome"):
            _receipt(tmp_path, candidates=[{"gene": "G0", "rank": 1, **where}])


def test_a_receipt_freezes_the_whole_universe_not_just_the_picks(tmp_path):
    receipt = _receipt(tmp_path)
    assert len(receipt.payload["candidates"]) == 5
    assert len(receipt.payload["validation_set"]["slots"]) == 1
    with pytest.raises(receipts.ReceiptError, match="candidate universe"):
        _receipt(tmp_path, candidates=[])
    with pytest.raises(receipts.ReceiptError, match="same gene twice"):
        _receipt(tmp_path, candidates=[{"gene": "G0", "rank": 1},
                                       {"gene": "G0", "rank": 2}])


def test_a_receipt_pins_the_rules_it_was_written_under(tmp_path):
    provenance = _receipt(tmp_path).payload["provenance"]
    assert provenance["feature_spec_sha256"] == F.spec_hash()
    assert provenance["endpoint_registry_sha256"] == E.registry_hash()
    assert "git_dirty" in provenance


def test_a_receipt_says_its_timestamp_is_not_trusted(tmp_path):
    trust = _receipt(tmp_path).payload["timestamp_trust"]
    assert "independent custodian" in trust


# =====================================================================
# Rounds
# =====================================================================

def _round(budget=8):
    genes = [f"G{i:02d}" for i in range(50)]
    rng = np.random.default_rng(2)
    rankings = {"splicr": baselines.ranking_from_scores(rng.random(50)),
                "fdr": baselines.ranking_from_scores(rng.random(50))}
    plan = cohort.plan(rankings, genes, budget=budget,
                       endpoint_key="ko_fitness_independent_guide.v1",
                       laboratory_threshold=1.0)
    return Round("rnd-1", "s1", plan)


def _outcome(gene, result, index, endpoint="ko_fitness_independent_guide"):
    return OutcomeRecord(f"o{index}", gene, "independent_guide", result,
                         Context("ko_fitness"), lab_id="L1", study_id="st1",
                         screen_id="s1", endpoint_id=endpoint, endpoint_version=1,
                         laboratory_threshold=1.0,
                         measurement={**MEASUREMENT, "effect_size": -1.4})


def test_outcomes_cannot_be_attached_to_an_unfrozen_round():
    draft = _round()
    with pytest.raises(RoundError, match="never frozen"):
        draft.reveal([_outcome(draft.selected_genes[0], "validated", 1)])


def test_a_frozen_round_cannot_be_refrozen_or_revealed_twice():
    frozen = _round().freeze("a" * 64)
    with pytest.raises(RoundError, match="already frozen"):
        frozen.freeze("b" * 64)
    revealed = frozen.reveal([_outcome(g, "validated", i)
                              for i, g in enumerate(frozen.selected_genes)])
    with pytest.raises(RoundError, match="already been revealed"):
        revealed.reveal([_outcome(frozen.selected_genes[0], "failed", 99)])


def test_the_validation_set_cannot_grow_after_the_freeze():
    frozen = _round().freeze("a" * 64)
    with pytest.raises(RoundError, match="cannot grow after"):
        frozen.reveal([_outcome("NOT_IN_THE_SET", "validated", 1)])


def test_an_outcome_scored_against_another_endpoint_is_refused():
    frozen = _round().freeze("a" * 64)
    with pytest.raises(RoundError, match="other than the round"):
        frozen.reveal([_outcome(frozen.selected_genes[0], "validated", 1,
                                endpoint="pharmacologic_inhibition")])


def test_a_partial_reveal_is_allowed_only_when_the_caller_says_so():
    frozen = _round().freeze("a" * 64)
    one = [_outcome(frozen.selected_genes[0], "validated", 1)]
    with pytest.raises(RoundError, match="no outcome"):
        frozen.reveal(one, allow_partial=False)
    partial = frozen.reveal(one, allow_partial=True)
    assert partial.completeness()["complete"] is False
    assert partial.labels()[1:] == [None] * (len(frozen.selected_genes) - 1)


def test_freezing_needs_a_real_receipt_hash():
    with pytest.raises(RoundError, match="full sha256"):
        _round().freeze("short")


def test_a_round_with_no_candidates_cannot_be_frozen():
    genes = ["G0"]
    plan = cohort.plan({"splicr": baselines.ranking_from_scores([1.0])}, genes,
                       budget=1)
    empty = Round("r", "s", plan)
    object.__setattr__(empty.plan.validation_set, "slots", ())
    with pytest.raises(RoundError, match="no candidates"):
        empty.freeze("a" * 64)


def test_the_blind_manifest_hides_the_arm_and_is_not_in_ranking_order():
    frozen = _round(budget=12).freeze("a" * 64)
    manifest = frozen.blind_manifest()
    assert manifest["genes"] != list(frozen.selected_genes)
    assert sorted(manifest["genes"]) == sorted(frozen.selected_genes)
    body = json.dumps(manifest)
    for arm in ("splicr", "fdr", "investigator", "random"):
        assert f'"{arm}"' not in body
    assert "rank" not in body
    assert "including the ones that look uninteresting" in manifest["instructions"]


def test_a_blind_manifest_comes_only_from_a_frozen_round():
    with pytest.raises(RoundError, match="frozen round"):
        _round().blind_manifest()


def test_revealing_stamps_each_outcome_with_the_arm_it_was_drawn_from():
    frozen = _round().freeze("a" * 64)
    revealed = frozen.reveal([_outcome(g, "validated", i)
                              for i, g in enumerate(frozen.selected_genes)])
    assert {o.arm for o in revealed.outcomes} <= {"splicr", "fdr"}
    assert all(o.round_id == "rnd-1" for o in revealed.outcomes)
    assert all(o.recorded_at for o in revealed.outcomes)


# =====================================================================
# The network end to end
# =====================================================================

def test_an_unfitted_network_refuses_all_four_questions_with_reasons():
    network = ValidationNetwork()
    assert not network.fitted
    result = network.estimate({"gene": "CDK2", "hit": {"lfc": -2.0, "fdr": 1e-6},
                               "context": {"assay_class": "ko_fitness"}})
    assert set(result) == set(E.QUESTIONS)
    for question, value in result.items():
        assert not value.available, question
        assert value.because
        assert not isinstance(value, Estimate)
    status = network.status()
    assert status["fitted"] is False
    assert len(status["questions"]) == 4


def test_fitting_produces_a_head_per_question_with_enough_outcomes(fitted):
    status = fitted.status()
    assert status["fitted"]
    assert "reproduces" in status["heads"]
    #: 60 pharmacologic outcomes is not enough to calibrate on, and the head
    #: refuses rather than existing. That refusal is the designed behaviour.
    assert "pharmacologic" not in status["heads"]
    assert "pharmacologic" in status["refusals"]
    assert "below the" in status["refusals"]["pharmacologic"]["because"]


def test_a_cohort_whose_evidence_is_the_wrong_shape_is_refused(cohort_rows):
    """
    A fit on a wall of missing values succeeds and learns nothing.

    That is far worse than failing, because a model that learned nothing still
    returns a number. An outcome's `evidence` has to be shaped the way the
    pipeline writes a candidate; a cohort imported with different keys is
    refused, with the channels it did manage to read named so an importer can
    see what went wrong.
    """
    from dataclasses import replace

    misshapen = [replace(o, evidence={"log2FoldChange": -1.2, "padj": 0.01})
                 for o in cohort_rows]
    network = ValidationNetwork.fit(misshapen)
    assert not network.fitted
    assert set(network.refusals) == set(E.QUESTIONS)
    for question, refusal in network.refusals.items():
        assert refusal.reason == "evidence_missing", question
        assert "evidence channels were recorded" in refusal.because
        assert "hit, qc, flags, artifacts and context" in refusal.because
    # And every estimate is refused rather than returning a learned-nothing
    # probability.
    for value in network.estimate({"gene": "G", "hit": {"lfc": -2.0, "fdr": 1e-6},
                                   "context": {"assay_class": "ko_fitness"}}).values():
        assert not value.available


def test_every_fitted_head_beats_predicting_the_base_rate_on_unseen_labs(fitted):
    for question, head in fitted.status()["heads"].items():
        test = head["evaluation"]["test"]
        assert test["beats_base_rate"], question
        assert test["n"] > 0
        assert len(head["evaluation"]["holdout"]["test_groups"]) == 2


def test_the_calibrator_never_sees_the_test_laboratories(fitted):
    for question, head in fitted.status()["heads"].items():
        holdout = head["evaluation"]["holdout"]
        assert not (set(holdout["train_groups"]) & set(holdout["test_groups"]))
        assert "out-of-fold" in head["evaluation"]["calibration_source"] or \
               "held-out calibration" in head["evaluation"]["calibration_source"]


def test_the_four_heads_do_not_share_a_number(fitted):
    rng = np.random.default_rng(99)
    evidence = _evidence(rng)
    evidence["hit"].update({"lfc": -2.0, "fdr": 1e-5, "n_good_guides": 4,
                            "n_guides": 4})
    evidence["flags"] = []
    candidate = {"gene": "CDK2",
                 "context": {"assay_class": "ko_fitness", "modality": "knockout",
                             "phenotype_family": "fitness",
                             "model_type": "cancer_cell_line"},
                 **evidence}
    estimates = {q: v for q, v in fitted.estimate(candidate).items()
                 if isinstance(v, Estimate)}
    assert len(estimates) >= 2
    probabilities = [round(v.probability, 4) for v in estimates.values()]
    assert len(set(probabilities)) == len(probabilities)
    versions = {v.model_version for v in estimates.values()}
    assert len(versions) == len(estimates), "each head has its own version"


def test_an_estimate_cannot_be_printed_without_its_cohort(fitted):
    rng = np.random.default_rng(7)
    candidate = {"gene": "CDK2",
                 "context": {"assay_class": "ko_fitness", "modality": "knockout",
                             "phenotype_family": "fitness",
                             "model_type": "cancer_cell_line"},
                 **_evidence(rng)}
    estimate = fitted.estimate(candidate)["reproduces"]
    assert isinstance(estimate, Estimate)
    #: Every one of the four questions' sentences names the experiment, so a
    #: percentage cannot appear without the clause that interprets it.
    assert E.QUESTION_SENTENCE["reproduces"] in estimate.sentence
    assert "Calibrated on" in estimate.cohort_sentence
    assert "laboratories" in estimate.cohort_sentence
    assert str(estimate.availability.n_decided) in estimate.cohort_sentence


def test_a_fitted_network_still_refuses_out_of_domain(fitted):
    exotic = {"gene": "FOXG1",
              "context": {"assay_class": "reporter", "modality": "crispra",
                          "phenotype_family": "differentiation",
                          "model_type": "ipsc_derived"},
              "hit": {"lfc": -3.0, "fdr": 1e-9}}
    for question, value in fitted.estimate(exotic).items():
        assert not value.available, question


def test_the_estimate_is_censored_at_the_edge_of_its_evidence(fitted):
    """
    A model can be confident past the edge of its cohort. Reporting "98%" when
    the calibration cohort's highest probability was 94% is a sharper claim than
    any outcome supports, so the estimate becomes a floor and says so.
    """
    rng = np.random.default_rng(99)
    evidence = _evidence(rng)
    evidence["hit"].update({"lfc": -6.0, "fdr": 1e-30, "n_good_guides": 4,
                            "n_guides": 4})
    evidence["flags"] = []
    candidate = {"gene": "EXTREME",
                 "context": {"assay_class": "ko_fitness", "modality": "knockout",
                             "phenotype_family": "fitness",
                             "model_type": "cancer_cell_line"},
                 **evidence}
    bounded = [v for v in fitted.estimate(candidate).values()
               if isinstance(v, Estimate) and v.bounded != "none"]
    assert bounded, "an extreme candidate should hit at least one head's ceiling"
    for estimate in bounded:
        assert estimate.sentence.startswith(("At least", "At most"))
        assert "extrapolating the fitted curve" in estimate.bound_note


def test_no_probability_is_ever_printed_as_certainty():
    assert format_probability(1.0) == ">99%"
    assert format_probability(0.9999) == ">99%"
    assert format_probability(CERTAINTY_CEILING) == ">99%"
    assert format_probability(0.0) == "<1%"
    assert format_probability(0.4) == "40%"
    assert format_probability(float("nan")) == "not available"


def test_abstention_over_a_mixed_list_counts_both_branches(fitted):
    rng = np.random.default_rng(31)
    inside = [{"gene": f"G{i}",
               "context": {"assay_class": "ko_fitness", "modality": "knockout",
                           "phenotype_family": "fitness",
                           "model_type": "cancer_cell_line"},
               **_evidence(rng)} for i in range(20)]
    outside = [{"gene": f"X{i}",
                "context": {"assay_class": "reporter", "modality": "crispra",
                            "phenotype_family": "differentiation",
                            "model_type": "ipsc_derived"},
                **_evidence(rng)} for i in range(10)]
    result = fitted.abstention_over(inside + outside, "reproduces")
    assert result["n_candidates"] == 30
    assert result["n_estimated"] == 20
    assert result["n_declined"] == 10
    assert result["reasons"] == {"out_of_domain": 10}


def test_the_cohort_is_what_is_stored_and_the_model_is_derived(tmp_path, cohort_rows):
    digest = write_cohort(cohort_rows, tmp_path / "cohort.json")
    loaded = load_network(tmp_path / "cohort.json", use_cache=False)
    assert loaded.cohort_sha256 == digest
    assert loaded.n_outcomes == len(cohort_rows)
    assert loaded.network.fitted
    #: Refitting from the same cohort gives the same head versions, which is
    #: what makes a receipt's claim checkable by somebody who has the cohort.
    again = load_network(tmp_path / "cohort.json", use_cache=False)
    assert ({q: h.version for q, h in loaded.network.heads.items()}
            == {q: h.version for q, h in again.network.heads.items()})


def test_a_missing_cohort_and_an_unreadable_one_are_different_states(tmp_path):
    missing = load_network(tmp_path / "nope.json", use_cache=False)
    assert missing.problem is None
    assert "no cohort file" in missing.source
    (tmp_path / "bad.json").write_text("{not json")
    broken = load_network(tmp_path / "bad.json", use_cache=False)
    assert broken.problem is not None
    assert "unreadable" in broken.source


# =====================================================================
# The ladder
# =====================================================================

def _ladder_outcome(gene, kind, result, effect, endpoint, index):
    return OutcomeRecord(f"o{index}", gene, kind, result, Context("ko_fitness"),
                         lab_id="L1", study_id="s", screen_id="sc",
                         endpoint_id=endpoint, endpoint_version=1,
                         laboratory_threshold=0.5,
                         measurement={**MEASUREMENT, "effect_size": effect})


def test_the_ladder_reproduces_the_published_prkdc_result():
    """
    PRKDC in doi:10.1158/0008-5472.CAN-24-0775 validated genetically and not
    pharmacologically. Both statements are true and the ladder holds both.
    """
    rows = [
        _ladder_outcome("PRKDC", "independent_guide", "validated", -1.4,
                        "ko_fitness_independent_guide", 1),
        _ladder_outcome("PRKDC", "organoid", "validated", -1.1,
                        "organoid_growth_arrayed", 2),
        _ladder_outcome("PRKDC", "small_molecule", "failed", -0.05,
                        "pharmacologic_inhibition", 3),
        _ladder_outcome("PRKDC", "small_molecule", "failed", -0.02,
                        "pharmacologic_inhibition", 4),
    ]
    payload = ladder("PRKDC", rows, primary_significant=True)
    states = {r["key"]: r["state"] for r in payload["rungs"]}
    assert states["primary"] == "met"
    assert states["guide"] == "met"
    assert states["pharmacologic"] == "not_met"
    assert states["another_model"] == "met"
    assert states["orthogonal"] == "not_tested"
    assert states["in_vivo"] == "not_tested"


def test_the_ladder_can_say_mixed_which_is_the_ptk2_case():
    """
    Two PTK2 inhibitors: GSK2256098 had no effect on either line, PF-573228
    produced a partial response in one. Neither 'validated' nor 'failed' is
    true, and a ladder that could not say 'mixed' would have to pick one.
    """
    rows = [
        _ladder_outcome("PTK2", "independent_guide", "validated", -1.2,
                        "ko_fitness_independent_guide", 1),
        _ladder_outcome("PTK2", "small_molecule", "failed", -0.01,
                        "pharmacologic_inhibition", 2),
        _ladder_outcome("PTK2", "small_molecule", "validated", -0.9,
                        "pharmacologic_inhibition", 3),
    ]
    payload = ladder("PTK2", rows, primary_significant=True)
    rung = next(r for r in payload["rungs"] if r["key"] == "pharmacologic")
    assert rung["state"] == "mixed"
    assert rung["n_met"] == 1 and rung["n_not_met"] == 1
    assert "disagreement is information rather than noise" in rung["because"]
    #: A mixed rung is worth another replicate before climbing a new rung.
    assert next_experiment(payload)["rung"] == "pharmacologic"


def test_not_tested_is_never_shown_as_a_negative():
    from splicr.validation.report import STATE_GLOSS

    payload = ladder("NEW", [], primary_significant=True)
    for rung in payload["rungs"]:
        if rung["key"] == "primary":
            continue
        assert rung["state"] == "not_tested"
        assert rung["n_outcomes"] == 0
        assert rung["state_label"] == "Not tested"
        assert "not a negative result" in rung["state_gloss"]
    assert "It is not a negative result." in STATE_GLOSS["not_tested"]
    #: And the four states stay four distinct words, so no view can collapse
    #: 'not tested' into 'not met' by relabelling.
    assert len({STATE_GLOSS[s] for s in payload["states"]}) == 4


def test_a_record_the_endpoint_cannot_score_keeps_the_laboratorys_own_result():
    """
    The bug the end-to-end suite caught against a real session.

    An outcome logged outside a blinded round has no prespecified laboratory
    effect bar, so the arrayed endpoints return 'insufficient_record' for it.
    That is the normal state for every outcome a researcher logs from the Truth
    Loop. Treating it as "no outcome" showed a rung as untested beside a panel
    saying two outcomes existed, which discarded what the scientist recorded.

    The endpoint overrides the recorded result only where it reaches an actual
    verdict. The cohort counting in `coverage` stays stricter, and
    `endpoint_disagreements` still reports every unscorable record.
    """
    unscorable = [
        # No laboratory_threshold, so the effect criterion cannot be evaluated.
        OutcomeRecord("o1", "G", "independent_guide", "validated",
                      Context("ko_fitness"), lab_id="L1",
                      endpoint_id="ko_fitness_independent_guide", endpoint_version=1,
                      measurement={**MEASUREMENT, "effect_size": -1.4}),
        OutcomeRecord("o2", "G", "small_molecule", "failed",
                      Context("other"), lab_id="L1",
                      endpoint_id="pharmacologic_inhibition", endpoint_version=1,
                      measurement={**MEASUREMENT, "effect_size": -0.05}),
    ]
    assert all(o.decide().decision == "insufficient_record" for o in unscorable)
    payload = ladder("G", unscorable, primary_significant=True)
    states = {r["key"]: r["state"] for r in payload["rungs"]}
    assert states["guide"] == "met", "the laboratory said it validated"
    assert states["pharmacologic"] == "not_met", "the laboratory said it did not"
    assert states["orthogonal"] == "not_tested", "and nobody ran that one"
    # The rung counts and the panel's own total agree, which is what broke.
    guide = next(r for r in payload["rungs"] if r["key"] == "guide")
    assert guide["n_outcomes"] == 1 and guide["n_met"] == 1


def test_an_endpointless_outcome_still_keeps_its_recorded_result():
    """A validation type with no endpoint must not lose the lab's own label."""
    rows = [OutcomeRecord("o1", "G", "orthogonal_genetic", "validated",
                          Context("other"), lab_id="L1",
                          measurement={"effect_size": -1.0})]
    payload = ladder("G", rows, primary_significant=True)
    states = {r["key"]: r["state"] for r in payload["rungs"]}
    assert states["orthogonal"] == "met"


def test_an_inconclusive_outcome_does_not_mark_a_rung_against_the_gene():
    rows = [_ladder_outcome("G", "independent_guide", "inconclusive", None,
                            "ko_fitness_independent_guide", 1)]
    rung = next(r for r in ladder("G", rows, primary_significant=True)["rungs"]
                if r["key"] == "guide")
    assert rung["state"] == "not_tested"
    assert rung["n_inconclusive"] == 1
    assert "not a negative one" in rung["because"]


def test_an_other_outcome_is_kept_and_placed_on_no_rung():
    rows = [OutcomeRecord("o1", "G", "other", "validated", Context("other"),
                          lab_id="L1")]
    payload = ladder("G", rows)
    assert payload["n_outcomes"] == 1
    assert payload["n_unplaced"] == 1
    assert "would assert which experiment they were" in payload["unplaced_note"]
    assert all(r["n_outcomes"] == 0 for r in payload["rungs"])


def test_the_next_experiment_is_the_earliest_untested_rung():
    rows = [_ladder_outcome("G", "independent_guide", "validated", -1.4,
                            "ko_fitness_independent_guide", 1)]
    recommendation = next_experiment(ladder("G", rows, primary_significant=True))
    assert recommendation["rung"] == "orthogonal"
    assert recommendation["question"] == "target_specific"


def test_the_network_report_shows_the_refusals_too(fitted):
    report = network_report(fitted)
    assert len(report["questions"]) == 4
    assert report["refusals"], "a page that hides the unfitted head overstates"
    assert set(report["question_sentences"]) == set(E.QUESTIONS)
    assert len(report["ladder_rungs"]) == 6
    #: The payload has to be JSON, because the console reads it.
    json.dumps(report, allow_nan=False)


def test_nothing_in_this_subsystem_emits_a_warning(cohort_rows):
    """
    A RuntimeWarning from a mean over an all-missing channel is the kind of
    thing that gets filtered out in production and then hides a real NaN. There
    are none, and this test keeps it that way.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        network = ValidationNetwork.fit(cohort_rows[:500])
        network.estimate({"gene": "G", "context": {"assay_class": "ko_fitness"},
                          "hit": {"lfc": -1.0, "fdr": 0.01}})


# =====================================================================
# The pipeline's score stage
# =====================================================================

class _Gene:
    """The fields `_score_candidates` reads off a scored gene."""

    def __init__(self, gene, lfc, fdr, **over):
        self.gene = gene
        self.lfc = lfc
        self.fdr = fdr
        self.p_value = fdr / 3
        self.bayes_factor = over.get("bayes_factor")
        self.norm_z = over.get("norm_z")
        self.n_guides = over.get("n_guides", 4)
        self.n_good_guides = over.get("n_good_guides", 4)
        self.max_guide_share = over.get("max_guide_share")


class _Hits:
    def __init__(self, genes):
        self.genes = {g.gene: g for g in genes}

    def significant(self, fdr=0.1):
        return [g for g in self.genes.values() if g.fdr is not None and g.fdr < fdr]


class _Qc:
    def as_dict(self):
        return {"run": {"median_replicate_r": 0.91, "verdict": "pass",
                        "bottlenecked_samples": 0}}


class _Atlas:
    available = True
    hit_rates = {"CDK2": 0.04}


class _Result:
    validation = None


def test_the_score_stage_asks_the_gate_and_records_its_answer(monkeypatch, tmp_path):
    """
    The stage that used to be hard-coded `skipped`.

    With no cohort it still produces no probability — but the reason it records
    is the gate's own sentence naming what is outstanding, not a constant. That
    is the whole difference between a stage that is unimplemented and one that
    is honestly empty.
    """
    from splicr import pipeline
    from splicr.validation import store

    store.clear_cache()
    monkeypatch.setenv(store.ENV_VAR, str(tmp_path / "no-such-cohort.json"))

    spec = pipeline.ScreenInput(name="test", phenotype="proliferation")
    hits = _Hits([_Gene("CDK2", -2.1, 1e-6), _Gene("QUIET", -0.1, 0.9)])
    scored = pipeline._score_candidates(hits, {}, _Qc(), _Atlas(), spec, _Result())

    # One called hit, four questions, every one refused with a reason.
    assert scored["n_estimated"] == 0
    assert scored["n_declined"] == 1
    assert len(scored["candidates"]) == 1
    assert scored["candidates"][0]["gene"] == "CDK2"
    questions = scored["candidates"][0]["questions"]
    assert set(questions) == set(E.QUESTIONS)
    for question, estimate in questions.items():
        assert estimate["available"] is False, question
        assert estimate["because"], question
        assert "probability" not in estimate, question
    # The stage's own detail names the shortfall rather than asserting one.
    assert "no probability was estimated" in scored["detail"]
    assert scored["metrics"]["n_called"] == 1
    assert scored["metrics"]["cohort"]["fitted"] is False


def test_the_score_stage_estimates_once_a_cohort_exists(monkeypatch, tmp_path, cohort_rows):
    from splicr import pipeline
    from splicr.validation import store

    store.clear_cache()
    path = tmp_path / "cohort.json"
    write_cohort(cohort_rows, path)
    monkeypatch.setenv(store.ENV_VAR, str(path))

    spec = pipeline.ScreenInput(name="test", phenotype="proliferation")
    hits = _Hits([_Gene("CDK2", -2.1, 1e-6)])
    scored = pipeline._score_candidates(hits, {}, _Qc(), _Atlas(), spec, _Result())

    assert scored["n_estimated"] == 1
    questions = scored["candidates"][0]["questions"]
    # Three heads fit on this cohort and the pharmacologic one does not, so the
    # same candidate gets three probabilities and one named refusal.
    available = {q: e for q, e in questions.items() if e["available"]}
    assert len(available) == 3
    assert questions["pharmacologic"]["available"] is False
    for question, estimate in available.items():
        assert 0.0 <= estimate["probability"] <= 1.0
        assert E.QUESTION_SENTENCE[question] in estimate["sentence"]
        assert "Calibrated on" in estimate["cohort_sentence"]
    store.clear_cache()


def test_a_broken_cohort_loses_no_run(monkeypatch, tmp_path):
    """
    Scoring must never cost a run that has already produced its hits and its QC.

    A failure comes back as zero estimates with the exception in `detail`, which
    is a worse outcome than a probability and a much better one than a lost run.
    """
    from splicr import pipeline
    from splicr.validation import store

    store.clear_cache()
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    monkeypatch.setenv(store.ENV_VAR, str(broken))

    scored = pipeline._score_candidates(
        _Hits([_Gene("CDK2", -2.1, 1e-6)]), {}, _Qc(), _Atlas(),
        pipeline.ScreenInput(name="test"), _Result())
    assert scored["n_estimated"] == 0
    assert scored["metrics"]["cohort"]["problem"] is not None
    store.clear_cache()


def test_the_screens_context_decides_which_cohort_it_is_judged_against():
    """
    A drug arm and a reporter screen are not knockout fitness screens, and
    putting them in that stratum would score them against a cohort that cannot
    speak to them.
    """
    from splicr import pipeline

    plain = pipeline.ScreenInput(name="x")
    assert pipeline._assay_class(plain) == "ko_fitness"
    assert pipeline._phenotype_family(plain) == "fitness"

    drug = pipeline.ScreenInput(name="x", condition="olaparib",
                                phenotype="drug resistance")
    assert pipeline._assay_class(drug) == "drug_modifier"
    assert pipeline._phenotype_family(drug) == "drug_resistance"

    reporter = pipeline.ScreenInput(name="x", phenotype="GFP reporter",
                                    fitness_assay=False)
    assert pipeline._assay_class(reporter) == "reporter"
    assert pipeline._phenotype_family(reporter) == "reporter"

    #: A drug arm whose condition names neither resistance nor sensitisation
    #: lands in 'other' rather than being guessed into one of them. Landing in
    #: 'other' and being refused a number is better than being scored against
    #: the wrong cohort.
    ambiguous = pipeline.ScreenInput(name="x", condition="compound A",
                                     phenotype="viability")
    assert pipeline._phenotype_family(ambiguous) == "other"

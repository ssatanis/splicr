"""
Regression tests for screen design validation and the QC checks that depend on it.

Every test here corresponds to a defect that shipped. The metadata layer is
where a screen goes wrong most often and most quietly: which sample is the
library reference, and which way round the contrast goes. Each of these used to
pass straight through the engine and change the answer without saying so, so
these are the tests that stop that happening again.

Counts are simulated, and only ever used to ask whether a check fires. No
number produced here is reported as a measurement of anything.
"""
from __future__ import annotations

import random

import pytest

from splicr.count import CountMatrix, SampleCounts
from splicr.design import DesignError, build_design
from splicr.qc import dropout_contrast, screen_qc
from splicr.references import essentials, load_library, nonessentials

LABELS = ["plasmid", "T0", "D21_A", "D21_B", "D21_C"]
ENDPOINTS = ["D21_A", "D21_B", "D21_C"]


# ---------------------------------------------------------------------------
# A simulated dropout screen, small enough to build in a second.
#
# Genes are real Brunello genes and the essential/nonessential sets are the real
# CEGv2/NEGv1 ones, because NNMD and AUROC are computed against those sets by
# name: a made-up gene symbol would simply never be found. Only the counts are
# simulated.
# ---------------------------------------------------------------------------

N_ESSENTIAL, N_NONESSENTIAL, N_OTHER = 60, 90, 150
MEAN_READS_PER_GUIDE = 248.0      # the depth the reported scenario was built at


@pytest.fixture(scope="module")
def library():
    return load_library("brunello")


@pytest.fixture(scope="module")
def screen(library):
    """(library, CountMatrix) for plasmid + T0 + a day-21 triplicate."""
    rng = random.Random(7)
    ess, non = essentials(), nonessentials()

    by_gene: dict[str, list] = {}
    for g in library.guides:
        if g.gene and not g.is_control:
            by_gene.setdefault(g.gene, []).append(g)

    picked = (rng.sample(sorted(ess & by_gene.keys()), N_ESSENTIAL)
              + rng.sample(sorted(non & by_gene.keys()), N_NONESSENTIAL)
              + rng.sample(sorted(by_gene.keys() - ess - non), N_OTHER))
    guides = [g for gene in picked for g in by_gene[gene][:4]]

    # Per-gene day-21 survival, and per-guide abundance in the pool. The pool
    # abundance is shared across samples, which is the whole reason raw
    # log-count correlation is uninformative about what the experiment did.
    effect = {gene: (rng.uniform(0.04, 0.22) if gene in ess
                     else rng.uniform(0.9, 1.1) if gene in non
                     else rng.lognormvariate(0.0, 0.25))
              for gene in picked}
    abundance = [rng.lognormvariate(0.0, 0.45) for _ in guides]

    def sample(name: str) -> SampleCounts:
        counts = {}
        for g, ab in zip(guides, abundance):
            mu = MEAN_READS_PER_GUIDE * ab
            if name not in ("plasmid", "T0"):
                mu *= effect[g.gene]
            counts[g.guide_id] = max(0, int(rng.gauss(mu, max(mu, 1.0) ** 0.5) + 0.5))
        mapped = sum(counts.values())
        total = int(mapped / 0.78)
        return SampleCounts(label=name, counts=counts, total_reads=total,
                            mapped_exact=mapped, mapped_mismatch=0,
                            unmapped=total - mapped, no_spacer=0,
                            with_anchor=int(total * 0.96), anchor_name="lentiguide")

    # from_samples keys off the library's full guide list, so build the matrix
    # from the sampled guides only: an unrepresented genome-wide remainder would
    # drag every abundance metric into "focused screen" territory.
    samples = [sample(n) for n in LABELS]
    return CountMatrix(
        library_slug=library.slug,
        guide_ids=[g.guide_id for g in guides],
        genes=[g.gene for g in guides],
        samples=LABELS,
        matrix=[[s.counts[g.guide_id] for s in samples] for g in guides],
        per_sample=samples,
    )


def permuted(matrix: CountMatrix, sample: str, fraction: float, seed: int = 11):
    """The matrix with a fraction of one sample's guide counts shuffled.

    A sample swap, index hopping and a mispipetted arm all look like this from
    the counts: the right distribution attached to the wrong guides.
    """
    j = matrix.samples.index(sample)
    original = [row[j] for row in matrix.matrix]
    rng = random.Random(seed)
    idx = rng.sample(range(len(original)), int(fraction * len(original)))
    values = [original[i] for i in idx]
    rng.shuffle(values)
    for i, v in zip(idx, values):
        matrix.matrix[i][j] = v
    return original


def restore(matrix: CountMatrix, sample: str, original: list[int]) -> None:
    j = matrix.samples.index(sample)
    for row, v in zip(matrix.matrix, original):
        row[j] = v


# ---------------------------------------------------------------------------
# Roles are inferred, not defaulted to control
# ---------------------------------------------------------------------------

def test_default_roles_find_the_library_reference():
    """
    The documented CLI with no --role flags used to make the plasmid pool and T0
    both 'control' arms, which left the screen with no library reference at all.
    """
    design = build_design(LABELS, {}, ENDPOINTS, ["T0"])
    assert design.roles == {"plasmid": "plasmid", "T0": "reference",
                            "D21_A": "treatment", "D21_B": "treatment",
                            "D21_C": "treatment"}
    assert design.reference_samples == ["plasmid", "T0"]


def test_default_roles_give_the_same_qc_as_explicit_ones(screen, library):
    """No --role flags must not be a different experiment from spelling them out."""
    inferred = build_design(LABELS, {}, ENDPOINTS, ["T0"])
    explicit = build_design(LABELS, {"plasmid": "plasmid", "T0": "reference"},
                            ENDPOINTS, ["T0"])
    assert inferred.roles == explicit.roles

    qc = screen_qc(screen, inferred.roles, inferred.treatment, inferred.control, library)
    # The check that used to be skipped entirely on this design, with a reason
    # that said no reference had been supplied when two had.
    assert qc.nnmd is not None, qc.nnmd_reason
    assert qc.nnmd < library_nnmd_threshold()
    assert qc.auroc is not None and qc.auroc > 0.9
    assert qc.nnmd_contrast == "D21_A+D21_B+D21_C vs plasmid"
    assert qc.verdict == "pass"


def library_nnmd_threshold() -> float:
    from splicr.config import SETTINGS
    return SETTINGS.qc.nnmd_max


# ---------------------------------------------------------------------------
# A baseline sample is never the dropout endpoint, whatever role it carries
# ---------------------------------------------------------------------------

def test_t0_called_control_still_measures_the_endpoint(screen, library):
    """
    'control' instead of 'reference' for T0 used to make QC measure T0 against
    plasmid, find no dropout because none has happened yet, and fail a screen
    that separates essentials perfectly on its real endpoint.
    """
    roles = {"plasmid": "plasmid", "T0": "control", "D21_A": "treatment",
             "D21_B": "treatment", "D21_C": "treatment"}
    endpoint, reference, label = dropout_contrast(roles, ENDPOINTS, ["T0"])
    assert "T0" not in endpoint
    assert reference == ["plasmid"]
    assert label == "D21_A+D21_B+D21_C vs plasmid"

    qc = screen_qc(screen, roles, ENDPOINTS, ["T0"], library)
    assert qc.nnmd is not None and qc.nnmd < library_nnmd_threshold()
    assert qc.verdict != "fail"
    # The lab is told that the metadata contradicts the sample name, since the
    # fix is in their metadata rather than in the numbers.
    assert any("named like the library reference" in n for n in qc.notes)


def test_a_denominator_sample_is_never_the_numerator(screen, library):
    """T0 is in the caller's own --control list, so it cannot be the endpoint."""
    roles = {"plasmid": "plasmid", "T0": "reference", "D21_A": "treatment",
             "D21_B": "treatment", "D21_C": "treatment"}
    endpoint, _, _ = dropout_contrast(roles, ENDPOINTS, ["T0"])
    assert endpoint == ENDPOINTS


# ---------------------------------------------------------------------------
# Roles are a closed set
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("role", ["Plasmid", "PLASMID", "library", "T0", "ref",
                                  "treated", "day21", "", "reference "])
def test_unknown_role_strings_are_refused(role):
    """
    public.sample_role is an enum of exactly four values. A role outside it used
    to be accepted, silently fail every `role == "plasmid"` test, and change
    which contrast NNMD was measured on.
    """
    with pytest.raises(DesignError) as exc:
        build_design(LABELS, {"plasmid": role}, ENDPOINTS, ["T0"])
    assert "not a role" in str(exc.value)


def test_a_miscased_role_is_told_it_is_miscased():
    with pytest.raises(DesignError, match="case-sensitive"):
        build_design(LABELS, {"plasmid": "Plasmid"}, ENDPOINTS, ["T0"])


def test_role_for_a_sample_not_in_the_screen_is_refused():
    with pytest.raises(DesignError) as exc:
        build_design(LABELS, {"plasmidd": "plasmid"}, ENDPOINTS, ["T0"])
    assert "not in this screen" in str(exc.value)
    assert "'plasmid'" in str(exc.value)     # the one-edit hint


# ---------------------------------------------------------------------------
# Contrast labels
# ---------------------------------------------------------------------------

def test_a_mistyped_treatment_label_names_the_typo():
    """
    `--treatment D21_a` for a screen containing D21_A used to pass QC on two
    replicates instead of three, then kill MAGeCK with exit 255 after counting
    had already run.

    The message has to name the label the caller mistyped. A typo also leaves
    the real sample with no inferable role, so the missing-role check fires on
    the same design; it used to speak first and name D21_A, the sample that is
    fine, while never mentioning D21_a or the hint for it.
    """
    with pytest.raises(DesignError) as exc:
        build_design(LABELS, {}, ["D21_a", "D21_B", "D21_C"], ["T0"])
    message = str(exc.value)
    assert "'D21_a'" in message and "not in this screen" in message
    assert "Did you mean 'D21_A'?" in message


def test_a_mistyped_control_label_names_the_typo():
    with pytest.raises(DesignError) as exc:
        build_design(LABELS, {}, ENDPOINTS, ["T_0"])
    assert "Did you mean 'T0'?" in str(exc.value)


def test_an_empty_contrast_side_is_refused_by_name():
    """Each side names its own flag, rather than reporting role-less samples."""
    with pytest.raises(DesignError, match="no --treatment sample"):
        build_design(LABELS, {}, [], ["T0"])
    with pytest.raises(DesignError, match="no --control sample"):
        build_design(LABELS, {}, ENDPOINTS, [])


def test_a_sample_on_both_sides_is_refused():
    with pytest.raises(DesignError, match="both sides"):
        build_design(LABELS, {}, ["D21_A", "T0"], ["T0"])


def test_a_repeated_contrast_label_is_refused():
    with pytest.raises(DesignError, match="more than once"):
        build_design(LABELS, {}, ["D21_A", "D21_A", "D21_B"], ["T0"])


def test_duplicate_sample_labels_are_refused():
    with pytest.raises(DesignError, match="duplicate sample label"):
        build_design(["T0", "D21_A", "D21_A"], {}, ["D21_A"], ["T0"])


def test_an_unaccounted_sample_is_asked_about_not_guessed():
    """
    A sample in neither side of the contrast whose name says nothing is a
    question, not a default. Guessing 'control' for it is what started all of
    this.
    """
    with pytest.raises(DesignError) as exc:
        build_design(LABELS, {}, ["D21_A", "D21_B"], ["T0"])
    assert "D21_C" in str(exc.value) and "--role D21_C" in str(exc.value)


# ---------------------------------------------------------------------------
# Inverted contrast
# ---------------------------------------------------------------------------

def test_an_inverted_contrast_is_refused_before_anything_expensive_runs():
    """
    `--treatment T0 --control D21_*` used to produce a fully confident, fully
    inverted report: hundreds of core essential genes called ENRICHED, with QC
    still saying pass because nothing compared the contrast to the roles.
    """
    with pytest.raises(DesignError) as exc:
        build_design(LABELS, {}, ["T0"], ENDPOINTS)
    message = str(exc.value)
    assert "inverted" in message
    # It also says which way round to run it.
    assert "--treatment D21_A" in message and "--control T0" in message


def test_an_inverted_contrast_is_caught_even_with_roles_asserted():
    """An explicit role does not make a reference sample an endpoint."""
    roles = {"plasmid": "plasmid", "T0": "treatment", "D21_A": "control",
             "D21_B": "control", "D21_C": "control"}
    with pytest.raises(DesignError, match="inverted"):
        build_design(LABELS, roles, ["T0"], ENDPOINTS)


# ---------------------------------------------------------------------------
# Replicate agreement has to have power
# ---------------------------------------------------------------------------

def test_replicate_agreement_is_measured_on_fold_change(screen, library):
    """
    The 0.19 floor is DepMap's residual-LFC number. Applied to raw log counts it
    is nearly powerless, because every sample of a screen inherits the same
    guide abundance from the pool.
    """
    roles = {"plasmid": "plasmid", "T0": "reference", "D21_A": "treatment",
             "D21_B": "treatment", "D21_C": "treatment"}
    qc = screen_qc(screen, roles, ENDPOINTS, ["T0"], library)
    endpoint_pairs = [p for p in qc.replicate_pairs if p.role == "treatment"]
    assert endpoint_pairs
    for p in endpoint_pairs:
        assert p.r_lfc is not None, "a screen with a reference must form fold changes"
        assert p.best == p.r_lfc


def test_a_partly_scrambled_replicate_is_caught(screen, library):
    """
    A replicate with 40% of its guide counts permuted used to pass QC with no
    note at all; the absolute floor only fired once the arm was about 80% noise.
    The check with the power is the comparison to the peers.
    """
    roles = {"plasmid": "plasmid", "T0": "reference", "D21_A": "treatment",
             "D21_B": "treatment", "D21_C": "treatment"}
    original = permuted(screen, "D21_C", 0.40)
    try:
        qc = screen_qc(screen, roles, ENDPOINTS, ["T0"], library)
        assert qc.verdict != "pass"
        assert "D21_C" in qc.suspect_arms
        assert any("D21_C" in n and "agree" in n for n in qc.notes)
    finally:
        restore(screen, "D21_C", original)


def test_an_untouched_triplicate_raises_nothing(screen, library):
    """The other half of the check: it must not fire on a healthy screen."""
    roles = {"plasmid": "plasmid", "T0": "reference", "D21_A": "treatment",
             "D21_B": "treatment", "D21_C": "treatment"}
    qc = screen_qc(screen, roles, ENDPOINTS, ["T0"], library)
    assert qc.suspect_arms == []
    assert qc.verdict == "pass", qc.notes


@pytest.mark.parametrize("fraction", [0.2, 0.4, 0.6])
def test_the_scrambled_replicate_check_fires_well_before_total_noise(
        screen, library, fraction):
    roles = {"plasmid": "plasmid", "T0": "reference", "D21_A": "treatment",
             "D21_B": "treatment", "D21_C": "treatment"}
    original = permuted(screen, "D21_C", fraction)
    try:
        qc = screen_qc(screen, roles, ENDPOINTS, ["T0"], library)
        assert "D21_C" in qc.suspect_arms
    finally:
        restore(screen, "D21_C", original)

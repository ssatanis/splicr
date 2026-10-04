"""
What "validated" means, written down before any outcome is collected.

WHY THIS FILE EXISTS AT ALL

A CRISPR hit can validate genetically and fail pharmacologically. The kinome
screen in African-ancestry breast cancer organoids
(doi:10.1158/0008-5472.CAN-24-0775) is the clean worked example and it is the
reason this module is a registry rather than a constant: the authors called hits
at "a reduction of at least 50% (log2 fold change <-1) and a p value <0.05",
then tested CDK2, PTK2 and PRKDC with individual gRNAs and saw growth reduced in
all three. The pharmacology then disagreed with itself. Both lines were
sensitive to the CDK2 inhibitor AUZ-454. Of two PTK2 inhibitors, GSK2256098 had
no effect on either line and only ICSBCS007 partially responded to PF-573228.
The PRKDC inhibitors LTURM34 and AZD7648 "did not show potent activity against
the PDTOs at the tested concentrations in contrast to the individual gRNA
validation results".

PRKDC is therefore a gene that validated and did not validate in the same paper,
and the only thing that makes those two statements compatible is naming the
endpoint each was measured against. A single number called "validation
probability" would have to average them, and the average would be a claim about
nothing.

So: an endpoint is a named, versioned, hashable object. It says which question
it answers, which perturbations count as independent, how many replicates it
needs, which direction the effect must take, who owns the effect threshold, and
which controls must pass. A recorded outcome is scored against exactly one
endpoint, and an outcome that cannot be scored against it says so rather than
being counted as a failure.

WHO OWNS THE THRESHOLD

Mostly not SplicR. `threshold_owner` is 'laboratory' for every arrayed endpoint,
because the effect size that counts as a response in one organoid assay is not
the one that counts in another, and a globally invented cut would silently
relabel other people's experiments. SplicR owns a threshold only where the
quantity is dimensionless and the convention is near-universal (a q-value). A
published criterion is carried as an example with its DOI, not promoted to a
default.

WHAT AN ENDPOINT IS NOT

It is not a judgement about the gene, and it is not the model's opinion. It is
the rule the bench agreed to before the plate went in the incubator, which is
the only kind of rule that can be used to score a prediction afterwards.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Mapping

# ---------------------------------------------------------------------------
# The four questions. They never share a number.
# ---------------------------------------------------------------------------

#: Every endpoint answers exactly one of these. A calibrated probability is
#: always a probability *of one of these four things*, named in the sentence
#: that prints it.
QUESTIONS: tuple[str, ...] = (
    "reproduces",        # an independent perturbation reproduces the phenotype, same model
    "target_specific",   # the effect survives an orthogonal perturbation of the same target
    "cross_model",       # the phenotype reproduces in another model or biological context
    "pharmacologic",     # inhibiting the target with a compound recapitulates the phenotype
)

QUESTION_LABEL: dict[str, str] = {
    "reproduces": "Independent genetic reproduction in the same model",
    "target_specific": "Target specificity under an orthogonal perturbation",
    "cross_model": "Reproduction in another model or context",
    "pharmacologic": "Pharmacologic recapitulation with a selective compound",
}

#: The sentence a printed probability must appear inside. A bare percentage is
#: not interpretable; "79%" and "79% chance an independent guide reproduces the
#: depletion phenotype in this model" are different claims and only the second
#: one is a scientific statement.
QUESTION_SENTENCE: dict[str, str] = {
    "reproduces": "estimated probability of reproducing the phenotype with an "
                  "independent perturbation in the same model",
    "target_specific": "estimated probability that the effect survives an "
                       "orthogonal perturbation of the same target",
    "cross_model": "estimated probability of reproducing the phenotype in "
                   "another model or biological context",
    "pharmacologic": "estimated probability of recapitulating the phenotype "
                     "pharmacologically with a selective inhibitor",
}

# ---------------------------------------------------------------------------
# The validation types a lab can record
# ---------------------------------------------------------------------------

#: What was actually done at the bench. Recorded verbatim; the question it bears
#: on is derived, never asked of the person filling the form.
VALIDATION_TYPES: tuple[str, ...] = (
    "independent_guide",
    "independent_guide_set",
    "crispri",
    "crispra",
    "rescue",
    "orthogonal_genetic",
    "small_molecule",
    "another_model",
    "organoid",
    "in_vivo",
    "other",
)

VALIDATION_TYPE_LABEL: dict[str, str] = {
    "independent_guide": "Independent CRISPR guide",
    "independent_guide_set": "Independent guide set",
    "crispri": "CRISPRi",
    "crispra": "CRISPRa",
    "rescue": "Rescue experiment",
    "orthogonal_genetic": "Orthogonal genetic assay",
    "small_molecule": "Small-molecule inhibition",
    "another_model": "Another cellular model",
    "organoid": "Organoid",
    "in_vivo": "In vivo",
    "other": "Other",
}

#: Which question each type bears on. 'other' maps to nothing on purpose: it is
#: recorded, kept and exported, and it does not enter any head, because a model
#: cannot learn from a label whose meaning was never fixed.
TYPE_QUESTION: dict[str, str | None] = {
    "independent_guide": "reproduces",
    "independent_guide_set": "reproduces",
    "crispri": "target_specific",
    "crispra": "target_specific",
    "rescue": "target_specific",
    "orthogonal_genetic": "target_specific",
    "small_molecule": "pharmacologic",
    "another_model": "cross_model",
    "organoid": "cross_model",
    "in_vivo": "cross_model",
    "other": None,
}

#: Assay classes an endpoint can belong to. The class, not the gene, decides
#: which cohort an outcome joins, so it is a closed set.
ASSAY_CLASSES: tuple[str, ...] = (
    "ko_fitness",          # knockout viability / proliferation
    "drug_modifier",       # resistance or sensitisation under a compound
    "reporter",            # FACS or imaging reporter
    "organoid_growth",     # arrayed organoid area or viability
    "in_vivo_growth",
    "other",
)

# ---------------------------------------------------------------------------
# The decision a record gets when scored against an endpoint
# ---------------------------------------------------------------------------

#: The four results a lab records. Stored exactly as recorded.
RESULTS: tuple[str, ...] = ("validated", "failed", "inconclusive", "pending")

#: A fifth state that exists only here, and never in the outcome table.
#:
#: 'insufficient_record' means this record cannot be scored against this
#: endpoint, because a criterion the endpoint requires was not recorded. It is
#: not 'failed' (the assay did not run and come out against the hit) and it is
#: not 'inconclusive' (the assay did not run and fail to decide). Collapsing it
#: into either one would put an unmeasured experiment into a rate's numerator or
#: denominator, which is the single easiest way to manufacture a validation
#: statistic.
DECISIONS: tuple[str, ...] = ("validated", "failed", "inconclusive", "insufficient_record")


@dataclass(frozen=True)
class Criterion:
    """One clause of an endpoint, and whether the record satisfied it."""

    name: str
    label: str
    status: str          # 'pass' | 'fail' | 'not_recorded'
    detail: str = ""


@dataclass(frozen=True)
class Decision:
    """The result of scoring one record against one endpoint."""

    decision: str
    endpoint_id: str
    endpoint_version: int
    question: str
    criteria: tuple[Criterion, ...]
    because: str

    @property
    def scorable(self) -> bool:
        return self.decision != "insufficient_record"

    def as_dict(self) -> dict:
        return {
            "decision": self.decision,
            "endpoint_id": self.endpoint_id,
            "endpoint_version": self.endpoint_version,
            "question": self.question,
            "because": self.because,
            "criteria": [asdict(c) for c in self.criteria],
        }


class EndpointError(ValueError):
    """An endpoint definition that could not be used as written."""


# ---------------------------------------------------------------------------
# The endpoint
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Endpoint:
    endpoint_id: str
    version: int
    label: str
    question: str
    validation_types: tuple[str, ...]
    assay_class: str

    #: Does the perturbation have to be independent of the one that produced the
    #: primary signal? For a genetic reproduction endpoint, yes: re-running the
    #: screen's own construct measures the screen again.
    requires_independent_perturbation: bool = True
    #: Must it also not be one of the original library constructs? "Where
    #: feasible" in the literature, so it is a separate, softer clause: a record
    #: that does not say is inconclusive against endpoints that require it, not
    #: failed.
    requires_distinct_constructs: bool = False
    min_independent_perturbations: int = 1
    min_biological_replicates: int = 2

    #: 'depleted', 'enriched' or 'either'. The prespecified direction. An effect
    #: of the right size in the wrong direction is not a validation.
    direction: str = "either"

    #: The effect metric and the bar it must clear. `effect_threshold` of None
    #: means the bar belongs to the laboratory's own assay and must be supplied
    #: per round; scoring without it returns 'insufficient_record'.
    effect_metric: str = "log2_fold_change"
    effect_threshold: float | None = None
    threshold_owner: str = "laboratory"     # 'laboratory' | 'splicr' | 'published'

    #: Named controls that must be recorded as passing.
    control_criteria: tuple[str, ...] = ()

    #: A published criterion, carried as an example and never as a default.
    published_example: Mapping[str, object] | None = None
    #: What a negative result on this endpoint does and does not mean.
    negative_means: str = ""
    notes: str = ""

    def __post_init__(self) -> None:
        if self.question not in QUESTIONS:
            raise EndpointError(f"{self.endpoint_id}: unknown question {self.question!r}")
        if self.assay_class not in ASSAY_CLASSES:
            raise EndpointError(f"{self.endpoint_id}: unknown assay class {self.assay_class!r}")
        if self.direction not in ("depleted", "enriched", "either"):
            raise EndpointError(f"{self.endpoint_id}: unknown direction {self.direction!r}")
        if self.threshold_owner not in ("laboratory", "splicr", "published"):
            raise EndpointError(f"{self.endpoint_id}: unknown threshold owner")
        if not self.validation_types:
            raise EndpointError(f"{self.endpoint_id}: an endpoint with no validation type")
        for kind in self.validation_types:
            if kind not in VALIDATION_TYPES:
                raise EndpointError(f"{self.endpoint_id}: unknown validation type {kind!r}")
            if TYPE_QUESTION[kind] != self.question:
                raise EndpointError(
                    f"{self.endpoint_id}: validation type {kind!r} bears on "
                    f"{TYPE_QUESTION[kind]!r}, not on {self.question!r}")
        if self.min_independent_perturbations < 1 or self.min_biological_replicates < 1:
            raise EndpointError(f"{self.endpoint_id}: replicate requirements must be positive")
        if self.effect_threshold is not None and self.threshold_owner == "laboratory":
            raise EndpointError(
                f"{self.endpoint_id}: a laboratory-owned threshold cannot be fixed here")

    # -- identity ----------------------------------------------------------

    def canonical(self) -> dict:
        """The definition as bytes-stable JSON, for hashing into a receipt."""
        payload = asdict(self)
        payload["published_example"] = (
            dict(self.published_example) if self.published_example is not None else None)
        return payload

    def hash(self) -> str:
        encoded = json.dumps(self.canonical(), sort_keys=True, allow_nan=False).encode()
        return hashlib.sha256(encoded).hexdigest()

    @property
    def key(self) -> str:
        return f"{self.endpoint_id}.v{self.version}"

    # -- scoring -----------------------------------------------------------

    def decide(self, measurement: Mapping[str, object], *,
               laboratory_threshold: float | None = None) -> Decision:
        """
        Score one recorded measurement against this endpoint.

        Every clause is evaluated and reported, including the ones that passed,
        so a reader can see which criterion carried the decision. A clause whose
        input was never recorded is 'not_recorded' and forces
        'insufficient_record' when the clause is required, because the
        alternative is to guess.

        The recorded `result` is honoured where it is the only thing that can
        be: a 'pending' assay has no measurement to score and an 'inconclusive'
        one was declared undecidable by the people who ran it. This method never
        upgrades either into a decision.
        """
        criteria: list[Criterion] = []
        recorded = measurement.get("result")
        if recorded == "pending":
            return Decision("insufficient_record", self.endpoint_id, self.version,
                            self.question, (),
                            "The assay has not finished, so there is nothing to score.")
        if recorded == "inconclusive":
            return Decision("inconclusive", self.endpoint_id, self.version, self.question,
                            (),
                            "Recorded inconclusive by the laboratory that ran it.")

        def add(name: str, label: str, status: str, detail: str = "") -> None:
            criteria.append(Criterion(name, label, status, detail))

        missing: list[str] = []
        failed: list[str] = []

        # 1. independence of the perturbation
        if self.requires_independent_perturbation:
            value = measurement.get("independent_perturbation")
            if value is None:
                add("independent_perturbation", "Independent perturbation used",
                    "not_recorded")
                missing.append("whether the perturbation was independent")
            elif bool(value):
                add("independent_perturbation", "Independent perturbation used", "pass")
            else:
                add("independent_perturbation", "Independent perturbation used", "fail",
                    "The primary screen's own perturbation was reused.")
                failed.append("the perturbation was not independent")

        # 2. distinct from the screen's constructs, where the endpoint asks
        if self.requires_distinct_constructs:
            value = measurement.get("distinct_from_screen_constructs")
            if value is None:
                add("distinct_constructs", "Not one of the original screen constructs",
                    "not_recorded")
                missing.append("whether the constructs differed from the screen's")
            elif bool(value):
                add("distinct_constructs", "Not one of the original screen constructs", "pass")
            else:
                add("distinct_constructs", "Not one of the original screen constructs", "fail",
                    "The validation reused a construct from the screening library.")
                failed.append("the constructs came from the screening library")

        # 3. how many independent perturbations
        n_pert = _as_int(measurement.get("n_perturbations"))
        label = f"At least {self.min_independent_perturbations} independent perturbation(s)"
        if n_pert is None:
            add("n_perturbations", label, "not_recorded")
            missing.append("the number of independent perturbations")
        elif n_pert >= self.min_independent_perturbations:
            add("n_perturbations", label, "pass", f"{n_pert} used")
        else:
            add("n_perturbations", label, "fail", f"only {n_pert} used")
            failed.append(f"only {n_pert} independent perturbation(s)")

        # 4. biological replicates
        n_rep = _as_int(measurement.get("n_replicates"))
        label = f"At least {self.min_biological_replicates} biological replicate(s)"
        if n_rep is None:
            add("n_replicates", label, "not_recorded")
            missing.append("the number of biological replicates")
        elif n_rep >= self.min_biological_replicates:
            add("n_replicates", label, "pass", f"{n_rep} recorded")
        else:
            add("n_replicates", label, "fail", f"only {n_rep} recorded")
            failed.append(f"only {n_rep} biological replicate(s)")

        # 5. direction and effect size against the prespecified bar
        threshold = (self.effect_threshold if self.threshold_owner != "laboratory"
                     else laboratory_threshold)
        effect = _as_float(measurement.get("effect_size"))
        bar = "the laboratory's prespecified bar" if threshold is None else f"{abs(threshold):g}"
        bar_label = (f"Effect in the {self.direction} direction past {bar}"
                     if self.direction != "either" else f"Effect past {bar}")
        if effect is None:
            add("effect_size", bar_label, "not_recorded")
            missing.append(f"the measured {self.effect_metric}")
        elif threshold is None:
            add("effect_size", bar_label, "not_recorded",
                "This endpoint's threshold belongs to the laboratory's assay and "
                "was not supplied for this round.")
            missing.append("the laboratory's prespecified effect threshold")
        else:
            right_way = (
                self.direction == "either"
                or (self.direction == "depleted" and effect < 0)
                or (self.direction == "enriched" and effect > 0))
            big_enough = abs(effect) >= abs(threshold)
            if right_way and big_enough:
                add("effect_size", bar_label, "pass",
                    f"{effect:+.3f} against a bar of {abs(threshold):.3f}")
            elif not right_way:
                add("effect_size", bar_label, "fail",
                    f"{effect:+.3f} is in the opposite direction to the prespecified "
                    f"{self.direction} effect")
                failed.append("the effect ran the wrong way")
            else:
                add("effect_size", bar_label, "fail",
                    f"{effect:+.3f} does not reach a bar of {abs(threshold):.3f}")
                failed.append("the effect did not reach the prespecified bar")

        # 6. named controls
        for control in self.control_criteria:
            passed = _control_status(measurement, control)
            label = f"Control: {control.replace('_', ' ')}"
            if passed is None:
                add(f"control:{control}", label, "not_recorded")
                missing.append(f"the {control.replace('_', ' ')} control")
            elif passed:
                add(f"control:{control}", label, "pass")
            else:
                add(f"control:{control}", label, "fail")
                failed.append(f"the {control.replace('_', ' ')} control did not pass")

        if missing:
            return Decision(
                "insufficient_record", self.endpoint_id, self.version, self.question,
                tuple(criteria),
                "Not scorable against this endpoint: " + ", ".join(missing) +
                " was not recorded.")
        if failed:
            return Decision("failed", self.endpoint_id, self.version, self.question,
                            tuple(criteria),
                            "Did not meet the endpoint: " + "; ".join(failed) + ".")
        return Decision("validated", self.endpoint_id, self.version, self.question,
                        tuple(criteria),
                        "Every prespecified criterion was met.")


def _as_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        out = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return out


def _as_float(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return out if out == out and abs(out) != float("inf") else None


def _control_status(measurement: Mapping[str, object], control: str) -> bool | None:
    controls = measurement.get("controls")
    if not isinstance(controls, Mapping):
        return None
    value = controls.get(control)
    return None if value is None else bool(value)


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------

_DOW = {
    "doi": "10.1158/0008-5472.CAN-24-0775",
    "pmid": "39891928",
    "what": "Kinome-focused CRISPR-Cas9 screens in African-ancestry patient-derived "
            "breast cancer organoids",
    "screen_hit_criterion": "a reduction of at least 50% (log2 fold change < -1) "
                            "and a p value < 0.05",
    "quoted": True,
}

REGISTRY: dict[str, Endpoint] = {}


def register(endpoint: Endpoint) -> Endpoint:
    if endpoint.key in REGISTRY:
        raise EndpointError(f"{endpoint.key} is already registered")
    REGISTRY[endpoint.key] = endpoint
    return endpoint


KO_FITNESS_INDEPENDENT_GUIDE = register(Endpoint(
    endpoint_id="ko_fitness_independent_guide",
    version=1,
    label="Independent guide, knockout fitness",
    question="reproduces",
    validation_types=("independent_guide",),
    assay_class="ko_fitness",
    requires_independent_perturbation=True,
    requires_distinct_constructs=True,
    min_independent_perturbations=1,
    min_biological_replicates=2,
    direction="depleted",
    effect_metric="log2_fold_change",
    effect_threshold=None,
    threshold_owner="laboratory",
    control_criteria=("negative_control_guides", "positive_control_guides"),
    negative_means="A negative result here says this guide did not reproduce the "
                   "depletion under this assay. It does not establish that the gene "
                   "has no phenotype.",
    notes="The default genetic-reproduction endpoint for pooled knockout fitness "
          "screens. The effect bar belongs to the assay that measures it.",
))

KO_FITNESS_INDEPENDENT_GUIDE_SET = register(Endpoint(
    endpoint_id="ko_fitness_independent_guide_set",
    version=1,
    label="Independent guide set, knockout fitness",
    question="reproduces",
    validation_types=("independent_guide_set",),
    assay_class="ko_fitness",
    requires_distinct_constructs=True,
    min_independent_perturbations=2,
    min_biological_replicates=2,
    direction="depleted",
    control_criteria=("negative_control_guides", "positive_control_guides"),
    negative_means="A negative result here is stronger than one independent guide "
                   "failing, because two or more perturbations of the same target "
                   "agreed on not reproducing it.",
))

ORGANOID_GROWTH_ARRAYED = register(Endpoint(
    endpoint_id="organoid_growth_arrayed",
    version=1,
    label="Arrayed organoid growth",
    question="cross_model",
    validation_types=("organoid",),
    assay_class="organoid_growth",
    requires_independent_perturbation=True,
    requires_distinct_constructs=False,
    min_independent_perturbations=2,
    min_biological_replicates=2,
    direction="depleted",
    effect_metric="relative_organoid_area",
    effect_threshold=None,
    threshold_owner="laboratory",
    control_criteria=("empty_vector_control",),
    published_example=_DOW,
    negative_means="A negative result here is about this organoid model. It does "
                   "not transfer to the 2D line the screen was run in, or to "
                   "another donor's organoid.",
    notes="Modelled on the arrayed individual-gRNA growth assay in "
          "doi:10.1158/0008-5472.CAN-24-0775, where CDK2, PTK2 and PRKDC gRNAs "
          "reduced organoid area in ICSBCS002 and reduced it for only some "
          "guides in ICSBCS007. The 50%/p<0.05 figures in that paper are the "
          "screen's own hit criterion, which is why they are carried here as an "
          "example and not as this endpoint's default bar.",
))

ORTHOGONAL_CRISPRI = register(Endpoint(
    endpoint_id="orthogonal_crispri",
    version=1,
    label="CRISPRi knockdown of the same target",
    question="target_specific",
    validation_types=("crispri",),
    assay_class="ko_fitness",
    requires_independent_perturbation=True,
    min_independent_perturbations=2,
    min_biological_replicates=2,
    direction="depleted",
    effect_metric="log2_fold_change",
    threshold_owner="laboratory",
    control_criteria=("non_targeting_control", "knockdown_confirmed"),
    negative_means="CRISPRi reduces transcript rather than cutting DNA. A "
                   "disagreement with knockout can mean the knockout phenotype "
                   "was a cutting artefact, or that partial knockdown was not "
                   "enough. It does not by itself decide which.",
))

RESCUE_COMPLEMENTATION = register(Endpoint(
    endpoint_id="rescue_complementation",
    version=1,
    label="Rescue by complementation",
    question="target_specific",
    validation_types=("rescue",),
    assay_class="ko_fitness",
    requires_independent_perturbation=False,
    min_independent_perturbations=1,
    min_biological_replicates=2,
    direction="enriched",
    effect_metric="rescue_log2_fold_change",
    threshold_owner="laboratory",
    control_criteria=("empty_vector_control", "expression_confirmed"),
    negative_means="A rescue that does not restore the phenotype can mean the "
                   "phenotype was off-target, or that the construct was not "
                   "expressed or not functional.",
    notes="The direction is reversed on purpose: a rescue validates by "
          "restoring growth, so the prespecified effect is enriched.",
))

PHARMACOLOGIC_INHIBITION = register(Endpoint(
    endpoint_id="pharmacologic_inhibition",
    version=1,
    label="Selective small-molecule inhibition",
    question="pharmacologic",
    validation_types=("small_molecule",),
    assay_class="other",
    requires_independent_perturbation=True,
    requires_distinct_constructs=False,
    min_independent_perturbations=1,
    min_biological_replicates=2,
    direction="depleted",
    effect_metric="viability_relative_to_vehicle",
    threshold_owner="laboratory",
    control_criteria=("vehicle_control",),
    published_example=_DOW,
    negative_means="This is the endpoint most often misread. A compound that "
                   "does not recapitulate a genetic phenotype may be a poor "
                   "compound, dosed below its effective range, or aimed at a "
                   "target that partial inhibition does not touch the way a "
                   "knockout does. It is not evidence that the screen hit was "
                   "false. In doi:10.1158/0008-5472.CAN-24-0775 the PRKDC "
                   "inhibitors LTURM34 and AZD7648 showed no potent activity at "
                   "the tested concentrations while the individual gRNAs did "
                   "reduce growth, and of two PTK2 inhibitors one had no effect "
                   "on either line while the other produced a partial response "
                   "in one.",
    notes="Records the compound and concentration in the measurement, because a "
          "pharmacologic outcome without them cannot be interpreted or reused.",
))

CROSS_MODEL_REPRODUCTION = register(Endpoint(
    endpoint_id="cross_model_reproduction",
    version=1,
    label="Reproduction in another cellular model",
    question="cross_model",
    validation_types=("another_model",),
    assay_class="ko_fitness",
    requires_independent_perturbation=False,
    min_independent_perturbations=1,
    min_biological_replicates=2,
    direction="depleted",
    threshold_owner="laboratory",
    control_criteria=("negative_control_guides",),
    negative_means="A dependency that is real and context-specific is expected "
                   "to fail this endpoint in the wrong context. A negative here "
                   "is information about transfer, not about the original hit.",
))

IN_VIVO_REPRODUCTION = register(Endpoint(
    endpoint_id="in_vivo_reproduction",
    version=1,
    label="Reproduction in vivo",
    question="cross_model",
    validation_types=("in_vivo",),
    assay_class="in_vivo_growth",
    requires_independent_perturbation=False,
    min_independent_perturbations=1,
    min_biological_replicates=3,
    direction="depleted",
    threshold_owner="laboratory",
    control_criteria=("vehicle_control",),
    negative_means="In vivo failure can be pharmacokinetic, immunological or "
                   "about the microenvironment, none of which is a statement "
                   "about the in vitro measurement.",
))

ORTHOGONAL_GENETIC_OTHER = register(Endpoint(
    endpoint_id="orthogonal_genetic_other",
    version=1,
    label="Other orthogonal genetic assay",
    question="target_specific",
    validation_types=("orthogonal_genetic", "crispra"),
    assay_class="other",
    requires_independent_perturbation=True,
    min_independent_perturbations=1,
    min_biological_replicates=2,
    direction="either",
    threshold_owner="laboratory",
    negative_means="The direction is not prespecified for this catch-all "
                   "endpoint, so it is the weakest of the orthogonal endpoints "
                   "and is reported separately from CRISPRi and rescue.",
    notes="A named endpoint is always preferable. This exists so an unusual "
          "assay can be recorded with its criteria rather than dropped.",
))


def endpoint(key_or_id: str, version: int | None = None) -> Endpoint:
    """Look up an endpoint by `id.vN` or by id plus version."""
    key = key_or_id if version is None else f"{key_or_id}.v{version}"
    if key in REGISTRY:
        return REGISTRY[key]
    if version is None:
        matches = sorted((e for e in REGISTRY.values() if e.endpoint_id == key_or_id),
                         key=lambda e: e.version)
        if matches:
            return matches[-1]
    raise EndpointError(f"no endpoint {key!r} is registered")


def endpoints_for(validation_type: str) -> tuple[Endpoint, ...]:
    if validation_type not in VALIDATION_TYPES:
        raise EndpointError(f"unknown validation type {validation_type!r}")
    return tuple(e for e in REGISTRY.values() if validation_type in e.validation_types)


def default_endpoint(validation_type: str) -> Endpoint | None:
    """The endpoint an outcome of this type is scored against unless told otherwise."""
    found = endpoints_for(validation_type)
    if not found:
        return None
    return sorted(found, key=lambda e: (len(e.validation_types), -e.version))[0]


def registry_hash() -> str:
    """One hash over every registered endpoint, to pin a receipt to the rules."""
    payload = {key: REGISTRY[key].canonical() for key in sorted(REGISTRY)}
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()


def registry_manifest() -> dict:
    return {
        "schema": "splicr.endpoint-registry.v1",
        "registry_hash": registry_hash(),
        "n_endpoints": len(REGISTRY),
        "endpoints": {key: {"hash": REGISTRY[key].hash(),
                            "question": REGISTRY[key].question,
                            "assay_class": REGISTRY[key].assay_class,
                            "label": REGISTRY[key].label}
                      for key in sorted(REGISTRY)},
    }

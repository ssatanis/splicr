"""
The record a laboratory contributes, including the ones nobody publishes.

WHY THE FAILURES ARE THE POINT

Published literature keeps the interesting successes. A lab that tests five
genes and writes up two has not been dishonest; it has written a paper. But a
model trained on the published half learns the selection, not the biology, and
the probability it prints is the probability that a validated gene gets
published, which is not a quantity anybody wants.

So this record has room for every result, the pending ones included, and the
cohort counter in `coverage` counts decided outcomes only. A failed follow-up is
worth as much here as a successful one, and an inconclusive one is worth
something different again: it is where the uncertainty lives.

WHAT MAKES A RECORD USABLE

Three identifiers, and they are not interchangeable:

    lab_id      who ran it. The unit of the cluster bootstrap, because two
                screens from one lab are not two independent observations.
    study_id    which screen campaign it belongs to. The unit of the grouped
                split, because 500 candidates from one publication that get
                split at random put the same experiment on both sides of the
                train/test line.
    screen_id   the primary screen the candidate came from.

A record missing `lab_id` cannot enter a held-out-lab evaluation and says so,
rather than being quietly assigned to a lab of its own and inflating the number
of laboratories in the cohort.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, Sequence

from .endpoints import (
    ASSAY_CLASSES, RESULTS, TYPE_QUESTION, VALIDATION_TYPES, Decision,
    EndpointError, default_endpoint, endpoint as get_endpoint,
)

#: Which arm of a stratified validation set an outcome came from. The arm is
#: what makes a comparison of ranking strategies legitimate, and 'unassigned'
#: is honest about the records that predate any round.
ARMS: tuple[str, ...] = ("splicr", "fdr", "investigator", "random", "unassigned")

#: Model types, closed so that a stratum is countable.
MODEL_TYPES: tuple[str, ...] = (
    "cancer_cell_line", "immortalised_line", "primary_cell", "organoid",
    "ipsc_derived", "in_vivo", "other",
)

#: Perturbation modality of the primary screen.
MODALITIES: tuple[str, ...] = ("knockout", "crispri", "crispra", "base_editing", "other")

#: Phenotype families. Deliberately coarse: a stratum has to contain enough
#: outcomes to be counted, and a free-text phenotype would make every stratum
#: a singleton.
PHENOTYPE_FAMILIES: tuple[str, ...] = (
    "fitness", "drug_resistance", "drug_sensitisation", "reporter",
    "differentiation", "other",
)


class OutcomeError(ValueError):
    """A record that could not be accepted as written."""


@dataclass(frozen=True)
class Context:
    """Where the primary screen was run. Decides which cohort an outcome joins."""

    assay_class: str
    modality: str = "knockout"
    phenotype_family: str = "fitness"
    model_type: str = "cancer_cell_line"
    cell_line: str | None = None
    disease: str | None = None
    treatment: str | None = None

    def __post_init__(self) -> None:
        for value, allowed, what in (
            (self.assay_class, ASSAY_CLASSES, "assay class"),
            (self.modality, MODALITIES, "modality"),
            (self.phenotype_family, PHENOTYPE_FAMILIES, "phenotype family"),
            (self.model_type, MODEL_TYPES, "model type"),
        ):
            if value not in allowed:
                raise OutcomeError(f"unknown {what} {value!r}")

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_record(cls, record: Mapping[str, Any]) -> "Context":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in record.items() if k in known})


@dataclass(frozen=True)
class OutcomeRecord:
    """One follow-up experiment, as it is stored and as it is learned from."""

    outcome_id: str
    gene: str
    validation_type: str
    result: str
    context: Context

    lab_id: str | None = None
    study_id: str | None = None
    screen_id: str | None = None

    endpoint_id: str | None = None
    endpoint_version: int | None = None
    #: The laboratory's own prespecified effect bar for this round, when the
    #: endpoint's threshold belongs to them. Supplied at round creation, not
    #: after the measurement is in.
    laboratory_threshold: float | None = None

    #: What was measured. Keys the endpoints read: independent_perturbation,
    #: distinct_from_screen_constructs, n_perturbations, n_replicates,
    #: effect_size, p_value, controls{...}, compound, concentration_um.
    measurement: Mapping[str, Any] = field(default_factory=dict)

    #: The frozen evidence as it stood when the candidate was called. Written
    #: from the stored hit row, never from a client, and never after the
    #: outcome is known.
    #:
    #: Shaped the way the pipeline writes a candidate, because that is what
    #: `features.build_vector` reads:
    #:
    #:     {"hit": {...}, "qc": {...}, "flags": [...],
    #:      "artifacts": {...}, "context": {...}, "guides": {...},
    #:      "atlas": {...}, "depmap": {...}, "biology": {...}}
    #:
    #: Every key is optional - a screen that did not run DrugZ has no DrugZ
    #: statistic, and that is a fact about the screen rather than a zero. But a
    #: cohort whose evidence is a *differently* shaped mapping produces vectors
    #: that are entirely missing, and a fit on those succeeds and learns
    #: nothing. `network._fit_head` measures the completeness and refuses such
    #: a cohort rather than returning a model that cannot be wrong because it
    #: never saw anything.
    evidence: Mapping[str, Any] = field(default_factory=dict)

    arm: str = "unassigned"
    round_id: str | None = None
    recorded_at: str | None = None

    def __post_init__(self) -> None:
        if not self.outcome_id or not isinstance(self.outcome_id, str):
            raise OutcomeError("an outcome needs an id")
        if not self.gene or not isinstance(self.gene, str):
            raise OutcomeError(f"{self.outcome_id}: an outcome needs a gene symbol")
        if self.validation_type not in VALIDATION_TYPES:
            raise OutcomeError(
                f"{self.outcome_id}: unknown validation type {self.validation_type!r}")
        if self.result not in RESULTS:
            raise OutcomeError(f"{self.outcome_id}: unknown result {self.result!r}")
        if self.arm not in ARMS:
            raise OutcomeError(f"{self.outcome_id}: unknown arm {self.arm!r}")
        if not isinstance(self.context, Context):
            raise OutcomeError(f"{self.outcome_id}: context must be a Context")
        if (self.endpoint_id is None) != (self.endpoint_version is None):
            raise OutcomeError(
                f"{self.outcome_id}: an endpoint id needs its version and vice versa")

    # -- derived ----------------------------------------------------------

    @property
    def question(self) -> str | None:
        """The one of the four questions this outcome bears on, or None."""
        return TYPE_QUESTION[self.validation_type]

    @property
    def decided(self) -> bool:
        """Whether the bench reached an answer. Pending and inconclusive did not."""
        return self.result in ("validated", "failed")

    @property
    def label(self) -> int | None:
        """1, 0 or None. None never becomes a 0: see the module docstring."""
        return {"validated": 1, "failed": 0}.get(self.result)

    def endpoint(self):
        """The endpoint this outcome is scored against."""
        if self.endpoint_id is not None:
            return get_endpoint(self.endpoint_id, self.endpoint_version)
        found = default_endpoint(self.validation_type)
        if found is None:
            raise EndpointError(
                f"{self.outcome_id}: no endpoint covers validation type "
                f"{self.validation_type!r}")
        return found

    def decide(self) -> Decision:
        """
        Score the measurement against the endpoint.

        This is a check on the recorded result, not a replacement for it. Where
        the two disagree the disagreement is the finding: a record marked
        'validated' whose measurement does not clear the prespecified bar is a
        record that needs a human, and `endpoint_disagreements` surfaces them.
        """
        return self.endpoint().decide(
            {**self.measurement, "result": self.result},
            laboratory_threshold=self.laboratory_threshold)

    # -- serialisation ----------------------------------------------------

    def as_dict(self) -> dict:
        payload = asdict(self)
        payload["context"] = self.context.as_dict()
        payload["measurement"] = dict(self.measurement)
        payload["evidence"] = dict(self.evidence)
        return payload

    @classmethod
    def from_record(cls, record: Mapping[str, Any]) -> "OutcomeRecord":
        if not isinstance(record, Mapping):
            raise OutcomeError("an outcome record must be a mapping")
        context = record.get("context")
        return cls(
            outcome_id=str(record.get("outcome_id") or ""),
            gene=str(record.get("gene") or ""),
            validation_type=str(record.get("validation_type") or ""),
            result=str(record.get("result") or ""),
            context=context if isinstance(context, Context)
            else Context.from_record(context or {}),
            lab_id=_opt_str(record.get("lab_id")),
            study_id=_opt_str(record.get("study_id")),
            screen_id=_opt_str(record.get("screen_id")),
            endpoint_id=_opt_str(record.get("endpoint_id")),
            endpoint_version=(None if record.get("endpoint_version") is None
                              else int(record["endpoint_version"])),
            laboratory_threshold=(None if record.get("laboratory_threshold") is None
                                  else float(record["laboratory_threshold"])),
            measurement=dict(record.get("measurement") or {}),
            evidence=dict(record.get("evidence") or {}),
            arm=str(record.get("arm") or "unassigned"),
            round_id=_opt_str(record.get("round_id")),
            recorded_at=_opt_str(record.get("recorded_at")),
        )

    def stamped(self, when: datetime | None = None) -> "OutcomeRecord":
        if self.recorded_at is not None:
            return self
        moment = (when or datetime.now(timezone.utc)).astimezone(timezone.utc)
        return replace(self, recorded_at=moment.isoformat())


def _opt_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


# ---------------------------------------------------------------------------
# Working with a cohort of them
# ---------------------------------------------------------------------------

def load_outcomes(records: Iterable[Mapping[str, Any]]) -> list[OutcomeRecord]:
    """Parse a cohort, refusing the whole file rather than dropping a bad row."""
    out: list[OutcomeRecord] = []
    seen: set[str] = set()
    for i, record in enumerate(records):
        parsed = OutcomeRecord.from_record(record)
        if parsed.outcome_id in seen:
            raise OutcomeError(f"duplicate outcome id {parsed.outcome_id!r} at index {i}")
        seen.add(parsed.outcome_id)
        out.append(parsed)
    return out


def load_outcomes_file(path) -> list[OutcomeRecord]:
    with open(path, "r", encoding="utf-8") as stream:
        payload = json.load(stream)
    rows = payload["outcomes"] if isinstance(payload, Mapping) else payload
    if not isinstance(rows, list):
        raise OutcomeError("an outcome file holds a list, or an object with 'outcomes'")
    return load_outcomes(rows)


def for_question(outcomes: Sequence[OutcomeRecord], question: str) -> list[OutcomeRecord]:
    return [o for o in outcomes if o.question == question]


def decided(outcomes: Sequence[OutcomeRecord]) -> list[OutcomeRecord]:
    return [o for o in outcomes if o.decided]


@dataclass(frozen=True)
class CohortCounts:
    """What a set of outcomes actually contains. Every denominator, named."""

    total: int
    validated: int
    failed: int
    inconclusive: int
    pending: int
    n_labs: int
    n_studies: int
    n_screens: int
    n_genes: int
    labs_unattributed: int

    @property
    def n_decided(self) -> int:
        return self.validated + self.failed

    def as_dict(self) -> dict:
        return {**asdict(self), "n_decided": self.n_decided}


def count_cohort(outcomes: Sequence[OutcomeRecord]) -> CohortCounts:
    by_result = {r: 0 for r in RESULTS}
    for o in outcomes:
        by_result[o.result] += 1
    return CohortCounts(
        total=len(outcomes),
        validated=by_result["validated"],
        failed=by_result["failed"],
        inconclusive=by_result["inconclusive"],
        pending=by_result["pending"],
        n_labs=len({o.lab_id for o in outcomes if o.lab_id}),
        n_studies=len({o.study_id for o in outcomes if o.study_id}),
        n_screens=len({o.screen_id for o in outcomes if o.screen_id}),
        n_genes=len({o.gene for o in outcomes}),
        labs_unattributed=sum(1 for o in outcomes if not o.lab_id),
    )


def endpoint_disagreements(outcomes: Sequence[OutcomeRecord]) -> list[dict]:
    """
    Records whose measurement does not agree with the result they were given.

    This is a data-quality report, not a correction. Nothing is overwritten:
    the lab's own label stands, and the disagreement is surfaced so somebody
    can look. A cohort with many of these cannot support a calibrated claim and
    `coverage` is told about it.
    """
    out: list[dict] = []
    for o in outcomes:
        if not o.decided:
            continue
        try:
            decision = o.decide()
        except EndpointError as exc:
            out.append({"outcome_id": o.outcome_id, "gene": o.gene,
                        "recorded": o.result, "decision": "no_endpoint",
                        "because": str(exc)})
            continue
        if decision.decision == "insufficient_record":
            out.append({"outcome_id": o.outcome_id, "gene": o.gene,
                        "recorded": o.result, "decision": decision.decision,
                        "because": decision.because})
        elif decision.decision != o.result:
            out.append({"outcome_id": o.outcome_id, "gene": o.gene,
                        "recorded": o.result, "decision": decision.decision,
                        "because": decision.because})
    return out

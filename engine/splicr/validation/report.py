"""
The payload the console reads, and the ladder a scientist reads.

THE LADDER

One number per candidate is less useful than six rungs, because the rungs are
what a scientist already thinks in:

    PRIMARY SCREEN            significant
    GUIDE REPRODUCIBILITY     independent guide reproduced
    ORTHOGONAL GENETIC        not tested
    PHARMACOLOGIC             mixed
    ANOTHER MODEL             reproduced
    IN VIVO                   not tested

Four states per rung, and the difference between the last two is the whole
point:

    met           an outcome met the prespecified endpoint
    not_met       an outcome ran and did not meet it
    mixed         outcomes of this kind disagree with each other
    not_tested    nobody has run this. Not a negative.

`mixed` exists because of PRKDC and PTK2 in
doi:10.1158/0008-5472.CAN-24-0775: two PTK2 inhibitors, one with no effect on
either line and one with a partial response in one. Collapsing that to "failed"
or to "validated" would both be wrong, and a ladder that cannot say "mixed"
would force one of them.

A calibrated estimate is attached to a rung only where the gate opened for that
rung's question. A rung with no estimate shows its outcomes and says the
probability is unavailable, which is the state every rung is in today.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence

from . import SCHEMA_VERSION
from .endpoints import (
    QUESTION_LABEL, QUESTION_SENTENCE, QUESTIONS, VALIDATION_TYPE_LABEL,
    EndpointError,
)
from .network import Estimate, ValidationNetwork
from .outcomes import OutcomeRecord
from .coverage import Unavailable

#: The rungs, in the order a project actually climbs them. Each names the
#: question it informs and the validation types that can satisfy it.
RUNGS: tuple[dict, ...] = (
    {"key": "primary", "label": "Primary screen", "question": None,
     "types": (),
     "gloss": "The screen's own statistics called this gene."},
    {"key": "guide", "label": "Guide reproducibility", "question": "reproduces",
     "types": ("independent_guide", "independent_guide_set"),
     "gloss": "An independent perturbation reproduced the phenotype in the "
              "same model."},
    {"key": "orthogonal", "label": "Orthogonal genetic evidence",
     "question": "target_specific",
     "types": ("crispri", "crispra", "rescue", "orthogonal_genetic"),
     "gloss": "A different way of perturbing the same target agreed."},
    {"key": "pharmacologic", "label": "Pharmacologic evidence",
     "question": "pharmacologic", "types": ("small_molecule",),
     "gloss": "A selective compound recapitulated the phenotype. Failure here "
              "is often about the compound, not the gene."},
    {"key": "another_model", "label": "Another model", "question": "cross_model",
     "types": ("another_model", "organoid"),
     "gloss": "The phenotype reproduced in a different model or context."},
    {"key": "in_vivo", "label": "In vivo", "question": "cross_model",
     "types": ("in_vivo",),
     "gloss": "The phenotype reproduced in an animal."},
)

RUNG_STATES: tuple[str, ...] = ("met", "not_met", "mixed", "not_tested")

STATE_LABEL: dict[str, str] = {
    "met": "Met",
    "not_met": "Not met",
    "mixed": "Mixed",
    "not_tested": "Not tested",
}

STATE_GLOSS: dict[str, str] = {
    "met": "An outcome met the prespecified endpoint for this rung.",
    "not_met": "An outcome ran against this endpoint and did not meet it.",
    "mixed": "Outcomes of this kind disagree with each other. Both are kept; "
             "neither is averaged away.",
    "not_tested": "Nobody has run this experiment. It is not a negative result.",
}


@dataclass(frozen=True)
class Rung:
    key: str
    label: str
    gloss: str
    state: str
    question: str | None
    n_outcomes: int
    n_met: int
    n_not_met: int
    n_inconclusive: int
    n_pending: int
    #: The outcome ids behind the state, so a reader can open them.
    outcome_ids: tuple[str, ...]
    #: A calibrated estimate for this rung's question, or the refusal.
    estimate: dict | None
    estimate_available: bool
    because: str

    def as_dict(self) -> dict:
        return {**asdict(self), "state_label": STATE_LABEL[self.state],
                "state_gloss": STATE_GLOSS[self.state]}


def _rung_state(met: int, not_met: int, inconclusive: int, pending: int) -> tuple[str, str]:
    if met > 0 and not_met > 0:
        return "mixed", (
            f"{met} outcome(s) met this endpoint and {not_met} did not. Both are "
            f"recorded; a gene can reproduce under one perturbation and not "
            f"another, and that disagreement is information rather than noise.")
    if met > 0:
        return "met", f"{met} outcome(s) met the prespecified endpoint."
    if not_met > 0:
        return "not_met", (
            f"{not_met} outcome(s) ran against this endpoint and did not meet it.")
    if inconclusive > 0:
        return "not_tested", (
            f"{inconclusive} outcome(s) ran and could not decide. An inconclusive "
            f"result is not a negative one, so this rung is not marked against "
            f"the gene.")
    if pending > 0:
        return "not_tested", f"{pending} outcome(s) are still at the bench."
    return "not_tested", "No experiment of this kind has been recorded."


def ladder(gene: str, outcomes: Sequence[OutcomeRecord], *,
           primary_significant: bool | None = None,
           primary_detail: str = "",
           estimates: Mapping[str, Estimate | Unavailable] | None = None) -> dict:
    """
    One candidate's validation ladder.

    `outcomes` is every recorded outcome for this gene, of any type. Each is
    placed on the rung its validation type belongs to; an outcome whose type is
    'other' appears in the summary count and on no rung, because the rung would
    be a claim about which experiment it was.
    """
    mine = [o for o in outcomes if o.gene == gene]
    rungs: list[Rung] = []
    for spec in RUNGS:
        if spec["key"] == "primary":
            state = ("met" if primary_significant else
                     "not_met" if primary_significant is False else "not_tested")
            rungs.append(Rung(
                spec["key"], spec["label"], spec["gloss"], state, None,
                0, 0, 0, 0, 0, (), None, False,
                primary_detail or (
                    "The screen called this gene." if state == "met" else
                    "The screen did not call this gene." if state == "not_met" else
                    "No primary call is recorded for this gene.")))
            continue

        members = [o for o in mine if o.validation_type in spec["types"]]
        met = not_met = inconclusive = pending = 0
        for outcome in members:
            if outcome.result == "pending":
                pending += 1
                continue
            try:
                decision = outcome.decide().decision
            except EndpointError:
                decision = None
            #: The endpoint's verdict overrides the recorded result only where
            #: it is an actual verdict. 'insufficient_record' means a criterion
            #: the endpoint requires was not written down, which is the normal
            #: state for an outcome logged outside a blinded round - the
            #: arrayed endpoints' effect thresholds belong to the laboratory
            #: and are agreed at round creation. Treating that as "no outcome"
            #: discarded every outcome a researcher logs on its own, and showed
            #: a rung as untested beside a panel saying two outcomes existed.
            #:
            #: The cohort counting in `coverage` stays stricter, and
            #: `endpoint_disagreements` still reports every unscorable record.
            #: But a ladder whose job is to show a scientist what has been done
            #: must not erase what they recorded.
            if decision == "validated":
                met += 1
            elif decision == "failed":
                not_met += 1
            elif decision == "inconclusive":
                inconclusive += 1
            elif outcome.result == "validated":
                met += 1
            elif outcome.result == "failed":
                not_met += 1
            else:
                inconclusive += 1
        state, because = _rung_state(met, not_met, inconclusive, pending)

        question = spec["question"]
        found = (estimates or {}).get(question) if question else None
        estimate_dict: dict | None = None
        available = False
        if found is not None:
            estimate_dict = found.as_dict()
            available = bool(getattr(found, "available", False))
        rungs.append(Rung(
            spec["key"], spec["label"], spec["gloss"], state, question,
            len(members), met, not_met, inconclusive, pending,
            tuple(o.outcome_id for o in members), estimate_dict, available,
            because))

    unplaced = [o for o in mine if o.validation_type == "other"]
    return {
        "schema": "splicr.validation-ladder.v1",
        "gene": gene,
        "rungs": [r.as_dict() for r in rungs],
        "n_outcomes": len(mine),
        "n_unplaced": len(unplaced),
        "unplaced_note": (
            f"{len(unplaced)} outcome(s) were recorded as 'other'. They are kept "
            f"and exported and sit on no rung, because placing them would assert "
            f"which experiment they were." if unplaced else ""),
        "states": {s: STATE_LABEL[s] for s in RUNG_STATES},
    }


def next_experiment(ladder_payload: Mapping[str, Any]) -> dict:
    """
    Which rung to climb next, and why.

    The recommendation is the first untested rung in ladder order whose question
    carries the most remaining uncertainty, which with no calibrated estimate
    simply means the first untested rung. It is stated as a question to answer
    rather than as an instruction, because the lab knows its own capacity and
    SplicR does not.
    """
    rungs = list(ladder_payload.get("rungs") or [])
    untested = [r for r in rungs if r["state"] == "not_tested" and r["key"] != "primary"]
    mixed = [r for r in rungs if r["state"] == "mixed"]
    if mixed:
        rung = mixed[0]
        return {
            "rung": rung["key"], "label": rung["label"],
            "why": (f"Outcomes on the {rung['label'].lower()} rung disagree with "
                    f"each other. Another replicate of that rung resolves more "
                    f"than climbing a new one."),
            "question": rung["question"],
        }
    if not untested:
        return {"rung": None, "label": None,
                "why": "Every rung has an outcome recorded.", "question": None}
    rung = untested[0]
    return {
        "rung": rung["key"], "label": rung["label"],
        "why": (f"{rung['label']} is the earliest rung with no outcome. "
                f"{rung['gloss']}"),
        "question": rung["question"],
    }


def network_report(net: ValidationNetwork, *,
                   when: datetime | None = None) -> dict:
    """
    The Validation Network page's whole payload.

    Deliberately includes the refusals and the shortfalls, not just what works.
    A page that shows three fitted heads and silently omits the fourth tells the
    reader the product does four things well.
    """
    moment = (when or datetime.now(timezone.utc)).astimezone(timezone.utc)
    status = net.status()
    return {
        "schema": "splicr.validation-network-report.v1",
        "engine_schema": SCHEMA_VERSION,
        "generated_utc": moment.isoformat(),
        "fitted": status["fitted"],
        "cohort": status["cohort"],
        "questions": status["questions"],
        "heads": status["heads"],
        "refusals": status["refusals"],
        "validation_types": {k: VALIDATION_TYPE_LABEL[k]
                             for k in VALIDATION_TYPE_LABEL},
        "question_sentences": {q: QUESTION_SENTENCE[q] for q in QUESTIONS},
        "question_labels": {q: QUESTION_LABEL[q] for q in QUESTIONS},
        "ladder_rungs": [
            {"key": r["key"], "label": r["label"], "gloss": r["gloss"],
             "question": r["question"]} for r in RUNGS
        ],
        "rung_states": {s: {"label": STATE_LABEL[s], "gloss": STATE_GLOSS[s]}
                        for s in RUNG_STATES},
    }

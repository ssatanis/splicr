"""
The blinded round: freeze, then reveal, and never the other way round.

A round has exactly three states and they only go forwards.

    draft      the validation set is designed, nothing is committed
    frozen     a receipt exists, its hash has left the building, and the
               candidate universe, the ranking and the model are fixed
    revealed   outcomes have been attached

`reveal` refuses on a round that was never frozen, and refuses outcomes for
candidates that are not in the frozen validation set. Both refusals are the
point of the object: the first stops a prediction being written after the
answer, and the second stops the validation set being quietly extended to
include a candidate that turned out well.

WHAT 'BLINDED' MEANS HERE

The laboratory validates without knowing which strategy proposed which
candidate. The software cannot enforce that — a person can always look — so what
it does instead is make the arm assignment part of the frozen receipt, so that
afterwards anybody can check that the arms were not re-labelled. `blind_manifest`
is the list the bench gets: candidate genes in a shuffled order with no arm, no
rank and no score, under a seed that is itself frozen.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Mapping, Sequence

import numpy as np

from .cohort import CohortPlan
from .endpoints import endpoint as get_endpoint
from .outcomes import OutcomeRecord

STATES: tuple[str, ...] = ("draft", "frozen", "revealed")


class RoundError(ValueError):
    """A round operation that would break the order of events."""


@dataclass
class Round:
    round_id: str
    screen_id: str
    plan: CohortPlan
    state: str = "draft"
    receipt_sha256: str | None = None
    frozen_at: str | None = None
    revealed_at: str | None = None
    blind_seed: int = 20261003
    outcomes: list[OutcomeRecord] = field(default_factory=list)
    notes: str = ""

    def __post_init__(self) -> None:
        if self.state not in STATES:
            raise RoundError(f"unknown round state {self.state!r}")
        if self.state != "draft" and not self.receipt_sha256:
            raise RoundError(
                f"{self.round_id} is {self.state} with no receipt hash, which means "
                f"nothing was actually committed")

    # -- the frozen candidate set -----------------------------------------

    @property
    def selected_genes(self) -> tuple[str, ...]:
        return tuple(slot.gene for slot in self.plan.validation_set.slots)

    def arm_of(self, gene: str) -> str | None:
        for slot in self.plan.validation_set.slots:
            if slot.gene == gene:
                return slot.arm
        return None

    # -- freeze ------------------------------------------------------------

    def freeze(self, receipt_sha256: str, *, when: datetime | None = None) -> "Round":
        if self.state != "draft":
            raise RoundError(
                f"{self.round_id} is already {self.state}. A frozen round is frozen; "
                f"a changed design is a new round.")
        if not receipt_sha256 or len(receipt_sha256) != 64:
            raise RoundError("freezing needs the receipt's full sha256")
        if not self.plan.validation_set.slots:
            raise RoundError("a round with no candidates selected cannot be frozen")
        moment = (when or datetime.now(timezone.utc)).astimezone(timezone.utc)
        return replace(self, state="frozen", receipt_sha256=receipt_sha256.lower(),
                       frozen_at=moment.isoformat())

    # -- what the bench gets ----------------------------------------------

    def blind_manifest(self) -> dict:
        """
        The candidate list as the bench sees it: no arm, no rank, no score.

        Shuffled under the round's own frozen seed, so the order is
        reproducible by an auditor and is not the ranking order. A bench list
        in ranking order is not blinded, however carefully the columns are
        hidden.
        """
        if self.state == "draft":
            raise RoundError(
                "a blind manifest is issued from a frozen round, so that the list "
                "the bench works from is the list the receipt committed to")
        genes = list(self.selected_genes)
        order = np.random.default_rng(self.blind_seed).permutation(len(genes))
        shuffled = [genes[i] for i in order]
        return {
            "schema": "splicr.blind-manifest.v1",
            "round_id": self.round_id,
            "receipt_sha256": self.receipt_sha256,
            "blind_seed": self.blind_seed,
            "endpoint": self.plan.endpoint_key,
            "laboratory_threshold": self.plan.laboratory_threshold,
            "n_candidates": len(shuffled),
            "genes": shuffled,
            "manifest_sha256": hashlib.sha256(
                ("\n".join(shuffled)).encode()).hexdigest(),
            "instructions":
                "Validate every gene on this list against the named endpoint, "
                "including the ones that look uninteresting. Record the result "
                "for all of them, failures and inconclusives included. Which "
                "strategy proposed which candidate is in the frozen receipt and "
                "is deliberately not here.",
        }

    # -- reveal ------------------------------------------------------------

    def reveal(self, outcomes: Sequence[OutcomeRecord], *,
               when: datetime | None = None,
               allow_partial: bool = True) -> "Round":
        """
        Attach outcomes to a frozen round.

        Refusals, each for its own reason:

          not frozen        the prediction was never committed, so these
                            outcomes cannot score it
          already revealed  a second reveal is an amendment, and an amendable
                            outcome set is not evidence
          unknown gene      the candidate is not in the frozen validation set.
                            Accepting it would let the set grow to include
                            whatever happened to work.
          wrong endpoint    the outcome was scored against a different endpoint
                            than the round agreed to
        """
        if self.state == "draft":
            raise RoundError(
                f"{self.round_id} was never frozen. Outcomes cannot score a "
                f"prediction that was not committed first.")
        if self.state == "revealed":
            raise RoundError(
                f"{self.round_id} has already been revealed. Record a further "
                f"experiment as a new round rather than amending this one.")
        selected = set(self.selected_genes)
        unknown = sorted({o.gene for o in outcomes if o.gene not in selected})
        if unknown:
            raise RoundError(
                f"{len(unknown)} outcome(s) name genes that are not in this round's "
                f"frozen validation set: {unknown[:5]}"
                f"{' ...' if len(unknown) > 5 else ''}. The set cannot grow after "
                f"the freeze.")
        if self.plan.endpoint_key is not None:
            agreed = get_endpoint(self.plan.endpoint_key)
            wrong = sorted({o.outcome_id for o in outcomes
                            if o.endpoint_id is not None
                            and f"{o.endpoint_id}.v{o.endpoint_version}" != agreed.key})
            if wrong:
                raise RoundError(
                    f"{len(wrong)} outcome(s) were scored against an endpoint other "
                    f"than the round's agreed {agreed.key}: {wrong[:5]}")
        missing = sorted(selected - {o.gene for o in outcomes})
        if missing and not allow_partial:
            raise RoundError(
                f"{len(missing)} candidate(s) in the frozen set have no outcome: "
                f"{missing[:5]}. Pass allow_partial=True to reveal a round that is "
                f"still running.")
        moment = (when or datetime.now(timezone.utc)).astimezone(timezone.utc)
        stamped = [replace(o, round_id=self.round_id,
                           arm=(o.arm if o.arm != "unassigned"
                                else (self.arm_of(o.gene) or "unassigned"))).stamped(moment)
                   for o in outcomes]
        return replace(self, state="revealed", revealed_at=moment.isoformat(),
                       outcomes=list(stamped))

    # -- reading -----------------------------------------------------------

    def labels(self) -> list[int | None]:
        """
        1, 0 or None per candidate in the frozen validation set's order.

        None for a candidate with no decided outcome. The whole set is returned,
        not just the ones with answers, because precision@k needs to know how
        much of the top k was never tested.
        """
        by_gene = {o.gene: o for o in self.outcomes}
        return [by_gene[gene].label if gene in by_gene else None
                for gene in self.selected_genes]

    def completeness(self) -> dict:
        labels = self.labels()
        decided = sum(1 for v in labels if v is not None)
        return {"n_selected": len(labels), "n_recorded": len(self.outcomes),
                "n_decided": decided,
                "n_outstanding": len(labels) - len(self.outcomes),
                "complete": decided == len(labels)}

    def as_dict(self) -> dict:
        return {
            "schema": "splicr.validation-round.v1",
            "round_id": self.round_id, "screen_id": self.screen_id,
            "state": self.state, "receipt_sha256": self.receipt_sha256,
            "frozen_at": self.frozen_at, "revealed_at": self.revealed_at,
            "blind_seed": self.blind_seed,
            "plan": self.plan.as_dict(),
            "completeness": self.completeness(),
            "notes": self.notes,
            "outcomes": [o.as_dict() for o in self.outcomes],
        }

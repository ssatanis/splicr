"""
The validation set that defeats cherry-picking.

THE PROBLEM, CONCRETELY

SplicR ranks 200 candidates. The lab validates its five favourites. Four come
back positive. Nobody may conclude that SplicR is 80% accurate, because the lab
tested the candidates it already liked, and a ranking is only tested by the
candidates somebody would not otherwise have chosen.

THE PUBLISHED FIX

This is a known problem with a published prescription. The Nature Reviews
Methods Primers article on high-content CRISPR screening
(doi:10.1038/s43586-022-00098-7) puts it plainly: "Although it is common
practice to cherry-pick interesting screening hits for validation, this approach
cannot validate the screen as a whole. For a representative assessment of the
screening hits, some hits should be selected for validation solely based on
their ranks - for example, the top 20 hits as well as 10 hits each around the
5th, 10th, 25th, 50th and 75th percentiles."

That design is `RANK_STRATIFIED_REFERENCE` below, implemented at its published
sizes and scaled down proportionally when the budget is smaller. It is the
default because it is somebody else's recommendation, published and citable,
rather than a stratification SplicR invented for its own convenience.

THE ARM DESIGN, ON TOP

Rank stratification makes the *screen* assessable. Comparing *strategies* needs
one more thing: candidates drawn from each strategy's own top of the list, so
that precision@k is defined for all of them and the discordant set is big enough
to test. So a round draws four arms:

    splicr        the network's own top candidates
    fdr           the screen's q-value ranking
    investigator  whatever the lab would have picked
    random        drawn across the rank range

and deduplicates: a candidate every strategy picked is assigned once, to the
arm that reached it first in a fixed precedence, and the saving is handed back
to the arms that still have room. A budget of 20 with heavy overlap buys more
distinct candidates than a budget of 20 with none, and the round says which.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Mapping, Sequence

import numpy as np

from .baselines import Ranking

#: The published reference design, at its published sizes.
#: doi:10.1038/s43586-022-00098-7
RANK_STRATIFIED_REFERENCE: dict = {
    "source": "doi:10.1038/s43586-022-00098-7",
    "top_n": 20,
    "percentiles": (5, 10, 25, 50, 75),
    "per_percentile": 10,
    "total": 70,
}

#: Order in which arms claim a candidate that several of them chose. SplicR last
#: on purpose: if a candidate is in the lab's own list, it is attributed to the
#: lab, so SplicR cannot take credit for a pick the investigator would have made
#: anyway. That makes every lift this design measures a conservative one.
ARM_PRECEDENCE: tuple[str, ...] = ("investigator", "fdr", "random", "splicr")


class CohortError(ValueError):
    """A validation set the budget or the candidate list cannot support."""


@dataclass(frozen=True)
class Slot:
    """One candidate assigned to one arm, with the reason it was drawn."""

    index: int
    gene: str
    arm: str
    stratum: str
    rank_in_arm: int
    #: Every arm that wanted this candidate, before deduplication.
    wanted_by: tuple[str, ...]

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class ValidationSet:
    slots: tuple[Slot, ...]
    budget: int
    design: str
    #: Arms that asked for fewer slots than they were allotted, because every
    #: candidate they wanted had already been claimed.
    overlap_saved: int
    by_arm: dict[str, int]
    by_stratum: dict[str, int]
    note: str

    @property
    def genes(self) -> tuple[str, ...]:
        return tuple(s.gene for s in self.slots)

    def as_dict(self) -> dict:
        return {"design": self.design, "budget": self.budget,
                "n_slots": len(self.slots), "overlap_saved": self.overlap_saved,
                "by_arm": dict(self.by_arm), "by_stratum": dict(self.by_stratum),
                "note": self.note,
                "slots": [s.as_dict() for s in self.slots]}


def rank_stratified(ranking: Ranking, genes: Sequence[str], *,
                    budget: int | None = None) -> ValidationSet:
    """
    The published design: the top N, plus a block at each percentile.

    At the published budget of 70 the blocks are exactly as the article
    specifies. A smaller budget scales both the top block and the per-percentile
    blocks by the same factor and keeps at least one candidate per percentile,
    because dropping a percentile entirely would reintroduce the bias the design
    exists to remove.
    """
    n = len(genes)
    if n == 0:
        raise CohortError("no candidates to draw a validation set from")
    reference_total = int(RANK_STRATIFIED_REFERENCE["total"])
    target = reference_total if budget is None else int(budget)
    if target < 1:
        raise CohortError("a validation budget of fewer than 1 is not a design")
    percentiles = tuple(RANK_STRATIFIED_REFERENCE["percentiles"])
    scale = min(1.0, target / reference_total)
    top_n = max(1, int(round(int(RANK_STRATIFIED_REFERENCE["top_n"]) * scale)))
    per_pct = max(1, int(round(int(RANK_STRATIFIED_REFERENCE["per_percentile"]) * scale)))

    order = list(ranking.order)
    taken: set[int] = set()
    slots: list[Slot] = []

    def claim(index: int, stratum: str) -> None:
        if index in taken or len(slots) >= target:
            return
        taken.add(index)
        slots.append(Slot(index, genes[index], "rank_stratified", stratum,
                          len(slots) + 1, ("rank_stratified",)))

    for position in order[:top_n]:
        claim(position, f"top_{top_n}")
    collisions: list[str] = []
    for pct in percentiles:
        centre = int(round((pct / 100.0) * (n - 1)))
        half = per_pct // 2
        window = range(max(0, centre - half), min(n, centre - half + per_pct))
        before = len(slots)
        for offset in window:
            claim(order[offset], f"p{pct}")
        short = per_pct - (len(slots) - before)
        if short > 0:
            collisions.append(f"{pct}th ({short} of {per_pct})")

    #: A percentile block comes up short when its window has already been
    #: claimed. On a short candidate list that is not a bug: the 5th percentile
    #: of 200 candidates is rank 10, which the top block already holds. It is
    #: reported rather than papered over, because a reader comparing this set
    #: with the published design has to be able to see where they differ.
    #:
    #: The remainder is then filled from unclaimed ranks walking inward from the
    #: deepest end, never from the top, which would quietly turn a stratified
    #: set back into a top-k set and reintroduce the bias it exists to remove.
    if len(slots) < target:
        for position in reversed(order):
            if len(slots) >= target:
                break
            claim(position, "unclaimed_ranks")

    by_stratum: dict[str, int] = {}
    for slot in slots:
        by_stratum[slot.stratum] = by_stratum.get(slot.stratum, 0) + 1
    note = (f"{RANK_STRATIFIED_REFERENCE['source']}: top {top_n} plus {per_pct} "
            f"around each of the {', '.join(f'{p}th' for p in percentiles)} "
            f"percentiles")
    if scale < 1.0:
        note += (f", scaled from the published {reference_total}-validation design "
                 f"by {scale:.2f}")
    note += "."
    if collisions:
        note += (f" On {n} candidates the {', '.join(collisions)} percentile "
                 f"window(s) fell inside a block already drawn; the shortfall was "
                 f"filled from the deepest unclaimed ranks.")
    return ValidationSet(tuple(slots), target, "rank_stratified", 0,
                         {"rank_stratified": len(slots)}, by_stratum, note)


def stratified_arms(rankings: Mapping[str, Ranking], genes: Sequence[str], *,
                    budget: int, per_arm: int | None = None) -> ValidationSet:
    """
    Equal slots per arm, deduplicated under ARM_PRECEDENCE.

    `budget` is the number of distinct validations the lab agreed to run, so a
    candidate several arms wanted costs one validation, not three. The slots
    freed by that overlap are returned to the arms that still have candidates
    they want, in a second pass, and `overlap_saved` reports how many there
    were. A buyer reading "20 validations bought 20 distinct candidates" and
    "20 validations bought 20 distinct candidates after 6 overlaps were
    reassigned" is reading two different experiments.
    """
    if not rankings:
        raise CohortError("no ranking strategies to draw arms from")
    n = len(genes)
    if n == 0:
        raise CohortError("no candidates to draw a validation set from")
    arms = [name for name in ARM_PRECEDENCE if name in rankings]
    arms += [name for name in rankings if name not in ARM_PRECEDENCE]
    share = per_arm if per_arm is not None else max(1, budget // len(arms))

    wanted: dict[int, list[str]] = {}
    for name in arms:
        for index in rankings[name].top(share):
            wanted.setdefault(index, []).append(name)

    taken: set[int] = set()
    slots: list[Slot] = []
    per_arm_count: dict[str, int] = {name: 0 for name in arms}

    def claim(index: int, arm: str) -> bool:
        if index in taken or len(slots) >= budget:
            return False
        taken.add(index)
        per_arm_count[arm] += 1
        slots.append(Slot(index, genes[index], arm, arm, per_arm_count[arm],
                          tuple(wanted.get(index, (arm,)))))
        return True

    # Pass one: each arm takes its share, in precedence order.
    for name in arms:
        for index in rankings[name].top(share):
            if per_arm_count[name] >= share:
                break
            claim(index, name)

    overlap_saved = sum(1 for index, names in wanted.items() if len(names) > 1)

    # Pass two: spend what the overlap freed, deepest-starved arm first.
    if len(slots) < budget:
        depth = share
        while len(slots) < budget and depth < n:
            depth = min(n, depth * 2)
            progressed = False
            for name in sorted(arms, key=lambda a: per_arm_count[a]):
                for index in rankings[name].top(depth):
                    if len(slots) >= budget:
                        break
                    if claim(index, name):
                        progressed = True
                        break
            if not progressed:
                break

    by_arm = {name: count for name, count in per_arm_count.items()}
    note = (f"{len(slots)} distinct candidates for a budget of {budget} across "
            f"{len(arms)} arms at {share} each. {overlap_saved} candidate(s) were "
            f"wanted by more than one arm and were assigned once, under the "
            f"precedence {' > '.join(arms)}; SplicR is last, so a candidate the "
            f"investigator also chose is credited to the investigator.")
    return ValidationSet(tuple(slots), budget, "stratified_arms", overlap_saved,
                         by_arm, dict(by_arm), note)


@dataclass
class CohortPlan:
    """A round's design, ready to be frozen into a receipt."""

    validation_set: ValidationSet
    rankings: dict[str, dict] = field(default_factory=dict)
    laboratory_threshold: float | None = None
    endpoint_key: str | None = None
    budget_agreed: int = 0

    def as_dict(self) -> dict:
        return {
            "schema": "splicr.validation-cohort.v1",
            "validation_set": self.validation_set.as_dict(),
            "rankings": dict(sorted(self.rankings.items())),
            "laboratory_threshold": self.laboratory_threshold,
            "endpoint": self.endpoint_key,
            "budget_agreed": self.budget_agreed,
        }


def plan(rankings: Mapping[str, Ranking], genes: Sequence[str], *,
         budget: int, design: str = "stratified_arms",
         endpoint_key: str | None = None,
         laboratory_threshold: float | None = None) -> CohortPlan:
    """Build a round's validation set under one of the two designs."""
    if design == "rank_stratified":
        primary = rankings.get("splicr") or next(iter(rankings.values()))
        chosen = rank_stratified(primary, genes, budget=budget)
    elif design == "stratified_arms":
        chosen = stratified_arms(rankings, genes, budget=budget)
    else:
        raise CohortError(f"unknown validation-set design {design!r}")
    return CohortPlan(chosen,
                      {name: r.as_dict() for name, r in rankings.items()},
                      laboratory_threshold, endpoint_key, budget)

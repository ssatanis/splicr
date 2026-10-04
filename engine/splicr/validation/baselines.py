"""
What SplicR has to beat, and the only comparison a customer cares about.

"92% accurate" is not a claim anybody can act on, and if most candidates fail
validation it is a claim a model can earn by saying no to everything. The claim
that matters is comparative and budgeted:

    at the same number of follow-up experiments, how many independently
    confirmed hits does each selection strategy return?

So every ranking is a baseline here, including the investigator's own, and they
all expose the same interface: given candidates, return an order. The
investigator baseline is not a model — it is whatever the lab actually chose,
read out of the recorded arm — and it is the hardest one to beat, which is why
it is in the list.

RANKING, NOT SCORING

Each baseline returns indices in its preferred order and says which field it
ordered on. A baseline that cannot rank a candidate (no FDR recorded, no Bayes
factor) puts it last and reports how many it could not place, rather than
scoring it zero: zero would be the best possible FDR.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping, Sequence

import numpy as np


@dataclass(frozen=True)
class Ranking:
    name: str
    label: str
    ordered_on: str
    order: tuple[int, ...]
    #: Candidates the baseline had no basis to place, pushed to the end.
    n_unrankable: int
    note: str = ""

    def top(self, k: int) -> tuple[int, ...]:
        return self.order[:k]

    def as_dict(self) -> dict:
        return {"name": self.name, "label": self.label, "ordered_on": self.ordered_on,
                "n_unrankable": self.n_unrankable, "note": self.note}


def _field(candidates: Sequence[Mapping], *path: str) -> np.ndarray:
    out = np.full(len(candidates), np.nan)
    for i, candidate in enumerate(candidates):
        node: object = candidate
        for key in path:
            if not isinstance(node, Mapping):
                node = None
                break
            node = node.get(key)
        if node is None or isinstance(node, bool):
            continue
        try:
            value = float(node)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if np.isfinite(value):
            out[i] = value
    return out


def _rank(name: str, label: str, ordered_on: str, keys: np.ndarray, *,
          ascending: bool, note: str = "") -> Ranking:
    """
    Order by `keys`, missing last, ties broken by original position.

    Stable on purpose: two candidates with the same q-value must come out in the
    same order on every run, or a precision@10 moves between runs for no reason.
    """
    missing = ~np.isfinite(keys)
    signed = np.where(missing, np.inf, keys if ascending else -keys)
    order = np.lexsort((np.arange(len(keys)), signed))
    return Ranking(name, label, ordered_on, tuple(int(i) for i in order),
                   int(missing.sum()), note)


def baseline_fdr(candidates: Sequence[Mapping]) -> Ranking:
    """Baseline A: the screen's own q-value, smallest first."""
    return _rank("fdr", "FDR only", "hits.fdr", _field(candidates, "hit", "fdr"),
                 ascending=True,
                 note="The default most labs use. Blind to guide agreement, "
                      "copy number and prior art.")


def baseline_effect_fdr(candidates: Sequence[Mapping]) -> Ranking:
    """
    Baseline B: significant first, then by effect magnitude.

    Implemented as -log10(q) * |lfc| rather than a two-key sort, because a lab
    doing this by hand sorts on significance and then scans for big effects,
    and the product of the two reproduces that behaviour without a threshold
    nobody agreed on.
    """
    fdr = _field(candidates, "hit", "fdr")
    lfc = np.abs(_field(candidates, "hit", "lfc"))
    with np.errstate(divide="ignore", invalid="ignore"):
        significance = -np.log10(np.clip(fdr, 1e-300, 1.0))
    keys = np.where(np.isfinite(significance) & np.isfinite(lfc), significance * lfc, np.nan)
    return _rank("effect_fdr", "Effect size and FDR", "-log10(fdr) * |lfc|", keys,
                 ascending=False,
                 note="Needs both a q-value and an effect size; a candidate "
                      "missing either is unranked.")


def baseline_mageck(candidates: Sequence[Mapping]) -> Ranking:
    """Baseline C: MAGeCK's own RRA rank, as the tool printed it."""
    keys = _field(candidates, "hit", "stat_rank")
    if not np.isfinite(keys).any():
        keys = _field(candidates, "hit", "rra_score")
    return _rank("mageck", "MAGeCK RRA rank", "hits.stat_rank", keys, ascending=True,
                 note="The tool's own ordering, not re-derived.")


def baseline_bagel(candidates: Sequence[Mapping]) -> Ranking:
    """
    Baseline D: BAGEL2 Bayes factor, largest first.

    Only meaningful on a loss-of-function fitness contrast against a library
    reference, which is why `n_unrankable` matters more here than elsewhere: on
    a drug-modifier screen this baseline legitimately places nothing.
    """
    return _rank("bagel", "BAGEL2 Bayes factor", "hits.bayes_factor",
                 _field(candidates, "hit", "bayes_factor"), ascending=False,
                 note="Defined only for essentiality contrasts.")


def baseline_investigator(candidates: Sequence[Mapping]) -> Ranking:
    """
    Baseline E: what the lab actually picked.

    Read from `investigator_rank` where the round recorded one, otherwise from
    the arm: a candidate the investigator chose ranks above one they did not.
    This is not a model and it is not reconstructed; a candidate with no
    recorded investigator opinion is unrankable and says so.
    """
    explicit = _field(candidates, "investigator_rank")
    if np.isfinite(explicit).any():
        return _rank("investigator", "Investigator's own choices", "investigator_rank",
                     explicit, ascending=True,
                     note="The ranks the laboratory recorded before any outcome.")
    keys = np.full(len(candidates), np.nan)
    for i, candidate in enumerate(candidates):
        arm = candidate.get("arm")
        if arm == "investigator":
            keys[i] = 0.0
        elif arm in ("splicr", "fdr", "random"):
            keys[i] = 1.0
    return _rank("investigator", "Investigator's own choices", "arm", keys,
                 ascending=True,
                 note="Derived from the recorded arm: chosen, or not chosen. "
                      "Within those two groups there is no order, so this "
                      "baseline cannot be read at a finer k than the arm size.")


BASELINES: dict[str, Callable[[Sequence[Mapping]], Ranking]] = {
    "fdr": baseline_fdr,
    "effect_fdr": baseline_effect_fdr,
    "mageck": baseline_mageck,
    "bagel": baseline_bagel,
    "investigator": baseline_investigator,
}


def rank_all(candidates: Sequence[Mapping]) -> dict[str, Ranking]:
    """Every baseline that can place at least one candidate."""
    out: dict[str, Ranking] = {}
    for name, build in BASELINES.items():
        ranking = build(candidates)
        if ranking.n_unrankable < len(candidates):
            out[name] = ranking
    return out


def ranking_from_scores(scores: Sequence[float], *, name: str = "splicr",
                        label: str = "SplicR validation network",
                        ordered_on: str = "calibrated validation probability") -> Ranking:
    """SplicR's own ranking, in the same shape as the baselines."""
    return _rank(name, label, ordered_on, np.asarray(scores, dtype=float),
                 ascending=False)

"""Enforced leakage boundary for BioGRID ORCS <-> AssayBench.

AssayBench is derived from BioGRID ORCS: 1565 of the 1952 human ORCS screens ARE
AssayBench records, and ORCS ships gene-level HIT calls for them. For a validation
or test screen those HIT calls are the answer key -- val/test screens self-match
their own AssayBench labels at median hit-set Jaccard 0.935. Reading one is not a
subtle bias, it is reading the label.

The mapping is exact, not fuzzy: ``dataset_name`` literally encodes the ORCS
SCREEN_ID(s). See ``_assaybench_safe_orcs.json`` for the rule and the audit.

This module is the only sanctioned way to touch ORCS. It refuses excluded ids at
the point of read, so a bug downstream cannot silently leak.

    from splicr.orcs_safe import safe_ids, assert_safe, load_safe_hits

    assert_safe(screen_id)          # raises LeakageError if not safe
    hits = load_safe_hits()         # {screen_id: [gene, ...]}, safe screens only
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Iterable

_HERE = os.path.dirname(os.path.abspath(__file__))
BOUNDARY_JSON = os.path.join(_HERE, "_assaybench_safe_orcs.json")
PARSED_DIR = os.environ.get(
    "ORCS_PARSED_DIR",
    "/Users/sahaj/Documents/Projects/SplicR/data/references/orcs/parsed",
)

#: Which exclusion policy to enforce. "publication" is the recommended default:
#: it drops the 359 val/test screens *and* the 19 same-paper sibling screens,
#: which are technical replicates of a val/test screen. "screen" is the bare
#: minimum. "strict" additionally drops 14 screens flagged only by hit-set
#: Jaccard; that flag was investigated and is core-essentiality overlap between
#: independent papers, not experiment identity, so "strict" costs signal.
POLICY = os.environ.get("ORCS_EXCLUSION_POLICY", "publication")

_KEY = {
    "publication": "safe_orcs_ids",
    "screen": "safe_orcs_ids_screen_level",
    "strict": "safe_orcs_ids_strict",
}


class LeakageError(RuntimeError):
    """Raised when code tries to read an ORCS screen that is an AssayBench val/test screen."""


@lru_cache(maxsize=1)
def boundary() -> dict:
    """The full audit document."""
    with open(BOUNDARY_JSON) as fh:
        return json.load(fh)


@lru_cache(maxsize=4)
def safe_ids(policy: str | None = None) -> frozenset[int]:
    """ORCS screen ids that may be read while evaluating on AssayBench val/test."""
    pol = policy or POLICY
    if pol not in _KEY:
        raise ValueError(f"unknown policy {pol!r}; choose from {sorted(_KEY)}")
    return frozenset(boundary()[_KEY[pol]])


@lru_cache(maxsize=1)
def excluded_ids() -> frozenset[int]:
    """ORCS screen ids that are AssayBench validation/test screens, or their same-paper siblings."""
    return frozenset(boundary()["excluded_orcs_ids"])


@lru_cache(maxsize=1)
def usable_ids() -> frozenset[int]:
    """Safe screens that also measured a real library (>=5000 genes, not a hit-list-only deposit)."""
    return frozenset(boundary()["safe_orcs_ids_usable_full_library"])


def assert_safe(screen_ids: int | Iterable[int], policy: str | None = None) -> None:
    """Raise :class:`LeakageError` if any id is outside the safe set.

    Call this immediately before reading, never after aggregating.
    """
    ids = [screen_ids] if isinstance(screen_ids, int) else list(screen_ids)
    ok = safe_ids(policy)
    bad = [i for i in ids if int(i) not in ok]
    if bad:
        excl = excluded_ids()
        why = {i: ("AssayBench validation/test screen or same-paper sibling"
                   if int(i) in excl else "not a known human ORCS screen id")
               for i in bad[:10]}
        raise LeakageError(
            f"refusing to read {len(bad)} ORCS screen(s) under policy {policy or POLICY!r}: {why}"
            + (" ..." if len(bad) > 10 else "")
        )


def filter_safe(screen_ids: Iterable[int], policy: str | None = None) -> list[int]:
    """Drop unsafe ids instead of raising. Prefer :func:`assert_safe` where you can."""
    ok = safe_ids(policy)
    return [int(i) for i in screen_ids if int(i) in ok]


@lru_cache(maxsize=1)
def load_safe_hits() -> dict[int, list[str]]:
    """``{screen_id: [HIT gene symbol, ...]}`` for safe screens only.

    Reads the safe-only parsed cache, which physically does not contain the
    excluded screens, so this cannot leak even if the caller is wrong.
    """
    path = os.path.join(PARSED_DIR, "orcs_human_safe_hits.json")
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"{path} missing. Rebuild it from the archive with tools/build_orcs_safe_cache.py"
        )
    with open(path) as fh:
        raw = json.load(fh)
    out = {int(k): v for k, v in raw["hits"].items()}
    assert_safe(out.keys(), policy=raw.get("policy"))
    return out


def load_safe_long(columns: list[str] | None = None):
    """Long-format ``(screen_id, gene, hit, score1)`` table for safe screens only."""
    import pyarrow.parquet as pq

    path = os.path.join(PARSED_DIR, "orcs_human_safe_long.parquet")
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"{path} missing. Rebuild it from the archive with tools/build_orcs_safe_cache.py"
        )
    tb = pq.read_table(path, columns=columns)
    if "screen_id" in tb.column_names:
        assert_safe(set(tb.column("screen_id").to_pylist()))
    return tb


if __name__ == "__main__":
    b = boundary()
    print(f"ORCS release {b['orcs']['release']}  human screens {b['orcs']['n_screens']}")
    for pol in ("screen", "publication", "strict"):
        print(f"  policy {pol:<12} safe {len(safe_ids(pol)):>5}")
    print(f"  excluded (publication) {len(excluded_ids())}")
    print(f"  safe AND full-library  {len(usable_ids())}")
    print(f"  active policy          {POLICY}")
    for sid in (1, 2063):
        try:
            assert_safe(sid); print(f"  assert_safe({sid}) -> OK")
        except LeakageError as e:
            print(f"  assert_safe({sid}) -> REFUSED: {str(e)[:110]}")

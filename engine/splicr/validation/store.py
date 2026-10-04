"""
Where the cohort lives, and why the model is not what gets stored.

A fitted model could be pickled. It will not be, for two reasons.

A pickle is not auditable. Nobody can read one and check what it learned, and a
reviewer asking "what was this calibrated on" would have to take the file's word
for it.

And the model is a function of the cohort. The cohort is the asset — the thing
competitors cannot download and every partner laboratory adds to — so the
cohort is what gets hashed, versioned and committed, and the model is derived
from it on load. That also makes the receipt's claim checkable: a receipt names
the cohort's hash, and anybody with the cohort can refit and get the same
numbers.

The cost is a fit on load. At the hundreds-to-thousands of outcomes this is
designed for, that is well under a second, and it is cached on the cohort
file's identity so a pipeline run does not pay it twice.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from .network import ValidationNetwork
from .outcomes import OutcomeError, OutcomeRecord, load_outcomes

#: Overridable so a test, a partner import or a Modal job can point elsewhere.
ENV_VAR = "SPLICR_VALIDATION_COHORT"


def cohort_path() -> Path:
    override = os.environ.get(ENV_VAR)
    if override:
        return Path(override)
    from ..config import ROOT
    return ROOT / "data" / "validation" / "outcomes.json"


@dataclass(frozen=True)
class LoadedNetwork:
    network: ValidationNetwork
    cohort_sha256: str | None
    cohort_path: str | None
    n_outcomes: int
    source: str
    problem: str | None = None

    def as_dict(self) -> dict:
        return {"cohort_sha256": self.cohort_sha256, "cohort_path": self.cohort_path,
                "n_outcomes": self.n_outcomes, "source": self.source,
                "problem": self.problem, "fitted": self.network.fitted,
                "n_heads": len(self.network.heads)}


_CACHE: dict[tuple, LoadedNetwork] = {}


def load_network(path: str | Path | None = None, *,
                 use_cache: bool = True) -> LoadedNetwork:
    """
    Fit the network from the cohort on disk, or return the honest empty one.

    A missing cohort file is not an error. It is the state SplicR is in until
    partner laboratories have contributed outcomes, and the returned network
    refuses every estimate with a reason that says so. A *malformed* cohort file
    is different: it is reported as a problem rather than silently treated as
    absent, because "we could not read your outcomes" and "you have no
    outcomes" must not look the same to an operator.
    """
    target = Path(path) if path is not None else cohort_path()
    if not target.exists():
        return LoadedNetwork(ValidationNetwork(), None, str(target), 0,
                             f"no cohort file at {target}; the network is unfitted "
                             f"and every estimate is refused with a reason")
    stat = target.stat()
    key = (str(target.resolve()), stat.st_mtime_ns, stat.st_size)
    if use_cache and key in _CACHE:
        return _CACHE[key]

    body = target.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    try:
        payload = json.loads(body.decode("utf-8"))
        rows = payload["outcomes"] if isinstance(payload, dict) else payload
        outcomes = load_outcomes(rows)
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError,
            OutcomeError) as exc:
        loaded = LoadedNetwork(
            ValidationNetwork(), digest, str(target), 0,
            "cohort file present but unreadable; the network is unfitted",
            f"{type(exc).__name__}: {exc}")
        if use_cache:
            _CACHE[key] = loaded
        return loaded

    loaded = LoadedNetwork(
        ValidationNetwork.fit(outcomes), digest, str(target), len(outcomes),
        f"fitted from {len(outcomes)} recorded outcomes in {target.name}")
    if use_cache:
        _CACHE[key] = loaded
    return loaded


def write_cohort(outcomes: Sequence[OutcomeRecord], path: str | Path) -> str:
    """
    Write a cohort, atomically, and return its hash.

    Temp-file-and-replace, like every other artifact write in this engine, so a
    half-written cohort never becomes the thing a pipeline run calibrates
    against.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema": "splicr.validation-cohort.v1",
        "n_outcomes": len(outcomes),
        "outcomes": [o.as_dict() for o in outcomes],
    }
    body = (json.dumps(payload, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_bytes(body)
    temporary.replace(target)
    return hashlib.sha256(body).hexdigest()


def clear_cache() -> None:
    _CACHE.clear()

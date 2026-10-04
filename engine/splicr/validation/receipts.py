"""
Prediction receipts: the thing that stops "we changed the model after seeing
what worked".

A prospective claim registered after the outcomes are known is worth nothing.
The only way to make a prospective claim checkable by somebody who does not
trust you is to commit to the prediction in content-addressed form before the
answer exists, and to hand the hash to somebody else.

So a receipt is written with exclusive creation — it cannot overwrite — and it
holds everything that would otherwise be deniable:

    the candidate universe, in full, not just the picks
    the rank and frozen evidence vector of every candidate
    the model manifest, the calibrator, the feature-spec hash
    the endpoint registry hash and the laboratory's agreed threshold
    the engine revision and the working-tree patch hash
    the cohort the estimate was licensed by, or the refusal

and, deliberately, no field in which an outcome could be recorded. The API has
no argument for one. A receipt that could hold an outcome is a receipt somebody
can be asked to backfill.

WHAT THIS IS NOT

It is not trusted timestamping. A local file proves content, not time, and the
`timestamp_trust` field says so in the payload rather than in a README nobody
reads. An independent custodian has to hold the hash. This mirrors
`research_protocol.freeze_predictions`, which already made that argument for the
pre-screen track; this is the post-screen, per-candidate version of the same
discipline, and the two use the same wording on purpose.
"""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from . import SCHEMA_VERSION
from .endpoints import registry_hash
from .features import spec_hash

RECEIPT_SCHEMA = "splicr.validation-receipt.v1"


class ReceiptError(ValueError):
    """A receipt that could not be written, or did not verify."""


def _git(args: Sequence[str], cwd: Path) -> str | None:
    try:
        return subprocess.check_output(["git", *args], cwd=cwd, text=True,
                                       stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def provenance(root: Path | None = None) -> dict:
    """
    Where the code came from, including whether it was dirty.

    The working-tree patch hash matters as much as the revision: a receipt
    written from a modified checkout and a receipt written from a clean one are
    different claims, and only one of them is reproducible from a commit.
    """
    if root is None:
        from ..config import ROOT
        root = ROOT
    base = Path(root)
    patch = _git(["diff", "--", "engine/splicr/validation"], base)
    return {
        "git_revision": _git(["rev-parse", "HEAD"], base),
        "git_dirty": bool(_git(["status", "--porcelain"], base)),
        "validation_patch_sha256": (
            hashlib.sha256(patch.encode()).hexdigest() if patch is not None else None),
        "python": platform.python_version(),
        "schema_version": SCHEMA_VERSION,
        "feature_spec_sha256": spec_hash(),
        "endpoint_registry_sha256": registry_hash(),
    }


#: JavaScript integers are exact to 2**53. A receipt carrying a whole number
#: larger than that cannot be re-derived in the console, so it is refused rather
#: than written as bytes only one of the two languages can reproduce.
EXACT_INTEGER_LIMIT = 2 ** 53


def _normalise(node: Any, where: str = "payload") -> Any:
    """
    Make the payload's numbers independent of which language wrote them.

    Python has ints and floats; JavaScript has one number type. `json.dumps`
    writes a Python float of 1.0 as "1.0" and an int of 1 as "1", and the
    console cannot tell which was meant, so the same logical payload would hash
    two ways depending on where it was built.

    So a whole-valued float becomes an int before serialisation. `1.0` and `1`
    both become `1`, in both languages, and the receipt's hash is a property of
    its content rather than of its provenance. Nothing is lost: a receipt
    records ranks, scores and counts, and none of them is a quantity where
    "1.0" and "1" differ.

    A whole number past 2**53 is refused instead, because the console could not
    round-trip it and a commitment only one side can verify is not one.
    """
    if isinstance(node, bool):
        return node
    if isinstance(node, float):
        if node != node or node in (float("inf"), float("-inf")):
            raise ReceiptError(f"{where} is not a finite number")
        if node.is_integer():
            if abs(node) > EXACT_INTEGER_LIMIT:
                raise ReceiptError(
                    f"{where} is a whole number larger than 2**53; the console "
                    f"cannot round-trip it, so the receipt could not be verified "
                    f"there")
            #: -0.0 and 0.0 are the same quantity and must hash the same.
            return int(node)
        return node
    if isinstance(node, int):
        if abs(node) > EXACT_INTEGER_LIMIT:
            raise ReceiptError(
                f"{where} is larger than 2**53; the console cannot round-trip it")
        return node
    if isinstance(node, Mapping):
        return {str(key): _normalise(value, f"{where}.{key}")
                for key, value in node.items()}
    if isinstance(node, (list, tuple)):
        return [_normalise(value, f"{where}[{i}]") for i, value in enumerate(node)]
    return node


def canonical_bytes(payload: Mapping[str, Any]) -> bytes:
    """
    One byte string for one payload, for ever, in either language.

    Sorted keys, no NaN, two-space indent, no ASCII escaping and a trailing
    newline, over a payload whose numbers have been normalised by `_normalise`
    so that Python's int/float distinction cannot change the bytes. A receipt
    whose bytes depend on dictionary insertion order, or on which language
    assembled it, cannot be re-derived — and a hash nobody can re-derive is not
    a commitment.

    `apps/web/src/lib/validation/receipt.ts` reproduces this exactly, pinned by
    a generated fixture of the engine's own output.
    """
    return (json.dumps(_normalise(payload), sort_keys=True, indent=2,
                       allow_nan=False, ensure_ascii=False) + "\n").encode("utf-8")


@dataclass(frozen=True)
class Receipt:
    payload: dict
    digest: str
    path: Path | None = None

    @property
    def round_id(self) -> str:
        return str(self.payload["round_id"])

    def as_dict(self) -> dict:
        return {"round_id": self.round_id, "sha256": self.digest,
                "path": str(self.path) if self.path else None,
                "created_utc": self.payload["created_utc"],
                "n_candidates": len(self.payload["candidates"]),
                "n_selected": len(self.payload["validation_set"]["slots"]),
                "timestamp_trust": self.payload["timestamp_trust"]}


_FORBIDDEN = (
    "result", "results", "outcome", "outcomes", "validated", "failed",
    "label", "labels", "truth", "ground_truth", "observed", "answer", "answers",
)


def _assert_no_outcomes(node: Any, where: str = "payload") -> None:
    """
    Refuse a payload that carries an outcome, at any depth.

    Belt and braces over "the API has no argument for it": a caller can put an
    outcome inside the free-form `context` or `evidence` mapping, and a receipt
    that already knows the answer is not a commitment to anything. Checked on
    write and on verify.
    """
    if isinstance(node, Mapping):
        for key, value in node.items():
            lowered = str(key).strip().lower()
            if lowered in _FORBIDDEN:
                raise ReceiptError(
                    f"{where}.{key} looks like an outcome. A prediction receipt is "
                    f"written before the answer exists and cannot carry one.")
            _assert_no_outcomes(value, f"{where}.{key}")
    elif isinstance(node, (list, tuple)):
        for i, value in enumerate(node):
            _assert_no_outcomes(value, f"{where}[{i}]")


def build(round_id: str, *,
          candidates: Sequence[Mapping[str, Any]],
          validation_set: Mapping[str, Any],
          rankings: Mapping[str, Any],
          model_manifest: Mapping[str, Any],
          calibration_manifest: Mapping[str, Any] | None,
          coverage: Mapping[str, Any],
          endpoint_key: str | None,
          laboratory_threshold: float | None,
          screen: Mapping[str, Any],
          root: Path | None = None,
          created: datetime | None = None) -> Receipt:
    """
    Assemble a receipt. No outcome argument exists, and none is accepted.

    `candidates` must be the whole universe the prediction ranked, not the
    selected slots. Freezing only the picks would let a later analysis choose
    which non-picks to count as negatives.
    """
    if not round_id or not isinstance(round_id, str):
        raise ReceiptError("a receipt needs a round id")
    if not candidates:
        raise ReceiptError("a receipt needs the candidate universe it ranked")
    genes = [str(c.get("gene") or "") for c in candidates]
    if any(not g for g in genes):
        raise ReceiptError("every candidate in the universe needs a gene symbol")
    if len(set(genes)) != len(genes):
        raise ReceiptError("the candidate universe contains the same gene twice")

    moment = (created or datetime.now(timezone.utc)).astimezone(timezone.utc)
    payload = {
        "schema": RECEIPT_SCHEMA,
        "round_id": round_id,
        "created_utc": moment.isoformat(),
        "screen": dict(screen),
        "candidates": [
            {"gene": str(c["gene"]),
             "rank": int(c["rank"]) if c.get("rank") is not None else None,
             "score": (None if c.get("score") is None else float(c["score"])),
             "probability": (None if c.get("probability") is None
                             else float(c["probability"])),
             "question": c.get("question"),
             "evidence": dict(c.get("evidence") or {})}
            for c in candidates
        ],
        "validation_set": dict(validation_set),
        "rankings": dict(rankings),
        "model": dict(model_manifest),
        "calibration": dict(calibration_manifest) if calibration_manifest else None,
        "coverage": dict(coverage),
        "endpoint": endpoint_key,
        "laboratory_threshold": laboratory_threshold,
        "provenance": provenance(root),
        "timestamp_trust": "local content commitment; an independent custodian "
                           "must retain the hash for this to evidence timing",
    }
    _assert_no_outcomes(payload)
    return Receipt(payload, hashlib.sha256(canonical_bytes(payload)).hexdigest())


def write(receipt: Receipt, path: str | Path) -> Receipt:
    """
    Write the receipt, refusing to overwrite.

    `x` mode, not `w`. An overwritable receipt is a note, and the whole value of
    this file is that the earlier version cannot be replaced once its hash has
    left the building.
    """
    target = Path(path)
    body = canonical_bytes(receipt.payload)
    digest = hashlib.sha256(body).hexdigest()
    if digest != receipt.digest:
        raise ReceiptError("the receipt's payload changed after it was built")
    try:
        with open(target, "xb") as stream:
            stream.write(body)
    except FileExistsError as exc:
        raise ReceiptError(
            f"{target} already exists. A receipt is never overwritten; write the "
            f"next one under a new round id.") from exc
    return Receipt(receipt.payload, digest, target)


def read(path: str | Path) -> Receipt:
    source = Path(path)
    body = source.read_bytes()
    payload = json.loads(body.decode("utf-8"))
    if payload.get("schema") != RECEIPT_SCHEMA:
        raise ReceiptError(f"{source} is not a {RECEIPT_SCHEMA} receipt")
    return Receipt(payload, hashlib.sha256(body).hexdigest(), source)


def verify(path: str | Path, expected_sha256: str | None = None) -> dict:
    """
    Check a receipt against its own bytes and, if given, against a hash held
    elsewhere.

    Two separate checks, reported separately. Re-serialising the parsed payload
    and comparing catches a file that was edited in a way that happens to stay
    valid JSON; comparing the file's own digest against a custodian's copy
    catches the file being swapped wholesale.
    """
    source = Path(path)
    body = source.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    report: dict = {"path": str(source), "sha256": digest,
                    "bytes_canonical": None, "matches_expected": None,
                    "carries_no_outcome": None, "ok": False, "problems": []}
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        report["problems"].append(f"not readable as JSON: {exc}")
        return report
    report["bytes_canonical"] = canonical_bytes(payload) == body
    if not report["bytes_canonical"]:
        report["problems"].append(
            "the file's bytes are not the canonical serialisation of its own "
            "content, so it was edited after it was written")
    try:
        _assert_no_outcomes(payload)
        report["carries_no_outcome"] = True
    except ReceiptError as exc:
        report["carries_no_outcome"] = False
        report["problems"].append(str(exc))
    if expected_sha256 is not None:
        report["matches_expected"] = digest == expected_sha256.strip().lower()
        if not report["matches_expected"]:
            report["problems"].append(
                f"digest {digest} does not match the retained {expected_sha256}")
    report["ok"] = not report["problems"]
    return report

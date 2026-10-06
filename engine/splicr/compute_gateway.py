"""Small authenticated dispatch contract; heavy work stays in queued Functions."""
from __future__ import annotations

from typing import Callable


def validate_dispatch(payload: dict) -> tuple[str, int]:
    if not isinstance(payload, dict) or set(payload) - {"kind", "count"}:
        raise ValueError("Use only kind and count.")
    kind, count = payload.get("kind"), payload.get("count", 1)
    if kind not in {"public", "private", "health"}:
        raise ValueError("Unknown dispatch kind.")
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 64:
        raise ValueError("Count must be an integer from 1 to 64.")
    if kind != "private" and count != 1:
        raise ValueError("Public and health requests require count 1.")
    return kind, count


def dispatch(payload: dict, *, public: Callable, private: Callable) -> dict:
    kind, count = validate_dispatch(payload)
    if kind == "health":
        raise ValueError("Health does not enqueue work.")
    calls = [public()] if kind == "public" else [private() for _ in range(count)]
    return {"accepted": True, "kind": kind, "call_ids": [call.object_id for call in calls]}

"""Validate reviewed numeric designs before invoking any external caller."""
import math
import numpy as np


def validate_mle(design: dict, samples: list[str]) -> None:
    import re
    columns, rows = design.get("columns", []), design.get("rows", [])
    if not 2 <= len(columns) <= 20 or len(set(columns)) != len(columns) or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,39}", name) for name in columns):
        raise ValueError("MLE coefficients need unique safe names")
    if design.get("coefficient") not in columns[1:]:
        raise ValueError("Choose an MLE coefficient other than baseline")
    if len(rows) != len(samples) or len({row.get("sample") for row in rows}) != len(samples) or {row.get("sample") for row in rows} != set(samples):
        raise ValueError("MLE rows must match every selected sample exactly once")
    values = [row.get("values", []) for row in rows]
    if any(len(row) != len(columns) or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in row) or row[0] != 1 for row in values):
        raise ValueError("MLE values must be finite and the baseline must be 1")
    if len(samples) <= len(columns):
        raise ValueError("MLE needs more samples than coefficients")
    if np.linalg.matrix_rank(np.asarray(values, dtype=float)) != len(columns):
        raise ValueError("MLE factors are confounded or constant")
    rounds = design.get("permutation_round", 10)
    if not isinstance(rounds, int) or not 10 <= rounds <= 1000:
        raise ValueError("MLE permutation rounds must be 10 to 1000")
    seed = design.get("random_seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2**32 - 1:
        raise ValueError("MLE random seed must be an unsigned 32-bit integer")

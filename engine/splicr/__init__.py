"""
SplicR analysis engine.

Nine stages turn reads into scored hits: ingest, detect, count, QC, call hits,
flag artifacts, Atlas context, score, report. Each stage reads the previous
stage's artifact and writes its own, so nothing is recomputed unless its
inputs changed.
"""

__version__ = "0.1.0"

from .config import SETTINGS, REFERENCE_DIR, ROOT  # noqa: F401

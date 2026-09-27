"""Importable alias for ``orcs-retrieval.py``.

The deliverable filename contains a hyphen, so ``import`` cannot name it.  This
shim loads that file and re-exports it, so both spellings work and there is only
one implementation::

    from splicr.features.orcs_retrieval import orcs_retrieval_features, FEATURE_NAMES
"""

from __future__ import annotations

import importlib.util
import os
import sys

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orcs-retrieval.py")
_NAME = "splicr.features._orcs_retrieval_impl"

_mod = sys.modules.get(_NAME)
if _mod is None:
    _spec = importlib.util.spec_from_file_location(_NAME, _PATH)
    if _spec is None or _spec.loader is None:  # pragma: no cover
        raise ImportError(f"cannot load {_PATH}")
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules[_NAME] = _mod
    _spec.loader.exec_module(_mod)

FEATURE_NAMES = _mod.FEATURE_NAMES
PRIMARY = _mod.PRIMARY
LabelAccessError = _mod.LabelAccessError
ORCSCorpus = _mod.ORCSCorpus
load_corpus = _mod.load_corpus
query_direction = _mod.query_direction
orcs_retrieval_features = _mod.orcs_retrieval_features
rank_genes = _mod.rank_genes
build_index_cache = _mod.build_index_cache
build_profile_cache = _mod.build_profile_cache
main = _mod.main

__all__ = [
    "FEATURE_NAMES", "PRIMARY", "LabelAccessError", "ORCSCorpus", "load_corpus",
    "query_direction", "orcs_retrieval_features", "rank_genes",
    "build_index_cache", "build_profile_cache", "main",
]

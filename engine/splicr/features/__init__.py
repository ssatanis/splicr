"""Label-free per-(screen, gene) feature families for AssayBench ranking.

Every module here obeys the same contract:

* it is fit on the AssayBench ``train`` split only (``yearfold0 == "train"``) and
  refuses to be fit on anything else,
* ``transform`` conditions only on a screen's *metadata* and its *library*
  (``relevance_genes``), never on its labels,
* it is deterministic: same inputs, same floats, no RNG, no dict-order dependence,
* it exposes ``FEATURE_NAMES`` and returns ``{dataset_name: {gene: {feature: value}}}``.

No module here may load the ``yearfold0 == "test"`` split.

See :mod:`splicr.features.priors` for the stratified hit-frequency prior family,
and :mod:`splicr.features.depmap` for the DepMap cell-line-matched family.
"""

from __future__ import annotations

__all__ = ["depmap", "priors"]

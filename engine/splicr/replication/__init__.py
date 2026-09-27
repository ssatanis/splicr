"""The independent replication benchmark.

Given only screen A's own measurements, rank A's genes by the probability that
the gene is also called a hit in an independent screen B of the same phenotype
in the same cell line, published by a different lab with a different library.
B's hit calls are the label and are never visible to a predictor.

See ``docs/07-replication-benchmark.md`` for the construction and the objections.
"""

from .dataset import (  # noqa: F401
    ReplicationPair,
    SPLITS,
    allowed_background_screens,
    build,
    describe,
    forbidden_external,
    load,
    load_pair_inputs,
    load_pair_labels,
    pairs,
)

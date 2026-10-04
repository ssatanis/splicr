"""
The SplicR Validation Network.

A screen produces candidates. A bench produces outcomes. This package is the
machinery that connects the two in the only order that lets a number mean
anything: the prediction is frozen first, the outcome arrives second, and the
cohort that licenses a printed probability is counted, not assumed.

    endpoints    what "validated" means, per assay class, written down first
    outcomes     the record a lab contributes, including the failures
    features     the evidence vector, by family, missing values kept missing
    splits       grouped and temporal splits, with leakage refused
    baselines    FDR, effect+FDR, MAGeCK, BAGEL2 and the investigator
    models       hierarchical logistic and gradient-boosted trees
    calibration  Platt, isotonic and beta, chosen on held-out labs
    coverage     the out-of-domain gate that refuses to print a number
    evaluation   precision@k, lift, hits per budget, Brier, reliability
    cohort       the rank-stratified validation set that defeats cherry-picking
    receipts     content-hashed prediction commitments
    rounds       blinded round lifecycle: freeze, reveal, score
    network      the four heads, and the one call a caller makes
    report       the payload the console reads

Nothing here invents an outcome, and no module in it can produce a probability
without a cohort behind it. `coverage` is the single chokepoint for that, and
`network.estimate` is the only public way to obtain a probability.
"""

from .endpoints import (  # noqa: F401
    ASSAY_CLASSES, DECISIONS, QUESTIONS, QUESTION_LABEL, QUESTION_SENTENCE,
    RESULTS, TYPE_QUESTION, VALIDATION_TYPES, VALIDATION_TYPE_LABEL,
    Decision, Endpoint, EndpointError, default_endpoint, endpoint,
    endpoints_for, registry_hash, registry_manifest, REGISTRY,
)

SCHEMA_VERSION = "splicr.validation-network.v1"

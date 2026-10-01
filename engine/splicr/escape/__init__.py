"""
SplicR Escape: why a perturbation may have produced less than it should have.

The question is not "did the gene deplete" - the hit caller answers that - but
"this target's phenotype is weaker than the evidence says it should be; what could
account for that?" Several mechanism families can:

    paralog compensation      a duplicate covers the lost function
    pathway bypass            an alternative branch carries the signal
    feedback activation       inhibiting downstream releases upstream
    state adaptation          the population shifts transcriptional state
    variant-mediated          the target changes and stops being perturbable

Only the first is implemented. The others are named here because an engine that
silently reported paralog compensation as "the" escape mechanism would be claiming
to have ruled out four families it never looked at, and the console says which one
was evaluated.

Every output of this package is a ranked HYPOTHESIS with its evidence itemised, not
a finding. "Paralog compensation is the leading hypothesis for this target in this
model, on these five channels, with no direct perturbation evidence" is a statement
this data can support. "Gene Y buffered Gene X" needs a paired perturbation that
was actually run, and until one has been, the package says so.
"""

from . import analysis, context, evidence, paralogs, trigger

__all__ = ["analysis", "context", "evidence", "paralogs", "trigger"]

"""
Biophysical validation of a CRISPR screen's guides.

A pooled screen measures survival, not protein loss. These modules estimate what
each guide actually did to the gene it targets, so a gene's screen signal can be
read against the quality of the reagents that produced it.

    genome    place a guide on hg38 and cut the 60 bp window a repair model needs
    repair    Lindel repair-outcome prediction: frameshift vs in-frame spectrum
    protein   what an in-frame deletion removes from the protein
    score     per-guide knockout probability and the gene-level TrueKnockout score
    benchmark whether any of it improves a real screen, measured

Every number here is a prediction. `benchmark` is what decides if it is useful.
"""

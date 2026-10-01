"""
Proposing the dual-knockout experiment that would settle a compensation hypothesis.

WHAT THIS IS FOR

escape/analysis.py can say "paralog compensation by ARID1B is a strong hypothesis
for ARID1A in this model, on five channels, with no direct evidence". The
experiment that settles it is a paired perturbation of both genes. This module
proposes one: two spacers per gene, laid out as a Cas12a crRNA array, with every
constraint it checked and every warning it found.

It proposes. It does not order anything, it does not claim the hypothesis is true,
and it refuses to emit a construct it cannot justify.

FOUR THINGS IT DELIBERATELY WILL NOT DO

1. It will not score Cas12a guides with Rule Set 3. RS3 is a SpCas9 on-target
   model trained on SpCas9 data; Cas12a has a different PAM, a different cut
   geometry, a staggered rather than blunt cut, and its own published activity
   models (DeepCpf1 and successors). Handing a Cas12a spacer to a Cas9 model
   returns a number, which is exactly the problem. No Cas12a activity model is
   installed in this deployment, so `predicted_activity` is None and the reason is
   stated on every design. Selection is on sequence constraints and measured
   genomic specificity only, and the report says so.

2. It will not invent a crRNA scaffold. The direct repeat depends on the Cas12a
   ortholog and on the vector, a construct is what a laboratory orders, and a
   sequence recalled rather than read from a source is not something to put in
   front of a bench. The array layout - which spacers, in which order, with a
   repeat between each - is emitted always. The full construct is emitted only when
   the caller supplies the repeat their vector uses.

3. It will not design without being asked. The nuclease is a required argument with
   no default, because "generate a dual-guide library" is a decision about an
   experiment and the engine is not entitled to make it.

4. It will not treat a design as evidence. The output says, in the object and in
   the text, that it is a proposed validation design for a hypothesis that has not
   been tested.

WHAT IT CHECKS

    in the coding sequence     a spacer outside the CDS is not a knockout
    not in the last exon       a frameshift there often escapes nonsense-mediated
                               decay, so the protein may survive
    PAM                        the nuclease's own PAM, at the nuclease's spacing
    composition                GC range, no long homopolymer, and no TTTT, which
                               terminates a U6 transcript and is a known failure
                               mode of pol III-expressed arrays
    genomic uniqueness         perfect and one-mismatch occurrences counted in the
                               genome with bowtie, not predicted
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from .config import tool_env
from .validate import genome, protein

#: Spacers proposed per gene. Two is the smallest number that distinguishes a
#: reagent failure from a real phenotype, and the smallest an array can carry per
#: gene while staying inside a four-spacer construct for a pair.
SPACERS_PER_GENE = 2

#: Composition limits. GC outside this range and long homopolymers are associated
#: with poor synthesis and poor activity across nucleases; the run of four Ts is a
#: pol III terminator and is a hard exclusion rather than a preference.
GC_RANGE = (0.25, 0.75)
MAX_HOMOPOLYMER = 4
POLY_T = "TTTT"


@dataclass(frozen=True)
class Nuclease:
    """One nuclease, and what is and is not known about designing for it here."""

    name: str
    family: str
    #: PAM as a IUPAC string, and which side of the protospacer it sits on.
    pam: str
    pam_side: str
    spacer_length: int
    #: Named model that predicts on-target activity for this nuclease, when one is
    #: installed. Empty means no activity prediction is available and none is
    #: substituted from another nuclease's model.
    activity_model: str = ""
    #: The crRNA direct repeat, when the caller supplies one for their vector.
    #: Never defaulted: see the module docstring.
    direct_repeat: str = ""
    notes: str = ""

    @property
    def can_predict_activity(self) -> bool:
        return bool(self.activity_model)


#: The registry. Every entry states what is known; nothing is filled in by analogy
#: with another nuclease.
NUCLEASES: dict[str, Nuclease] = {
    "AsCas12a": Nuclease(
        name="AsCas12a", family="Cas12a", pam="TTTV", pam_side="5'",
        spacer_length=23,
        notes="Acidaminococcus Cas12a. The 23 nt spacer is the length Cas12a crRNA "
              "arrays are commonly built at; libraries differ and the length is a "
              "parameter. No on-target activity model for this nuclease is installed "
              "here, so no activity is predicted.",
    ),
    "LbCas12a": Nuclease(
        name="LbCas12a", family="Cas12a", pam="TTTV", pam_side="5'",
        spacer_length=23,
        notes="Lachnospiraceae Cas12a. Same PAM requirement as AsCas12a; the crRNA "
              "direct repeat differs and is supplied by the caller. No on-target "
              "activity model is installed here.",
    ),
}

#: Engineered variants exist with broader PAM requirements - enAsCas12a among them -
#: and they are not in the registry because enumerating a PAM set from memory is how
#: a design goes wrong silently. Add one with its published PAM definition beside it.
UNREGISTERED_NOTE = (
    "Engineered Cas12a variants with expanded PAM requirements are not in this "
    "registry. Add one with its published PAM definition rather than assuming it "
    "accepts the wild-type PAM."
)

_IUPAC = {
    "A": "A", "C": "C", "G": "G", "T": "T",
    "R": "AG", "Y": "CT", "S": "GC", "W": "AT", "K": "GT", "M": "AC",
    "B": "CGT", "D": "AGT", "H": "ACT", "V": "ACG", "N": "ACGT",
}


def pam_pattern(pam: str) -> re.Pattern:
    """A regex for a IUPAC PAM string."""
    return re.compile("".join(f"[{_IUPAC[base]}]" for base in pam.upper()))


@dataclass(frozen=True)
class Spacer:
    """One candidate spacer, with every check that was run on it."""

    gene: str
    sequence: str
    chrom: str
    #: 0-based genomic start of the protospacer, on `strand`.
    start: int
    strand: str
    pam: str
    gc: float
    #: Protein residue the cut falls in, when it resolved, and its curated features.
    protein_residue: int | None = None
    cds_fraction: float | None = None
    in_last_exon: bool | None = None
    features_hit: tuple[str, ...] = ()
    #: Measured, not predicted: occurrences of this exact sequence in the genome.
    perfect_matches: int | None = None
    one_mismatch_matches: int | None = None
    #: Always None until a Cas12a activity model is installed. Never borrowed from
    #: a Cas9 model.
    predicted_activity: float | None = None
    activity_model: str = ""
    warnings: tuple[str, ...] = ()

    @property
    def specific(self) -> bool:
        """Unique at zero mismatches, and measured rather than assumed."""
        return self.perfect_matches == 1


@dataclass(frozen=True)
class ArrayDesign:
    """A proposed crRNA array for one gene pair. A proposal, not a result."""

    nuclease: str
    genes: tuple[str, str]
    spacers: tuple[Spacer, ...]
    #: The layout, always. Repeats are named rather than spelled unless the caller
    #: supplied the sequence their vector uses.
    layout: tuple[str, ...] = ()
    #: The full DNA construct, only when a direct repeat was supplied.
    construct: str = ""
    direct_repeat: str = ""
    warnings: tuple[str, ...] = ()
    #: Why this design was proposed, carried through from the hypothesis.
    rationale: str = ""
    provenance: dict[str, str] = field(default_factory=dict)

    @property
    def complete(self) -> bool:
        """Two spacers for each gene, each unique in the genome."""
        per_gene = {gene: [s for s in self.spacers if s.gene == gene] for gene in self.genes}
        return all(len(found) >= SPACERS_PER_GENE and all(s.specific for s in found)
                   for found in per_gene.values())

    def statement(self) -> str:
        counts = ", ".join(f"{gene}: {sum(1 for s in self.spacers if s.gene == gene)}"
                           for gene in self.genes)
        head = (f"Proposed {self.nuclease} crRNA array for a paired knockout of "
                f"{' and '.join(self.genes)} ({counts} spacers).")
        why = f" {self.rationale}" if self.rationale else ""
        state = (" Every spacer is unique in the genome at zero mismatches."
                 if self.complete else
                 " This design is incomplete: see the warnings.")
        construct = (" The construct is written out below."
                     if self.construct else
                     " The array layout is given; supply your vector's crRNA direct "
                     "repeat to have the construct written out.")
        return (head + why + state + construct
                + " This is a proposed experiment for an untested hypothesis, not "
                  "evidence that the hypothesis is true.")


# ---------------------------------------------------------------------------
# Finding spacers
# ---------------------------------------------------------------------------

def _composition_warnings(sequence: str) -> list[str]:
    out = []
    gc = (sequence.count("G") + sequence.count("C")) / len(sequence)
    if not GC_RANGE[0] <= gc <= GC_RANGE[1]:
        out.append(f"GC {gc:.0%} is outside {GC_RANGE[0]:.0%}-{GC_RANGE[1]:.0%}")
    for base in "ACGT":
        if base * (MAX_HOMOPOLYMER + 1) in sequence:
            out.append(f"a run of more than {MAX_HOMOPOLYMER} {base}s")
            break
    if POLY_T in sequence:
        out.append(f"contains {POLY_T}, which terminates a pol III transcript")
    return out


def candidate_spacers(gene: str, nuclease: Nuclease, genome_source: genome.Genome,
                      max_candidates: int = 400) -> tuple[list[Spacer], list[str]]:
    """
    Every PAM-adjacent spacer inside the gene's MANE Select coding sequence.

    Walks the CDS intervals from the same cache `protein.locate` uses, so a spacer's
    residue is numbered by the same transcript the guide-disagreement report uses.
    Returns the candidates and any reason the search could not be done.
    """
    intervals = protein.cds_intervals(gene)
    if not intervals:
        return [], [f"no MANE Select CDS is cached for {gene}; build it with "
                    f"splicr.validate.protein.build_cds_cache()"]
    pattern = pam_pattern(nuclease.pam)
    length = nuclease.spacer_length
    out: list[Spacer] = []
    for chrom, start, end, _strand in intervals:
        # A margin so a spacer straddling an exon boundary is still found, and its
        # cut is still placed by protein.locate rather than assumed in-frame.
        window_start = max(0, start - length - len(nuclease.pam) - 1)
        window = genome_source.fetch(chrom, window_start, end + length + len(nuclease.pam) + 1)
        for offset in range(len(window) - len(nuclease.pam) - length):
            for strand, sequence in (("+", window), ("-", genome.revcomp(window))):
                pam_seq = sequence[offset:offset + len(nuclease.pam)]
                if not pattern.fullmatch(pam_seq):
                    continue
                spacer = sequence[offset + len(nuclease.pam):
                                  offset + len(nuclease.pam) + length]
                if len(spacer) < length or "N" in spacer or "N" in pam_seq:
                    continue
                if strand == "+":
                    spacer_start = window_start + offset + len(nuclease.pam)
                else:
                    spacer_start = (window_start + len(window)
                                    - (offset + len(nuclease.pam) + length))
                if not start <= spacer_start < end:
                    continue
                gc = (spacer.count("G") + spacer.count("C")) / length
                out.append(Spacer(
                    gene=gene, sequence=spacer, chrom=chrom, start=spacer_start,
                    strand=strand, pam=pam_seq, gc=round(gc, 4),
                    activity_model=nuclease.activity_model,
                    warnings=tuple(_composition_warnings(spacer)),
                ))
                if len(out) >= max_candidates:
                    return out, []
    return out, []


def _bowtie_counts(sequences: list[str], index: Path, mismatches: int = 1
                   ) -> dict[str, tuple[int, int]] | None:
    """
    Perfect and one-mismatch genomic occurrences, counted with bowtie.

    Measured, not predicted. Returns None when the index or the binary is absent,
    so the caller reports specificity as unknown rather than as "unique".
    """
    if not Path(f"{index}.1.ebwt").exists():
        return None
    with tempfile.TemporaryDirectory() as work:
        reads = Path(work) / "spacers.fa"
        reads.write_text("".join(f">{i}\n{seq}\n" for i, seq in enumerate(sequences)))
        command = ["bowtie", "-f", "-a", "-v", str(mismatches), "--quiet",
                   "--suppress", "2,3,4,5,6,7", str(index), str(reads)]
        try:
            proc = subprocess.run(command, capture_output=True, text=True,
                                  env=tool_env(), timeout=1800)
        except (OSError, subprocess.TimeoutExpired):
            return None
        if proc.returncode != 0:
            return None
    perfect: dict[int, int] = {}
    near: dict[int, int] = {}
    for line in proc.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        try:
            index_id = int(parts[0])
        except ValueError:
            continue
        # With --suppress the remaining column is the mismatch descriptor; empty
        # means a perfect match.
        descriptor = parts[1].strip() if len(parts) > 1 else ""
        if descriptor:
            near[index_id] = near.get(index_id, 0) + 1
        else:
            perfect[index_id] = perfect.get(index_id, 0) + 1
    return {sequence: (perfect.get(i, 0), near.get(i, 0))
            for i, sequence in enumerate(sequences)}


def _annotate(spacer: Spacer, nuclease: Nuclease) -> Spacer:
    """Place the spacer's cut on the protein, where the reference can."""
    # Cas12a cuts inside the protospacer, staggered, 18-23 nt from the PAM. The
    # residue is reported for the middle of the protospacer and the report says the
    # cut is staggered, rather than implying a blunt Cas9-style position.
    middle = spacer.start + nuclease.spacer_length // 2
    try:
        located = protein.locate(spacer.gene, spacer.chrom, middle)
    except Exception:  # noqa: BLE001 - annotation never fails a design
        return spacer
    if located is None:
        return spacer
    features = protein.domains_at(spacer.gene, located.residue)
    warnings = list(spacer.warnings)
    if located.in_last_exon:
        warnings.append("in the last exon, where a frameshift often escapes "
                        "nonsense-mediated decay")
    return Spacer(
        **{**spacer.__dict__,
           "protein_residue": located.residue,
           "cds_fraction": round(located.fraction, 6) if located.n_residues else None,
           "in_last_exon": located.in_last_exon,
           "features_hit": tuple(features),
           "warnings": tuple(warnings)},
    )


def _select(candidates: list[Spacer], count: int, spacer_length: int) -> list[Spacer]:
    """
    Pick spacers on the constraints that were actually checked.

    No activity model is available for Cas12a here, so there is nothing to rank on
    that predicts cutting. What is used instead is measured or structural: genomic
    uniqueness first, then no composition warning, then earlier in the coding
    sequence (a frameshift nearer the 5' end removes more protein), then spread
    apart so two spacers do not sit in the same 100 bp.
    """
    ranked = sorted(
        candidates,
        key=lambda s: (
            0 if s.perfect_matches == 1 else 1 if s.perfect_matches is None else 2,
            s.one_mismatch_matches if s.one_mismatch_matches is not None else 99,
            len(s.warnings),
            s.cds_fraction if s.cds_fraction is not None else 1.0,
            s.start,
        ),
    )
    chosen: list[Spacer] = []
    for spacer in ranked:
        if len(chosen) >= count:
            break
        if any(abs(spacer.start - other.start) < 100 for other in chosen):
            continue
        chosen.append(spacer)
    return chosen


def design_pair(gene_a: str, gene_b: str, *, nuclease: str,
                direct_repeat: str = "", rationale: str = "",
                genome_path: Path | None = None,
                bowtie_index: Path | None = None,
                spacers_per_gene: int = SPACERS_PER_GENE) -> ArrayDesign:
    """
    Propose a Cas12a array that knocks out both genes.

    `nuclease` is required and must name an entry in NUCLEASES. `direct_repeat` is
    the crRNA repeat the caller's vector uses; without it the layout is returned and
    the construct is not. Nothing here claims the hypothesis behind the design.
    """
    if nuclease not in NUCLEASES:
        raise ValueError(
            f"{nuclease!r} is not in the nuclease registry. Known: "
            f"{', '.join(sorted(NUCLEASES))}. {UNREGISTERED_NOTE}")
    spec = NUCLEASES[nuclease]
    warnings: list[str] = []
    if not spec.can_predict_activity:
        warnings.append(
            f"no on-target activity model for {spec.name} is installed, so no spacer "
            f"here carries a predicted activity. Selection used sequence constraints "
            f"and measured genomic specificity only. A Cas9 model was deliberately "
            f"not substituted.")

    try:
        source = genome.Genome(genome_path) if genome_path else genome.Genome()
    except FileNotFoundError as error:
        return ArrayDesign(
            nuclease=spec.name, genes=(gene_a, gene_b), spacers=(),
            warnings=(f"no design was produced: {error}",), rationale=rationale)

    index = bowtie_index or (genome.GENOME_DIR / "hg38")
    chosen: list[Spacer] = []
    for gene in (gene_a, gene_b):
        candidates, problems = candidate_spacers(gene, spec, source)
        warnings.extend(problems)
        if not candidates:
            warnings.append(f"no PAM-adjacent spacer was found in {gene}'s coding sequence")
            continue
        counts = _bowtie_counts([c.sequence for c in candidates], index)
        if counts is None:
            warnings.append(
                "genomic specificity was not measured: the bowtie index for the "
                "reference genome was not found, so no spacer's uniqueness is known")
            annotated = [_annotate(c, spec) for c in candidates]
        else:
            annotated = []
            for candidate in candidates:
                perfect, near = counts.get(candidate.sequence, (0, 0))
                annotated.append(_annotate(
                    Spacer(**{**candidate.__dict__,
                              "perfect_matches": perfect,
                              "one_mismatch_matches": near}), spec))
        picked = _select(annotated, spacers_per_gene, spec.spacer_length)
        if len(picked) < spacers_per_gene:
            warnings.append(
                f"only {len(picked)} spacer(s) for {gene} passed the constraints; "
                f"{spacers_per_gene} were requested")
        chosen.extend(picked)

    layout: list[str] = []
    for spacer in chosen:
        layout.append("crRNA direct repeat")
        layout.append(f"spacer {spacer.gene} {spacer.sequence}")
    construct = ""
    repeat = (direct_repeat or spec.direct_repeat or "").strip().upper()
    if repeat:
        if not re.fullmatch(r"[ACGT]+", repeat):
            warnings.append("the supplied direct repeat is not unambiguous DNA; no "
                            "construct was written")
        else:
            construct = "".join(repeat + spacer.sequence for spacer in chosen)
    return ArrayDesign(
        nuclease=spec.name, genes=(gene_a, gene_b), spacers=tuple(chosen),
        layout=tuple(layout), construct=construct, direct_repeat=repeat,
        warnings=tuple(warnings), rationale=rationale,
        provenance={
            "nuclease": f"{spec.name} ({spec.family}), PAM {spec.pam} {spec.pam_side} of "
                        f"a {spec.spacer_length} nt spacer",
            "nuclease_notes": spec.notes,
            "activity_model": spec.activity_model or "none installed",
            "genome": str(source.path.name),
            "specificity": "bowtie, perfect and one-mismatch genomic occurrences",
            "transcript_set": "Ensembl 116 MANE Select CDS",
            "array_orientation": "5' to 3', one crRNA direct repeat before each spacer",
        },
    )

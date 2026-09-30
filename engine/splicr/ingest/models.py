"""
Contracts between the stages of the autonomous ingest.

    discover  ->  StudyCandidate          (GEO / SRA / ENA search, classification)
    plan      ->  StudyPlan               (run metadata, sample roles, contrasts, entities)
    fetch     ->  FastqFile + FastqcReport per run
    analyze   ->  engine.pipeline result  (count, QC, MAGeCK RRA, BAGEL2)
    publish   ->  lake Parquet + Postgres rows, every entity hard-mapped

Every stage reads and writes these dataclasses only, so a stage can run
locally, on Modal, or under Airflow without the others changing. All of them
round-trip through JSON (`to_json` / `from_json`) because that is how they are
stored in `ingest.studies.plan` and passed between Modal functions.
"""

from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass, field
from typing import Any, Literal

Verdict = Literal["screen", "maybe", "not_screen"]
Role = Literal["plasmid", "reference", "control", "treatment", "exclude"]
PlanStatus = Literal["ready", "needs_review", "unsupported"]

# Lifecycle of a study in ingest.studies.status. Transitions only move forward,
# except that any state may go to `failed` or `needs_review`, and `failed` may be
# retried back to the stage that failed.
STATUSES = (
    "discovered",    # found by a search; classified
    "rejected",      # classified not_screen, or unsupported organism/assay
    "planned",       # run metadata fetched, roles and contrasts inferred
    "needs_review",  # the plan is not confident enough to analyze unattended
    "fetching",      # FASTQ download + md5 check + FastQC
    "analyzing",     # counting, QC, hit calling
    "published",     # results in the lake and Postgres
    "failed",        # a stage raised; `error` says which and why
)


class _Json:
    def to_json(self) -> str:
        return json.dumps(dataclasses.asdict(self), default=str, sort_keys=True)

    @classmethod
    def from_dict(cls, d: dict[str, Any]):
        kwargs = {}
        for f in dataclasses.fields(cls):
            if f.name not in d:
                continue
            v = d[f.name]
            t = f.type if isinstance(f.type, str) else getattr(f.type, "__name__", "")
            if isinstance(v, list) and "list[RunRecord]" in t:
                v = [RunRecord.from_dict(x) for x in v]
            elif isinstance(v, list) and "list[SampleRole]" in t:
                v = [SampleRole.from_dict(x) for x in v]
            elif isinstance(v, list) and "list[Contrast]" in t:
                v = [Contrast.from_dict(x) for x in v]
            kwargs[f.name] = v
        return cls(**kwargs)

    @classmethod
    def from_json(cls, s: str):
        return cls.from_dict(json.loads(s))


@dataclass
class StudyCandidate(_Json):
    """One deposited study, found by discovery and scored by the classifier."""

    accession: str                  # canonical id: GSE if the study is in GEO, else PRJNA/PRJEB/PRJDB
    source: str                     # "geo" | "sra" | "ena": which search found it first
    title: str
    summary: str = ""
    organism: str | None = None
    taxid: int | None = None
    xrefs: dict[str, str] = field(default_factory=dict)   # geo, bioproject, sra_study, ena_study
    pubmed_ids: list[str] = field(default_factory=list)
    first_public: str | None = None  # ISO date
    last_updated: str | None = None
    n_runs: int | None = None
    score: float = 0.0              # classifier score in [0, 1]
    verdict: Verdict = "maybe"
    reasons: list[str] = field(default_factory=list)      # human-readable evidence for the score
    # Classifier inputs that ingest.studies does not store. Filled at discovery
    # time only; a candidate reloaded from the table has them empty, and the
    # classifier then scores on title/summary/organism alone.
    sample_titles: list[str] = field(default_factory=list)       # GSM titles / SRA experiment titles
    library_strategies: list[str] = field(default_factory=list)  # SRA LIBRARY_STRATEGY values seen


@dataclass
class RunRecord(_Json):
    """One sequencing run, with everything needed to fetch and label it."""

    run: str                        # SRR / ERR / DRR
    experiment: str | None = None   # SRX / ERX
    sample: str | None = None       # SRS / ERS / SAMN
    geo_sample: str | None = None   # GSM, when the study is in GEO
    sample_title: str = ""
    characteristics: dict[str, str] = field(default_factory=dict)   # GEO/BioSample key: value
    library_strategy: str | None = None
    library_layout: str | None = None   # SINGLE | PAIRED
    instrument: str | None = None
    read_count: int | None = None
    base_count: int | None = None
    fastq_urls: list[str] = field(default_factory=list)   # https, from ENA filereport
    fastq_md5: list[str] = field(default_factory=list)
    fastq_bytes: list[int] = field(default_factory=list)


@dataclass
class SampleRole(_Json):
    """The inferred role of one run's sample in the screen design."""

    run: str
    label: str                      # stable, filesystem-safe sample label used by the pipeline
    role: Role
    condition: str | None = None    # group name, e.g. "DMSO_day21", "olaparib"
    timepoint: str | None = None
    replicate: str | None = None
    confidence: float = 0.0         # [0, 1]
    evidence: list[str] = field(default_factory=list)
    # Half-library ("A" / "B") when the study sequenced a split library (GeCKO v2
    # A/B, Calabrese/Dolcetto sets) as separate runs. Runs of different parts are
    # counted against different references and never share a contrast.
    library_part: str | None = None


@dataclass
class Contrast(_Json):
    """One comparison the pipeline runs: treatment labels vs control labels."""

    name: str
    treatment: list[str]
    control: list[str]
    kind: str = "dropout"           # dropout | positive_selection | drug_modifier | sorting


@dataclass
class StudyPlan(_Json):
    """Everything the analysis needs, inferred without a human, with its confidence."""

    accession: str
    taxid: int | None
    runs: list[RunRecord] = field(default_factory=list)
    roles: list[SampleRole] = field(default_factory=list)
    contrasts: list[Contrast] = field(default_factory=list)
    modality: str | None = None             # knockout | crispri | crispra | base_edit | knockout_cas12a
    phenotype: str | None = None            # e.g. "proliferation", "drug resistance", "FACS: CD47 low"
    cell_line_raw: str | None = None
    cell_line_rrid: str | None = None       # Cellosaurus accession, or None if unresolved
    compound_raw: str | None = None
    compound_chembl: str | None = None
    library_hint: str | None = None         # from metadata text; the reads decide the library
    confidence: float = 0.0
    status: PlanStatus = "needs_review"
    issues: list[str] = field(default_factory=list)   # why it is not ready, in plain words
    # Observations that do not block analysis but the analysis should honour:
    # paired-end read-1 assumption, split half-libraries, GEO count tables to
    # cross-check against.
    notes: list[str] = field(default_factory=list)
    supplementary_count_tables: list[str] = field(default_factory=list)   # https URLs from GEO
    # Slug of a library SplicR did not hold and learned from this study's own
    # supplementary files (splicr.ingest.library_extract). Set only after the
    # extracted library was verified against the study's reads, so its presence
    # means counting can proceed; the manifest beside it records the provenance.
    learned_library: str | None = None


@dataclass
class FastqcReport(_Json):
    """Parsed FastQC summary for one FASTQ file."""

    run: str
    file: str
    total_sequences: int | None = None
    sequence_length: str | None = None
    percent_gc: float | None = None
    modules: dict[str, str] = field(default_factory=dict)   # module name -> PASS | WARN | FAIL

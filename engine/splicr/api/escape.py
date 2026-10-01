"""HTTP adapters for paralog-escape analysis and Cas12a array design.

The routes here only validate, authorize and serialize. The scientific rules stay
in :mod:`splicr.escape` and :mod:`splicr.multiplex`, so CLI, pipeline and HTTP
callers cannot acquire different definitions of the same result.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from .. import multiplex as mx
from ..escape import analysis as an
from ..escape import evidence as ev
from ..escape import trigger as tg
from .security import Caller, require_hits_read


class WireModel(BaseModel):
    """The API is closed-world: misspelled fields and non-finite values fail."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class EscapeObservation(WireModel):
    gene: str = Field(min_length=1, max_length=100)
    symbol: str = Field(default="", max_length=100)
    lfc: float | None = None
    n_guides: int | None = Field(default=None, ge=0)
    fragile: bool = False
    spread_vs_screen: float | None = Field(default=None, ge=0)
    expression_log1p_tpm: float | None = Field(default=None, ge=0)
    expectation_source: str = Field(default="", max_length=300)
    expected_to_deplete: bool = False


class EscapeRequest(WireModel):
    screen_label: str = Field(default="", max_length=200)
    model_id: str = Field(default="", max_length=100)
    observations: list[EscapeObservation] = Field(min_length=1, max_length=50_000)
    qc_verdict: Literal["pass", "warn", "fail"]
    fitness_contrast: bool
    nnmd: float | None = None
    reference_essential_effects: tuple[float, ...] = Field(default_factory=tuple)
    essential_set: str = Field(default="", max_length=200)


class AssessmentResponse(WireModel):
    gene: str
    symbol: str
    verdict: str
    reason: str
    percentile_among_essentials: float | None
    n_reference_essentials: int | None
    weak_threshold_lfc: float | None
    observed_lfc: float | None
    quantile: float
    provenance: dict[str, str]
    statement: str


class EvidenceChannelResponse(WireModel):
    name: str
    availability: str
    supports: bool
    statement: str
    value: float | None
    interval: tuple[float, float] | None
    n_units: int | None
    unit: str
    source: str
    limitation: str


class HypothesisResponse(WireModel):
    target: str
    candidate: str
    target_symbol: str
    candidate_symbol: str
    model: str
    strength: str
    supporting: list[str]
    available: list[str]
    missing: list[str]
    direct_causal_evidence: bool
    channels: list[EvidenceChannelResponse]
    provenance: dict[str, str]
    statement: str


class EscapeTargetResponse(WireModel):
    assessment: AssessmentResponse
    hypotheses: list[HypothesisResponse]
    leading_candidate: str | None
    candidates_not_evaluated: int
    candidates_not_shown: int
    note: str
    statement: str


class EscapeResponse(WireModel):
    screen: str
    eligible: bool
    reason: str
    flagged: int
    assessments: list[AssessmentResponse]
    targets: list[EscapeTargetResponse]
    provenance: dict[str, str]
    summary: str


class MultiplexRequest(WireModel):
    target_gene: str = Field(min_length=1, max_length=100)
    paralog_gene: str = Field(min_length=1, max_length=100)
    nuclease: Literal["AsCas12a", "LbCas12a"] = "AsCas12a"
    direct_repeat: str = Field(default="", max_length=200)
    rationale: str = Field(default="", max_length=1_000)
    spacers_per_gene: int = Field(default=mx.SPACERS_PER_GENE, ge=1, le=6)


class SpacerResponse(WireModel):
    gene: str
    sequence: str
    chrom: str
    start: int
    strand: str
    pam: str
    gc: float
    protein_residue: int | None
    cds_fraction: float | None
    in_last_exon: bool | None
    features_hit: list[str]
    perfect_matches: int | None
    one_mismatch_matches: int | None
    predicted_activity: float | None
    activity_model: str
    warnings: list[str]


class MultiplexResponse(WireModel):
    nuclease: str
    genes: tuple[str, str]
    spacers: list[SpacerResponse]
    layout: list[str]
    construct_sequence: str = Field(serialization_alias="construct")
    direct_repeat: str
    warnings: list[str]
    rationale: str
    provenance: dict[str, str]
    complete: bool
    statement: str


router = APIRouter(prefix="/v1", tags=["escape"])


def _assessment(value: tg.Assessment) -> AssessmentResponse:
    return AssessmentResponse(
        gene=value.gene,
        symbol=value.symbol,
        verdict=value.verdict,
        reason=value.reason,
        percentile_among_essentials=value.percentile_among_essentials,
        n_reference_essentials=value.n_reference_essentials,
        weak_threshold_lfc=value.weak_threshold_lfc,
        observed_lfc=value.observed_lfc,
        quantile=value.quantile,
        provenance=value.provenance,
        statement=value.statement(),
    )


def _hypothesis(value: ev.Hypothesis) -> HypothesisResponse:
    return HypothesisResponse(
        target=value.target,
        candidate=value.candidate,
        target_symbol=value.target_symbol,
        candidate_symbol=value.candidate_symbol,
        model=value.model,
        strength=value.strength,
        supporting=list(value.supporting),
        available=list(value.available),
        missing=list(value.missing),
        direct_causal_evidence=value.direct_causal_evidence,
        channels=[EvidenceChannelResponse.model_validate(channel.__dict__)
                  for channel in value.channels],
        provenance=value.provenance,
        statement=value.statement(),
    )


@router.post("/escape/analyse", response_model=EscapeResponse)
def analyse_escape(
    request: EscapeRequest,
    _caller: Caller = Depends(require_hits_read),
) -> EscapeResponse:
    """Assess unexpectedly weak targets and rank every supported escape hypothesis."""

    observations = [
        tg.GeneObservation(
            gene=row.gene,
            symbol=row.symbol,
            lfc=row.lfc,
            n_guides=row.n_guides,
            fragile=row.fragile,
            spread_vs_screen=row.spread_vs_screen,
            expression_log1p_tpm=row.expression_log1p_tpm,
            expectation_source=row.expectation_source,
            expected_to_deplete=row.expected_to_deplete,
        )
        for row in request.observations
    ]
    context = tg.ScreenContext(
        qc_verdict=request.qc_verdict,
        fitness_contrast=request.fitness_contrast,
        nnmd=request.nnmd,
        reference_essential_effects=request.reference_essential_effects,
        essential_set=request.essential_set,
        screen_label=request.screen_label,
    )
    result = an.analyse(observations, context, model_id=request.model_id)
    assessments = [_assessment(value) for value in result.assessments]
    targets = [
        EscapeTargetResponse(
            assessment=_assessment(target.assessment),
            hypotheses=[_hypothesis(value) for value in target.hypotheses],
            leading_candidate=(target.leading.candidate_symbol or target.leading.candidate)
            if target.leading else None,
            candidates_not_evaluated=target.candidates_not_evaluated,
            candidates_not_shown=target.candidates_not_shown,
            note=target.note,
            statement=target.statement(),
        )
        for target in result.targets
    ]
    return EscapeResponse(
        screen=result.screen,
        eligible=result.eligible,
        reason=result.reason,
        flagged=result.flagged,
        assessments=assessments,
        targets=targets,
        provenance=result.provenance,
        summary=result.summary(),
    )


@router.post("/multiplex/design", response_model=MultiplexResponse)
def design_multiplex(
    request: MultiplexRequest,
    _caller: Caller = Depends(require_hits_read),
) -> MultiplexResponse:
    """Propose a Cas12a array; the response states when it is incomplete."""

    design = mx.design_pair(
        request.target_gene,
        request.paralog_gene,
        nuclease=request.nuclease,
        direct_repeat=request.direct_repeat,
        rationale=request.rationale,
        spacers_per_gene=request.spacers_per_gene,
    )
    return MultiplexResponse(
        nuclease=design.nuclease,
        genes=design.genes,
        spacers=[SpacerResponse(
            gene=row.gene,
            sequence=row.sequence,
            chrom=row.chrom,
            start=row.start,
            strand=row.strand,
            pam=row.pam,
            gc=row.gc,
            protein_residue=row.protein_residue,
            cds_fraction=row.cds_fraction,
            in_last_exon=row.in_last_exon,
            features_hit=list(row.features_hit),
            perfect_matches=row.perfect_matches,
            one_mismatch_matches=row.one_mismatch_matches,
            predicted_activity=row.predicted_activity,
            activity_model=row.activity_model,
            warnings=list(row.warnings),
        ) for row in design.spacers],
        layout=list(design.layout),
        construct_sequence=design.construct,
        direct_repeat=design.direct_repeat,
        warnings=list(design.warnings),
        rationale=design.rationale,
        provenance=design.provenance,
        complete=design.complete,
        statement=design.statement(),
    )

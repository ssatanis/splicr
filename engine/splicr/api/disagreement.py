"""
HTTP surface for the guide-disagreement report.

Routing, authorization, validation and serialization only. The calculation, the
concordance table and every sentence the report prints live in
`splicr.validate.domain_report`, so the offline worklist, the pipeline and this
API cannot answer the same question three different ways - which is exactly what
they used to do, with three different thresholds.

Two routes, one report shape:

    POST /v1/guide-disagreement
        The caller supplies the measurements. Stateless: nothing is read from or
        written to the database, and the caller's key is checked for scope only.

    GET  /v1/screens/{screen_id}/genes/{gene}/disagreement
        The measurements are already stored. The screen must belong to the
        caller's key's organization.
"""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .. import harmonize
from ..validate import domain_report as core
from ..validate import protein
from ..validate.domain_report import (
    DEPLETION_LFC,
    MIN_GUIDES,
    DisagreementReport,
    GuideEvidence,
    Provenance,
    build_report,
    spread_baseline,
)
from .security import Caller, require_hits_read


# ---------------------------------------------------------------------------
# Wire types
# ---------------------------------------------------------------------------

class GuideInput(BaseModel):
    """One guide-level measurement supplied by a caller."""

    model_config = ConfigDict(extra="forbid")

    guide_key: str = Field(min_length=1, max_length=200)
    gene: str = Field(min_length=1, max_length=100)
    log2_fold_change: float
    p_value: float | None = Field(default=None, ge=0.0, le=1.0)
    fdr: float | None = Field(default=None, ge=0.0, le=1.0)
    #: Assembly coordinates of the verified cut. Both or neither; a residue is
    #: never claimed from a position the caller did not supply.
    chromosome: str | None = Field(default=None, min_length=1, max_length=20)
    cut_position: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _coordinates_come_in_pairs(self):
        if (self.chromosome is None) != (self.cut_position is None):
            raise ValueError("chromosome and cut_position must be given together")
        if not math.isfinite(self.log2_fold_change):
            raise ValueError("log2_fold_change must be finite")
        return self


class DisagreementRequest(BaseModel):
    """
    A gene's guides, and every other gene's guides from the same screen.

    `screen_guides` is optional and is what makes the spread comparable: without
    it there is no way to know whether this gene's guides disagree more than the
    rest of the experiment, and the response says the ratio is unavailable rather
    than substituting an absolute cut.
    """

    model_config = ConfigDict(extra="forbid")

    gene: str = Field(min_length=1, max_length=100)
    taxid: int = Field(default=harmonize.HUMAN)
    guides: list[GuideInput] = Field(min_length=MIN_GUIDES)
    screen_guides: list[GuideInput] = Field(default_factory=list)
    depletion_lfc: float = Field(default=DEPLETION_LFC)
    annotate_protein: bool = True

    @model_validator(mode="after")
    def _guide_keys_are_unique(self):
        keys = [g.guide_key for g in self.guides]
        if len(keys) != len(set(keys)):
            raise ValueError("guide_key values must be unique within guides")
        return self


# ---------------------------------------------------------------------------
# Stateless route: the caller brings the measurements
# ---------------------------------------------------------------------------

def _resolve_gene(query: str, taxid: int) -> tuple[str | None, str]:
    """Canonical Ensembl id and approved symbol, or a 422 naming the reason."""
    try:
        resolution = harmonize.genes(taxid).resolve(query)
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"taxid {taxid} is not supported: {exc}") from exc
    if not resolution.ok:
        raise HTTPException(
            status_code=422,
            detail=f"'{query}' did not resolve to a current Ensembl gene: "
                   f"{resolution.reason or resolution.status}")
    return resolution.id, (resolution.label or query)


def _annotate_row(symbol: str, guide: GuideInput, depletion_lfc: float,
                  annotate: bool) -> tuple[GuideEvidence, object | None]:
    """The annotated row, and the codon position it resolved to when it did."""
    row = GuideEvidence(
        guide_key=guide.guide_key, log2_fold_change=guide.log2_fold_change,
        residual=0.0, depleted=guide.log2_fold_change <= depletion_lfc,
        p_value=guide.p_value, fdr=guide.fdr,
        chromosome=guide.chromosome, cut_position=guide.cut_position,
    )
    if not annotate:
        row.note = "protein context was not requested"
        return row, None
    if guide.chromosome is None or guide.cut_position is None:
        row.note = "no verified cut position was supplied"
        return row, None
    located = protein.locate(symbol, guide.chromosome, guide.cut_position)
    if located is None:
        row.note = "no MANE Select CDS covers this cut"
        return row, None
    features = protein.domains_at(symbol, located.residue)
    row.protein_residue = located.residue
    row.cds_fraction = round(located.fraction, 6) if located.n_residues else None
    row.in_last_exon = located.in_last_exon
    row.features_hit = list(features)
    row.annotation_evidence = "curated" if features else "cds_only"
    if not features:
        row.note = "the residue resolved; no curated UniProt feature covers it"
    return row, located


router = APIRouter(prefix="/v1", tags=["guide disagreement"])


@router.post("/guide-disagreement", response_model=DisagreementReport)
def guide_disagreement(request: DisagreementRequest,
                       caller: Caller = Depends(require_hits_read)) -> DisagreementReport:
    """
    Report guide disagreement for one gene from measurements the caller supplies.

    Stateless: nothing is read from or written to the database, so the caller's
    key is checked for a valid scope but no organization scoping applies - there
    is no stored row to scope to.
    """
    ensembl_id, symbol = _resolve_gene(request.gene, request.taxid)
    mine = [g for g in request.guides if g.gene.strip().upper() in
            {symbol.upper(), request.gene.strip().upper()}] or list(request.guides)
    if len(mine) < MIN_GUIDES:
        raise HTTPException(status_code=422,
                            detail=f"fewer than {MIN_GUIDES} guides for {symbol}")
    annotated = [_annotate_row(symbol, g, request.depletion_lfc, request.annotate_protein)
                 for g in mine]
    protein.flush_features()
    rows = [row for row, _ in annotated]
    position = next((p for _, p in annotated if p is not None), None)
    baseline, n_genes = spread_baseline(
        (g.gene, g.log2_fold_change) for g in request.screen_guides
    ) if request.screen_guides else ({}, 0)
    accession = protein.feature_records(symbol)[0] if request.annotate_protein else None
    transcript = position.transcript if position else None
    n_residues = position.n_residues if position else None
    return build_report(
        symbol, rows, ensembl_gene_id=ensembl_id, uniprot_accession=accession,
        mane_transcript=transcript, n_residues=n_residues,
        depletion_lfc=request.depletion_lfc,
        baseline=baseline or None, baseline_n_genes=n_genes or None,
        provenance=Provenance(
            reference_versions=core.REFERENCE_VERSIONS,
            measurement_source="supplied by the caller in this request",
        ),
    )


# ---------------------------------------------------------------------------
# Recorded route: the measurements are already stored
# ---------------------------------------------------------------------------

#: The stored report for one gene, newest run first. `report` is the document
#: engine/splicr/validate/domain_report.py produced at analysis time; nothing here
#: recomputes it, so a reader a month later sees the same numbers.
SELECT_REPORT = """
select gd.report, gd.created_at, r.id::text, c.id::text
  from public.gene_disagreement gd
  join public.comparisons c on c.id = gd.comparison_id
  join public.runs r on r.id = gd.run_id
 where gd.screen_id = %s
   and upper(gd.gene_symbol) = upper(%s)
   and gd.schema_version = '1'
 order by r.started_at desc nulls last, r.id desc
 limit 1
"""


@router.get("/screens/{screen_id}/genes/{gene}/disagreement",
            response_model=DisagreementReport)
def recorded_disagreement(
    screen_id: str = Path(pattern=r"^[0-9a-fA-F-]{36}$"),
    gene: str = Path(min_length=1, max_length=100),
    taxid: int = Query(default=harmonize.HUMAN),
    caller: Caller = Depends(require_hits_read),
) -> DisagreementReport:
    """
    The recorded guide-disagreement report for a gene in a stored run.

    The screen must belong to the caller's key's organization. Nothing is
    recomputed: the fold changes are MAGeCK's own and the report is the one the
    run produced, with the reference releases it used written into it. That is the
    point - a stored analysis does not change under a reader because a reference
    was refreshed.
    """
    from .. import db

    with db.connect() as conn:
        if not caller.may_read_screen(conn, screen_id):
            # Same status for "not yours" and "does not exist", so the endpoint
            # cannot be used to discover another organization's screen ids.
            raise HTTPException(status_code=404, detail="no such screen")
        _ensembl_id, symbol = _resolve_gene(gene, taxid)
        row = conn.execute(SELECT_REPORT, (screen_id, symbol)).fetchone()
        if row is None:
            stored = conn.execute(
                "select count(*) from public.gene_disagreement where screen_id = %s",
                (screen_id,),
            ).fetchone()[0]
            if stored:
                raise HTTPException(
                    status_code=404,
                    detail=f"{symbol} has no stored guide-disagreement report in this "
                           f"screen. A gene needs at least {MIN_GUIDES} guides with a "
                           "fold change to have one.")
            raise HTTPException(
                status_code=409,
                detail="this screen has no stored guide-disagreement reports. They are "
                       "written by runs analysed after public.gene_disagreement was "
                       "added; re-run the comparison to produce them.")
    document, created_at, _run_id, _comparison_id = row
    report = DisagreementReport.model_validate(document)
    # The document was serialised before it was stored, so when it was annotated
    # is the row's own timestamp rather than part of the document.
    report.provenance.annotated_at = created_at.isoformat() if created_at else None
    return report

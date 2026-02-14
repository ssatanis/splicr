
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from app.services.tea import tea_service

router = APIRouter()

# ─── Request Models ───────────────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    sequence: str
    model: Optional[str] = "pridict"

class OffTargetRequest(BaseModel):
    sequence: str
    max_mismatches: Optional[int] = 4
    model: Optional[str] = "cas9"

class WindowRequest(BaseModel):
    on_target_score: float
    off_target_risk: float

# ─── Response Models ──────────────────────────────────────────────────────────

class EfficiencyResponse(BaseModel):
    model: str
    efficiency_score: float
    confidence: float
    details: Dict[str, Any]

class OffTargetSite(BaseModel):
    locus: str
    sequence: str
    mismatches: int
    risk_score: float
    gene: Optional[str] = None

class OffTargetResponse(BaseModel):
    targets: List[OffTargetSite]
    aggregate_risk: float

class WindowResponse(BaseModel):
    window_score: float
    classification: str
    details: Dict[str, Any]

# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/predict/efficiency", response_model=EfficiencyResponse)
async def predict_efficiency(request: PredictionRequest):
    """
    Predict base editing efficiency for a target sequence.
    """
    if not request.sequence:
        raise HTTPException(status_code=400, detail="Sequence is required")
    
    # In a real app, validate sequence (ACGT only)
    
    result = tea_service.predict_efficiency(request.sequence, request.model)
    return result

@router.post("/predict/off-targets", response_model=OffTargetResponse)
async def predict_off_targets(request: OffTargetRequest):
    """
    Predict potential off-target sites and calculate aggregate risk.
    """
    if not request.sequence:
        raise HTTPException(status_code=400, detail="Sequence is required")
    
    targets = tea_service.predict_off_targets(request.sequence, request.model)
    
    # Simple aggregate risk: sum of individual risks (capped at 100 for simplicity)
    total_risk = sum(t["risk_score"] for t in targets)
    aggregate_risk = min(total_risk, 100.0)
    
    return {
        "targets": targets,
        "aggregate_risk": round(aggregate_risk, 2)
    }

@router.post("/calculate-window", response_model=WindowResponse)
async def calculate_window(request: WindowRequest):
    """
    Calculate therapeutic window score based on efficacy and safety metrics.
    """
    result = tea_service.calculate_therapeutic_window(
        request.on_target_score, 
        request.off_target_risk
    )
    
    return {
        "window_score": result["window_score"],
        "classification": result["classification"],
        "details": result
    }

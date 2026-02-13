from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
import logging

from app.services.s3_service import S3Service
# Import the engine from src, ensuring it's in pythonpath
import sys
from pathlib import Path
# Add src to sys.path if not present (hacky but effective for now)
src_path = str(Path(__file__).parent.parent.parent.parent.parent / "src")
if src_path not in sys.path:
    sys.path.append(src_path)

from crispr_confidence.engine import get_scorer

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Pydantic Models ---

class GeneItem(BaseModel):
    gene_id: str
    beta_score: float = Field(..., description="MAGeCK beta score")
    fdr: float = Field(..., description="MAGeCK FDR")
    lfc: Optional[float] = Field(None, description="Average LFC (if guides not provided)")
    max_offtarget_risk: Optional[float] = Field(0.0, description="Pre-calculated max off-target risk")

class CSRequest(BaseModel):
    gene_data: List[GeneItem]
    guide_data: Dict[str, List[float]] = Field(
        default_factory=dict, 
        description="Map of gene_id to list of guide LFCs"
    )
    replicate_data: Dict[str, List[float]] = Field(
        default_factory=dict, 
        description="Map of gene_id to list of replicate LFCs"
    )

class ComponentScores(BaseModel):
    sgRNA_concordance: float
    reproducibility: float
    pathway_coherence: float
    validation_likelihood: float
    offtarget_risk: float

class CCSResult(BaseModel):
    gene: str
    score: float
    tier: str
    recommendation: str
    components: ComponentScores
    details: Optional[Dict[str, Any]] = None

# --- Endpoints ---

@router.post("/calculate_ccs", response_model=List[CCSResult])
async def calculate_ccs_endpoint(payload: CSRequest):
    """
    Calculate CRISPR Confidence Score for a batch of genes.
    """
    try:
        scorer = get_scorer()
        
        # Convert Pydantic model to dict for the engine
        # We need to serialize carefully
        screen_data = {
            'gene_data': [g.model_dump() for g in payload.gene_data],
            'guide_data': payload.guide_data,
            'replicate_data': payload.replicate_data
        }
        
        results = scorer.score_screen(screen_data)
        
        return results
        
    except Exception as e:
        logger.error(f"Error calculating CCS: {str(e)}")
        raise HTTPException(status_code=500, detail=f"CCS Calculation failed: {str(e)}")

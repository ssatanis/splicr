"""Results retrieval API endpoints"""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import AnalysisResultsResponse
from app.services.analysis_service import AnalysisService
from app.models import AnalysisStatus
from uuid import UUID
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/{analysis_id}", response_model=AnalysisResultsResponse)
async def get_analysis_results(
    analysis_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get analysis results with download URLs
    
    Returns presigned download URLs for results files and plots.
    Only available for completed analyses.
    
    - **analysis_id**: Unique analysis identifier
    """
    try:
        analysis = AnalysisService.get_analysis(db, analysis_id)
        
        if not analysis:
            raise HTTPException(
                status_code=404,
                detail=f"Analysis {analysis_id} not found"
            )
        
        # Check if analysis is complete
        if analysis.status != AnalysisStatus.SUCCEEDED.value:
            raise HTTPException(
                status_code=400,
                detail=f"Analysis is not complete. Current status: {analysis.status}"
            )
        
        # Generate download URLs
        urls = AnalysisService.get_results_urls(analysis)
        
        return AnalysisResultsResponse(
            id=analysis.id,
            status=analysis.status,
            results_url=urls.get('results'),
            plots=urls.get('plots', {}),
            qc_metrics=analysis.qc_metrics,
            compute_time=analysis.compute_time
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting analysis results: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get analysis results: {str(e)}"
        )


@router.get("/{analysis_id}/download/{result_type}")
async def download_result_file(
    analysis_id: UUID,
    result_type: str,
    db: Session = Depends(get_db)
):
    """
    Get direct download URL for specific result file
    
    - **analysis_id**: Unique analysis identifier
    - **result_type**: Type of result (results, volcano_plot, waterfall_plot, etc.)
    """
    try:
        analysis = AnalysisService.get_analysis(db, analysis_id)
        
        if not analysis:
            raise HTTPException(
                status_code=404,
                detail=f"Analysis {analysis_id} not found"
            )
        
        if analysis.status != AnalysisStatus.SUCCEEDED.value:
            raise HTTPException(
                status_code=400,
                detail=f"Analysis is not complete. Current status: {analysis.status}"
            )
        
        from app.services.s3_service import S3Service
        s3_service = S3Service()
        
        # Determine S3 key based on result type
        if result_type == "results":
            if not analysis.results_s3_key:
                raise HTTPException(
                    status_code=404,
                    detail="Results file not found"
                )
            s3_key = analysis.results_s3_key
            filename = f"analysis_{str(analysis.id)[:8]}_results.zip"
        else:
            # Plot files
            if not analysis.plots_s3_keys or result_type not in analysis.plots_s3_keys:
                raise HTTPException(
                    status_code=404,
                    detail=f"Plot {result_type} not found"
                )
            s3_key = analysis.plots_s3_keys[result_type]
            filename = f"{result_type}.png"
        
        # Generate download URL
        download_url = s3_service.generate_presigned_download_url(
            s3_key,
            expires_in=3600,
            filename=filename
        )
        
        return {
            "download_url": download_url,
            "expires_in": 3600,
            "filename": filename
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating download URL: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate download URL: {str(e)}"
        )


@router.get("/{analysis_id}/qc-metrics")
async def get_qc_metrics(
    analysis_id: UUID,
    db: Session = Depends(get_db)
):
    """
    Get quality control metrics for analysis
    
    - **analysis_id**: Unique analysis identifier
    """
    try:
        analysis = AnalysisService.get_analysis(db, analysis_id)
        
        if not analysis:
            raise HTTPException(
                status_code=404,
                detail=f"Analysis {analysis_id} not found"
            )
        
        if not analysis.qc_metrics:
            raise HTTPException(
                status_code=404,
                detail="QC metrics not available"
            )
        
        return {
            "analysis_id": str(analysis.id),
            "qc_metrics": analysis.qc_metrics
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting QC metrics: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get QC metrics: {str(e)}"
        )

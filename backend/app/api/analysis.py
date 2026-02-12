"""Analysis submission and management API endpoints"""
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import (
    AnalysisSubmitRequest,
    AnalysisResponse,
    AnalysisStatusResponse
)
from app.services.analysis_service import AnalysisService
from app.models import AnalysisStatus, User
from app.dependencies import get_current_user
from uuid import UUID
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/submit", response_model=AnalysisResponse, status_code=201)
async def submit_analysis(
    request: AnalysisSubmitRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Submit new CRISPR screen analysis
    
    Creates a new analysis record and queues it for processing.
    
    - **file_keys**: List of S3 file keys (from upload endpoint)
    - **library_type**: Type of library (genome-wide, focused, etc.)
    - **sample_names**: Optional list of sample names
    - **algorithm**: Analysis algorithm (mageck or bagel2)
    - **parameters**: Optional custom parameters
    
    Returns created analysis with unique ID.
    """
    try:
        logger.info(f"User {current_user.id} submitting analysis with {len(request.file_keys)} files")
        
        # Validate files exist in S3
        if not AnalysisService.validate_files(request.file_keys):
            raise HTTPException(
                status_code=400,
                detail="One or more files not found in S3. Please upload files first."
            )
        
        # Create analysis record associated with user
        analysis = AnalysisService.create_analysis(
            db=db,
            file_keys=request.file_keys,
            library_type=request.library_type,
            sample_names=request.sample_names,
            algorithm=request.algorithm,
            parameters=request.parameters,
            user_id=str(current_user.id)
        )
        
        # Queue analysis task (import here to avoid circular dependency)
        from app.tasks.celery_tasks import submit_analysis_task
        background_tasks.add_task(
            submit_analysis_task.delay,
            str(analysis.id),
            request.file_keys,
            request.library_type,
            request.algorithm
        )
        
        logger.info(f"Analysis {analysis.id} submitted successfully")
        
        return AnalysisResponse.model_validate(analysis)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting analysis: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to submit analysis: {str(e)}"
        )


@router.get("/{analysis_id}/status", response_model=AnalysisStatusResponse)
async def get_analysis_status(
    analysis_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get analysis status
    
    Returns current status, progress, and timing information.
    
    - **analysis_id**: Unique analysis identifier
    """
    try:
        analysis = AnalysisService.get_analysis(db, analysis_id)
        
        if not analysis:
            raise HTTPException(
                status_code=404,
                detail=f"Analysis {analysis_id} not found"
            )
            
        # Check ownership
        if analysis.user_id and analysis.user_id != str(current_user.id):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to access this analysis"
            )
        
        return AnalysisStatusResponse(
            id=analysis.id,
            status=analysis.status,
            progress=analysis.progress,
            current_step=analysis.current_step,
            error_message=analysis.error_message,
            created_at=analysis.created_at,
            started_at=analysis.started_at,
            completed_at=analysis.completed_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting analysis status: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get analysis status: {str(e)}"
        )


@router.get("/{analysis_id}", response_model=AnalysisResponse)
async def get_analysis(
    analysis_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get full analysis details
    
    Returns complete analysis information including configuration and results.
    
    - **analysis_id**: Unique analysis identifier
    """
    try:
        analysis = AnalysisService.get_analysis(db, analysis_id)
        
        if not analysis:
            raise HTTPException(
                status_code=404,
                detail=f"Analysis {analysis_id} not found"
            )

        # Check ownership
        if analysis.user_id and analysis.user_id != str(current_user.id):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to access this analysis"
            )
        
        return AnalysisResponse.model_validate(analysis)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting analysis: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get analysis: {str(e)}"
        )


@router.get("/", response_model=list[AnalysisResponse])
async def list_analyses(
    status: str = None,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    List analyses with optional filtering
    
    Returns paginated list of analyses for the current user.
    
    - **status**: Optional status filter (CREATED, RUNNING, SUCCEEDED, FAILED)
    - **limit**: Maximum number of results (default: 50)
    - **offset**: Result offset for pagination (default: 0)
    """
    try:
        analyses = AnalysisService.list_analyses(
            db=db,
            user_id=str(current_user.id),
            status=status,
            limit=min(limit, 100),  # Cap at 100
            offset=offset
        )
        
        return [AnalysisResponse.model_validate(a) for a in analyses]
        
    except Exception as e:
        logger.error(f"Error listing analyses: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list analyses: {str(e)}"
        )


@router.delete("/{analysis_id}")
async def delete_analysis(
    analysis_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete (cancel) analysis
    
    Marks analysis as cancelled. If running, will attempt to cancel the job.
    
    - **analysis_id**: Unique analysis identifier
    """
    try:
        analysis = AnalysisService.get_analysis(db, analysis_id)
        
        if not analysis:
            raise HTTPException(
                status_code=404,
                detail=f"Analysis {analysis_id} not found"
            )
            
        # Check ownership
        if analysis.user_id and analysis.user_id != str(current_user.id):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to access this analysis"
            )
        
        # If running, cancel the Batch job
        if analysis.status == AnalysisStatus.RUNNING.value and analysis.batch_job_id:
            from app.services.batch_service import BatchService
            try:
                BatchService.cancel_job(
                    analysis.batch_job_id,
                    reason="User requested cancellation"
                )
            except Exception as e:
                logger.warning(f"Failed to cancel Batch job: {str(e)}")
        
        # Mark as cancelled
        success = AnalysisService.delete_analysis(db, analysis_id)
        
        if not success:
            raise HTTPException(
                status_code=500,
                detail="Failed to delete analysis"
            )
        
        return {"message": "Analysis cancelled successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting analysis: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete analysis: {str(e)}"
        )

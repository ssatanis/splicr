"""Celery tasks for CRISPR analysis processing"""
from celery import Celery, Task
from app.config import get_settings
from app.services.batch_service import BatchService
from app.services.analysis_service import AnalysisService
from app.database import SessionLocal
from app.models import AnalysisStatus
from uuid import UUID
import time
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

# Initialize Celery app
celery_app = Celery(
    "splicr",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND
)

# Celery configuration
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600 * 6,  # 6 hours max
    task_soft_time_limit=3600 * 5,  # 5 hours soft limit
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_reject_on_worker_lost=True,
)


class DatabaseTask(Task):
    """Base task with database session management"""
    
    def __call__(self, *args, **kwargs):
        """Execute task with database session"""
        return super().__call__(*args, **kwargs)


@celery_app.task(name="tasks.submit_analysis", bind=True, base=DatabaseTask)
def submit_analysis_task(
    self,
    analysis_id: str,
    file_keys: list,
    library_type: str,
    algorithm: str = "mageck"
):
    """
    Submit analysis to AWS Batch and monitor progress
    
    This task:
    1. Validates the analysis
    2. Submits job to AWS Batch
    3. Monitors job status
    4. Updates analysis status in database
    
    Args:
        analysis_id: UUID of the analysis
        file_keys: List of S3 file keys
        library_type: Type of library
        algorithm: Analysis algorithm
    """
    db = SessionLocal()
    
    try:
        logger.info(f"Starting analysis task for {analysis_id}")
        
        # Get analysis
        analysis_uuid = UUID(analysis_id)
        analysis = AnalysisService.get_analysis(db, analysis_uuid)
        
        if not analysis:
            raise ValueError(f"Analysis {analysis_id} not found")
        
        # Update status to VALIDATING
        AnalysisService.update_analysis_status(
            db=db,
            analysis_id=analysis_uuid,
            status=AnalysisStatus.VALIDATING.value,
            progress=5,
            current_step="Validating input files"
        )
        
        # Validate files
        if not AnalysisService.validate_files(file_keys):
            raise ValueError("File validation failed")
        
        # Update status to QUEUED
        AnalysisService.update_analysis_status(
            db=db,
            analysis_id=analysis_uuid,
            status=AnalysisStatus.QUEUED.value,
            progress=10,
            current_step="Submitting to compute queue"
        )
        
        # Submit to AWS Batch
        batch_service = BatchService()
        job_result = batch_service.submit_analysis_job(
            analysis_id=analysis_id,
            file_keys=file_keys,
            library_type=library_type,
            algorithm=algorithm
        )
        
        logger.info(f"Submitted Batch job {job_result['job_id']} for analysis {analysis_id}")
        
        # Update with job ID
        analysis.batch_job_id = job_result['job_id']
        db.commit()
        
        # Update status to RUNNING
        AnalysisService.update_analysis_status(
            db=db,
            analysis_id=analysis_uuid,
            status=AnalysisStatus.RUNNING.value,
            progress=20,
            current_step="Analysis job running"
        )
        
        # Monitor job status
        poll_interval = 30  # seconds
        max_polls = 720  # 6 hours max (30s * 720 = 6h)
        poll_count = 0
        
        while poll_count < max_polls:
            time.sleep(poll_interval)
            poll_count += 1
            
            # Get job status
            status_result = batch_service.get_job_status(job_result['job_id'])
            
            # Update progress based on status
            if status_result['status'] == 'RUNNING':
                # Gradually increase progress
                progress = min(20 + (poll_count * 0.5), 90)
                AnalysisService.update_analysis_status(
                    db=db,
                    analysis_id=analysis_uuid,
                    status=AnalysisStatus.RUNNING.value,
                    progress=int(progress),
                    current_step=status_result.get('aws_status', 'Running')
                )
            
            # Check if job completed
            if status_result['status'] in ['SUCCEEDED', 'FAILED']:
                final_status = (
                    AnalysisStatus.SUCCEEDED.value
                    if status_result['status'] == 'SUCCEEDED'
                    else AnalysisStatus.FAILED.value
                )
                
                error_msg = None
                if status_result['status'] == 'FAILED':
                    error_msg = status_result.get('status_reason', 'Job failed')
                
                AnalysisService.update_analysis_status(
                    db=db,
                    analysis_id=analysis_uuid,
                    status=final_status,
                    progress=100 if final_status == AnalysisStatus.SUCCEEDED.value else 0,
                    current_step="Complete" if final_status == AnalysisStatus.SUCCEEDED.value else "Failed",
                    error_message=error_msg
                )
                
                logger.info(f"Analysis {analysis_id} completed with status: {final_status}")
                break
        
        if poll_count >= max_polls:
            # Timeout
            logger.error(f"Analysis {analysis_id} timed out after 6 hours")
            AnalysisService.update_analysis_status(
                db=db,
                analysis_id=analysis_uuid,
                status=AnalysisStatus.FAILED.value,
                progress=0,
                current_step="Timeout",
                error_message="Analysis exceeded maximum time limit"
            )
        
        return {
            "analysis_id": analysis_id,
            "status": analysis.status,
            "job_id": job_result['job_id']
        }
        
    except Exception as e:
        logger.error(f"Error in analysis task: {str(e)}")
        
        # Update analysis status to FAILED
        try:
            AnalysisService.update_analysis_status(
                db=db,
                analysis_id=UUID(analysis_id),
                status=AnalysisStatus.FAILED.value,
                progress=0,
                current_step="Failed",
                error_message=str(e)
            )
        except Exception as update_error:
            logger.error(f"Failed to update analysis status: {str(update_error)}")
        
        raise
        
    finally:
        db.close()


@celery_app.task(name="tasks.cleanup_old_analyses")
def cleanup_old_analyses_task():
    """
    Cleanup old completed analyses (scheduled task)
    
    This task should be run periodically to:
    - Archive old results
    - Clean up temporary S3 files
    - Update cost estimates
    """
    logger.info("Running cleanup task")
    
    # Implementation for cleanup logic
    # This would typically:
    # 1. Find analyses older than retention period
    # 2. Archive or delete results
    # 3. Update statistics
    
    return {"status": "cleanup_complete"}


@celery_app.task(name="tasks.health_check")
def health_check_task():
    """Health check task for monitoring"""
    return {"status": "healthy", "service": "celery-worker"}

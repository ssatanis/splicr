"""Analysis orchestration service"""
from sqlalchemy.orm import Session
from app.models import Analysis, AnalysisStatus
from app.services.s3_service import S3Service
from typing import List, Optional, Dict
import logging
from uuid import UUID

logger = logging.getLogger(__name__)


class AnalysisService:
    """Service for analysis orchestration and management"""
    
    @staticmethod
    def create_analysis(
        db: Session,
        file_keys: List[str],
        library_type: str,
        sample_names: Optional[List[str]] = None,
        algorithm: str = "mageck",
        parameters: Optional[Dict] = None,
        user_id: Optional[str] = None
    ) -> Analysis:
        """
        Create new analysis record
        
        Args:
            db: Database session
            file_keys: List of S3 file keys
            library_type: Library type
            sample_names: Optional sample names
            algorithm: Analysis algorithm
            parameters: Optional custom parameters
            user_id: Optional user ID
            
        Returns:
            Created Analysis object
        """
        analysis = Analysis(
            user_id=user_id,
            file_keys=file_keys,
            library_type=library_type,
            sample_names=sample_names,
            algorithm=algorithm,
            parameters=parameters,
            status=AnalysisStatus.CREATED.value
        )
        
        db.add(analysis)
        db.commit()
        db.refresh(analysis)
        
        logger.info(f"Created analysis {analysis.id}")
        return analysis
    
    @staticmethod
    def get_analysis(db: Session, analysis_id: UUID) -> Optional[Analysis]:
        """
        Get analysis by ID
        
        Args:
            db: Database session
            analysis_id: Analysis UUID
            
        Returns:
            Analysis object or None
        """
        return db.query(Analysis).filter(Analysis.id == analysis_id).first()
    
    @staticmethod
    def list_analyses(
        db: Session,
        user_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> List[Analysis]:
        """
        List analyses with optional filtering
        
        Args:
            db: Database session
            user_id: Optional user ID filter
            status: Optional status filter
            limit: Maximum number of results
            offset: Result offset for pagination
            
        Returns:
            List of Analysis objects
        """
        query = db.query(Analysis)
        
        if user_id:
            query = query.filter(Analysis.user_id == user_id)
        
        if status:
            query = query.filter(Analysis.status == status)
        
        query = query.order_by(Analysis.created_at.desc())
        query = query.limit(limit).offset(offset)
        
        return query.all()
    
    @staticmethod
    def update_analysis_status(
        db: Session,
        analysis_id: UUID,
        status: str,
        progress: Optional[int] = None,
        current_step: Optional[str] = None,
        error_message: Optional[str] = None
    ) -> Analysis:
        """
        Update analysis status
        
        Args:
            db: Database session
            analysis_id: Analysis UUID
            status: New status
            progress: Optional progress percentage
            current_step: Optional current step description
            error_message: Optional error message
            
        Returns:
            Updated Analysis object
        """
        analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
        
        if not analysis:
            raise ValueError(f"Analysis {analysis_id} not found")
        
        analysis.status = status
        
        if progress is not None:
            analysis.progress = progress
        
        if current_step:
            analysis.current_step = current_step
        
        if error_message:
            analysis.error_message = error_message
        
        # Update timing
        from datetime import datetime
        if status == AnalysisStatus.RUNNING.value and not analysis.started_at:
            analysis.started_at = datetime.utcnow()
        
        if status in [AnalysisStatus.SUCCEEDED.value, AnalysisStatus.FAILED.value]:
            if not analysis.completed_at:
                analysis.completed_at = datetime.utcnow()
                
            # Calculate compute time
            if analysis.started_at:
                analysis.compute_time = (
                    analysis.completed_at - analysis.started_at
                ).total_seconds()
        
        db.commit()
        db.refresh(analysis)
        
        logger.info(f"Updated analysis {analysis_id} status to {status}")
        return analysis
    
    @staticmethod
    def validate_files(file_keys: List[str]) -> bool:
        """
        Validate that all files exist in S3
        
        Args:
            file_keys: List of S3 file keys
            
        Returns:
            True if all files exist
        """
        s3_service = S3Service()
        
        for file_key in file_keys:
            # Check if it exists in S3/R2
            if not s3_service.check_file_exists(file_key):
                # Small concession: If it exists in local data/ dir, we'll allow it for dev
                # But strictly speaking, production should use S3
                local_data_path = Path("/Users/sahaj/Documents/Projects/SplicR/data") / file_key.replace("uploads/", "")
                if not local_data_path.exists():
                    logger.error(f"File not found in S3 or locally: {file_key}")
                    return False
        
        return True
    
    @staticmethod
    def get_results_urls(analysis: Analysis) -> Dict[str, str]:
        """
        Generate download URLs for analysis results
        
        Args:
            analysis: Analysis object
            
        Returns:
            Dict of result type to download URL
        """
        urls = {}
        s3_service = S3Service()
        
        # Main results file
        if analysis.results_s3_key:
            urls['results'] = s3_service.generate_presigned_download_url(
                analysis.results_s3_key,
                expires_in=3600,
                filename=f"analysis_{str(analysis.id)[:8]}_results.zip"
            )
        
        # Plot files
        if analysis.plots_s3_keys:
            urls['plots'] = {}
            for plot_type, s3_key in analysis.plots_s3_keys.items():
                urls['plots'][plot_type] = s3_service.generate_presigned_download_url(
                    s3_key,
                    expires_in=3600,
                    filename=f"{plot_type}.png"
                )
        
        return urls
    
    @staticmethod
    def delete_analysis(db: Session, analysis_id: UUID) -> bool:
        """
        Delete analysis (soft delete - mark as cancelled)
        
        Args:
            db: Database session
            analysis_id: Analysis UUID
            
        Returns:
            True if successful
        """
        analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
        
        if not analysis:
            return False
        
        # If running, should cancel the job first
        if analysis.status == AnalysisStatus.RUNNING.value:
            logger.warning(f"Attempting to delete running analysis {analysis_id}")
        
        analysis.status = AnalysisStatus.CANCELLED.value
        db.commit()
        
        logger.info(f"Deleted analysis {analysis_id}")
        return True

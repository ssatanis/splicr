"""AWS Batch service for compute job orchestration"""
import boto3
from botocore.exceptions import ClientError
from app.config import get_settings
from typing import Dict, List, Optional
import logging
import json

logger = logging.getLogger(__name__)
settings = get_settings()

# Initialize Batch client
batch_client = boto3.client(
    'batch',
    region_name=settings.AWS_REGION,
    aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None
)


class BatchService:
    """Service for AWS Batch operations"""
    
    @staticmethod
    def submit_analysis_job(
        analysis_id: str,
        file_keys: List[str],
        library_type: str,
        algorithm: str = "mageck",
        parameters: Optional[Dict] = None
    ) -> Dict[str, str]:
        """
        Submit CRISPR analysis job to AWS Batch
        
        Args:
            analysis_id: Unique analysis identifier
            file_keys: List of S3 file keys
            library_type: Type of library (genome-wide, focused, etc.)
            algorithm: Analysis algorithm (mageck or bagel2)
            parameters: Optional custom parameters
            
        Returns:
            Dict with job_id, job_name, and status
        """
        # Sanitize job name (AWS Batch requirements)
        job_name = f"splicr-{analysis_id[:8]}"
        
        # Build command to run in container
        command_overrides = [
            "python",
            "/analysis/run_analysis.py",
            "--analysis-id", analysis_id,
            "--file-keys", ",".join(file_keys),
            "--library", library_type,
            "--algorithm", algorithm,
            "--s3-bucket", settings.S3_BUCKET_NAME
        ]
        
        # Add custom parameters if provided
        if parameters:
            command_overrides.extend([
                "--parameters", json.dumps(parameters)
            ])
        
        # Environment variables passed to container
        environment = [
            {'name': 'ANALYSIS_ID', 'value': analysis_id},
            {'name': 'S3_BUCKET', 'value': settings.S3_BUCKET_NAME},
            {'name': 'AWS_REGION', 'value': settings.AWS_REGION},
            {'name': 'LIBRARY_TYPE', 'value': library_type},
            {'name': 'ALGORITHM', 'value': algorithm}
        ]
        
        try:
            response = batch_client.submit_job(
                jobName=job_name,
                jobQueue=settings.AWS_BATCH_JOB_QUEUE,
                jobDefinition=settings.AWS_BATCH_JOB_DEFINITION,
                containerOverrides={
                    'command': command_overrides,
                    'environment': environment,
                    'resourceRequirements': [
                        {'type': 'VCPU', 'value': '4'},
                        {'type': 'MEMORY', 'value': '16384'}  # 16GB
                    ]
                },
                tags={
                    'AnalysisId': analysis_id,
                    'Service': 'SplicR',
                    'Algorithm': algorithm
                }
            )
            
            logger.info(f"Submitted Batch job {response['jobId']} for analysis {analysis_id}")
            
            return {
                "job_id": response['jobId'],
                "job_name": response['jobName'],
                "status": "SUBMITTED"
            }
            
        except ClientError as e:
            logger.error(f"Error submitting Batch job: {str(e)}")
            raise Exception(f"Failed to submit analysis job: {str(e)}")
    
    @staticmethod
    def get_job_status(job_id: str) -> Dict[str, any]:
        """
        Get AWS Batch job status
        
        Args:
            job_id: AWS Batch job ID
            
        Returns:
            Dict with job status information
        """
        try:
            response = batch_client.describe_jobs(jobs=[job_id])
            
            if not response['jobs']:
                logger.warning(f"Job {job_id} not found")
                return {
                    "job_id": job_id,
                    "status": "NOT_FOUND"
                }
            
            job = response['jobs'][0]
            
            # Map Batch statuses to our internal statuses
            status_mapping = {
                'SUBMITTED': 'QUEUED',
                'PENDING': 'QUEUED',
                'RUNNABLE': 'QUEUED',
                'STARTING': 'RUNNING',
                'RUNNING': 'RUNNING',
                'SUCCEEDED': 'SUCCEEDED',
                'FAILED': 'FAILED'
            }
            
            internal_status = status_mapping.get(job['status'], job['status'])
            
            result = {
                "job_id": job_id,
                "status": internal_status,
                "aws_status": job['status'],
                "created_at": job.get('createdAt'),
                "started_at": job.get('startedAt'),
                "stopped_at": job.get('stoppedAt'),
                "status_reason": job.get('statusReason', ''),
                "container": job.get('container', {})
            }
            
            # Calculate progress based on status
            if internal_status == 'QUEUED':
                result['progress'] = 10
            elif internal_status == 'RUNNING':
                # Could be enhanced with actual progress from container logs
                result['progress'] = 50
            elif internal_status == 'SUCCEEDED':
                result['progress'] = 100
            else:
                result['progress'] = 0
            
            logger.debug(f"Job {job_id} status: {internal_status}")
            return result
            
        except ClientError as e:
            logger.error(f"Error getting job status: {str(e)}")
            raise Exception(f"Failed to get job status: {str(e)}")
    
    @staticmethod
    def cancel_job(job_id: str, reason: str = "User requested cancellation") -> bool:
        """
        Cancel a running job
        
        Args:
            job_id: AWS Batch job ID
            reason: Cancellation reason
            
        Returns:
            True if successful
        """
        try:
            batch_client.terminate_job(
                jobId=job_id,
                reason=reason
            )
            logger.info(f"Cancelled job {job_id}: {reason}")
            return True
            
        except ClientError as e:
            logger.error(f"Error cancelling job: {str(e)}")
            raise Exception(f"Failed to cancel job: {str(e)}")
    
    @staticmethod
    def get_job_logs(job_id: str) -> Optional[str]:
        """
        Get CloudWatch logs for a job (if available)
        
        Args:
            job_id: AWS Batch job ID
            
        Returns:
            Log stream name or None
        """
        try:
            response = batch_client.describe_jobs(jobs=[job_id])
            
            if not response['jobs']:
                return None
            
            job = response['jobs'][0]
            container = job.get('container', {})
            log_stream_name = container.get('logStreamName')
            
            return log_stream_name
            
        except ClientError as e:
            logger.error(f"Error getting job logs: {str(e)}")
            return None

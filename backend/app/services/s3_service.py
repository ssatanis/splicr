"""AWS S3 service for file storage operations"""
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
from app.config import get_settings
import uuid
from datetime import datetime
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

# Configure boto3 with retry logic and timeouts
config = Config(
    region_name=settings.AWS_REGION,
    retries={'max_attempts': 3, 'mode': 'adaptive'},
    connect_timeout=5,
    read_timeout=60
)

# Initialize S3 client (supports both AWS S3 and Cloudflare R2)
s3_client = boto3.client(
    's3',
    endpoint_url=settings.R2_ENDPOINT_URL or None,  # Use R2 endpoint if configured
    config=config,
    aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
    aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None
)


class S3Service:
    """Service for S3 operations"""
    
    @staticmethod
    def generate_presigned_upload_url(filename: str, file_type: str) -> Dict[str, any]:
        """
        Generate presigned POST URL for direct browser-to-S3 upload
        
        Args:
            filename: Name of the file
            file_type: MIME type of the file
            
        Returns:
            Dict with upload_url, fields, file_key, and expires_in
        """
        # Generate unique file key with date-based partitioning
        date_path = datetime.now().strftime('%Y/%m/%d')
        unique_id = str(uuid.uuid4())
        file_key = f"uploads/{date_path}/{unique_id}/{filename}"
        
        try:
            presigned_post = s3_client.generate_presigned_post(
                Bucket=settings.S3_BUCKET_NAME,
                Key=file_key,
                Fields={
                    "Content-Type": file_type,
                    "x-amz-server-side-encryption": "AES256"
                },
                Conditions=[
                    {"Content-Type": file_type},
                    ["content-length-range", 1, settings.MAX_UPLOAD_SIZE],
                    {"x-amz-server-side-encryption": "AES256"}
                ],
                ExpiresIn=3600  # 1 hour
            )
            
            logger.info(f"Generated presigned URL for file: {filename}")
            
            return {
                "upload_url": presigned_post['url'],
                "fields": presigned_post['fields'],
                "file_key": file_key,
                "expires_in": 3600
            }
        except ClientError as e:
            logger.error(f"Error generating presigned URL: {str(e)}")
            raise Exception(f"Failed to generate upload URL: {str(e)}")
    
    @staticmethod
    def generate_presigned_download_url(
        file_key: str,
        expires_in: int = 3600,
        filename: Optional[str] = None
    ) -> str:
        """
        Generate presigned URL for file download
        
        Args:
            file_key: S3 object key
            expires_in: URL expiration time in seconds
            filename: Optional filename for Content-Disposition header
            
        Returns:
            Presigned download URL
        """
        try:
            params = {
                'Bucket': settings.S3_BUCKET_NAME,
                'Key': file_key
            }
            
            # Add Content-Disposition header if filename provided
            if filename:
                params['ResponseContentDisposition'] = f'attachment; filename="{filename}"'
            
            url = s3_client.generate_presigned_url(
                'get_object',
                Params=params,
                ExpiresIn=expires_in
            )
            
            logger.info(f"Generated download URL for: {file_key}")
            return url
            
        except ClientError as e:
            logger.error(f"Error generating download URL: {str(e)}")
            raise Exception(f"Failed to generate download URL: {str(e)}")
    
    @staticmethod
    def check_file_exists(file_key: str) -> bool:
        """
        Check if file exists in S3
        
        Args:
            file_key: S3 object key
            
        Returns:
            True if file exists, False otherwise
        """
        try:
            s3_client.head_object(
                Bucket=settings.S3_BUCKET_NAME,
                Key=file_key
            )
            return True
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            logger.error(f"Error checking file existence: {str(e)}")
            raise
    
    @staticmethod
    def get_file_size(file_key: str) -> int:
        """
        Get file size in bytes
        
        Args:
            file_key: S3 object key
            
        Returns:
            File size in bytes
        """
        try:
            response = s3_client.head_object(
                Bucket=settings.S3_BUCKET_NAME,
                Key=file_key
            )
            return response['ContentLength']
        except ClientError as e:
            logger.error(f"Error getting file size: {str(e)}")
            raise Exception(f"Failed to get file size: {str(e)}")
    
    @staticmethod
    def copy_file(source_key: str, dest_key: str) -> bool:
        """
        Copy file within S3
        
        Args:
            source_key: Source S3 object key
            dest_key: Destination S3 object key
            
        Returns:
            True if successful
        """
        try:
            copy_source = {
                'Bucket': settings.S3_BUCKET_NAME,
                'Key': source_key
            }
            s3_client.copy_object(
                CopySource=copy_source,
                Bucket=settings.S3_BUCKET_NAME,
                Key=dest_key,
                ServerSideEncryption='AES256'
            )
            logger.info(f"Copied {source_key} to {dest_key}")
            return True
        except ClientError as e:
            logger.error(f"Error copying file: {str(e)}")
            raise Exception(f"Failed to copy file: {str(e)}")
    
    @staticmethod
    def delete_file(file_key: str) -> bool:
        """
        Delete file from S3
        
        Args:
            file_key: S3 object key
            
        Returns:
            True if successful
        """
        try:
            s3_client.delete_object(
                Bucket=settings.S3_BUCKET_NAME,
                Key=file_key
            )
            logger.info(f"Deleted file: {file_key}")
            return True
        except ClientError as e:
            logger.error(f"Error deleting file: {str(e)}")
            raise Exception(f"Failed to delete file: {str(e)}")
    
    @staticmethod
    def list_files(prefix: str, max_keys: int = 1000) -> list:
        """
        List files with given prefix
        
        Args:
            prefix: S3 key prefix
            max_keys: Maximum number of keys to return
            
        Returns:
            List of file keys
        """
        try:
            response = s3_client.list_objects_v2(
                Bucket=settings.S3_BUCKET_NAME,
                Prefix=prefix,
                MaxKeys=max_keys
            )
            
            if 'Contents' not in response:
                return []
            
            return [obj['Key'] for obj in response['Contents']]
            
        except ClientError as e:
            logger.error(f"Error listing files: {str(e)}")
            raise Exception(f"Failed to list files: {str(e)}")

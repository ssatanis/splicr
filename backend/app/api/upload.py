"""File upload API endpoints"""
from fastapi import APIRouter, HTTPException, Depends
from app.schemas import PresignedURLRequest, PresignedURLResponse
from app.services.s3_service import S3Service
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/presigned-url", response_model=PresignedURLResponse)
async def get_presigned_upload_url(request: PresignedURLRequest):
    """
    Generate presigned URL for direct browser-to-S3 upload
    
    This endpoint returns a presigned POST URL that the frontend can use
    to upload files directly to S3 without routing through the backend.
    
    - **filename**: Name of the file to upload
    - **file_type**: MIME type of the file
    
    Returns presigned upload URL with required fields.
    """
    try:
        logger.info(f"Generating presigned URL for: {request.filename}")
        
        result = S3Service.generate_presigned_upload_url(
            filename=request.filename,
            file_type=request.file_type
        )
        
        return PresignedURLResponse(**result)
        
    except Exception as e:
        logger.error(f"Error generating presigned URL: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate upload URL: {str(e)}"
        )


@router.post("/validate")
async def validate_upload(file_key: str):
    """
    Validate that a file was successfully uploaded to S3
    
    - **file_key**: S3 object key to validate
    
    Returns file existence and size information.
    """
    try:
        s3_service = S3Service()
        
        exists = s3_service.check_file_exists(file_key)
        
        if not exists:
            raise HTTPException(
                status_code=404,
                detail="File not found in S3"
            )
        
        file_size = s3_service.get_file_size(file_key)
        
        return {
            "file_key": file_key,
            "exists": True,
            "size_bytes": file_size,
            "size_mb": round(file_size / (1024 * 1024), 2)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error validating upload: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to validate upload: {str(e)}"
        )

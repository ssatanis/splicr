"""Application configuration using Pydantic Settings"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing import List
import json


class Settings(BaseSettings):
    """Application settings with environment variable support"""
    
    # Application
    APP_NAME: str = "SplicR API"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    
    # Database
    DATABASE_URL: str
    
    # Redis
    REDIS_URL: str = "redis://redis:6379/0"
    
    # Celery
    CELERY_BROKER_URL: str = "redis://redis:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/0"
    
    # AWS / R2 Storage
    AWS_REGION: str = "us-east-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    S3_BUCKET_NAME: str
    AWS_BATCH_JOB_QUEUE: str
    AWS_BATCH_JOB_DEFINITION: str
    
    # Cloudflare R2 (optional - for S3-compatible storage)
    R2_ENDPOINT_URL: str = ""  # e.g., https://{account_id}.r2.cloudflarestorage.com
    R2_PUBLIC_URL: str = ""    # Optional: Custom domain for public access
    
    # Security
    SECRET_KEY: str
    CORS_ORIGINS: str = '["http://localhost:3000"]'
    
    # File Upload
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024 * 1024  # 10GB
    ALLOWED_EXTENSIONS: set = {".fastq", ".fq", ".fastq.gz", ".fq.gz"}
    
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="allow"
    )
    
    def get_cors_origins(self) -> List[str]:
        """Parse CORS origins from JSON string"""
        try:
            return json.loads(self.CORS_ORIGINS)
        except json.JSONDecodeError:
            return ["http://localhost:3000"]


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance"""
    return Settings()

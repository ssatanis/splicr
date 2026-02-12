"""Pydantic schemas for request/response validation"""
from pydantic import BaseModel, Field, validator, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


class UserCreate(BaseModel):
    """User registration request"""
    email: EmailStr
    password: str = Field(..., min_length=8, description="Minimum 8 characters")
    display_name: Optional[str] = None

    @validator("password")
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class UserResponse(BaseModel):
    """User response (no password)"""
    id: UUID
    email: str
    display_name: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class UserLogin(BaseModel):
    """Login request"""
    email: EmailStr
    password: str


class Token(BaseModel):
    """JWT token response"""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class PresignedURLRequest(BaseModel):
    """Request for presigned upload URL"""
    filename: str = Field(..., description="Name of the file to upload")
    file_type: str = Field(..., description="MIME type of the file")
    
    @validator('filename')
    def validate_filename(cls, v):
        if not v.lower().endswith(('.fastq', '.fq', '.fastq.gz', '.fq.gz')):
            raise ValueError('Invalid file extension. Must be .fastq, .fq, .fastq.gz, or .fq.gz')
        return v


class PresignedURLResponse(BaseModel):
    """Response with presigned URL"""
    upload_url: str
    fields: Dict[str, str]
    file_key: str
    expires_in: int


class AnalysisSubmitRequest(BaseModel):
    """Request to submit new analysis"""
    file_keys: List[str] = Field(..., description="List of S3 file keys")
    library_type: str = Field(..., description="Library type (genome-wide, focused, etc.)")
    sample_names: Optional[List[str]] = Field(None, description="Sample names")
    algorithm: str = Field("mageck", description="Analysis algorithm (mageck or bagel2)")
    parameters: Optional[Dict[str, Any]] = Field(None, description="Custom parameters")
    
    @validator('file_keys')
    def validate_file_keys(cls, v):
        if not v or len(v) == 0:
            raise ValueError('At least one file is required')
        return v
    
    @validator('algorithm')
    def validate_algorithm(cls, v):
        if v not in ['mageck', 'bagel2']:
            raise ValueError('Algorithm must be "mageck" or "bagel2"')
        return v


class AnalysisResponse(BaseModel):
    """Analysis response"""
    id: UUID
    user_id: Optional[str]
    file_keys: List[str]
    library_type: str
    sample_names: Optional[List[str]]
    algorithm: str
    parameters: Optional[Dict[str, Any]]
    status: str
    batch_job_id: Optional[str]
    progress: int
    current_step: Optional[str]
    error_message: Optional[str]
    results_s3_key: Optional[str]
    plots_s3_keys: Optional[Dict[str, str]]
    qc_metrics: Optional[Dict[str, Any]]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    compute_time: Optional[float]
    cost_estimate: Optional[float]
    
    class Config:
        from_attributes = True


class AnalysisStatusResponse(BaseModel):
    """Analysis status response"""
    id: UUID
    status: str
    progress: int
    current_step: Optional[str]
    error_message: Optional[str]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class AnalysisResultsResponse(BaseModel):
    """Analysis results response"""
    id: UUID
    status: str
    results_url: Optional[str]
    plots: Optional[Dict[str, str]]  # plot_type -> download_url
    qc_metrics: Optional[Dict[str, Any]]
    compute_time: Optional[float]


class WebSocketMessage(BaseModel):
    """WebSocket message format"""
    analysis_id: str
    status: str
    progress: int
    current_step: Optional[str]
    message: Optional[str]
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class HealthCheckResponse(BaseModel):
    """Health check response"""
    status: str
    service: str
    version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ApiKeyCreate(BaseModel):
    """API Key creation request"""
    name: str = "API Key"
    scopes: List[str] = ["*"]


class ApiKeyResponse(BaseModel):
    """API Key response (with full key)"""
    id: UUID
    name: str
    prefix: str
    scopes: List[str]
    created_at: datetime
    key: str  # Only returned once


class ApiKeyListResponse(BaseModel):
    """API Key list item (no full key)"""
    id: UUID
    name: str
    prefix: str
    scopes: List[str]
    created_at: datetime
    last_used_at: Optional[datetime]

    class Config:
        from_attributes = True

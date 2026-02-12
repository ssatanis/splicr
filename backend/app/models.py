"""SQLAlchemy database models"""
from sqlalchemy import Column, String, DateTime, Integer, JSON, Text, Float
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import uuid
from app.database import Base
import enum


from sqlalchemy import ForeignKey
from sqlalchemy.orm import relationship

class User(Base):
    """User model for authentication and profile"""
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    api_keys = relationship("ApiKey", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User {self.email}>"


class ApiKey(Base):
    """API Key model for programmatic access"""
    __tablename__ = "api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False, default="API Key")
    prefix = Column(String(32), nullable=False)  # sk_live_...
    hashed_key = Column(String(255), nullable=False, unique=True, index=True)
    scopes = Column(JSON, nullable=False, default=list)  # ["*"]
    last_used_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="api_keys")

    def __repr__(self):
        return f"<ApiKey {self.prefix}...>"

class AnalysisStatus(str, enum.Enum):
    """Analysis status enum"""
    CREATED = "CREATED"
    VALIDATING = "VALIDATING"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class Analysis(Base):
    """Analysis model for storing CRISPR screen analysis metadata"""
    __tablename__ = "analyses"
    
    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # User (for future authentication)
    user_id = Column(String, nullable=True, index=True)
    
    # Input files
    file_keys = Column(JSON, nullable=False)  # List of S3 keys
    library_type = Column(String, nullable=False)  # e.g., "genome-wide", "focused"
    sample_names = Column(JSON, nullable=True)  # List of sample names
    
    # Analysis configuration
    algorithm = Column(String, default="mageck")  # "mageck" or "bagel2"
    parameters = Column(JSON, nullable=True)  # Custom parameters
    
    # Status tracking
    status = Column(String, default=AnalysisStatus.CREATED.value, index=True)
    batch_job_id = Column(String, nullable=True, index=True)
    progress = Column(Integer, default=0)  # 0-100
    current_step = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Results
    results_s3_key = Column(String, nullable=True)
    plots_s3_keys = Column(JSON, nullable=True)  # Dict of plot type -> S3 key
    qc_metrics = Column(JSON, nullable=True)  # Quality control metrics
    
    # Timing
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Metadata
    compute_time = Column(Float, nullable=True)  # seconds
    cost_estimate = Column(Float, nullable=True)  # USD
    
    def __repr__(self):
        return f"<Analysis {self.id} - {self.status}>"
    
    def to_dict(self):
        """Convert to dictionary"""
        return {
            "id": str(self.id),
            "user_id": self.user_id,
            "file_keys": self.file_keys,
            "library_type": self.library_type,
            "sample_names": self.sample_names,
            "algorithm": self.algorithm,
            "parameters": self.parameters,
            "status": self.status,
            "batch_job_id": self.batch_job_id,
            "progress": self.progress,
            "current_step": self.current_step,
            "error_message": self.error_message,
            "results_s3_key": self.results_s3_key,
            "plots_s3_keys": self.plots_s3_keys,
            "qc_metrics": self.qc_metrics,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "compute_time": self.compute_time,
            "cost_estimate": self.cost_estimate
        }

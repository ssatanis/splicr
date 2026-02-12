"""API Key management endpoints"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from datetime import datetime
from uuid import UUID
import logging

from app.database import get_db
from app.models import User, ApiKey
from app.schemas import ApiKeyCreate, ApiKeyResponse, ApiKeyListResponse
from app.utils.auth import generate_api_key, get_api_key_hash
from app.dependencies import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/", response_model=ApiKeyResponse, status_code=201)
def create_api_key(
    data: ApiKeyCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generate a new API key.
    The key is returned ONLY ONCE in the response.
    """
    full_key = generate_api_key()
    hashed = get_api_key_hash(full_key)
    
    # Store safe display prefix (e.g., "sk_live_1234...abcd")
    safe_prefix = f"{full_key[:12]}...{full_key[-4:]}"
    
    api_key = ApiKey(
        user_id=current_user.id,
        name=data.name,
        prefix=safe_prefix,
        hashed_key=hashed,
        scopes=data.scopes
    )
    
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    
    logger.info(f"Generated API key {api_key.id} for user {current_user.id}")
    
    return ApiKeyResponse(
        id=api_key.id,
        name=api_key.name,
        prefix=api_key.prefix,
        scopes=api_key.scopes,
        created_at=api_key.created_at,
        key=full_key  # Include the full key only here
    )


@router.get("/", response_model=list[ApiKeyListResponse])
def list_api_keys(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List active API keys for current user"""
    keys = db.query(ApiKey).filter(
        ApiKey.user_id == current_user.id,
        ApiKey.revoked_at.is_(None)
    ).order_by(ApiKey.created_at.desc()).all()
    
    return keys


@router.delete("/{key_id}", status_code=204)
def revoke_api_key(
    key_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke an API key"""
    api_key = db.query(ApiKey).filter(
        ApiKey.id == key_id,
        ApiKey.user_id == current_user.id
    ).first()
    
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    
    if api_key.revoked_at:
        return # Already revoked
        
    api_key.revoked_at = datetime.utcnow()
    db.commit()
    
    logger.info(f"Revoked API key {key_id} for user {current_user.id}")
    return None

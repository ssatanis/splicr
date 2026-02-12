from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User, ApiKey
from app.utils.auth import decode_token, get_api_key_hash
from uuid import UUID
import logging

logger = logging.getLogger(__name__)

def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(None)
) -> User:
    """
    Authenticate user via Bearer token (JWT) or API Key.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    token = authorization.split(" ", 1)[1]
    
    # Check if this looks like an API key (sk_live_...)
    if token.startswith("sk_live_") or token.startswith("sk_test_"):
        # API Key authentication
        hashed = get_api_key_hash(token)
        api_key = db.query(ApiKey).filter(ApiKey.hashed_key == hashed).first()
        
        if not api_key:
            raise HTTPException(status_code=401, detail="Invalid API key")
            
        if api_key.revoked_at:
             raise HTTPException(status_code=401, detail="API key has been revoked")
             
        # Update usage stats (simplistic, better async)
        # api_key.last_used_at = datetime.utcnow()
        # db.commit() 
        # (Skipping update for GET requests to avoid DB write locking, or do it periodically)
        
        return api_key.user
        
    else:
        # JWT authentication
        user_id = decode_token(token)
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        try:
            uid = UUID(user_id)
        except ValueError:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user = db.query(User).filter(User.id == uid).first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user

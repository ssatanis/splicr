"""Main FastAPI application"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import get_settings
from app.database import engine, Base
from app.api.endpoints import ccs 
from app.api import upload, analysis, results, websocket, auth, reference_sets, api_keys
from app.schemas import HealthCheckResponse
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    debug=settings.DEBUG,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
    docs_url="/api/docs", # Custom docs URL as per root endpoint response
    redoc_url="/api/redoc",
)

# Set all CORS enabled origins
if settings.CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.get_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Include API routers
app.include_router(
    auth.router,
    prefix=f"{settings.API_V1_PREFIX}/auth",
    tags=["Auth"]
)
app.include_router(
    api_keys.router,
    prefix=f"{settings.API_V1_PREFIX}/api-keys",
    tags=["API Keys"]
)
app.include_router(
    upload.router,
    prefix=f"{settings.API_V1_PREFIX}/upload",
    tags=["Upload"]
)
app.include_router(
    analysis.router,
    prefix=f"{settings.API_V1_PREFIX}/analysis",
    tags=["Analysis"]
)
app.include_router(
    results.router,
    prefix=f"{settings.API_V1_PREFIX}/results",
    tags=["Results"]
)
app.include_router(
    ccs.router,
    prefix=f"{settings.API_V1_PREFIX}/ccs",
    tags=["CCS"]
)
app.include_router(
    websocket.router,
    prefix=f"{settings.API_V1_PREFIX}/ws",
    tags=["WebSocket"]
)
app.include_router(
    reference_sets.router,
    prefix=f"{settings.API_V1_PREFIX}",
    tags=["Reference Gene Sets"]
)


@app.get("/", response_class=JSONResponse)
async def root():
    """Root endpoint"""
    return {
        "service": settings.APP_NAME,
        "version": "1.0.0",
        "message": "From cuts to clarity - Production CRISPR screen analysis",
        "docs": "/api/docs",
        "health": "/health"
    }


@app.get("/health", response_model=HealthCheckResponse)
async def health_check():
    """
    Health check endpoint
    
    Returns service status and version information.
    Used by load balancers and monitoring systems.
    """
    return HealthCheckResponse(
        status="healthy",
        service=settings.APP_NAME,
        version="1.0.0",
        timestamp=datetime.utcnow()
    )


@app.get("/health/ready")
async def readiness_check():
    """
    Readiness check endpoint
    
    Checks if service is ready to accept requests.
    Verifies database connectivity and critical services.
    """
    try:
        from sqlalchemy import text
        from app.database import SessionLocal
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()
        
        return {
            "status": "ready",
            "database": "connected",
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Readiness check failed: {str(e)}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
        )


@app.get("/health/live")
async def liveness_check():
    """
    Liveness check endpoint
    
    Simple check to verify service is alive.
    Used by orchestration systems like Kubernetes.
    """
    return {
        "status": "alive",
        "timestamp": datetime.utcnow().isoformat()
    }


# Exception handlers
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler"""
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": "An unexpected error occurred"
        }
    )


# Startup event
@app.on_event("startup")
async def startup_event():
    """Application startup"""
    logger.info(f"Starting {settings.APP_NAME}")
    logger.info(f"Debug mode: {settings.DEBUG}")
    logger.info(f"Database: {settings.DATABASE_URL.split('@')[1] if '@' in settings.DATABASE_URL else 'configured'}")
    logger.info(f"S3 Bucket: {settings.S3_BUCKET_NAME}")
    logger.info(f"AWS Region: {settings.AWS_REGION}")


# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    """Application shutdown"""
    logger.info(f"Shutting down {settings.APP_NAME}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
        log_level="info"
    )

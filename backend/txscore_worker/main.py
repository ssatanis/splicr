from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from redis import Redis
from rq import Queue
from typing import List
import os
import uuid
import json

app = FastAPI(title="TxScore Worker API")

# Connect to Redis
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_conn = Redis.from_url(REDIS_URL)
q = Queue(connection=redis_conn)

class CalculateRequest(BaseModel):
    genes: List[str]
    cancer_type: str

@app.post("/api/txscore/calculate")
def calculate_txscore_endpoint(req: CalculateRequest):
    """Enqueue a job to calculate TxScores."""
    job = q.enqueue(
        "txscore_engine.calculate_txscore",
        args=(req.genes, req.cancer_type),
        job_timeout=600  # 10 minutes timeout
    )
    return {"job_id": job.get_id()}

@app.get("/api/txscore/status/{job_id}")
def get_job_status(job_id: str):
    """Check status of a calculation job."""
    job = q.fetch_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return {
        "job_id": job.get_id(),
        "status": job.get_status(),
        "enqueued_at": job.enqueued_at,
        "started_at": job.started_at,
        "ended_at": job.ended_at,
        "meta": job.meta
    }

@app.get("/api/txscore/result/{job_id}")
def get_job_result(job_id: str):
    """Get result of a completed job."""
    job = q.fetch_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if job.get_status() == "failed":
        raise HTTPException(status_code=400, detail="Job failed")
    
    if job.get_status() != "finished":
        return {"status": job.get_status(), "result": None}

    return {"status": "finished", "result": job.result}

@app.get("/")
def health_check():
    return {"status": "ok", "service": "txscore-worker"}

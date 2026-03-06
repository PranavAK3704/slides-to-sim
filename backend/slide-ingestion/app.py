"""
Slide Ingestion FastAPI Service
================================
REST API wrapping the ingestion pipeline.
Exposes endpoints for submitting a Google Slides URL and polling job status.
"""

import uuid
import logging
from pathlib import Path
from typing import Optional
from threading import Thread

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from dotenv import load_dotenv

from ingestion import ingest_presentation

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Slide Ingestion Service",
    description="Extract structured data from Google Slides presentations",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job store (replace with SQLite in Phase 8)
jobs: dict[str, dict] = {}


# ─── Request / Response Models ─────────────────────────────────────────────────

class IngestRequest(BaseModel):
    slides_url: str
    options: Optional[dict] = {}

class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: int
    current_phase: str
    result: Optional[dict] = None
    error: Optional[str] = None


# ─── Background Task ──────────────────────────────────────────────────────────

def run_ingestion(job_id: str, url: str):
    """Run ingestion pipeline in background thread."""
    try:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["current_phase"] = "Fetching slides from Google API"
        jobs[job_id]["progress"] = 10

        result = ingest_presentation(url, job_id)

        jobs[job_id]["status"] = "complete"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["current_phase"] = "Done"
        jobs[job_id]["result"] = result
        logger.info(f"Job {job_id} complete")

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}")
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
        jobs[job_id]["current_phase"] = "Failed"


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "slide-ingestion"}


@app.post("/ingest", response_model=JobStatus)
def ingest(request: IngestRequest, background_tasks: BackgroundTasks):
    """
    Submit a Google Slides URL for ingestion.
    Returns a job_id to poll for status.
    """
    job_id = str(uuid.uuid4())[:8]
    
    jobs[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "progress": 0,
        "current_phase": "Queued",
        "slides_url": request.slides_url,
        "result": None,
        "error": None,
    }
    
    background_tasks.add_task(run_ingestion, job_id, request.slides_url)
    logger.info(f"Created ingestion job {job_id} for {request.slides_url}")
    
    return JobStatus(**jobs[job_id])


@app.get("/jobs/{job_id}", response_model=JobStatus)
def get_job(job_id: str):
    """Poll job status."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return JobStatus(**jobs[job_id])


@app.get("/jobs/{job_id}/result")
def get_result(job_id: str):
    """Get full ingestion result (only available when status=complete)."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    
    job = jobs[job_id]
    if job["status"] != "complete":
        raise HTTPException(
            status_code=202, 
            detail=f"Job not complete yet. Status: {job['status']}"
        )
    
    return job["result"]


@app.get("/jobs")
def list_jobs():
    """List all jobs (for debugging)."""
    return [
        {"job_id": j["job_id"], "status": j["status"], "progress": j["progress"]}
        for j in jobs.values()
    ]


if __name__ == "__main__":
    import uvicorn
    import os
    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", 8001)), reload=True)

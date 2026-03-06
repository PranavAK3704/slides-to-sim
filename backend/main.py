"""
Main Orchestrator API
======================
Single FastAPI service that chains all pipeline phases:

POST /api/generate
  → Slide Ingestion
  → Vision Analysis
  → Instruction Parsing
  → Step Ordering
  → Simulation Generation
  (DOM Matching runs separately, needs target URL)

GET /api/jobs/{job_id}
GET /api/simulations/{sim_id}
"""

import os
import sys
import uuid
import json
import logging
import asyncio
from pathlib import Path
from typing import Optional
from threading import Thread
from datetime import datetime

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# Add service modules to path
sys.path.insert(0, str(Path(__file__).parent.parent / "slide-ingestion"))
sys.path.insert(0, str(Path(__file__).parent.parent / "vision-analysis"))
sys.path.insert(0, str(Path(__file__).parent.parent / "instruction-parser"))
sys.path.insert(0, str(Path(__file__).parent.parent / "simulation-generator"))

from ingestion import ingest_presentation
from vision import analyze_presentation
from parser import parse_and_order
from generator import build_simulation_config

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Slides-to-Sim API",
    description="Convert Google Slides training decks into interactive simulations",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Job + simulation store (Phase 8 migrates to SQLite)
jobs: dict[str, dict] = {}
simulations: dict[str, dict] = {}

OUTPUT_DIR = Path("./output")
OUTPUT_DIR.mkdir(exist_ok=True)
(OUTPUT_DIR / "slides").mkdir(exist_ok=True)
(OUTPUT_DIR / "simulations").mkdir(exist_ok=True)


# ─── Request Models ───────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    slides_url: str
    target_url: Optional[str] = None  # for DOM matching phase
    options: Optional[dict] = {}

class DOMMatchRequest(BaseModel):
    simulation_id: str
    target_url: str


# ─── Pipeline Phases ──────────────────────────────────────────────────────────

def update_job(job_id: str, **kwargs):
    if job_id in jobs:
        jobs[job_id].update(kwargs)


def run_pipeline(job_id: str, slides_url: str, target_url: Optional[str]):
    """Run full pipeline in background thread."""
    try:
        # Phase 1: Slide Ingestion
        update_job(job_id, status="processing", progress=10, 
                   current_phase="Ingesting slides from Google Slides")
        ingestion_result = ingest_presentation(slides_url, job_id)
        update_job(job_id, progress=30, current_phase="Analyzing slide visuals with Gemini Vision")
        
        # Phase 2: Vision Analysis
        vision_result = analyze_presentation(ingestion_result)
        update_job(job_id, progress=55, current_phase="Extracting and ordering workflow steps")
        
        # Phase 3+4: Instruction Parsing + Step Ordering
        workflow = parse_and_order(ingestion_result, vision_result)
        update_job(job_id, progress=75, current_phase="Generating simulation configuration")
        
        # Phase 6: Simulation Generation
        if target_url:
            workflow["target_url"] = target_url
        
        sim_config = build_simulation_config(workflow, ingestion_result)
        
        # Store simulation
        sim_id = sim_config["id"]
        simulations[sim_id] = sim_config
        
        # Save to disk
        sim_path = OUTPUT_DIR / "simulations" / f"{sim_id}.json"
        with open(sim_path, "w") as f:
            json.dump(sim_config, f, indent=2)
        
        update_job(job_id, 
                   status="complete", 
                   progress=100,
                   current_phase="Done",
                   simulation_id=sim_id)
        
        logger.info(f"✅ Job {job_id} → Simulation {sim_id} complete")
        
    except Exception as e:
        logger.error(f"Pipeline failed for job {job_id}: {e}", exc_info=True)
        update_job(job_id, status="error", current_phase="Failed", error=str(e))


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "slides-to-sim-api",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.post("/api/generate")
def generate(request: GenerateRequest, background_tasks: BackgroundTasks):
    """
    Submit a Google Slides URL to generate a simulation.
    Returns job_id for polling.
    """
    job_id = str(uuid.uuid4())[:8]
    
    jobs[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "progress": 0,
        "current_phase": "Queued",
        "slides_url": request.slides_url,
        "target_url": request.target_url,
        "simulation_id": None,
        "error": None,
        "created_at": datetime.utcnow().isoformat(),
    }
    
    background_tasks.add_task(
        run_pipeline, job_id, request.slides_url, request.target_url
    )
    
    logger.info(f"Created job {job_id} for {request.slides_url}")
    return jobs[job_id]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


@app.get("/api/simulations/{sim_id}")
def get_simulation(sim_id: str):
    """Get simulation config by ID."""
    # Check memory first
    if sim_id in simulations:
        return simulations[sim_id]
    
    # Check disk
    sim_path = OUTPUT_DIR / "simulations" / f"{sim_id}.json"
    if sim_path.exists():
        with open(sim_path) as f:
            sim = json.load(f)
            simulations[sim_id] = sim  # cache
            return sim
    
    raise HTTPException(status_code=404, detail="Simulation not found")


@app.get("/api/simulations")
def list_simulations():
    """List all generated simulations."""
    sims = []
    for path in (OUTPUT_DIR / "simulations").glob("*.json"):
        try:
            with open(path) as f:
                sim = json.load(f)
                sims.append({
                    "id": sim.get("id"),
                    "title": sim.get("title"),
                    "stepCount": sim.get("stepCount"),
                    "createdAt": sim.get("createdAt"),
                })
        except Exception:
            continue
    
    sims.sort(key=lambda s: s.get("createdAt", ""), reverse=True)
    return sims


@app.delete("/api/simulations/{sim_id}")
def delete_simulation(sim_id: str):
    """Delete a simulation."""
    simulations.pop(sim_id, None)
    sim_path = OUTPUT_DIR / "simulations" / f"{sim_id}.json"
    if sim_path.exists():
        sim_path.unlink()
        return {"deleted": True}
    raise HTTPException(status_code=404, detail="Simulation not found")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

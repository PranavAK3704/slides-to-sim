"""
Main Orchestrator API
======================
Single FastAPI service that chains all pipeline phases:

POST /api/generate
  → Slide Ingestion
  → Vision Analysis
  → Instruction Parsing + Step Ordering
  → DOM Matching (when target_url provided) — captures screenshots + hotspots
  → Simulation Generation

GET /api/jobs/{job_id}
GET /api/simulations/{sim_id}
GET /static/...  ← serves slide images and step screenshots
"""

import os
import sys
import uuid
import json
import sqlite3
import asyncio
import logging
from pathlib import Path
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# Add service modules to path
sys.path.insert(0, str(Path(__file__).parent / "slide-ingestion"))
sys.path.insert(0, str(Path(__file__).parent / "vision-analysis"))
sys.path.insert(0, str(Path(__file__).parent / "instruction-parser"))
sys.path.insert(0, str(Path(__file__).parent / "simulation-generator"))
sys.path.insert(0, str(Path(__file__).parent / "dom-matcher"))

from ingestion import ingest_presentation
from vision import analyze_presentation
from parser import parse_and_order
from generator import build_simulation_config
from dom_matcher import match_workflow as dom_match_workflow

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

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./output")).resolve()
OUTPUT_DIR.mkdir(exist_ok=True)
(OUTPUT_DIR / "slides").mkdir(exist_ok=True)
(OUTPUT_DIR / "simulations").mkdir(exist_ok=True)
(OUTPUT_DIR / "screenshots").mkdir(exist_ok=True)

# Serve slide images and step screenshots
app.mount("/static", StaticFiles(directory=str(OUTPUT_DIR)), name="static")

# ── SQLite job store (survives restarts) ──────────────────────────────────────
DB_PATH = OUTPUT_DIR / "jobs.db"

def _init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            job_id       TEXT PRIMARY KEY,
            status       TEXT,
            progress     INTEGER,
            current_phase TEXT,
            slides_url   TEXT,
            target_url   TEXT,
            simulation_id TEXT,
            error        TEXT,
            created_at   TEXT
        )
    """)
    con.commit()
    con.close()

_init_db()

def _job_to_dict(row) -> dict:
    keys = ["job_id","status","progress","current_phase","slides_url","target_url","simulation_id","error","created_at"]
    return dict(zip(keys, row))

def _load_job(job_id: str) -> Optional[dict]:
    con = sqlite3.connect(DB_PATH)
    row = con.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
    con.close()
    return _job_to_dict(row) if row else None

def _save_job(job: dict):
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        INSERT OR REPLACE INTO jobs
        (job_id,status,progress,current_phase,slides_url,target_url,simulation_id,error,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (
        job["job_id"], job["status"], job["progress"], job["current_phase"],
        job.get("slides_url"), job.get("target_url"), job.get("simulation_id"),
        job.get("error"), job.get("created_at"),
    ))
    con.commit()
    con.close()

# ── Supabase client (optional — only if env vars set) ─────────────────────────
_sb = None
def _get_supabase():
    global _sb
    if _sb is None:
        url  = os.getenv("SUPABASE_URL")
        key  = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_ANON_KEY")
        if url and key:
            try:
                from supabase import create_client
                _sb = create_client(url, key)
            except Exception as e:
                logger.warning(f"Supabase init failed: {e}")
    return _sb

def _push_sim_to_supabase(sim_config: dict, process_name: str = None, hub: str = None):
    sb = _get_supabase()
    if not sb:
        return
    try:
        sb.table("simulations").upsert({
            "id":           sim_config["id"],
            "title":        sim_config.get("title", "Untitled"),
            "process_name": process_name,
            "hub":          hub,
            "step_count":   sim_config.get("stepCount", len(sim_config.get("steps", []))),
            "steps_json":   sim_config.get("steps", []),
            "created_by":   "pipeline",
            "created_at":   sim_config.get("createdAt", datetime.utcnow().isoformat()),
        }).execute()
        logger.info(f"Sim {sim_config['id']} pushed to Supabase")
    except Exception as e:
        logger.error(f"Supabase push failed: {e}")

# In-memory cache (populated from SQLite on demand)
simulations: dict[str, dict] = {}


# ─── Request Models ───────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    slides_url:   str
    target_url:   Optional[str] = None
    process_name: Optional[str] = None
    hub:          Optional[str] = None
    options:      Optional[dict] = {}


# ─── Path → URL Helpers ───────────────────────────────────────────────────────

def path_to_static_url(abs_path: str) -> Optional[str]:
    """Convert a file path (relative or absolute) under OUTPUT_DIR to a /static/... URL."""
    try:
        rel = Path(abs_path).resolve().relative_to(OUTPUT_DIR)
        return f"/static/{rel.as_posix()}"
    except (ValueError, TypeError):
        return None


def annotate_slide_urls(ingestion_result: dict) -> None:
    """Add image_url to each slide in-place (absolute path → /static/... URL)."""
    for slide in ingestion_result.get("slides", []):
        if slide.get("image_path"):
            slide["image_url"] = path_to_static_url(slide["image_path"])


def annotate_step_urls(workflow: dict) -> None:
    """Add screenshot_url to each step in-place."""
    for step in workflow.get("steps", []):
        if step.get("screenshot_path"):
            step["screenshot_url"] = path_to_static_url(step["screenshot_path"])


# ─── Pipeline ─────────────────────────────────────────────────────────────────

def update_job(job_id: str, **kwargs):
    job = _load_job(job_id)
    if job:
        job.update(kwargs)
        _save_job(job)


def run_pipeline(job_id: str, slides_url: str, target_url: Optional[str], process_name: str = None, hub: str = None):
    """Run the full pipeline in a background thread."""
    try:
        # Phase 1: Slide Ingestion
        update_job(job_id, status="processing", progress=10,
                   current_phase="Fetching slides from Google Slides")
        ingestion_result = ingest_presentation(slides_url, job_id)
        annotate_slide_urls(ingestion_result)

        # Phase 2: Vision Analysis
        update_job(job_id, progress=30, current_phase="Analyzing slides with Gemini Vision")
        vision_result = analyze_presentation(ingestion_result)

        # Phase 3+4: Instruction Parsing + Step Ordering
        update_job(job_id, progress=50, current_phase="Extracting and ordering workflow steps")
        workflow = parse_and_order(ingestion_result, vision_result)

        # Phase 5: DOM Matching (only when target URL provided)
        if target_url:
            update_job(job_id, progress=65, current_phase="Capturing app screenshots with Playwright")
            screenshot_dir = OUTPUT_DIR / "screenshots" / job_id
            try:
                loop = asyncio.new_event_loop()
                try:
                    workflow = loop.run_until_complete(
                        dom_match_workflow(target_url, workflow, screenshot_dir)
                    )
                finally:
                    loop.close()
                annotate_step_urls(workflow)
                logger.info(f"DOM matching complete for job {job_id}")
            except Exception as e:
                logger.error(f"DOM matching failed (continuing without it): {e}")
                workflow["target_url"] = target_url

        # Phase 6: Simulation Generation
        update_job(job_id, progress=80, current_phase="Generating simulation configuration")
        sim_config = build_simulation_config(workflow, ingestion_result)

        # Store + persist
        sim_id = sim_config["id"]
        simulations[sim_id] = sim_config
        sim_path = OUTPUT_DIR / "simulations" / f"{sim_id}.json"
        with open(sim_path, "w") as f:
            json.dump(sim_config, f, indent=2)

        # Push to Supabase so frontend content page shows it immediately
        _push_sim_to_supabase(sim_config, process_name, hub)

        update_job(job_id, status="complete", progress=100,
                   current_phase="Done", simulation_id=sim_id)
        logger.info(f"Job {job_id} → Simulation {sim_id} complete")

    except Exception as e:
        logger.error(f"Pipeline failed for job {job_id}: {e}", exc_info=True)
        update_job(job_id, status="error", current_phase="Failed", error=str(e))


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "slides-to-sim-api", "version": "1.0.0"}


@app.post("/api/generate")
def generate(request: GenerateRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())[:8]
    job = {
        "job_id":        job_id,
        "status":        "pending",
        "progress":      0,
        "current_phase": "Queued",
        "slides_url":    request.slides_url,
        "target_url":    request.target_url,
        "simulation_id": None,
        "error":         None,
        "created_at":    datetime.utcnow().isoformat(),
    }
    _save_job(job)
    background_tasks.add_task(run_pipeline, job_id, request.slides_url, request.target_url, request.process_name, request.hub)
    logger.info(f"Created job {job_id}")
    return job


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = _load_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/simulations/{sim_id}")
def get_simulation(sim_id: str):
    if sim_id in simulations:
        return simulations[sim_id]
    sim_path = OUTPUT_DIR / "simulations" / f"{sim_id}.json"
    if sim_path.exists():
        with open(sim_path) as f:
            sim = json.load(f)
            simulations[sim_id] = sim
            return sim
    raise HTTPException(status_code=404, detail="Simulation not found")


@app.get("/api/simulations")
def list_simulations():
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
                    "domMatched": sim.get("domMatched", False),
                })
        except Exception:
            continue
    sims.sort(key=lambda s: s.get("createdAt", ""), reverse=True)
    return sims


@app.delete("/api/simulations/{sim_id}")
def delete_simulation(sim_id: str):
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

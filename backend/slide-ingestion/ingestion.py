"""
Slide Ingestion Service
=======================
Accepts a Google Slides URL, extracts all slide data using the Google Slides API,
downloads slide images as PNGs, and outputs structured JSON.

Output per slide:
{
    "slide_id": 1,
    "slide_index": 0,
    "image_path": "output/slides/job_xyz/slide_1.png",
    "title": "...",
    "body_text": "...",
    "description_text": "...",
    "speaker_notes": "...",
    "raw_shapes": [...]
}
"""

import os
import re
import json
import base64
import asyncio
import logging
from pathlib import Path
from typing import Optional

import aiofiles
import requests
from dotenv import load_dotenv
from googleapiclient.discovery import build
from PIL import Image
from io import BytesIO

load_dotenv()

logger = logging.getLogger(__name__)

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./output/slides"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ─── URL Parsing ──────────────────────────────────────────────────────────────

def extract_presentation_id(url: str) -> str:
    """
    Extract Google Slides presentation ID from various URL formats.
    Handles:
      - https://docs.google.com/presentation/d/PRESENTATION_ID/edit
      - https://docs.google.com/presentation/d/PRESENTATION_ID/pub
      - https://docs.google.com/presentation/d/PRESENTATION_ID
    """
    patterns = [
        r"/presentation/d/([a-zA-Z0-9_-]+)",
        r"id=([a-zA-Z0-9_-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    raise ValueError(f"Could not extract presentation ID from URL: {url}")


# ─── Google Slides API Client ─────────────────────────────────────────────────

def get_slides_service():
    """Build Google Slides API service using API key (no OAuth needed for public decks)."""
    if not GOOGLE_API_KEY:
        raise EnvironmentError("GOOGLE_API_KEY is not set in environment")
    return build("slides", "v1", developerKey=GOOGLE_API_KEY)


# ─── Shape Text Extraction ────────────────────────────────────────────────────

def extract_text_from_shape(shape: dict) -> str:
    """Extract plain text from a Google Slides shape's textContent."""
    text_content = shape.get("text", {})
    text_elements = text_content.get("textElements", [])
    parts = []
    for el in text_elements:
        text_run = el.get("textRun", {})
        content = text_run.get("content", "")
        if content.strip():
            parts.append(content.strip())
    return " ".join(parts).strip()


def classify_shape_role(shape: dict, slide_height: float) -> str:
    """
    Determine if a shape is title, body, or description.
    
    Heuristics:
    - Title: placeholder type TITLE or CENTERED_TITLE
    - Description: shape positioned in bottom 25% of slide
    - Body: everything else
    """
    placeholder = shape.get("placeholder", {})
    p_type = placeholder.get("type", "")
    
    if p_type in ("TITLE", "CENTERED_TITLE"):
        return "title"
    
    # Check vertical position
    transform = shape.get("transform", {})
    translate_y = transform.get("translateY", 0)
    
    # EMU: 914400 per inch, typical slide height = 6858000 EMU
    if slide_height > 0 and translate_y > slide_height * 0.70:
        return "description"
    
    return "body"


# ─── Slide Image Download ─────────────────────────────────────────────────────

def download_slide_image(presentation_id: str, slide_index: int, job_dir: Path) -> Optional[str]:
    """
    Download slide thumbnail using Google Slides API thumbnail endpoint.
    Returns local file path or None on failure.
    """
    if not GOOGLE_API_KEY:
        logger.warning("No API key; skipping image download")
        return None
    
    url = (
        f"https://slides.googleapis.com/v1/presentations/{presentation_id}"
        f"/pages/{slide_index + 1}/thumbnail"
        f"?key={GOOGLE_API_KEY}"
        f"&thumbnailProperties.thumbnailSize=LARGE"
    )
    
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        
        thumbnail_url = data.get("contentUrl")
        if not thumbnail_url:
            logger.error(f"No contentUrl in thumbnail response for slide {slide_index}")
            return None
        
        # Download the actual image
        img_resp = requests.get(thumbnail_url, timeout=30)
        img_resp.raise_for_status()
        
        # Save as PNG
        img = Image.open(BytesIO(img_resp.content))
        img_path = job_dir / f"slide_{slide_index + 1}.png"
        img.save(img_path, "PNG")
        
        logger.info(f"✅ Saved slide {slide_index + 1} → {img_path}")
        return str(img_path)
        
    except Exception as e:
        logger.error(f"Failed to download slide {slide_index + 1} image: {e}")
        return None


def image_to_base64(image_path: str) -> Optional[str]:
    """Convert PNG to base64 string for Gemini Vision API."""
    try:
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    except Exception as e:
        logger.error(f"Failed to encode image {image_path}: {e}")
        return None


# ─── Speaker Notes Extraction ─────────────────────────────────────────────────

def extract_speaker_notes(slide: dict) -> Optional[str]:
    """Extract speaker notes from slide notesPage."""
    slide_properties = slide.get("slideProperties", {})
    notes_page = slide_properties.get("notesPage", {})
    page_elements = notes_page.get("pageElements", [])
    
    notes_parts = []
    for element in page_elements:
        shape = element.get("shape", {})
        placeholder = shape.get("placeholder", {})
        if placeholder.get("type") == "BODY":
            text = extract_text_from_shape(shape)
            if text:
                notes_parts.append(text)
    
    return " ".join(notes_parts).strip() or None


# ─── Main Ingestion Function ──────────────────────────────────────────────────

def ingest_presentation(url: str, job_id: str) -> dict:
    """
    Full ingestion pipeline for a Google Slides presentation.
    
    Returns:
        {
            "job_id": str,
            "presentation_id": str,
            "title": str,
            "slide_count": int,
            "slides": [SlideData, ...]
        }
    """
    presentation_id = extract_presentation_id(url)
    logger.info(f"Ingesting presentation: {presentation_id}")
    
    # Create job output directory
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    # Fetch presentation data
    service = get_slides_service()
    presentation = service.presentations().get(
        presentationId=presentation_id
    ).execute()
    
    deck_title = presentation.get("title", "Untitled Presentation")
    slides = presentation.get("slides", [])
    
    # Get slide dimensions for position heuristics
    page_size = presentation.get("pageSize", {})
    slide_height = page_size.get("height", {}).get("magnitude", 6858000)
    
    logger.info(f"Found {len(slides)} slides in '{deck_title}'")
    
    results = []
    
    for idx, slide in enumerate(slides):
        slide_data = _process_slide(
            slide=slide,
            slide_index=idx,
            slide_height=slide_height,
            presentation_id=presentation_id,
            job_dir=job_dir,
        )
        results.append(slide_data)
        logger.info(f"Processed slide {idx + 1}/{len(slides)}")
    
    output = {
        "job_id": job_id,
        "presentation_id": presentation_id,
        "source_url": url,
        "title": deck_title,
        "slide_count": len(slides),
        "slides": results,
    }
    
    # Save output JSON
    output_path = job_dir / "ingestion_result.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)
    
    logger.info(f"✅ Ingestion complete → {output_path}")
    return output


def _process_slide(
    slide: dict,
    slide_index: int,
    slide_height: float,
    presentation_id: str,
    job_dir: Path,
) -> dict:
    """Process a single slide and return structured data."""
    
    page_elements = slide.get("pageElements", [])
    
    title_parts = []
    body_parts = []
    description_parts = []
    all_shapes = []
    
    for element in page_elements:
        shape = element.get("shape")
        if not shape:
            continue
        
        text = extract_text_from_shape(shape)
        if not text:
            continue
        
        role = classify_shape_role(shape, slide_height)
        
        if role == "title":
            title_parts.append(text)
        elif role == "description":
            description_parts.append(text)
        else:
            body_parts.append(text)
        
        all_shapes.append({
            "role": role,
            "text": text,
            "shape_type": shape.get("shapeType", ""),
            "placeholder_type": shape.get("placeholder", {}).get("type", ""),
        })
    
    # Download slide image
    image_path = download_slide_image(presentation_id, slide_index, job_dir)
    image_b64 = image_to_base64(image_path) if image_path else None
    
    # Extract speaker notes
    speaker_notes = extract_speaker_notes(slide)
    
    return {
        "slide_id": slide_index + 1,
        "slide_index": slide_index,
        "image_path": image_path,
        "image_base64": image_b64,
        "title": " | ".join(title_parts) or None,
        "body_text": "\n".join(body_parts) or None,
        "description_text": "\n".join(description_parts) or None,
        "speaker_notes": speaker_notes,
        "raw_shapes": all_shapes,
    }


# ─── CLI Entry Point ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import uuid
    
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    
    if len(sys.argv) < 2:
        print("Usage: python ingestion.py <google_slides_url>")
        sys.exit(1)
    
    url = sys.argv[1]
    job_id = str(uuid.uuid4())[:8]
    
    result = ingest_presentation(url, job_id)
    print(json.dumps(result, indent=2, default=str))

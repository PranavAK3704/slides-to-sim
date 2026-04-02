"""
Vision Analysis Engine — Gemini Vision First
=============================================
Sends each slide image to Gemini Vision. Gemini returns:
  - slide_type: instructional / informational / title
  - steps[]: each with hotspot % coords, element label, action, instruction
  - Ordering from: numbered boxes > reading order > text hint > slide order

No OpenCV. No Tesseract. No Playwright.
The slide image IS the simulation background.
"""

import os
import re
import json
import logging
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


# ─── Gemini Client ─────────────────────────────────────────────────────────────

def _get_model():
    import google.generativeai as genai
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel("gemini-1.5-flash")


# ─── Prompt ───────────────────────────────────────────────────────────────────

VISION_PROMPT = """You are analyzing a software training slide image.

Identify every UI interaction step shown on this slide.

--- HOW TO DETECT STEPS ---

Look for visual annotations in this priority order:
1. NUMBERED colored boxes/circles (e.g. red box with "1", orange circle with "2") → MOST RELIABLE, gives you explicit step order
2. UNNUMBERED colored boxes/borders around UI elements → use top-left to bottom-right reading order
3. ARROWS or lines pointing at elements → arrow tip = target element
4. CIRCLES or ovals drawn around elements
5. CURSOR/POINTER icon placed on an element
6. NO VISUAL ANNOTATION → read the bottom instruction text and locate the described element visually in the screenshot

--- BOUNDING BOX RULES ---

For the hotspot:
- Use the bounding box of the HIGHLIGHTED/ANNOTATED AREA (the red box, arrow, circle, etc.)
- If annotation_type is "none", use the bounding box of the UI element described in the text
- Express ALL coordinates as PERCENTAGES of image dimensions (0.0 to 100.0)
- xPct = left edge %, yPct = top edge %, widthPct = width %, heightPct = height %
- Be precise — the hotspot is what the user will click in the simulation

--- EDGE CASES ---

- Multiple numbered boxes on one slide → return ALL as separate steps ordered by their numbers
- Multiple unnumbered highlights → order top-left first, bottom-right last
- Step text at bottom says "Click X" but no annotation → set annotation_type="none", locate X visually, confidence ≤ 0.6
- Purely informational slide (no UI actions) → set slide_type="informational", return empty steps array
- Title/section break slide → set slide_type="title", return empty steps array

--- BOTTOM TEXT ---

Many training slides have instruction text at the bottom (often smaller font, sometimes a description area).
Always extract this as bottom_text — it's often the most reliable source of what action to perform.

--- RESPOND WITH JSON ONLY (no markdown, no backticks) ---

{
  "slide_type": "instructional",
  "steps": [
    {
      "order": 1,
      "order_source": "numbered_box",
      "annotation_type": "numbered_box",
      "element_label": "Inventory",
      "element_type": "tab",
      "action": "click",
      "value": null,
      "hotspot": {
        "xPct": 12.5,
        "yPct": 28.3,
        "widthPct": 9.2,
        "heightPct": 5.1
      },
      "instruction": "Click the Inventory tab",
      "confidence": 0.95
    }
  ],
  "bottom_text": "Click the Inventory tab to navigate to stock management",
  "analysis_notes": "One numbered red box. High confidence."
}

Valid values:
  order_source: "numbered_box" | "reading_order" | "text_hint" | "inferred"
  annotation_type: "numbered_box" | "box" | "arrow" | "circle" | "cursor" | "underline" | "none"
  element_type: "button" | "tab" | "input" | "dropdown" | "link" | "menu" | "icon" | "checkbox" | "unknown"
  action: "click" | "type" | "select" | "hover" | "scroll" | "verify"
  slide_type: "instructional" | "informational" | "title"
"""


# ─── Single Slide Analysis ─────────────────────────────────────────────────────

def analyze_slide(slide_data: dict) -> dict:
    """
    Analyze one slide image with Gemini Vision.
    Returns structured steps with hotspot % coordinates.
    """
    slide_id = slide_data.get("slide_id", 0)
    image_base64 = slide_data.get("image_base64")

    if not GEMINI_API_KEY:
        logger.warning(f"Slide {slide_id}: No Gemini API key — returning empty")
        return _empty_result(slide_id, "no_api_key")

    if not image_base64:
        logger.warning(f"Slide {slide_id}: No image data")
        return _empty_result(slide_id, "no_image")

    try:
        model = _get_model()
        image_part = {"mime_type": "image/png", "data": image_base64}

        response = model.generate_content([VISION_PROMPT, image_part])
        raw = response.text.strip()

        # Strip markdown fences if Gemini wraps anyway
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
            raw = raw.strip()

        parsed = json.loads(raw)

        steps = parsed.get("steps", [])
        slide_type = parsed.get("slide_type", "instructional")

        # Enrich each step: use bottom_text to improve weak instructions
        bottom_text = parsed.get("bottom_text", "")
        for step in steps:
            if bottom_text and (not step.get("instruction") or len(step.get("instruction", "")) < 8):
                step["instruction"] = bottom_text
            # Validate hotspot exists and has required keys
            hs = step.get("hotspot")
            if hs and not all(k in hs for k in ("xPct", "yPct", "widthPct", "heightPct")):
                step["hotspot"] = None

        logger.info(
            f"Slide {slide_id}: type={slide_type}, {len(steps)} steps, "
            f"method=gemini"
        )

        return {
            "slide_id": slide_id,
            "slide_type": slide_type,
            "steps": steps,
            "bottom_text": bottom_text,
            "analysis_notes": parsed.get("analysis_notes", ""),
            "analysis_method": "gemini",
        }

    except json.JSONDecodeError as e:
        logger.error(f"Slide {slide_id}: Gemini returned invalid JSON — {e}")
        # Try to salvage bottom_text at least
        return _empty_result(slide_id, "gemini_json_error")

    except Exception as e:
        logger.error(f"Slide {slide_id}: Gemini Vision failed — {e}")
        return _empty_result(slide_id, "gemini_error")


# ─── Full Presentation Analysis ───────────────────────────────────────────────

def analyze_presentation(ingestion_result: dict) -> dict:
    """
    Run vision analysis on all slides.
    Returns per-slide analysis results.
    """
    slides = ingestion_result.get("slides", [])
    logger.info(f"Analyzing {len(slides)} slides with Gemini Vision")

    slide_analyses = []
    for slide in slides:
        result = analyze_slide(slide)
        # Carry forward slide metadata needed by later pipeline stages
        result["image_url"] = slide.get("image_url") or slide.get("image_path")
        result["title"] = slide.get("title", "")
        result["body_text"] = slide.get("body_text", "")
        result["description_text"] = slide.get("description_text", "")
        result["speaker_notes"] = slide.get("speaker_notes", "")
        slide_analyses.append(result)

    return {
        "job_id": ingestion_result.get("job_id"),
        "presentation_id": ingestion_result.get("presentation_id"),
        "title": ingestion_result.get("title"),
        "slide_analyses": slide_analyses,
    }


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _empty_result(slide_id: int, method: str) -> dict:
    return {
        "slide_id": slide_id,
        "slide_type": "unknown",
        "steps": [],
        "bottom_text": "",
        "analysis_notes": "",
        "analysis_method": method,
    }


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 2:
        print("Usage: python vision.py <ingestion_result.json>")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        ingestion = json.load(f)

    result = analyze_presentation(ingestion)
    print(json.dumps(result, indent=2))

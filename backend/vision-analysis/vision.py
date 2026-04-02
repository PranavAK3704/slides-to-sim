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

VISION_PROMPT = """You are analyzing a software training slide image. The slide contains a screenshot of a web application with visual annotations showing which UI elements to click.

Your job: extract every numbered step shown on this slide as a structured action with a precise hotspot location.

--- WHAT TO LOOK FOR (in priority order) ---

1. NUMBERED BADGES/CIRCLES — small red, orange, or dark circles or squares containing a digit (1, 2, 3...) placed directly ON or NEXT TO a UI element. These are the most common annotation style. The number tells you the click order. The hotspot = the UI element the badge is touching or pointing to.

2. NUMBERED BOXES — a rectangle drawn around a UI element with a number label. Hotspot = the rectangle area.

3. UNNUMBERED HIGHLIGHT BOXES — colored borders or rectangles around UI elements without numbers. Order = top-left to bottom-right.

4. ARROWS — arrow tip points to target. Hotspot = the element at the arrow tip.

5. BOTTOM INSTRUCTION BOX — many slides have a bordered text box at the bottom (often red/pink border) stating the instruction like "Go to Inventory(1). Click Exceptions(2)." Always extract this text. Use the numbers in parentheses to match badges to their instructions.

6. NO ANNOTATION — if only bottom text exists, locate the described element visually in the screenshot and create a step for it (confidence ≤ 0.6).

--- CRITICAL RULES ---

- A slide containing a web app screenshot WITH any numbered badges/circles IS instructional — never mark it informational.
- Only mark slide_type="informational" if the slide is PURELY text/diagram with zero UI screenshot and zero action annotations.
- Only mark slide_type="title" if it's a plain title/cover slide with no screenshot.
- WHEN IN DOUBT, mark as instructional and extract what you can.
- For each numbered badge, create ONE step. The hotspot must cover the ACTUAL UI ELEMENT being highlighted (the tab, button, field), NOT the badge circle itself.
- Parse the bottom instruction text to write a clear human-readable instruction for each step.

--- HOTSPOT COORDINATES ---

- Express as PERCENTAGES of the full image (0.0 to 100.0)
- xPct = left edge %, yPct = top edge %, widthPct = width %, heightPct = height %
- Make the hotspot cover the full clickable element (e.g. the whole tab or button), not just the badge

--- RESPOND WITH JSON ONLY — no markdown, no backticks, no explanation ---

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
        "xPct": 5.2,
        "yPct": 34.1,
        "widthPct": 8.4,
        "heightPct": 4.2
      },
      "instruction": "Click the Inventory tab",
      "confidence": 0.95
    },
    {
      "order": 2,
      "order_source": "numbered_box",
      "annotation_type": "numbered_box",
      "element_label": "Exceptions",
      "element_type": "tab",
      "action": "click",
      "value": null,
      "hotspot": {
        "xPct": 55.1,
        "yPct": 28.5,
        "widthPct": 9.0,
        "heightPct": 4.0
      },
      "instruction": "Click on Exceptions",
      "confidence": 0.95
    }
  ],
  "bottom_text": "For Misroute Shipments, Go to Inventory(1). Click on Exceptions(2).",
  "analysis_notes": "Two numbered red badge circles visible on slide."
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

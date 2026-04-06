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
import base64
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

VISION_PROMPT = """You are analyzing a software training slide. Your job is to identify every UI action a learner must perform and return them as structured steps with precise hotspot locations.

=== STEP 1: CLASSIFY THE SLIDE ===

slide_type = "instructional"  → slide shows a UI screenshot with actions to perform
slide_type = "informational"  → purely text/diagram, no UI screenshot, nothing to click
slide_type = "title"          → cover/section-break slide, no content

DEFAULT TO "instructional" whenever you see a UI screenshot. Only use "informational" or "title" when there is clearly no interactive element at all.

=== STEP 2: FIND ANNOTATIONS (any style, any color) ===

Trainers annotate slides in many different ways. Look for ALL of these:

A) NUMBERED MARKERS — any small shape (circle, square, badge, label) containing a digit placed on or near a UI element. Color doesn't matter: red, orange, yellow, blue, black. The NUMBER gives you the step order.

B) HIGHLIGHT BOXES / BORDERS — any rectangle, outline, or border drawn around a UI element. Any color. If numbered → use the number. If not → use reading order (top-left first).

C) ARROWS / LINES — tip of arrow points to the target element.

D) HIGHLIGHTS / UNDERLINES — colored highlight or underline on text/element.

E) CURSOR ICON — a mouse cursor graphic placed on an element.

F) BOTTOM INSTRUCTION TEXT — a text area (often bordered) at the bottom of the slide containing the written instruction. It may reference steps by number in parentheses like "(1)" or "(2)". ALWAYS extract this — it is the most reliable source of what to do.

G) NO VISUAL ANNOTATION — if the slide has a UI screenshot and instruction text but no visual markers, locate the described element visually from the text and create a step (confidence 0.5).

=== STEP 3: BUILD HOTSPOT FOR EACH STEP ===

The hotspot must cover the ACTUAL UI ELEMENT to interact with (the button, tab, field, link), NOT the annotation marker itself.

- Use the annotation only to IDENTIFY which element is being highlighted
- Then draw the bounding box around that element
- Coordinates are PERCENTAGES of the full image: xPct, yPct = top-left corner; widthPct, heightPct = size
- Be precise — this is what the learner will click in the simulation

=== STEP 4: WRITE THE INSTRUCTION ===

Use the bottom instruction text as the primary source. If absent, write a short imperative: "Click [element label]", "Select [option]", "Type in [field name]".

=== OUTPUT — JSON ONLY, no markdown, no backticks ===

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
      "hotspot": { "xPct": 5.2, "yPct": 34.1, "widthPct": 8.4, "heightPct": 4.2 },
      "instruction": "Go to Inventory",
      "confidence": 0.95,
      "elementText": "Inventory",
      "urlPattern": "inventory",
      "isSafeAction": true
    }
  ],
  "bottom_text": "For Misroute Shipments, Go to Inventory(1). Click on Exceptions(2).",
  "analysis_notes": "Brief note on what was found and confidence level."
}

order_source: "numbered_box" | "reading_order" | "text_hint" | "inferred"
annotation_type: "numbered_box" | "box" | "arrow" | "circle" | "highlight" | "underline" | "cursor" | "none"
element_type: "button" | "tab" | "input" | "dropdown" | "link" | "menu" | "icon" | "checkbox" | "unknown"
action: "click" | "type" | "select" | "hover" | "scroll" | "verify"
slide_type: "instructional" | "informational" | "title"

=== RULES FOR elementText / urlPattern / isSafeAction ===

elementText — the EXACT text a user sees on the button, tab, or link. Strip everything else:
  - "Go to Inventory(1)"  →  elementText = "Inventory"
  - "Click on Exceptions(2)"  →  elementText = "Exceptions"
  - "Click the + Create button"  →  elementText = "+ Create" or "Create"
  No parentheses. No step numbers. No verbs like "Go to" or "Click on".
  This must literally match the DOM text the user would read on screen.

urlPattern — a URL fragment visible in the UI (tab labels, breadcrumbs, page title, sidebar
  active item, or any URL segment shown). Keep it short: "sc-overview", "rto/dashboard",
  "inventory", "exceptions". Use "" if you cannot determine it.

isSafeAction — true for read-only navigation (clicking tabs, opening pages, viewing data,
  using search/filters). false for any write operation (Save, Submit, Create, Bag, Receive,
  Complete, Confirm, Dispatch, Delete, Upload). Default to false when unsure — safer to
  intercept than to accidentally submit real data.
elementText: the EXACT visible text of the element — must match what a user would read on screen (this is used for DOM text matching on the live app)
urlPattern: a short string that should appear in the browser URL when on this page (e.g. "rto", "forward", "exceptions", "dashboard") — use "" if unknown
isSafeAction: true if the action only navigates or reads data; false if it creates, submits, updates, or deletes records
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
        # Gemini expects raw bytes, not a base64 string
        image_bytes = base64.b64decode(image_base64)
        image_part = {"mime_type": "image/png", "data": image_bytes}

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
        logger.error(f"Slide {slide_id}: Gemini returned invalid JSON — {e}\nRaw: {raw[:300]}")
        return _empty_result(slide_id, "gemini_json_error")

    except Exception as e:
        logger.error(f"Slide {slide_id}: Gemini Vision failed — {type(e).__name__}: {e}")
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

        # If Gemini errored AND body_text has content, inject it as bottom_text fallback
        # so the parser can still synthesize steps from the instruction text
        if result["analysis_method"] in ("gemini_error", "gemini_json_error", "no_image"):
            body = slide.get("body_text", "") or slide.get("description_text", "") or ""
            if body.strip():
                result["bottom_text"] = body.strip()
                logger.info(f"Slide {slide['slide_id']}: Gemini failed — injecting body_text as fallback")

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

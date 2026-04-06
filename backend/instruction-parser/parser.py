"""
Instruction Parser + Step Ordering Engine
==========================================
Now that vision.py extracts steps WITH hotspot coordinates directly from slide images,
this module just needs to:

1. Flatten per-slide vision steps into a single global list
2. Enrich instructions using slide text where Gemini was weak
3. Assign global ordering (vision ordering within slide, slide index across slides)
4. Skip informational/title slides
5. Flag low-confidence steps for human review

No heavy Gemini text parsing needed here anymore.
"""

import os
import uuid
import logging
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Confidence threshold below which a step gets flagged for review
REVIEW_THRESHOLD = 0.6


def _enrich_instruction(step: dict, slide: dict) -> str:
    """
    If Gemini's instruction is weak/short, try to build a better one
    from the slide's bottom_text or description_text.
    """
    instruction = step.get("instruction", "").strip()
    if instruction and len(instruction) > 10:
        return instruction

    # Fallbacks in priority order
    bottom_text = slide.get("bottom_text", "").strip()
    description = slide.get("description_text", "").strip()
    label = step.get("element_label", "")
    action = step.get("action", "click")

    if bottom_text and len(bottom_text) > 5:
        return bottom_text
    if description and len(description) > 5:
        return description
    if label:
        return f"{action.capitalize()} {label}"
    return instruction or "Follow the highlighted step"


def parse_and_order(ingestion_result: dict, vision_result: dict) -> dict:
    """
    Flatten and globally order all steps from vision analysis.

    Ordering logic:
      - Within a slide: use step["order"] from vision (respects numbered boxes)
      - Across slides: use slide index (slide 1 before slide 2)
      - Informational/title slides produce no steps

    Returns a workflow dict ready for the simulation generator.
    """
    slides = ingestion_result.get("slides", [])
    slide_analyses = vision_result.get("slide_analyses", [])

    # Build lookup: slide_id → slide metadata
    slide_meta = {s.get("slide_id"): s for s in slides}

    all_steps = []
    global_counter = 1

    for slide_index, slide_analysis in enumerate(slide_analyses):
        slide_id = slide_analysis.get("slide_id")
        slide_type = slide_analysis.get("slide_type", "instructional")
        steps = slide_analysis.get("steps", [])

        # Always skip the first slide (cover/title) and any slide Gemini classifies as title
        if slide_index == 0 or slide_type == "title":
            logger.info(f"Slide {slide_id} (index {slide_index}): skipping — title/cover slide")
            continue

        # If Gemini returned no steps but there's bottom text, synthesize a fallback step
        if not steps:
            bottom_text = slide_analysis.get("bottom_text", "").strip()
            if bottom_text and slide_type != "title":
                logger.info(f"Slide {slide_id}: no steps from vision, synthesizing from bottom_text")
                steps = [{
                    "order": 1,
                    "order_source": "text_hint",
                    "annotation_type": "none",
                    "element_label": "",
                    "element_type": "unknown",
                    "action": "click",
                    "value": None,
                    "hotspot": None,
                    "instruction": bottom_text,
                    "confidence": 0.4,
                }]
            else:
                logger.info(f"Slide {slide_id}: {slide_type} — skipping (no steps, no bottom text)")
                continue

        meta = slide_meta.get(slide_id, {})
        image_url = slide_analysis.get("image_url")

        # Sort steps within this slide by their vision-assigned order
        steps_sorted = sorted(steps, key=lambda s: s.get("order", 99))

        for step in steps_sorted:
            enriched_instruction = _enrich_instruction(step, {
                **meta,
                "bottom_text": slide_analysis.get("bottom_text", ""),
            })

            confidence = step.get("confidence", 0.5)
            needs_review = (
                confidence < REVIEW_THRESHOLD
                or step.get("annotation_type") == "none"
                or not step.get("hotspot")
            )

            all_steps.append({
                "step": global_counter,
                "action": step.get("action", "click"),
                "target": step.get("element_label", ""),
                "value": step.get("value"),
                "instruction": enriched_instruction,
                "hint": _build_hint(step),
                # Hotspot in % format from Gemini — ready for frontend
                "hotspot": step.get("hotspot"),
                # Slide image as simulation background
                "slide_image_url": image_url,
                "source_slide_id": slide_id,
                "ordering_method": step.get("order_source", "inferred"),
                "annotation_type": step.get("annotation_type", "unknown"),
                "confidence": confidence,
                "needs_review": needs_review,
                # Live overlay fields — extracted by Gemini, editable in review UI
                "element_text": step.get("elementText") or step.get("element_label", ""),
                "url_pattern": step.get("urlPattern", ""),
                "is_safe_action": step.get("isSafeAction", True),
            })
            global_counter += 1

    logger.info(
        f"Assembled {len(all_steps)} steps from {len(slide_analyses)} slides "
        f"({sum(1 for s in all_steps if s['needs_review'])} flagged for review)"
    )

    return {
        "simulation_id": str(uuid.uuid4())[:8],
        "title": ingestion_result.get("title", "Untitled Simulation"),
        "source_url": ingestion_result.get("source_url", ""),
        "presentation_id": ingestion_result.get("presentation_id", ""),
        "created_at": datetime.utcnow().isoformat(),
        "step_count": len(all_steps),
        "steps": all_steps,
    }


def _build_hint(step: dict) -> str:
    annotation = step.get("annotation_type", "none")
    label = step.get("element_label", "the element")
    action = step.get("action", "click")
    element_type = step.get("element_type", "element")

    if annotation in ("numbered_box", "box"):
        return f"Look for the highlighted {element_type} labeled '{label}'"
    if annotation == "arrow":
        return f"Follow the arrow — it points to '{label}'"
    if annotation in ("circle", "underline"):
        return f"The circled/underlined area shows '{label}'"
    if action == "type":
        return f"Click the input field, then type the required value"
    if action == "select":
        return f"Click the dropdown and choose from the available options"
    return f"Find '{label}' on the screen and {action} it"


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import json

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 3:
        print("Usage: python parser.py <ingestion.json> <vision.json>")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        ingestion = json.load(f)
    with open(sys.argv[2]) as f:
        vision = json.load(f)

    result = parse_and_order(ingestion, vision)
    print(json.dumps(result, indent=2))

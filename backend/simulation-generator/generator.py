"""
Simulation Generator
====================
Converts the ordered workflow into the final SimulationConfig JSON
consumed by the Training Player frontend.

Each step includes:
  - instruction + hint
  - hotspot (% coords from Gemini Vision — ready for spotlight overlay)
  - slideImage (URL to slide PNG served via /static/...)
  - hindiInstruction (Gemini-translated)
  - needsReview flag (low confidence steps flagged for human review)
"""

import os
import re
import json
import uuid
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./output")).resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
(OUTPUT_DIR / "simulations").mkdir(exist_ok=True)


def _translate_to_hindi(instructions: list[str]) -> list[str]:
    """
    Batch-translate step instructions to Hindi.
    UI element names are kept in English.
    Falls back to original on error.
    """
    if not GEMINI_API_KEY or not instructions:
        return instructions
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")

        numbered = "\n".join(f"{i+1}. {inst}" for i, inst in enumerate(instructions))
        prompt = (
            "Translate these software training instructions to Hindi (Devanagari script). "
            "Keep all UI element names, button labels, and menu names in English. "
            "Return ONLY the numbered translations in exactly the same numbered format:\n\n"
            + numbered
        )
        resp = model.generate_content(prompt)
        lines = [l.strip() for l in resp.text.strip().split("\n") if l.strip()]
        translations = [re.sub(r"^\d+[\.\)]\s*", "", l) for l in lines]

        if len(translations) == len(instructions):
            logger.info(f"Translated {len(translations)} instructions to Hindi")
            return translations
    except Exception as e:
        logger.warning(f"Hindi translation failed: {e}")
    return instructions


def _extract_element_text(instruction: str) -> str:
    """
    Parse elementText from instruction when Gemini left it blank.
    Handles patterns like:
      "Go to Inventory(1)"       → "Inventory"
      "Click on Exceptions(2)"   → "Exceptions"
      "Click Create Manifest(6)" → "Create Manifest"
      "Click Yes(9)"             → "Yes"
    Returns the first match, or empty string if none found.
    """
    if not instruction:
        return ""
    pattern = r'(?:go to|click on|click|select|tap)\s+([A-Za-z][A-Za-z0-9 /\-]+?)\s*\(\d+\)'
    m = re.search(pattern, instruction, re.IGNORECASE)
    if m:
        text = m.group(1).strip()
        # Skip generic words that aren't real UI elements
        skip = {'all', 'the', 'it', 'this', 'that', 'here'}
        if text.lower() not in skip and len(text) > 1:
            return text
    return ""


def build_simulation_config(
    workflow: dict,
    ingestion_result: dict = None,
) -> dict:
    """
    Build the final SimulationConfig.

    Hotspots come from Gemini Vision (already % format).
    Slide images are the simulation background — no DOM matching needed.
    """
    sim_id = workflow.get("simulation_id") or str(uuid.uuid4())[:8]
    title = workflow.get("title", "Untitled Simulation")
    raw_steps = workflow.get("steps", [])

    # Hindi translation (single Gemini call for all steps)
    english_instructions = [s.get("instruction", "") for s in raw_steps]
    hindi_instructions = _translate_to_hindi(english_instructions)

    sim_steps = []
    for i, raw in enumerate(raw_steps):
        hotspot = raw.get("hotspot")

        # Determine the slide image URL
        slide_image = raw.get("slide_image_url")

        step = {
            "stepNumber": raw.get("step", i + 1),
            "instruction": english_instructions[i],
            "hindiInstruction": hindi_instructions[i],
            "action": raw.get("action", "click"),
            "value": raw.get("value"),
            "hint": raw.get("hint", ""),
            # Hotspot in % coords — used for spotlight overlay
            "hotspot": hotspot,
            # Slide image is the simulation background
            "slideImage": slide_image,
            # Confidence + review flag
            "needsReview": raw.get("needs_review", False),
            # Live overlay fields — use Gemini's value, fall back to parsing instruction
            "elementText": raw.get("element_text", raw.get("target", "")) or _extract_element_text(english_instructions[i]),
            "urlPattern":  raw.get("url_pattern", ""),
            "isSafeAction": raw.get("is_safe_action", True),
            "meta": {
                "target": raw.get("target"),
                "confidence": raw.get("confidence", 0),
                "orderingMethod": raw.get("ordering_method", "inferred"),
                "annotationType": raw.get("annotation_type", "unknown"),
                "sourceSlideId": raw.get("source_slide_id"),
            },
        }
        sim_steps.append(step)

    review_count = sum(1 for s in sim_steps if s["needsReview"])

    config = {
        "id": sim_id,
        "title": title,
        "description": f"Interactive simulation: {title}",
        "createdAt": datetime.utcnow().isoformat(),
        "stepCount": len(sim_steps),
        "estimatedMinutes": max(1, len(sim_steps) // 3),
        "reviewRequired": review_count > 0,
        "reviewCount": review_count,
        "steps": sim_steps,
    }

    # Save to disk
    sim_path = OUTPUT_DIR / "simulations" / f"{sim_id}.json"
    with open(sim_path, "w") as f:
        json.dump(config, f, indent=2)

    logger.info(
        f"Simulation {sim_id} saved → {sim_path} "
        f"({len(sim_steps)} steps, {review_count} need review)"
    )
    return config


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 2:
        print("Usage: python generator.py <workflow.json>")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        workflow = json.load(f)

    config = build_simulation_config(workflow)
    print(json.dumps(config, indent=2))

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


_SKIP_WORDS = {'all', 'the', 'it', 'this', 'that', 'here', 'or', 'scan'}
_ACTION_RE  = re.compile(
    r'(?:go to|click on|click|select|tap)\s+([A-Za-z][A-Za-z0-9 /\-]+?)\s*\(\d+\)',
    re.IGNORECASE,
)

def _extract_all_element_texts(instruction: str) -> list:
    """
    Extract ALL clickable element names from an instruction string.
    "Go to RTO(1). Click on RTO Manifest(2). Click Create Manifest(3)"
    → ["RTO", "RTO Manifest", "Create Manifest"]
    """
    results = []
    for m in _ACTION_RE.finditer(instruction or ""):
        text = m.group(1).strip()
        if text and len(text) > 1 and text.lower() not in _SKIP_WORDS:
            results.append(text)
    return results


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

    # Expand multi-action steps before building final list
    # e.g. "Go to RTO(1). Click RTO Manifest(2). Click Create Manifest(3)"
    # becomes 3 separate steps, each with the right elementText
    expanded_raws = []
    expanded_english = []
    expanded_hindi = []
    for i, raw in enumerate(raw_steps):
        gemini_element = raw.get("element_text", raw.get("target", "")).strip()
        instruction = english_instructions[i]
        if gemini_element:
            # Gemini already gave us a clean elementText — trust it, no expansion
            expanded_raws.append((raw, gemini_element))
            expanded_english.append(instruction)
            expanded_hindi.append(hindi_instructions[i])
        else:
            # Parse all actions from instruction text
            actions = _extract_all_element_texts(instruction)
            if len(actions) <= 1:
                expanded_raws.append((raw, actions[0] if actions else ""))
                expanded_english.append(instruction)
                expanded_hindi.append(hindi_instructions[i])
            else:
                # Split into one step per action
                for action in actions:
                    expanded_raws.append((raw, action))
                    expanded_english.append(instruction)
                    expanded_hindi.append(hindi_instructions[i])

    sim_steps = []
    for i, (raw, element_text) in enumerate(expanded_raws):
        step = {
            "stepNumber": i + 1,
            "instruction": expanded_english[i],
            "hindiInstruction": expanded_hindi[i],
            "action": raw.get("action", "click"),
            "value": raw.get("value"),
            "hint": raw.get("hint", ""),
            "hotspot": raw.get("hotspot"),
            "slideImage": raw.get("slide_image_url"),
            "needsReview": raw.get("needs_review", False),
            "elementText": element_text,
            "urlPattern": raw.get("url_pattern", ""),
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

    review_count = sum(1 for s in sim_steps if s.get("needsReview"))

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

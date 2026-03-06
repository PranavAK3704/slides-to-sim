"""
Simulation Generator
====================
Converts a DOM-matched (or text-only) workflow into the final SimulationConfig
JSON consumed by the Training Player frontend.

Each step includes:
  - instruction + hint
  - selector
  - screenshot  (URL served via /static/...) — present when DOM-matched
  - hotspot     (normalized % coords for 1280×720 viewport) — present when DOM-matched
  - slideImage  (URL served via /static/...) — fallback from ingestion
  - validation rule
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

OUTPUT_DIR = Path("./output/simulations")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

VIEWPORT_W = 1280
VIEWPORT_H = 720

ACTION_INSTRUCTIONS = {
    "click": "Click {target}",
    "type": "Type '{value}' into {target}",
    "select": "Select '{value}' from {target}",
    "hover": "Hover over {target}",
    "navigate": "Navigate to {target}",
    "scroll": "Scroll to {target}",
    "verify": "Verify that {target} is visible",
}

ACTION_HINTS = {
    "click": "Look for a button, tab, or link labeled '{target}'",
    "type": "Click the field first, then type your input",
    "select": "Click the dropdown and choose '{value}' from the list",
    "hover": "Move your mouse over '{target}' to reveal more options",
    "navigate": "Use the navigation menu to find '{target}'",
}


def _instruction(step: dict) -> str:
    existing = step.get("instruction", "")
    if existing and len(existing) > 5:
        return existing
    tpl = ACTION_INSTRUCTIONS.get(step.get("action", "click"), "Interact with {target}")
    return tpl.format(target=step.get("target", "element"), value=step.get("value", ""))


def _hint(step: dict) -> str:
    tpl = ACTION_HINTS.get(step.get("action", "click"), "Find '{target}' on the screen")
    return tpl.format(target=step.get("target", "element"), value=step.get("value", ""))


def _validation(step: dict) -> dict:
    action = step.get("action", "click")
    target = step.get("target", "")
    selector = step.get("selector", "")
    if action == "navigate":
        return {"type": "url_change", "expected": target}
    if action == "verify":
        return {"type": "element_visible", "expected": selector or f"text={target}"}
    return {"type": "click_target", "expected": selector or f"text={target}"}


def _normalize_hotspot(raw: dict) -> Optional[dict]:
    """
    Convert pixel bounding box (at VIEWPORT_W × VIEWPORT_H) to percentages
    so the frontend can position the hotspot overlay regardless of display size.
    """
    if not raw:
        return None
    return {
        "xPct":      round((raw["x"] / VIEWPORT_W) * 100, 4),
        "yPct":      round((raw["y"] / VIEWPORT_H) * 100, 4),
        "widthPct":  round((raw["width"] / VIEWPORT_W) * 100, 4),
        "heightPct": round((raw["height"] / VIEWPORT_H) * 100, 4),
    }


def _translate_to_hindi(instructions: list[str]) -> list[str]:
    """
    Batch-translate a list of step instructions to Hindi using Gemini.
    UI element names (button labels etc.) are kept in English.
    Falls back to original text on any error.
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


def build_simulation_config(
    matched_workflow: dict,
    ingestion_result: dict = None,
) -> dict:
    """
    Build the final SimulationConfig from a (DOM-matched) workflow.

    When DOM matching ran, each step has screenshot_url + hotspot → the player
    renders an interactive screenshot with a spotlight hotspot overlay.

    When no DOM matching, steps have slideImage (from ingestion) → the player
    renders the slide image with step text. Full text-only fallback if neither.
    """
    sim_id = matched_workflow.get("simulation_id") or str(uuid.uuid4())[:8]
    title = matched_workflow.get("title", "Untitled Simulation")
    target_url = matched_workflow.get("target_url", "")
    dom_matched = matched_workflow.get("dom_matched", False)

    raw_steps = matched_workflow.get("steps", [])

    # Build slide image URL lookup (slide_id → image_url)
    slide_image_urls: dict = {}
    if ingestion_result:
        for slide in ingestion_result.get("slides", []):
            sid = slide.get("slide_id")
            url = slide.get("image_url") or slide.get("image_path")
            if sid and url:
                slide_image_urls[sid] = url

    # Build English instructions first, then translate all at once (single Gemini call)
    english_instructions = [_instruction(raw) for raw in raw_steps]
    hindi_instructions = _translate_to_hindi(english_instructions)

    sim_steps = []
    for i, raw in enumerate(raw_steps):
        step_num = raw.get("step", len(sim_steps) + 1)
        slide_id = raw.get("source_slide_id")

        step = {
            "stepNumber": step_num,
            "instruction": english_instructions[i],
            "hindiInstruction": hindi_instructions[i],
            "selector": raw.get("selector") or f"text={raw.get('target', '')}",
            "action": raw.get("action", "click"),
            "value": raw.get("value"),
            "hint": _hint(raw),
            # Screenshot from DOM matching (primary visual)
            "screenshot": raw.get("screenshot_url"),
            # Normalized hotspot for overlay positioning
            "hotspot": _normalize_hotspot(raw.get("hotspot")),
            # Slide image fallback (from Google Slides ingestion)
            "slideImage": slide_image_urls.get(slide_id),
            "validation": _validation(raw),
            "meta": {
                "target": raw.get("target"),
                "confidence": raw.get("match_confidence", 0),
                "orderingMethod": raw.get("ordering_method", "slide_order"),
                "fallbackUsed": raw.get("fallback_used", False),
            },
        }
        sim_steps.append(step)

    config = {
        "id": sim_id,
        "title": title,
        "description": f"Interactive simulation for: {title}",
        "targetUrl": target_url,
        "domMatched": dom_matched,
        "createdAt": datetime.utcnow().isoformat(),
        "stepCount": len(sim_steps),
        "estimatedMinutes": max(1, len(sim_steps) // 3),
        "steps": sim_steps,
    }

    output_path = OUTPUT_DIR / f"{sim_id}.json"
    with open(output_path, "w") as f:
        json.dump(config, f, indent=2)

    logger.info(f"Simulation config saved → {output_path}")
    return config


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 2:
        print("Usage: python generator.py <matched_workflow.json> [ingestion.json]")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        workflow = json.load(f)
    ingestion = None
    if len(sys.argv) >= 3:
        with open(sys.argv[2]) as f:
            ingestion = json.load(f)

    config = build_simulation_config(workflow, ingestion)
    print(json.dumps(config, indent=2))

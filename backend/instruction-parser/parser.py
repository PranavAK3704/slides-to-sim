"""
Instruction Parser + Step Ordering Engine
==========================================
Converts raw slide text into structured, ordered workflow steps.

STEP ORDERING PRIORITY:
  1. Red box numbers (from vision analysis)
  2. Description text ordering (parsed by Gemini)
  3. Slide order (fallback)

Uses Gemini API to semantically parse instructions.
"""

import os
import re
import json
import logging
from typing import Optional
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


# ─── Gemini Client ─────────────────────────────────────────────────────────────

def get_gemini_model():
    import google.generativeai as genai
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel("gemini-1.5-flash")


# ─── Instruction Parsing Prompt ───────────────────────────────────────────────

PARSE_PROMPT = """You are parsing software training instructions into structured UI actions.

Given this slide text, extract every discrete UI action the user must perform.

Slide title: {title}
Slide body text: {body_text}
Description text: {description_text}
Speaker notes: {speaker_notes}

For each action, determine:
- step: sequential number (1, 2, 3...)
- action: one of [click, type, select, hover, navigate, scroll, verify]
- target: the exact UI element label/name (e.g. "Inventory", "Create DRS", "Save")
- value: only for "type" or "select" actions (the text to type or option to select)
- instruction: a clear human-readable instruction (e.g. "Click the Inventory tab")

Respond ONLY with valid JSON:
{{
  "steps": [
    {{
      "step": 1,
      "action": "click",
      "target": "Inventory",
      "value": null,
      "instruction": "Click the Inventory tab",
      "confidence": 0.95
    }}
  ],
  "ordering_hint": "description" | "sequential" | "ambiguous",
  "parse_notes": "any notes about ambiguity or assumptions made"
}}

Rules:
- Extract ALL actions, even if numbered in the text
- If text says "1 Click Inventory 2 Click Create DRS", extract both as separate steps
- Preserve exact element labels — do not paraphrase
- If you cannot determine the target, set confidence below 0.6"""


def parse_slide_instructions(slide_data: dict) -> dict:
    """
    Parse a single slide's text into structured steps using Gemini.
    """
    slide_id = slide_data.get("slide_id", 0)
    
    prompt = PARSE_PROMPT.format(
        title=slide_data.get("title") or "None",
        body_text=slide_data.get("body_text") or "None",
        description_text=slide_data.get("description_text") or "None",
        speaker_notes=slide_data.get("speaker_notes") or "None",
    )
    
    if not GEMINI_API_KEY:
        logger.warning(f"No Gemini API key. Falling back to regex parsing for slide {slide_id}")
        return regex_parse_fallback(slide_data)
    
    try:
        model = get_gemini_model()
        response = model.generate_content(prompt)
        raw = response.text.strip()
        
        # Strip markdown fences
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
            raw = raw.strip()
        
        parsed = json.loads(raw)
        steps = parsed.get("steps", [])
        
        # Tag each step with source slide
        for step in steps:
            step["source_slide_id"] = slide_id
            step["source_text"] = (
                f"{slide_data.get('body_text', '')} {slide_data.get('description_text', '')}"
            ).strip()
        
        return {
            "slide_id": slide_id,
            "steps": steps,
            "ordering_hint": parsed.get("ordering_hint", "sequential"),
            "parse_notes": parsed.get("parse_notes", ""),
            "parse_method": "gemini",
        }
        
    except Exception as e:
        logger.error(f"Gemini parsing failed for slide {slide_id}: {e}. Using regex fallback.")
        return regex_parse_fallback(slide_data)


# ─── Regex Fallback Parser ────────────────────────────────────────────────────

def regex_parse_fallback(slide_data: dict) -> dict:
    """
    Simple regex-based fallback when Gemini is unavailable.
    Handles patterns like:
      "1 Click Inventory 2 Click Create DRS"
      "Click the Save button"
    """
    slide_id = slide_data.get("slide_id", 0)
    
    text = " ".join(filter(None, [
        slide_data.get("body_text", ""),
        slide_data.get("description_text", ""),
        slide_data.get("speaker_notes", ""),
    ])).strip()
    
    steps = []
    
    # Pattern: numbered instructions like "1 Click Inventory 2 Click Save"
    numbered = re.findall(r"(\d+)\s+(click|select|type|hover|navigate)\s+([^\d]+?)(?=\d+\s+\w+|$)", 
                          text, re.IGNORECASE)
    
    if numbered:
        for num, action, target in numbered:
            target = target.strip().rstrip(".,")
            steps.append({
                "step": int(num),
                "action": action.lower(),
                "target": target,
                "value": None,
                "instruction": f"{action.capitalize()} {target}",
                "confidence": 0.7,
                "source_slide_id": slide_id,
                "source_text": text,
            })
    else:
        # Pattern: unnumbered "Click X" instructions
        unnumbered = re.findall(r"(click|select|type|hover|navigate)\s+([^\n,.]+)", 
                                text, re.IGNORECASE)
        for idx, (action, target) in enumerate(unnumbered):
            target = target.strip()
            steps.append({
                "step": idx + 1,
                "action": action.lower(),
                "target": target,
                "value": None,
                "instruction": f"{action.capitalize()} {target}",
                "confidence": 0.5,
                "source_slide_id": slide_id,
                "source_text": text,
            })
    
    return {
        "slide_id": slide_id,
        "steps": steps,
        "ordering_hint": "sequential",
        "parse_notes": "Parsed via regex fallback",
        "parse_method": "regex",
    }


# ─── Step Ordering Engine ─────────────────────────────────────────────────────

def order_steps(
    slide_analyses: list[dict],
    parsed_slides: list[dict],
    ingestion_slides: list[dict],
) -> list[dict]:
    """
    Merge and order all steps from all slides using priority rules:
    
    Priority 1: Red box numbers from vision analysis
    Priority 2: Description text ordering
    Priority 3: Slide order
    
    Returns a flat, globally ordered list of steps.
    """
    
    all_steps = []
    
    for parsed in parsed_slides:
        slide_id = parsed["slide_id"]
        steps = parsed.get("steps", [])
        
        # Find matching vision analysis
        vision = next(
            (a for a in slide_analyses if a.get("slide_id") == slide_id), 
            {}
        )
        
        red_boxes = vision.get("red_boxes", [])
        red_box_numbers = [b["number"] for b in red_boxes if b.get("number") is not None]
        
        ordering_method = "slide_order"
        
        if red_box_numbers:
            # Priority 1: red boxes have numbers — use them
            ordering_method = "red_boxes"
            logger.info(f"Slide {slide_id}: Using red box ordering: {red_box_numbers}")
            
            # Match steps to red box numbers
            for step in steps:
                step["global_order"] = _compute_global_order(
                    slide_id=slide_id,
                    local_step=step["step"],
                    red_box_numbers=red_box_numbers,
                    method="red_boxes"
                )
                step["ordering_method"] = "red_boxes"
        
        elif parsed.get("ordering_hint") == "description":
            # Priority 2: description text had explicit ordering
            ordering_method = "description"
            logger.info(f"Slide {slide_id}: Using description text ordering")
            
            for step in steps:
                step["global_order"] = _compute_global_order(
                    slide_id=slide_id,
                    local_step=step["step"],
                    red_box_numbers=[],
                    method="description"
                )
                step["ordering_method"] = "description"
        
        else:
            # Priority 3: slide order
            logger.info(f"Slide {slide_id}: Using slide order")
            for step in steps:
                step["global_order"] = _compute_global_order(
                    slide_id=slide_id,
                    local_step=step["step"],
                    red_box_numbers=[],
                    method="slide_order"
                )
                step["ordering_method"] = "slide_order"
        
        all_steps.extend(steps)
    
    # Sort by global order
    all_steps.sort(key=lambda s: s.get("global_order", 999))
    
    # Re-number sequentially
    for idx, step in enumerate(all_steps):
        step["step"] = idx + 1
    
    return all_steps


def _compute_global_order(
    slide_id: int,
    local_step: int,
    red_box_numbers: list,
    method: str
) -> float:
    """
    Compute a sortable global order value.
    slide_id * 1000 + local_step ensures slide ordering is preserved.
    """
    if method == "red_boxes" and red_box_numbers:
        # Use the red box number directly as primary sort key
        red_num = red_box_numbers[local_step - 1] if local_step <= len(red_box_numbers) else local_step
        return red_num
    else:
        # slide_id-based ordering: slide 1 steps come before slide 2 steps
        return slide_id * 1000 + local_step


# ─── Full Pipeline ────────────────────────────────────────────────────────────

def parse_and_order(ingestion_result: dict, vision_result: dict) -> dict:
    """
    Run full instruction parsing + step ordering pipeline.
    
    Input:
        ingestion_result: from slide-ingestion service
        vision_result: from vision-analysis service
    
    Output:
        ordered workflow config ready for DOM matching
    """
    slides = ingestion_result.get("slides", [])
    slide_analyses = vision_result.get("slide_analyses", [])
    
    logger.info(f"Parsing instructions from {len(slides)} slides")
    
    # Parse each slide
    parsed_slides = []
    for slide in slides:
        parsed = parse_slide_instructions(slide)
        parsed_slides.append(parsed)
    
    # Order all steps
    ordered_steps = order_steps(slide_analyses, parsed_slides, slides)
    
    import uuid
    from datetime import datetime
    
    workflow = {
        "simulation_id": str(uuid.uuid4())[:8],
        "title": ingestion_result.get("title", "Untitled Simulation"),
        "source_url": ingestion_result.get("source_url", ""),
        "presentation_id": ingestion_result.get("presentation_id", ""),
        "created_at": datetime.utcnow().isoformat(),
        "step_count": len(ordered_steps),
        "steps": ordered_steps,
    }
    
    logger.info(f"✅ Generated {len(ordered_steps)} ordered steps")
    return workflow


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    
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

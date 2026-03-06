"""
Simulation Generator
====================
Converts a DOM-matched workflow into the final SimulationConfig JSON
that the Training Player frontend consumes.

Adds:
- Human-readable instructions
- Validation rules per step
- Hints and tooltips
- Reference slide images
- Metadata for the player
"""

import json
import uuid
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

OUTPUT_DIR = Path("./output/simulations")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


ACTION_INSTRUCTION_TEMPLATES = {
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
    "hover": "Move your mouse over '{target}' to reveal options",
    "navigate": "Use the navigation menu to find '{target}'",
}


def generate_instruction(step: dict) -> str:
    """Generate a clear, human-readable instruction string."""
    # Use existing instruction if high quality
    existing = step.get("instruction", "")
    if existing and len(existing) > 5:
        return existing
    
    action = step.get("action", "click")
    target = step.get("target", "element")
    value = step.get("value", "")
    
    template = ACTION_INSTRUCTION_TEMPLATES.get(action, "Interact with {target}")
    return template.format(target=target, value=value)


def generate_hint(step: dict) -> str:
    """Generate a contextual hint for the step."""
    action = step.get("action", "click")
    target = step.get("target", "element")
    value = step.get("value", "")
    
    template = ACTION_HINTS.get(action, "Find '{target}' on the screen")
    return template.format(target=target, value=value)


def generate_validation(step: dict) -> dict:
    """Generate validation rule for the step."""
    action = step.get("action", "click")
    target = step.get("target", "")
    selector = step.get("selector", "")
    
    if action == "navigate":
        return {
            "type": "url_change",
            "expected": target,
        }
    elif action == "verify":
        return {
            "type": "element_visible",
            "expected": selector or f"text={target}",
        }
    else:
        # Default: verify the target element was clicked
        return {
            "type": "click_target",
            "expected": selector or f"text={target}",
        }


def build_simulation_config(
    matched_workflow: dict,
    ingestion_result: dict = None,
) -> dict:
    """
    Build the final SimulationConfig from a DOM-matched workflow.
    
    This is the format consumed by the Training Player frontend.
    """
    sim_id = matched_workflow.get("simulation_id") or str(uuid.uuid4())[:8]
    title = matched_workflow.get("title", "Untitled Simulation")
    target_url = matched_workflow.get("target_url", "")
    
    raw_steps = matched_workflow.get("steps", [])
    
    # Build slide image lookup (slide_id → image_path)
    slide_images = {}
    if ingestion_result:
        for slide in ingestion_result.get("slides", []):
            slide_images[slide.get("slide_id")] = slide.get("image_path")
    
    # Build simulation steps
    sim_steps = []
    for raw_step in raw_steps:
        step_num = raw_step.get("step", len(sim_steps) + 1)
        slide_id = raw_step.get("source_slide_id")
        
        step = {
            "stepNumber": step_num,
            "instruction": generate_instruction(raw_step),
            "selector": raw_step.get("selector") or f"text={raw_step.get('target', '')}",
            "action": raw_step.get("action", "click"),
            "value": raw_step.get("value"),
            "hint": generate_hint(raw_step),
            "slideImage": slide_images.get(slide_id),
            "validation": generate_validation(raw_step),
            "meta": {
                "target": raw_step.get("target"),
                "confidence": raw_step.get("match_confidence", 0),
                "orderingMethod": raw_step.get("ordering_method", "slide_order"),
                "fallbackUsed": raw_step.get("fallback_used", False),
            }
        }
        sim_steps.append(step)
    
    config = {
        "id": sim_id,
        "title": title,
        "description": f"Interactive simulation for: {title}",
        "targetUrl": target_url,
        "createdAt": datetime.utcnow().isoformat(),
        "stepCount": len(sim_steps),
        "estimatedMinutes": max(1, len(sim_steps) // 3),
        "steps": sim_steps,
    }
    
    # Save to disk
    output_path = OUTPUT_DIR / f"{sim_id}.json"
    with open(output_path, "w") as f:
        json.dump(config, f, indent=2)
    
    logger.info(f"✅ Simulation config saved → {output_path}")
    return config


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 2:
        print("Usage: python generator.py <matched_workflow.json>")
        sys.exit(1)
    
    with open(sys.argv[1]) as f:
        workflow = json.load(f)
    
    ingestion = None
    if len(sys.argv) >= 3:
        with open(sys.argv[2]) as f:
            ingestion = json.load(f)
    
    config = build_simulation_config(workflow, ingestion)
    print(json.dumps(config, indent=2))

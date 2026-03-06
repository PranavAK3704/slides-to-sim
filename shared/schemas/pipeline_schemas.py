# Shared Data Schemas
# These TypeScript-style types define contracts between all pipeline services.
# Python services use TypedDict / Pydantic equivalents.

"""
SlideData — output of Slide Ingestion
"""

SLIDE_DATA_SCHEMA = {
    "slide_id": "int",
    "slide_index": "int",         # 0-based position in deck
    "image_path": "str",          # local path to downloaded PNG
    "image_base64": "str | None", # base64 for Gemini Vision
    "title": "str | None",
    "body_text": "str | None",
    "description_text": "str | None",  # text in bottom description box
    "speaker_notes": "str | None",
    "raw_shapes": "list[dict]",        # raw Google Slides API shape data
}

"""
UIElement — output of Vision Analysis (per slide)
"""
UI_ELEMENT_SCHEMA = {
    "label": "str",
    "type": "str",   # tab | button | dropdown | input | link | menu | icon | text
    "bbox": "dict | None",  # {x, y, width, height} normalized 0-1
    "confidence": "float",  # 0-1
    "is_highlighted": "bool",  # inside a red box?
    "highlight_number": "int | None",  # number in red box if present
}

"""
ParsedStep — output of Instruction Parser
"""
PARSED_STEP_SCHEMA = {
    "step": "int",
    "action": "str",  # click | type | select | hover | navigate | verify
    "target": "str",  # human-readable label e.g. "Inventory"
    "value": "str | None",  # for type actions
    "source_slide_id": "int",
    "source_text": "str",
    "confidence": "float",
}

"""
OrderedWorkflow — output of Step Ordering Engine
"""
ORDERED_WORKFLOW_SCHEMA = {
    "simulation_id": "str",
    "title": "str",
    "source_url": "str",
    "steps": "list[ParsedStep]",
    "ordering_method": "str",  # red_boxes | description | slide_order
    "created_at": "str",
}

"""
DOMMatch — output of DOM Matching Engine
"""
DOM_MATCH_SCHEMA = {
    "step": "int",
    "instruction": "str",
    "selector": "str",       # Playwright selector e.g. text=Inventory
    "selector_type": "str",  # text | role | label | css | xpath
    "element_tag": "str | None",
    "element_text": "str | None",
    "match_confidence": "float",
    "fallback_used": "bool",
}

"""
SimulationConfig — output of Simulation Generator (input to Training Player)
"""
SIMULATION_CONFIG_SCHEMA = {
    "id": "str",
    "title": "str",
    "description": "str | None",
    "target_url": "str",
    "created_at": "str",
    "steps": [
        {
            "step_number": "int",
            "instruction": "str",          # shown to user
            "selector": "str",             # Playwright/DOM selector
            "action": "str",               # click | type | select
            "value": "str | None",         # for type actions
            "hint": "str | None",          # extra tip shown in overlay
            "slide_image": "str | None",   # reference screenshot
            "validation": {
                "type": "str",             # click_target | url_change | element_visible
                "expected": "str",
            }
        }
    ]
}

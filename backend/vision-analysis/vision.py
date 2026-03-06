"""
Vision Analysis Engine
======================
Analyzes slide screenshots using Gemini Vision API to detect UI elements.

PRIMARY: Gemini Vision — semantic understanding of UI elements
FALLBACK: OpenCV red-box detection + Tesseract OCR for step numbers

Output per slide:
{
    "slide_id": 1,
    "elements": [
        {"label": "Inventory", "type": "tab", "confidence": 0.95, ...},
        {"label": "Create DRS", "type": "button", "confidence": 0.92, ...}
    ],
    "red_boxes": [
        {"number": 1, "bbox": {...}, "label": "Inventory"}
    ],
    "analysis_method": "gemini"
}
"""

import os
import re
import json
import base64
import logging
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


# ─── Gemini Vision Client ─────────────────────────────────────────────────────

def get_gemini_model():
    """Initialize Gemini generative model."""
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        return genai.GenerativeModel("gemini-1.5-flash")
    except ImportError:
        raise ImportError("google-generativeai not installed. Run: pip install google-generativeai")


# ─── Gemini Vision Analysis (PRIMARY) ─────────────────────────────────────────

VISION_PROMPT = """You are analyzing a software training screenshot.

Your task: identify ALL UI elements visible in this image that a user would interact with.

For each UI element found, output:
- label: the exact text label shown on the element
- type: one of [tab, button, dropdown, input, link, menu, icon, text, checkbox, radio]
- is_highlighted: true if element is inside a red/orange box or has red highlighting
- highlight_number: if inside a red numbered box, the number shown (null otherwise)

Also identify:
- Any numbered red boxes (step indicators)
- The overall workflow being described

Respond ONLY with valid JSON in this exact format:
{
  "elements": [
    {
      "label": "string",
      "type": "string",
      "is_highlighted": boolean,
      "highlight_number": number or null,
      "confidence": 0.0-1.0
    }
  ],
  "red_box_count": number,
  "workflow_summary": "one sentence description of what this slide teaches",
  "analysis_notes": "any important observations"
}

Do not include any text outside the JSON."""


def analyze_with_gemini(image_base64: str, slide_id: int) -> dict:
    """
    Use Gemini Vision to semantically understand slide UI elements.
    This is the PRIMARY analysis method.
    """
    model = get_gemini_model()
    
    import google.generativeai as genai
    
    image_data = {
        "mime_type": "image/png",
        "data": image_base64
    }
    
    try:
        response = model.generate_content([VISION_PROMPT, image_data])
        raw_text = response.text.strip()
        
        # Strip markdown code fences if present
        if raw_text.startswith("```"):
            raw_text = re.sub(r"^```[a-z]*\n?", "", raw_text)
            raw_text = re.sub(r"\n?```$", "", raw_text)
            raw_text = raw_text.strip()
        
        parsed = json.loads(raw_text)
        
        return {
            "slide_id": slide_id,
            "elements": parsed.get("elements", []),
            "red_box_count": parsed.get("red_box_count", 0),
            "workflow_summary": parsed.get("workflow_summary", ""),
            "analysis_notes": parsed.get("analysis_notes", ""),
            "analysis_method": "gemini",
            "raw_response": raw_text,
        }
        
    except json.JSONDecodeError as e:
        logger.error(f"Gemini returned invalid JSON for slide {slide_id}: {e}")
        logger.debug(f"Raw response: {raw_text}")
        return _empty_result(slide_id, "gemini_json_error")
    
    except Exception as e:
        logger.error(f"Gemini Vision failed for slide {slide_id}: {e}")
        return _empty_result(slide_id, "gemini_error")


# ─── OpenCV Red Box Detection (FALLBACK) ──────────────────────────────────────

def detect_red_boxes_opencv(image_path: str) -> list[dict]:
    """
    FALLBACK: Use OpenCV to detect red highlighted rectangles in slide images.
    Returns list of detected boxes with bounding boxes.
    
    Only called when Gemini fails or as enrichment data.
    """
    try:
        import cv2
        
        img = cv2.imread(image_path)
        if img is None:
            logger.error(f"Could not load image: {image_path}")
            return []
        
        height, width = img.shape[:2]
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        
        # Red in HSV wraps around — need two ranges
        lower_red1 = np.array([0, 100, 100])
        upper_red1 = np.array([10, 255, 255])
        lower_red2 = np.array([160, 100, 100])
        upper_red2 = np.array([180, 255, 255])
        
        mask1 = cv2.inRange(hsv, lower_red1, upper_red1)
        mask2 = cv2.inRange(hsv, lower_red2, upper_red2)
        red_mask = cv2.bitwise_or(mask1, mask2)
        
        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_CLOSE, kernel)
        red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_OPEN, kernel)
        
        # Find contours
        contours, _ = cv2.findContours(red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        boxes = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 500:  # skip tiny noise
                continue
            
            x, y, w, h = cv2.boundingRect(contour)
            
            # Normalize to 0-1
            boxes.append({
                "bbox": {
                    "x": x / width,
                    "y": y / height,
                    "width": w / width,
                    "height": h / height,
                    "x_px": x,
                    "y_px": y,
                    "w_px": w,
                    "h_px": h,
                },
                "area": area,
                "number": None,  # will be filled by OCR
            })
        
        # Sort by area descending, take top 10
        boxes.sort(key=lambda b: b["area"], reverse=True)
        return boxes[:10]
        
    except ImportError:
        logger.warning("OpenCV not available. Skipping red box detection.")
        return []
    except Exception as e:
        logger.error(f"Red box detection failed: {e}")
        return []


def read_numbers_from_boxes(image_path: str, boxes: list[dict]) -> list[dict]:
    """
    FALLBACK: Use Tesseract OCR to read step numbers from inside red boxes.
    Enriches box data with detected numbers.
    """
    try:
        import pytesseract
        import cv2
        
        img = cv2.imread(image_path)
        if img is None:
            return boxes
        
        for box in boxes:
            bbox = box["bbox"]
            h, w = img.shape[:2]
            
            # Crop to box region
            x = int(bbox["x_px"])
            y = int(bbox["y_px"])
            bw = int(bbox["w_px"])
            bh = int(bbox["h_px"])
            
            roi = img[y:y+bh, x:x+bw]
            
            # Preprocess for OCR
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            
            # OCR with digit mode
            config = "--psm 10 --oem 3 -c tessedit_char_whitelist=0123456789"
            text = pytesseract.image_to_string(thresh, config=config).strip()
            
            if text.isdigit():
                box["number"] = int(text)
                logger.info(f"Red box → number: {text}")
        
        return boxes
        
    except ImportError:
        logger.warning("Tesseract not available. Skipping OCR number extraction.")
        return boxes
    except Exception as e:
        logger.error(f"OCR extraction failed: {e}")
        return boxes


# ─── Full Analysis Pipeline ───────────────────────────────────────────────────

def analyze_slide(slide_data: dict) -> dict:
    """
    Full analysis pipeline for a single slide.
    
    1. Try Gemini Vision (primary)
    2. If Gemini fails or is unavailable, fall back to OpenCV + OCR
    3. Merge results
    """
    slide_id = slide_data.get("slide_id", 0)
    image_base64 = slide_data.get("image_base64")
    image_path = slide_data.get("image_path")
    
    result = _empty_result(slide_id, "none")
    
    # PRIMARY: Gemini Vision
    if GEMINI_API_KEY and image_base64:
        logger.info(f"Slide {slide_id}: Running Gemini Vision analysis")
        result = analyze_with_gemini(image_base64, slide_id)
    else:
        logger.warning(f"Slide {slide_id}: Gemini unavailable, using fallback only")
    
    # FALLBACK / ENRICHMENT: OpenCV red box detection
    if image_path and Path(image_path).exists():
        logger.info(f"Slide {slide_id}: Running red box detection")
        red_boxes = detect_red_boxes_opencv(image_path)
        if red_boxes:
            red_boxes = read_numbers_from_boxes(image_path, red_boxes)
            result["red_boxes"] = red_boxes
            
            # If Gemini found no elements, build elements from OCR
            if not result.get("elements") and red_boxes:
                result["analysis_method"] = "opencv_fallback"
    
    return result


def analyze_presentation(ingestion_result: dict) -> dict:
    """
    Run vision analysis on all slides from ingestion result.
    Returns enriched data with UI elements per slide.
    """
    slides = ingestion_result.get("slides", [])
    logger.info(f"Analyzing {len(slides)} slides")
    
    analyzed = []
    for slide in slides:
        analysis = analyze_slide(slide)
        analyzed.append(analysis)
    
    return {
        "job_id": ingestion_result.get("job_id"),
        "presentation_id": ingestion_result.get("presentation_id"),
        "title": ingestion_result.get("title"),
        "slide_analyses": analyzed,
    }


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _empty_result(slide_id: int, method: str) -> dict:
    return {
        "slide_id": slide_id,
        "elements": [],
        "red_boxes": [],
        "red_box_count": 0,
        "workflow_summary": "",
        "analysis_notes": "",
        "analysis_method": method,
    }


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import json
    
    logging.basicConfig(level=logging.INFO)
    
    if len(sys.argv) < 2:
        print("Usage: python vision.py <ingestion_result.json>")
        sys.exit(1)
    
    with open(sys.argv[1]) as f:
        ingestion = json.load(f)
    
    result = analyze_presentation(ingestion)
    print(json.dumps(result, indent=2))

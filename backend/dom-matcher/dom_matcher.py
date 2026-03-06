"""
DOM Matching Engine
===================
Opens the target application URL using Playwright, matches each instruction
step to a real DOM element, captures a screenshot at each state, and records
the element bounding box so the Training Player can render interactive hotspots.

MATCHING STRATEGY (in order):
1. Exact text match
2. ARIA role match
3. Label / placeholder match
4. Partial text match
5. Gemini visual disambiguation

OUTPUT per step adds:
  screenshot_path  — absolute path to PNG captured before the action
  hotspot          — {x, y, width, height} in pixels at 1280×720 viewport
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
VIEWPORT_W = 1280
VIEWPORT_H = 720


# ─── Bounding Box Helper ──────────────────────────────────────────────────────

async def _get_bounding_box(page, selector: str) -> Optional[dict]:
    """Return the bounding box of the first visible element matching selector."""
    try:
        locator = page.locator(selector)
        count = await locator.count()
        if count == 0:
            return None
        for i in range(min(count, 5)):
            el = locator.nth(i)
            if await el.is_visible():
                box = await el.bounding_box()
                if box:
                    return box
    except Exception as e:
        logger.debug(f"bounding_box failed for '{selector}': {e}")
    return None


# ─── Element Matching Strategies ─────────────────────────────────────────────

async def _try_text_match(page, target: str) -> Optional[dict]:
    try:
        loc = page.get_by_text(target, exact=True)
        count = await loc.count()
        if count >= 1:
            for i in range(count):
                el = loc.nth(i)
                if await el.is_visible():
                    tag = await el.evaluate("el => el.tagName.toLowerCase()")
                    return {"selector": f"text={target}", "selector_type": "text_exact", "element_tag": tag}
    except Exception as e:
        logger.debug(f"text match failed for '{target}': {e}")
    return None


async def _try_role_match(page, target: str, action: str) -> Optional[dict]:
    role_map = {
        "click": ["button", "link", "tab", "menuitem", "option"],
        "select": ["option", "listbox", "combobox"],
        "type": ["textbox", "searchbox"],
        "navigate": ["link", "button"],
    }
    for role in role_map.get(action, ["button", "link"]):
        try:
            loc = page.get_by_role(role, name=target)
            if await loc.count() >= 1 and await loc.first.is_visible():
                tag = await loc.first.evaluate("el => el.tagName.toLowerCase()")
                return {"selector": f"role={role}[name='{target}']", "selector_type": "aria_role", "element_tag": tag}
        except Exception:
            pass
    return None


async def _try_label_match(page, target: str) -> Optional[dict]:
    for method, selector_type in [("get_by_label", "label"), ("get_by_placeholder", "placeholder")]:
        try:
            loc = getattr(page, method)(target)
            if await loc.count() >= 1 and await loc.first.is_visible():
                tag = await loc.first.evaluate("el => el.tagName.toLowerCase()")
                return {"selector": f"{selector_type}={target}", "selector_type": selector_type, "element_tag": tag}
        except Exception:
            pass
    return None


async def _try_partial_text_match(page, target: str) -> Optional[dict]:
    try:
        loc = page.get_by_text(target)
        if await loc.count() >= 1 and await loc.first.is_visible():
            tag = await loc.first.evaluate("el => el.tagName.toLowerCase()")
            return {"selector": f"text={target}", "selector_type": "text_partial", "element_tag": tag}
    except Exception:
        pass
    return None


async def _try_gemini_match(page, step: dict) -> Optional[dict]:
    if not GEMINI_API_KEY:
        return None
    try:
        import google.generativeai as genai
        screenshot = await page.screenshot()
        screenshot_b64 = base64.b64encode(screenshot).decode()
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = (
            f'Look at this screenshot of a web application.\n'
            f'Find the element for this instruction: "{step.get("instruction")}"\n'
            f'Target label: "{step.get("target")}"\n'
            f'Respond ONLY with JSON: {{"selector": "...", "selector_type": "css|text|xpath", "confidence": 0.0-1.0}}'
        )
        resp = model.generate_content([prompt, {"mime_type": "image/png", "data": screenshot_b64}])
        raw = re.sub(r"^```[a-z]*\n?|\n?```$", "", resp.text.strip()).strip()
        parsed = json.loads(raw)
        return {
            "selector": parsed.get("selector"),
            "selector_type": f"gemini_{parsed.get('selector_type', 'css')}",
            "element_tag": None,
            "match_confidence": parsed.get("confidence", 0.6),
        }
    except Exception as e:
        logger.error(f"Gemini DOM match failed: {e}")
    return None


# ─── Single Step Matching ─────────────────────────────────────────────────────

async def match_step_to_dom(
    page,
    step: dict,
    screenshot_dir: Optional[Path] = None,
    step_num: int = 0,
) -> dict:
    """
    Match a step to a DOM element, capture a screenshot, and record the hotspot.
    Returns the step dict enriched with selector, screenshot_path, and hotspot.
    """
    target = step.get("target", "")
    action = step.get("action", "click")

    result = {
        **step,
        "selector": None,
        "selector_type": None,
        "element_tag": None,
        "element_text": target,
        "match_confidence": 0.0,
        "fallback_used": False,
        "screenshot_path": None,
        "hotspot": None,
    }

    # --- Try matching strategies ---
    match = (
        await _try_text_match(page, target)
        or await _try_role_match(page, target, action)
        or await _try_label_match(page, target)
        or await _try_partial_text_match(page, target)
        or await _try_gemini_match(page, step)
    )

    if match:
        result.update(match)
        if "match_confidence" not in match:
            confidence_map = {
                "text_exact": 0.95, "aria_role": 0.85, "label": 0.80,
                "placeholder": 0.80, "text_partial": 0.65,
            }
            result["match_confidence"] = confidence_map.get(match.get("selector_type", ""), 0.6)
        if match.get("selector_type", "").startswith("gemini"):
            result["fallback_used"] = True
    else:
        logger.warning(f"No DOM match for step {step_num}: '{target}'")
        result["selector"] = f"text={target}"
        result["selector_type"] = "text_guess"
        result["fallback_used"] = True

    # --- Screenshot before interacting ---
    if screenshot_dir:
        screenshot_path = screenshot_dir / f"step_{step_num:03d}.png"
        try:
            await page.screenshot(path=str(screenshot_path), full_page=False)
            result["screenshot_path"] = str(screenshot_path)
            logger.info(f"Screenshot saved: {screenshot_path}")
        except Exception as e:
            logger.error(f"Screenshot failed at step {step_num}: {e}")

    # --- Record element bounding box ---
    if result.get("selector"):
        box = await _get_bounding_box(page, result["selector"])
        if box:
            result["hotspot"] = {
                "x": box["x"],
                "y": box["y"],
                "width": box["width"],
                "height": box["height"],
            }

    return result


# ─── Full Matching Pipeline ───────────────────────────────────────────────────

async def match_workflow(
    target_url: str,
    workflow: dict,
    screenshot_dir: Optional[Path] = None,
) -> dict:
    """
    Open the target app, walk through all steps, capture screenshots and
    hotspot positions, then actually perform each action to advance app state.

    Returns the workflow enriched with screenshot_path + hotspot per step.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise ImportError("Run: pip install playwright && playwright install chromium")

    if screenshot_dir:
        screenshot_dir.mkdir(parents=True, exist_ok=True)

    steps = workflow.get("steps", [])
    matched_steps = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": VIEWPORT_W, "height": VIEWPORT_H}
        )
        page = await context.new_page()

        logger.info(f"DOM matching: opening {target_url}")
        try:
            await page.goto(target_url, wait_until="networkidle", timeout=30000)
        except Exception as e:
            logger.warning(f"Page load timeout (continuing anyway): {e}")

        for step in steps:
            step_num = step.get("step", len(matched_steps) + 1)
            logger.info(f"Matching step {step_num}: {step.get('instruction')}")

            matched = await match_step_to_dom(page, step, screenshot_dir, step_num)
            matched_steps.append(matched)

            # Perform the action so the next screenshot shows the resulting app state
            if matched.get("selector") and step.get("action") in ("click", "navigate"):
                try:
                    await page.locator(matched["selector"]).first.click(timeout=3000)
                    await page.wait_for_load_state("networkidle", timeout=5000)
                except Exception as e:
                    logger.warning(f"Could not advance app state at step {step_num}: {e}")

            elif matched.get("selector") and step.get("action") == "type" and step.get("value"):
                try:
                    await page.locator(matched["selector"]).first.fill(step["value"], timeout=3000)
                except Exception as e:
                    logger.warning(f"Could not type at step {step_num}: {e}")

        await browser.close()

    logger.info(f"DOM matching complete: {len(matched_steps)} steps")
    return {
        **workflow,
        "steps": matched_steps,
        "target_url": target_url,
        "dom_matched": True,
    }


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import asyncio

    logging.basicConfig(level=logging.INFO)

    if len(sys.argv) < 3:
        print("Usage: python dom_matcher.py <workflow.json> <target_url> [screenshot_dir]")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        workflow = json.load(f)

    target_url = sys.argv[2]
    screenshot_dir = Path(sys.argv[3]) if len(sys.argv) >= 4 else Path("./output/screenshots/cli")

    result = asyncio.run(match_workflow(target_url, workflow, screenshot_dir))
    print(json.dumps(result, indent=2, default=str))

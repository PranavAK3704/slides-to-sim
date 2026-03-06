"""
DOM Matching Engine
===================
Opens the target application URL using Playwright,
then matches each instruction step to a real DOM element.

MATCHING STRATEGY:
1. Exact text match (page.getByText)
2. ARIA role match (page.getByRole)
3. Placeholder/label match (page.getByLabel)
4. Gemini disambiguation (when multiple matches)
5. Fuzzy CSS fallback

Output per step:
{
    "step": 1,
    "instruction": "Click Inventory",
    "selector": "text=Inventory",
    "selector_type": "text",
    "element_tag": "a",
    "match_confidence": 0.95,
    "fallback_used": false
}
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


# ─── Playwright DOM Matcher ───────────────────────────────────────────────────

async def match_step_to_dom(page, step: dict) -> dict:
    """
    Given a Playwright page and a parsed step, find the best DOM selector.
    
    Returns enriched step with selector information.
    """
    target = step.get("target", "")
    action = step.get("action", "click")
    
    result = {
        **step,
        "selector": None,
        "selector_type": None,
        "element_tag": None,
        "element_text": None,
        "match_confidence": 0.0,
        "fallback_used": False,
    }
    
    # Strategy 1: Exact text match
    match = await _try_text_match(page, target)
    if match:
        result.update(match)
        result["match_confidence"] = 0.95
        return result
    
    # Strategy 2: ARIA role match
    match = await _try_role_match(page, target, action)
    if match:
        result.update(match)
        result["match_confidence"] = 0.85
        return result
    
    # Strategy 3: Label/placeholder match
    match = await _try_label_match(page, target)
    if match:
        result.update(match)
        result["match_confidence"] = 0.80
        return result
    
    # Strategy 4: Partial text match
    match = await _try_partial_text_match(page, target)
    if match:
        result.update(match)
        result["match_confidence"] = 0.65
        result["fallback_used"] = True
        return result
    
    # Strategy 5: Gemini disambiguation
    if GEMINI_API_KEY:
        match = await _try_gemini_match(page, step)
        if match:
            result.update(match)
            result["fallback_used"] = True
            return result
    
    logger.warning(f"No DOM match found for: '{target}'")
    result["match_confidence"] = 0.0
    result["selector"] = f"text={target}"  # best guess
    result["selector_type"] = "text_guess"
    result["fallback_used"] = True
    return result


async def _try_text_match(page, target: str) -> Optional[dict]:
    """Try exact text match using Playwright getByText."""
    try:
        locator = page.get_by_text(target, exact=True)
        count = await locator.count()
        
        if count == 1:
            element = locator.first
            tag = await element.evaluate("el => el.tagName.toLowerCase()")
            return {
                "selector": f"text={target}",
                "selector_type": "text_exact",
                "element_tag": tag,
                "element_text": target,
            }
        elif count > 1:
            # Multiple matches — use first visible one
            for i in range(count):
                el = locator.nth(i)
                if await el.is_visible():
                    tag = await el.evaluate("el => el.tagName.toLowerCase()")
                    return {
                        "selector": f"text={target} >> nth={i}",
                        "selector_type": "text_exact_nth",
                        "element_tag": tag,
                        "element_text": target,
                    }
    except Exception as e:
        logger.debug(f"Text match failed for '{target}': {e}")
    return None


async def _try_role_match(page, target: str, action: str) -> Optional[dict]:
    """Try ARIA role-based matching."""
    # Map action to likely role
    role_map = {
        "click": ["button", "link", "tab", "menuitem", "option"],
        "select": ["option", "listbox", "combobox"],
        "type": ["textbox", "searchbox"],
        "navigate": ["link", "button"],
    }
    
    roles = role_map.get(action, ["button", "link"])
    
    for role in roles:
        try:
            locator = page.get_by_role(role, name=target)
            count = await locator.count()
            if count >= 1:
                el = locator.first
                if await el.is_visible():
                    tag = await el.evaluate("el => el.tagName.toLowerCase()")
                    return {
                        "selector": f"role={role}[name='{target}']",
                        "selector_type": "aria_role",
                        "element_tag": tag,
                        "element_text": target,
                    }
        except Exception as e:
            logger.debug(f"Role match failed for role={role} name='{target}': {e}")
    
    return None


async def _try_label_match(page, target: str) -> Optional[dict]:
    """Try label/placeholder match."""
    try:
        locator = page.get_by_label(target)
        count = await locator.count()
        if count >= 1:
            el = locator.first
            if await el.is_visible():
                tag = await el.evaluate("el => el.tagName.toLowerCase()")
                return {
                    "selector": f"label={target}",
                    "selector_type": "label",
                    "element_tag": tag,
                    "element_text": target,
                }
    except Exception:
        pass
    
    try:
        locator = page.get_by_placeholder(target)
        count = await locator.count()
        if count >= 1:
            el = locator.first
            if await el.is_visible():
                return {
                    "selector": f"placeholder={target}",
                    "selector_type": "placeholder",
                    "element_tag": "input",
                    "element_text": target,
                }
    except Exception:
        pass
    
    return None


async def _try_partial_text_match(page, target: str) -> Optional[dict]:
    """Partial text match — more lenient."""
    try:
        locator = page.get_by_text(target)
        count = await locator.count()
        if count >= 1:
            el = locator.first
            if await el.is_visible():
                tag = await el.evaluate("el => el.tagName.toLowerCase()")
                return {
                    "selector": f"text={target}",
                    "selector_type": "text_partial",
                    "element_tag": tag,
                    "element_text": target,
                }
    except Exception:
        pass
    return None


async def _try_gemini_match(page, step: dict) -> Optional[dict]:
    """
    Use Gemini to determine the best selector when other strategies fail.
    Takes a screenshot of the page and asks Gemini to identify the element.
    """
    try:
        import google.generativeai as genai
        
        # Take screenshot for Gemini
        screenshot = await page.screenshot()
        import base64
        screenshot_b64 = base64.b64encode(screenshot).decode()
        
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        prompt = f"""Look at this screenshot of a web application.
        
I need to find the element that matches this instruction: "{step.get('instruction')}"
The target element label is: "{step.get('target')}"

Provide the best CSS selector or text selector for this element.
Respond ONLY with JSON:
{{"selector": "...", "selector_type": "css|text|xpath", "confidence": 0.0-1.0}}"""
        
        image_data = {"mime_type": "image/png", "data": screenshot_b64}
        response = model.generate_content([prompt, image_data])
        raw = response.text.strip()
        
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
        
        parsed = json.loads(raw.strip())
        return {
            "selector": parsed.get("selector"),
            "selector_type": f"gemini_{parsed.get('selector_type', 'unknown')}",
            "element_tag": None,
            "element_text": step.get("target"),
            "match_confidence": parsed.get("confidence", 0.6),
        }
    except Exception as e:
        logger.error(f"Gemini DOM matching failed: {e}")
        return None


# ─── Full Matching Pipeline ───────────────────────────────────────────────────

async def match_workflow(target_url: str, workflow: dict) -> dict:
    """
    Open the target app URL, match all workflow steps to DOM elements.
    
    Returns enriched workflow with selectors for each step.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise ImportError("Playwright not installed. Run: pip install playwright && playwright install chromium")
    
    steps = workflow.get("steps", [])
    matched_steps = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 720})
        page = await context.new_page()
        
        logger.info(f"Opening {target_url}")
        await page.goto(target_url, wait_until="networkidle", timeout=30000)
        
        for step in steps:
            logger.info(f"Matching step {step['step']}: {step.get('instruction')}")
            matched = await match_step_to_dom(page, step)
            matched_steps.append(matched)
        
        await browser.close()
    
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
        print("Usage: python dom_matcher.py <workflow.json> <target_url>")
        sys.exit(1)
    
    with open(sys.argv[1]) as f:
        workflow = json.load(f)
    
    target_url = sys.argv[2]
    result = asyncio.run(match_workflow(target_url, workflow))
    print(json.dumps(result, indent=2, default=str))

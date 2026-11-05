"""Structured HTML → recipe draft via recipe-scrapers (schema.org / site parsers)."""

from __future__ import annotations

import re
from typing import Any

from recipe_scrapers import scrape_html
from recipe_scrapers._exceptions import RecipeScrapersExceptions

from api.core.logging import logger
from api.core.recipe_import.parse_ingredient import (
    ingredients_from_html,
    parse_ingredient_line,
)
from api.core.recipe_markup import enrich_recipe_text
from api.core.recipe_text import normalize_instruction_newlines


def _safe_call(fn, default=None):
    try:
        return fn()
    except Exception:  # noqa: BLE001 — scrapers raise many site-specific errors
        return default


def _format_instructions(scraper) -> str:
    steps = _safe_call(scraper.instructions_list, None)
    if isinstance(steps, list) and steps:
        lines: list[str] = []
        for index, step in enumerate(steps, start=1):
            text = str(step or "").strip()
            if not text:
                continue
            if re_has_leading_number(text):
                lines.append(text)
            else:
                lines.append(f"{index}. {text}")
        if lines:
            return normalize_instruction_newlines("\n".join(lines))

    raw = _safe_call(scraper.instructions, "") or ""
    text = str(raw).strip()
    if not text:
        return ""
    # If already multi-line without numbers, number them.
    if "\n" in text and not re_has_leading_number(text.splitlines()[0]):
        numbered = []
        for index, line in enumerate(text.splitlines(), start=1):
            line = line.strip()
            if line:
                numbered.append(
                    line if re_has_leading_number(line) else f"{index}. {line}"
                )
        return normalize_instruction_newlines("\n".join(numbered))
    return normalize_instruction_newlines(text)


def re_has_leading_number(text: str) -> bool:
    stripped = text.lstrip()
    if not stripped:
        return False
    # "1." / "1)" / "Step 1"
    if stripped[:1].isdigit():
        return True
    lower = stripped.lower()
    return lower.startswith("step ") and any(ch.isdigit() for ch in lower[5:8])


def _prep_time_minutes(scraper) -> float | None:
    total = _safe_call(scraper.total_time, None)
    if isinstance(total, (int, float)) and total > 0:
        return float(total)
    prep = _safe_call(scraper.prep_time, None)
    cook = _safe_call(scraper.cook_time, None)
    minutes = 0.0
    if isinstance(prep, (int, float)) and prep > 0:
        minutes += float(prep)
    if isinstance(cook, (int, float)) and cook > 0:
        minutes += float(cook)
    return minutes or None


def _servings_sentence(schema: dict[str, Any] | None) -> str | None:
    """Turn recipeYield into one line. Ranges win over a single count."""
    if not isinstance(schema, dict):
        return None
    raw = schema.get("recipeYield")
    if isinstance(raw, list):
        texts = [str(item).strip() for item in raw if str(item).strip()]
    elif raw:
        texts = [str(raw).strip()]
    else:
        return None
    chosen = next((text for text in texts if re.search(r"\d\s*[-–]\s*\d", text)), None)
    if chosen is None and texts:
        chosen = texts[0]
    if not chosen:
        return None
    span = re.search(r"(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)", chosen)
    if span:
        return f"Serves {span.group(1)}–{span.group(2)}."
    single = re.search(r"\d+(?:\.\d+)?", chosen)
    if not single:
        return None
    count = single.group(0)
    if count == "1":
        return "Serves 1."
    return f"Serves {count}."


def _strip_video_boilerplate(description: str) -> str:
    return re.sub(
        r"^(?:\*\*)?\s*recipe video above\.?\s*(?:\*\*)?\s*",
        "",
        description,
        count=1,
        flags=re.IGNORECASE,
    ).strip()


def scrape_recipe_html(html: str, *, page_url: str) -> dict[str, Any] | None:
    """Extract a recipe dict from HTML, or None if nothing usable was found."""
    try:
        scraper = scrape_html(
            html,
            org_url=page_url,
            online=False,
            wild_mode=True,
        )
    except RecipeScrapersExceptions as exc:
        logger.info("recipe-scrapers rejected %s: %s", page_url, exc)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.info("recipe-scrapers failed for %s: %s", page_url, exc)
        return None

    title = (_safe_call(scraper.title, "") or "").strip()
    ingredient_lines = _safe_call(scraper.ingredients, None) or []
    if not isinstance(ingredient_lines, list):
        ingredient_lines = []
    ingredient_lines = [str(x).strip() for x in ingredient_lines if str(x).strip()]

    instructions = _format_instructions(scraper)
    if not title or not ingredient_lines or not instructions:
        logger.info(
            "Incomplete scrape for %s (title=%s ingredients=%s instructions=%s)",
            page_url,
            bool(title),
            len(ingredient_lines),
            bool(instructions),
        )
        return None

    description = (_safe_call(scraper.description, "") or "").strip()
    schema = getattr(scraper, "schema", None)
    schema_data = getattr(schema, "data", None)
    soup = getattr(scraper, "soup", None)
    schema = schema_data if isinstance(schema_data, dict) else None
    description, instructions, notes = enrich_recipe_text(
        soup=soup,
        schema=schema,
        description=description,
        instructions=instructions,
    )
    description = _strip_video_boilerplate(description)
    servings = _servings_sentence(schema)
    if servings and not re.search(r"\bservings?\b|\bserves\b", description, re.I):
        description = (
            f"{description.rstrip()}\n\n{servings}" if description else servings
        )
    if not description:
        description = f"Imported recipe: {title}"

    ingredients = ingredients_from_html(soup)
    if not ingredients:
        ingredients = [parse_ingredient_line(line) for line in ingredient_lines]
    # Drop empty parse fallthroughs that lost the original text
    ingredients = [ing for ing in ingredients if (ing.get("name") or "").strip()]
    if not ingredients:
        return None

    return {
        "name": title[:200],
        "description": description[:4000],
        "instructions": normalize_instruction_newlines(instructions)[:20000],
        "notes": notes[:12000] if notes else None,
        "prep_time": _prep_time_minutes(scraper),
        "ingredients": ingredients,
        "method": "schema",
    }

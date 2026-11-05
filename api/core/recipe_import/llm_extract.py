"""LLM fallback when structured recipe markup is missing."""

from __future__ import annotations

from typing import Any

from api.core.llm.client import (
    ChatMessage,
    LlmClient,
    StubLlmClient,
    _extract_json_payload,
    get_llm_client,
)
from api.core.logging import logger
from api.core.recipe_import.parse_ingredient import parse_ingredient_line
from api.core.recipe_markup import html_to_markdown
from api.core.recipe_text import normalize_instruction_newlines

_MAX_TEXT_CHARS = 14_000


def _normalize_llm_recipe(parsed: Any) -> dict[str, Any] | None:
    if not isinstance(parsed, dict):
        return None

    # Tolerate {recipe: {...}} wrappers
    if "recipe" in parsed and isinstance(parsed["recipe"], dict):
        parsed = parsed["recipe"]

    name = str(parsed.get("name") or parsed.get("title") or "").strip()
    description = str(parsed.get("description") or "").strip()
    instructions = str(parsed.get("instructions") or "").strip()
    notes = parsed.get("notes")
    notes_str = str(notes).strip() if notes else None

    prep_raw = parsed.get("prep_time")
    prep_time: float | None
    try:
        prep_time = float(prep_raw) if prep_raw is not None and prep_raw != "" else None
    except (TypeError, ValueError):
        prep_time = None
    if prep_time is not None and prep_time <= 0:
        prep_time = None

    raw_ingredients = parsed.get("ingredients") or []
    if not isinstance(raw_ingredients, list):
        return None

    ingredients: list[dict[str, Any]] = []
    for item in raw_ingredients:
        if isinstance(item, str):
            ingredients.append(parse_ingredient_line(item))
            continue
        if not isinstance(item, dict):
            continue
        name_i = str(item.get("name") or "").strip()
        if not name_i and item.get("text"):
            ingredients.append(parse_ingredient_line(str(item["text"])))
            continue
        if not name_i:
            continue
        amount = item.get("amount")
        try:
            amount_f = float(amount) if amount is not None and amount != "" else None
        except (TypeError, ValueError):
            amount_f = None
        units = item.get("units")
        details = item.get("details")
        group_name = item.get("group_name")
        ingredients.append(
            {
                "name": name_i[:200],
                "amount": amount_f,
                "units": str(units)[:40] if units else None,
                "details": str(details)[:400] if details else None,
                "group_name": str(group_name).strip()[:80] if group_name else None,
            }
        )

    if not name or not instructions or not ingredients:
        return None

    if not description:
        description = f"Imported recipe: {name}"

    return {
        "name": name[:200],
        "description": description[:4000],
        "instructions": normalize_instruction_newlines(instructions)[:20000],
        "notes": notes_str[:12000] if notes_str else None,
        "prep_time": prep_time,
        "ingredients": ingredients,
        "method": "llm",
    }


async def extract_recipe_with_llm(
    *,
    html: str,
    page_url: str,
    llm: LlmClient | None = None,
) -> dict[str, Any] | None:
    """Ask the configured LLM to extract a recipe from page text.

    Returns None when no real LLM is configured (stub) or extraction fails.
    """
    client = llm or get_llm_client()
    if isinstance(client, StubLlmClient):
        # Don't invent a fake recipe for arbitrary URLs when no OpenRouter key.
        logger.info("Skipping LLM recipe extract for %s — stub LLM active", page_url)
        return None

    text = html_to_markdown(html)
    if len(text) < 80:
        return None
    if len(text) > _MAX_TEXT_CHARS:
        text = text[:_MAX_TEXT_CHARS] + "\n…[truncated]"

    system = (
        "You extract cooking recipes from web page text. "
        "Return a single JSON object only (no Markdown fences) with keys: "
        "name (string), description (string), instructions (string), "
        "notes (string|null), prep_time (number minutes|null), ingredients "
        "(array of objects with name, amount number|null, units string|null, "
        "details string|null, group_name string|null). "
        "Set group_name when the page groups ingredients (Broth, Toppings). "
        "Keep both sides of a dual measurement: amount and units are the first "
        "quantity, and details starts with the other, such as or 3 lb. "
        "description, instructions, and notes are Markdown. Preserve bold "
        "(**like this**), italics (*like this*), and lists from the page. "
        "Put each instruction step on its own line, numbered, and use ## "
        "headings only for sections such as Sauce or Assembly. "
        'If the page is not a recipe, return {"error":"not_a_recipe"}.'
    )
    user = "IMPORT_RECIPE\n" f"URL: {page_url}\n\n" "PAGE TEXT:\n" f"{text}"

    try:
        result = await client.complete(
            [
                ChatMessage(role="system", content=system),
                ChatMessage(role="user", content=user),
            ],
            temperature=0.1,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM recipe extract failed for %s: %s", page_url, exc)
        return None

    parsed = result.parsed
    if parsed is None and result.content:
        try:
            parsed = _extract_json_payload(result.content)
        except ValueError:
            return None

    if isinstance(parsed, dict) and parsed.get("error"):
        return None

    # OpenRouter client normalizes build-mode into {recipes:[...]} when
    # BUILD_RECIPES is in the prompt; our IMPORT marker may leave raw dicts.
    if isinstance(parsed, dict) and isinstance(parsed.get("recipes"), list):
        for item in parsed["recipes"]:
            normalized = _normalize_llm_recipe(item)
            if normalized:
                return normalized

    return _normalize_llm_recipe(parsed)

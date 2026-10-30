"""LLM-assisted recipe patching from a free-text edit instruction."""

from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session

from api.core.llm.client import (
    ChatMessage,
    LlmClient,
    _extract_json_payload,
    get_llm_client,
)
from api.core.logging import logger
from api.core.recipe_import.llm_extract import _normalize_llm_recipe
from api.core.recipe_import.parse_ingredient import parse_ingredient_line
from api.core.recipe_text import normalize_instruction_newlines
from api.models import Recipe


class RecipeAiEditError(Exception):
    """Raised when the model cannot produce a usable recipe patch."""

    def __init__(self, message: str, *, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _recipe_snapshot(recipe: Recipe) -> dict[str, Any]:
    ingredients = []
    for ing in recipe.ingredients or []:
        ingredients.append(
            {
                "name": ing.name,
                "amount": ing.amount,
                "units": ing.units,
                "details": ing.details,
            }
        )
    return {
        "name": recipe.name,
        "description": recipe.description,
        "instructions": recipe.instructions,
        "notes": recipe.notes,
        "prep_time": recipe.prep_time,
        "ingredients": ingredients,
    }


def _normalize_edit_result(
    parsed: Any,
    *,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    """Normalize LLM output into a full recipe patch, filling gaps from fallback."""
    if isinstance(parsed, dict) and isinstance(parsed.get("recipes"), list):
        for item in parsed["recipes"]:
            normalized = _normalize_llm_recipe(item)
            if normalized:
                parsed = item
                break

    if (
        isinstance(parsed, dict)
        and "recipe" in parsed
        and isinstance(parsed["recipe"], dict)
    ):
        parsed = parsed["recipe"]

    if not isinstance(parsed, dict):
        raise RecipeAiEditError("The AI returned an unexpected response. Try again.")

    if parsed.get("error"):
        raise RecipeAiEditError(
            str(parsed.get("message") or "The AI couldn’t apply that edit.")
        )

    # Prefer the import normalizer when the model returns a complete recipe.
    complete = _normalize_llm_recipe(parsed)
    if complete:
        return {
            "name": complete["name"],
            "description": complete["description"],
            "instructions": complete["instructions"],
            "notes": complete.get("notes"),
            "prep_time": complete.get("prep_time"),
            "ingredients": complete["ingredients"],
        }

    # Partial responses: merge field-by-field onto the current recipe.
    name = str(parsed.get("name") or parsed.get("title") or fallback["name"]).strip()
    description = str(
        parsed.get("description") or fallback["description"] or ""
    ).strip()
    instructions = str(
        parsed.get("instructions") or fallback["instructions"] or ""
    ).strip()
    notes_raw = parsed.get("notes") if "notes" in parsed else fallback.get("notes")
    notes = str(notes_raw).strip() if notes_raw else None

    prep_raw = (
        parsed.get("prep_time") if "prep_time" in parsed else fallback.get("prep_time")
    )
    prep_time: float | None
    try:
        prep_time = float(prep_raw) if prep_raw is not None and prep_raw != "" else None
    except (TypeError, ValueError):
        prep_time = fallback.get("prep_time")
    if prep_time is not None and prep_time <= 0:
        prep_time = None

    if "ingredients" in parsed and isinstance(parsed["ingredients"], list):
        ingredients: list[dict[str, Any]] = []
        for item in parsed["ingredients"]:
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
                amount_f = (
                    float(amount) if amount is not None and amount != "" else None
                )
            except (TypeError, ValueError):
                amount_f = None
            units = item.get("units")
            details = item.get("details")
            ingredients.append(
                {
                    "name": name_i[:200],
                    "amount": amount_f,
                    "units": str(units)[:40] if units else None,
                    "details": str(details)[:200] if details else None,
                }
            )
    else:
        ingredients = list(fallback.get("ingredients") or [])

    if not name or not instructions:
        raise RecipeAiEditError(
            "The AI returned an incomplete recipe. Try a clearer instruction."
        )
    if not ingredients:
        raise RecipeAiEditError(
            "The AI removed all ingredients. Try a different instruction."
        )
    if not description:
        description = fallback.get("description") or f"Edited recipe: {name}"

    return {
        "name": name[:200],
        "description": description[:2000],
        "instructions": normalize_instruction_newlines(instructions)[:20000],
        "notes": notes[:2000] if notes else None,
        "prep_time": prep_time,
        "ingredients": ingredients,
    }


async def patch_recipe_with_llm(
    *,
    recipe: Recipe,
    instruction: str,
    llm: LlmClient | None = None,
) -> dict[str, Any]:
    """Ask the LLM to rewrite a recipe based on a free-text instruction.

    Returns a normalized dict with name/description/instructions/notes/
    prep_time/ingredients. Raises RecipeAiEditError on failure.
    """
    instruction = (instruction or "").strip()
    if not instruction:
        raise RecipeAiEditError("Describe what you’d like to change.", status_code=400)
    if len(instruction) > 4000:
        raise RecipeAiEditError(
            "That instruction is too long. Keep it under 4000 characters.",
            status_code=400,
        )

    snapshot = _recipe_snapshot(recipe)
    client = llm or get_llm_client()

    system = (
        "You edit cooking recipes based on a user's instruction. "
        "You receive the current recipe as JSON and must return a single JSON "
        "object only (no markdown) with keys: name (string), description "
        "(string), instructions (string with numbered steps separated by "
        "newlines), notes (string|null), prep_time (number minutes|null), "
        "ingredients (array of objects with name, amount number|null, units "
        "string|null, details string|null). "
        "Apply the requested changes and keep everything else as close as "
        "possible to the original. Always return the full updated recipe, "
        "including ingredients that did not change. "
        "If the instruction is impossible or unrelated to cooking, return "
        '{"error":"cannot_edit","message":"short reason"}.'
    )
    user = (
        "EDIT_RECIPE\n"
        f"INSTRUCTION:\n{instruction}\n\n"
        "CURRENT_RECIPE:\n"
        f"{json.dumps(snapshot, ensure_ascii=False)}"
    )

    try:
        result = await client.complete(
            [
                ChatMessage(role="system", content=system),
                ChatMessage(role="user", content=user),
            ],
            temperature=0.3,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM recipe edit failed for recipe %s: %s", recipe.id, exc)
        raise RecipeAiEditError(
            "The AI couldn’t edit this recipe right now. Try again shortly.",
            status_code=502,
        ) from exc

    parsed = result.parsed
    if parsed is None and result.content:
        try:
            parsed = _extract_json_payload(result.content)
        except ValueError as exc:
            raise RecipeAiEditError(
                "The AI returned an unreadable response. Try again."
            ) from exc

    return _normalize_edit_result(parsed, fallback=snapshot)


def apply_recipe_patch(
    *,
    recipe: Recipe,
    patch: dict[str, Any],
    user_id: int,
    session: Session,
) -> Recipe:
    """Append a new recipe version from an LLM patch. Prior versions stay put."""
    from api.core.recipe_versions import CHANGE_AI_EDIT, append_version

    return append_version(
        session,
        recipe,
        user_id=user_id,
        name=patch["name"],
        description=patch["description"],
        instructions=patch["instructions"],
        notes=patch.get("notes"),
        prep_time=patch.get("prep_time"),
        cover_image_id=recipe.cover_image_id,
        ingredients=patch.get("ingredients") or [],
        change_kind=CHANGE_AI_EDIT,
    )

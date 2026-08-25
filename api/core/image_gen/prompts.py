"""Shared prompt / search-query builders for recipe cover images."""

from __future__ import annotations

from typing import Any

# Low-signal tokens we never want as the sole search anchor.
_SKIP_INGREDIENTS = {
    "salt",
    "pepper",
    "water",
    "oil",
    "olive oil",
    "vegetable oil",
    "black pepper",
    "kosher salt",
    "butter",
    "garlic",
    "onion",
    "sugar",
    "flour",
}


def recipe_image_keywords(
    title: str,
    ingredients: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Concrete food nouns for search ranking (title words first, then ingredients)."""
    names: list[str] = []
    stop = {
        "with",
        "and",
        "the",
        "over",
        "a",
        "in",
        "of",
        "for",
        "sheet-pan",
        "sheet",
        "pan",
        "one-skillet",
        "skillet",
        "weeknight",
        "stubbed",
        "bowl",
        "style",
        "easy",
        "best",
        "homemade",
        "simple",
        "quick",
    }
    for token in (title or "").lower().replace(",", " ").split():
        token = token.strip("-")
        if len(token) < 4 or token in stop or token in names:
            continue
        names.append(token)
        if len(names) >= 3:
            break

    for ing in ingredients or []:
        name = str(ing.get("name") or "").strip().lower()
        if not name or name in _SKIP_INGREDIENTS:
            continue
        if name not in names:
            names.append(name)
        if len(names) >= 5:
            break

    return names


def build_recipe_image_prompt(
    title: str,
    description: str | None = None,
    ingredients: list[dict[str, Any]] | None = None,
) -> str:
    """Build a short food-photo query from recipe fields.

    Used as a diffusion prompt later, and as an Openverse search query for the
    broke adapter. Prefer the dish title so renaming the recipe changes results.
    """
    clean_title = (title or "").strip()
    keywords = recipe_image_keywords(title, ingredients)

    if clean_title:
        return f"{clean_title} dinner plated food"

    if keywords:
        return f"{' '.join(keywords[:3])} dinner plated food"

    desc = (description or "").strip()
    if desc:
        return f"{desc.split('.')[0].strip()[:80]} food"

    return "homemade dinner plated food"

"""Tools exposed to the meal-plan LLM, scoped to the current user's access."""

from __future__ import annotations

from typing import Any

from api.core.database import SessionDep
from api.core.household import get_membership, user_can_access_recipe
from api.core.recipe_search import search_user_recipes_dicts
from api.models import Recipe, User


def tool_definitions() -> list[dict[str, Any]]:
    """JSON-schema style tool defs for an OpenRouter tool-calling turn."""
    return [
        {
            "type": "function",
            "function": {
                "name": "search_user_recipes",
                "description": (
                    "Semantic + keyword search over recipes the user can access "
                    "(household or public) by meaning, name, description, "
                    "or ingredients."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "limit": {"type": "integer", "default": 8},
                    },
                    "required": ["query"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_recipe",
                "description": "Fetch a recipe by id if the user can access it.",
                "parameters": {
                    "type": "object",
                    "properties": {"recipe_id": {"type": "integer"}},
                    "required": ["recipe_id"],
                },
            },
        },
    ]


def search_user_recipes(
    session: SessionDep,
    user: User,
    query: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    return search_user_recipes_dicts(session, user, query, limit=limit)


def get_accessible_recipe(
    session: SessionDep,
    user: User,
    recipe_id: int,
) -> dict[str, Any] | None:
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        return None
    if not user_can_access_recipe(session, user, recipe):
        return None
    membership = get_membership(session, user.id)
    household_id = membership.household_id if membership else None
    return {
        "id": recipe.id,
        "name": recipe.name,
        "description": recipe.description,
        "instructions": recipe.instructions,
        "notes": recipe.notes,
        "prep_time": recipe.prep_time,
        "ingredients": [
            {
                "name": i.name,
                "amount": i.amount,
                "units": i.units,
                "details": i.details,
            }
            for i in (recipe.ingredients or [])
        ],
        "owned": household_id is not None and recipe.household_id == household_id,
    }

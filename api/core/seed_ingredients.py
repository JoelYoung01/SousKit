"""Sample ingredients + near-term planned meals for grocery list demos."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlmodel import Session, select

from api.core.config import settings
from api.models import Ingredient, PlannedRecipe, Recipe, User

logger = logging.getLogger(__name__)


def _seed_owner(session: Session) -> User | None:
    user = session.exec(
        select(User).where(User.email == settings.SEED_ADMIN_EMAIL)
    ).first()
    if user is None:
        user = session.exec(select(User)).first()
    return user


# Recipe name -> ingredient rows
SAMPLE_INGREDIENTS: dict[str, list[dict]] = {
    "Spaghetti Carbonara": [
        {"name": "Spaghetti", "amount": 12, "units": "oz"},
        {"name": "Eggs", "amount": 3, "units": None},
        {"name": "Parmesan", "amount": 1, "units": "cup"},
        {"name": "Pancetta", "amount": 4, "units": "oz"},
        {"name": "Black pepper", "amount": 1, "units": "tsp"},
    ],
    "Chicken Stir Fry": [
        {"name": "Chicken breast", "amount": 1, "units": "lb"},
        {"name": "Broccoli", "amount": 2, "units": "cups"},
        {"name": "Bell pepper", "amount": 1, "units": None},
        {"name": "Soy sauce", "amount": 3, "units": "tbsp"},
        {"name": "Garlic", "amount": 3, "units": "cloves"},
        {"name": "Vegetable oil", "amount": 2, "units": "tbsp"},
    ],
    "Greek Salad": [
        {"name": "Cucumber", "amount": 1, "units": None},
        {"name": "Tomato", "amount": 2, "units": None},
        {"name": "Red onion", "amount": 0.5, "units": None},
        {"name": "Kalamata olives", "amount": 0.5, "units": "cup"},
        {"name": "Feta cheese", "amount": 4, "units": "oz"},
        {"name": "Olive oil", "amount": 3, "units": "tbsp"},
        {"name": "Oregano", "amount": 1, "units": "tsp"},
    ],
    "Beef Tacos": [
        {"name": "Ground beef", "amount": 1, "units": "lb"},
        {"name": "Taco seasoning", "amount": 2, "units": "tbsp"},
        {"name": "Taco shells", "amount": 8, "units": None},
        {"name": "Lettuce", "amount": 2, "units": "cups"},
        {"name": "Tomato", "amount": 1, "units": None},
        {"name": "Cheddar", "amount": 1, "units": "cup"},
        {"name": "Sour cream", "amount": 0.5, "units": "cup"},
    ],
    "Chicken Noodle Soup": [
        {"name": "Chicken breast", "amount": 2, "units": "lb"},
        {"name": "Egg noodles", "amount": 8, "units": "oz"},
        {"name": "Carrot", "amount": 3, "units": None},
        {"name": "Celery", "amount": 2, "units": "stalks"},
        {"name": "Onion", "amount": 1, "units": None},
        {"name": "Chicken broth", "amount": 8, "units": "cups"},
        {"name": "Garlic", "amount": 2, "units": "cloves"},
    ],
    "Blueberry Pancakes": [
        {"name": "Flour", "amount": 2, "units": "cups"},
        {"name": "Milk", "amount": 1.5, "units": "cups"},
        {"name": "Eggs", "amount": 2, "units": None},
        {"name": "Blueberries", "amount": 1, "units": "cup"},
        {"name": "Butter", "amount": 3, "units": "tbsp"},
        {"name": "Sugar", "amount": 2, "units": "tbsp"},
    ],
    "Guacamole": [
        {"name": "Avocado", "amount": 3, "units": None},
        {"name": "Lime", "amount": 1, "units": None},
        {"name": "Red onion", "amount": 0.25, "units": "cup"},
        {"name": "Tomato", "amount": 1, "units": None},
        {"name": "Cilantro", "amount": 2, "units": "tbsp"},
        {"name": "Salt", "amount": 0.5, "units": "tsp"},
    ],
    "Vegetable Soup": [
        {"name": "Onion", "amount": 1, "units": None},
        {"name": "Garlic", "amount": 3, "units": "cloves"},
        {"name": "Carrot", "amount": 2, "units": None},
        {"name": "Celery", "amount": 2, "units": "stalks"},
        {"name": "Potato", "amount": 2, "units": None},
        {"name": "Vegetable broth", "amount": 6, "units": "cups"},
        {"name": "Olive oil", "amount": 2, "units": "tbsp"},
    ],
}


def ensure_sample_ingredients(session: Session) -> None:
    user = _seed_owner(session)
    if user is None:
        return

    recipes = session.exec(select(Recipe).where(Recipe.created_by_id == user.id)).all()
    by_name = {r.name: r for r in recipes}
    created = 0

    for recipe_name, rows in SAMPLE_INGREDIENTS.items():
        recipe = by_name.get(recipe_name)
        if recipe is None:
            continue
        if recipe.current_version_id is None:
            continue
        existing = session.exec(
            select(Ingredient).where(
                Ingredient.recipe_version_id == recipe.current_version_id
            )
        ).first()
        if existing is not None:
            continue
        # Sample data fills version 1 in place when it was seeded empty.
        # User edits append a new version instead of rewriting history.
        for row in rows:
            session.add(
                Ingredient(
                    created_by_id=user.id,
                    created_on=datetime.now(UTC),
                    name=row["name"],
                    amount=row["amount"],
                    units=row["units"],
                    details=None,
                    recipe_version_id=recipe.current_version_id,
                )
            )
            created += 1

    if created:
        session.commit()
        logger.info("Created %s sample ingredients", created)
    else:
        logger.info("Sample ingredients already present, skipping")


def ensure_sample_planned_meals(session: Session) -> None:
    user = _seed_owner(session)
    if user is None:
        return

    existing = session.exec(
        select(PlannedRecipe).where(PlannedRecipe.created_by_id == user.id)
    ).first()
    if existing is not None:
        logger.info("Planned meals already present, skipping")
        return

    recipes = session.exec(select(Recipe).where(Recipe.created_by_id == user.id)).all()
    by_name = {r.name: r for r in recipes}
    plan_names = [
        ("Chicken Stir Fry", 0),
        ("Greek Salad", 1),
        ("Beef Tacos", 2),
        ("Spaghetti Carbonara", 3),
        ("Chicken Noodle Soup", 5),
        ("Blueberry Pancakes", 6),
    ]

    today = datetime.now(UTC).replace(hour=12, minute=0, second=0, microsecond=0)
    added = 0
    for name, offset in plan_names:
        recipe = by_name.get(name)
        if recipe is None:
            continue
        session.add(
            PlannedRecipe(
                recipe_id=recipe.id,
                created_by_id=user.id,
                household_id=recipe.household_id,
                created_on=datetime.now(UTC),
                planned_for=today + timedelta(days=offset),
            )
        )
        added += 1

    if added:
        session.commit()
        logger.info("Created %s sample planned meals", added)

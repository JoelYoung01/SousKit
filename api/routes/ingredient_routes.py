from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select

from api.core.authentication import CurrentUserDep, verify_access_token
from api.core.database import SessionDep
from api.core.household import user_can_edit_recipe
from api.core.recipe_search import refresh_recipe_embedding_by_id
from api.core.recipe_versions import (
    append_version,
    content_from_version,
    require_current_version,
)
from api.models import Ingredient, Recipe
from api.schemas import IngredientCreate, IngredientDetail, IngredientUpdate

router = APIRouter(
    prefix="/ingredient",
    dependencies=[Depends(verify_access_token)],
    tags=["Ingredient"],
)


def _recipe_for_ingredient(session: SessionDep, recipe_id: int) -> Recipe:
    recipe = session.get(Recipe, recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="That recipe couldn’t be found.")
    return recipe


def _rows_from_head(head) -> list[dict]:
    return [
        {
            "name": ing.name,
            "amount": ing.amount,
            "units": ing.units,
            "details": ing.details,
        }
        for ing in head.ingredients or []
    ]


def _append_ingredient_edit(
    session: SessionDep,
    recipe: Recipe,
    user_id: int,
    rows: list[dict],
) -> Recipe:
    head = require_current_version(session, recipe)
    content = content_from_version(head)
    return append_version(
        session,
        recipe,
        user_id=user_id,
        name=content.name,
        description=content.description,
        instructions=content.instructions,
        notes=content.notes,
        prep_time=content.prep_time,
        cover_image_id=content.cover_image_id,
        ingredients=rows,
        change_kind="edit",
    )


@router.post(
    "/",
    response_model=IngredientDetail,
)
def create_ingredient(
    ingredient: IngredientCreate, currentUser: CurrentUserDep, session: SessionDep
):
    """Append a version that adds one ingredient. Previous versions stay put."""
    recipe = _recipe_for_ingredient(session, ingredient.recipe_id)
    if not user_can_edit_recipe(session, currentUser, recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only change ingredients on household recipes.",
        )

    head = require_current_version(session, recipe)
    rows = _rows_from_head(head)
    rows.append(ingredient.model_dump(exclude={"recipe_id"}))
    updated = _append_ingredient_edit(session, recipe, currentUser.id, rows)
    refresh_recipe_embedding_by_id(session, updated.id)
    current = require_current_version(session, updated)
    created = list(current.ingredients or [])[-1]
    return created


@router.put(
    "/{ingredient_id:int}/",
    response_model=IngredientDetail,
)
def update_ingredient(
    ingredient_id: int,
    ingredient: IngredientUpdate,
    currentUser: CurrentUserDep,
    session: SessionDep,
):
    """Append a version with this ingredient changed. The old row is kept."""
    existing_ingredient = session.exec(
        select(Ingredient).where(Ingredient.id == ingredient_id)
    ).first()

    if not existing_ingredient:
        raise HTTPException(
            status_code=404,
            detail="That ingredient couldn’t be found.",
        )

    recipe = existing_ingredient.recipe
    if recipe is None:
        raise HTTPException(status_code=404, detail="That recipe couldn’t be found.")
    if not user_can_edit_recipe(session, currentUser, recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only change ingredients on household recipes.",
        )

    head = require_current_version(session, recipe)
    rows = _rows_from_head(head)
    match_at = next(
        (
            idx
            for idx, ing in enumerate(head.ingredients or [])
            if ing.id == ingredient_id
        ),
        None,
    )
    if match_at is None:
        raise HTTPException(
            status_code=404,
            detail="That ingredient isn’t on the current version of this recipe.",
        )
    merged = rows[match_at] | ingredient.model_dump(exclude_unset=True)
    rows[match_at] = merged
    updated = _append_ingredient_edit(session, recipe, currentUser.id, rows)
    refresh_recipe_embedding_by_id(session, updated.id)
    current = require_current_version(session, updated)
    return list(current.ingredients or [])[match_at]


@router.delete("/{ingredient_id:int}/")
def delete_ingredient(
    ingredient_id: int, current_user: CurrentUserDep, session: SessionDep
):
    """Append a version that omits this ingredient."""
    existing_ingredient = session.exec(
        select(Ingredient).where(Ingredient.id == ingredient_id)
    ).first()
    if not existing_ingredient:
        raise HTTPException(
            status_code=404,
            detail="That ingredient couldn’t be found.",
        )

    recipe = existing_ingredient.recipe
    if recipe is None:
        raise HTTPException(status_code=404, detail="That recipe couldn’t be found.")
    if not user_can_edit_recipe(session, current_user, recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only remove ingredients from household recipes.",
        )

    head = require_current_version(session, recipe)
    if not any(ing.id == ingredient_id for ing in head.ingredients or []):
        raise HTTPException(
            status_code=404,
            detail="That ingredient isn’t on the current version of this recipe.",
        )
    rows = [
        row
        for ing, row in zip(head.ingredients or [], _rows_from_head(head), strict=True)
        if ing.id != ingredient_id
    ]
    updated = _append_ingredient_edit(session, recipe, current_user.id, rows)
    refresh_recipe_embedding_by_id(session, updated.id)

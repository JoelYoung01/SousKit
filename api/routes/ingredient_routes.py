from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import update
from sqlmodel import select

from api.core.authentication import CurrentUserDep, verify_access_token
from api.core.database import SessionDep
from api.core.household import user_can_edit_recipe
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


@router.post(
    "/",
    response_model=IngredientDetail,
)
def create_ingredient(
    ingredient: IngredientCreate, currentUser: CurrentUserDep, session: SessionDep
):
    recipe = _recipe_for_ingredient(session, ingredient.recipe_id)
    if not user_can_edit_recipe(session, currentUser, recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only change ingredients on household recipes.",
        )

    ingredient_data = ingredient.model_dump()
    ingredient_data["created_on"] = datetime.now(timezone.utc)
    ingredient_data["created_by_id"] = currentUser.id
    db_ingredient = Ingredient.model_validate(ingredient_data)
    session.add(db_ingredient)
    session.commit()
    session.refresh(db_ingredient)
    return db_ingredient


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
    existing_ingredient = session.exec(
        select(Ingredient).where(Ingredient.id == ingredient_id)
    ).first()

    if not existing_ingredient:
        raise HTTPException(
            status_code=404,
            detail="That ingredient couldn’t be found.",
        )

    recipe = _recipe_for_ingredient(session, existing_ingredient.recipe_id)
    if not user_can_edit_recipe(session, currentUser, recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only change ingredients on household recipes.",
        )

    update_stmt = (
        update(Ingredient)
        .where(Ingredient.id == ingredient_id)
        .values(**ingredient.model_dump(exclude_unset=True))
        .execution_options(synchronize_session="fetch")
    )
    session.exec(update_stmt)
    session.commit()
    session.refresh(existing_ingredient)
    return existing_ingredient


@router.delete("/{ingredient_id:int}/")
def delete_ingredient(
    ingredient_id: int, current_user: CurrentUserDep, session: SessionDep
):
    existing_ingredient = session.exec(
        select(Ingredient).where(Ingredient.id == ingredient_id)
    ).first()
    if not existing_ingredient:
        raise HTTPException(
            status_code=404,
            detail="That ingredient couldn’t be found.",
        )

    recipe = _recipe_for_ingredient(session, existing_ingredient.recipe_id)
    if not user_can_edit_recipe(session, current_user, recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only remove ingredients from household recipes.",
        )

    session.delete(existing_ingredient)
    session.commit()

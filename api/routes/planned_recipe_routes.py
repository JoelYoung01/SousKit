from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import selectinload
from sqlmodel import select

from api.core.authentication import CurrentUserDep, verify_access_token
from api.core.database import SessionDep
from api.core.household import (
    ensure_user_household,
    require_membership,
    user_can_access_recipe,
    user_can_edit_plan,
)
from api.models import PlannedRecipe, Recipe, RecipeVersion
from api.schemas import (
    PlannedRecipeCreate,
    PlannedRecipeDetail,
    PlannedRecipeUpdate,
    TimeFrameRequest,
)

router = APIRouter(
    prefix="/planned-recipe",
    dependencies=[Depends(verify_access_token)],
    tags=["Planned Recipe"],
)


def _planned_recipe_options():
    return (
        selectinload(PlannedRecipe.created_by),
        selectinload(PlannedRecipe.recipe)
        .selectinload(Recipe.current_version)
        .selectinload(RecipeVersion.cover_image),
    )


@router.post("/time-frame/", response_model=list[PlannedRecipeDetail])
def get_recipes_in_time_frame(
    body: TimeFrameRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    household, _ = require_membership(session, current_user)
    recipes = session.exec(
        select(PlannedRecipe)
        .where(
            PlannedRecipe.household_id == household.id,
            PlannedRecipe.planned_for >= body.start,
            PlannedRecipe.planned_for <= body.end,
        )
        .options(*_planned_recipe_options())
    ).all()
    return recipes


@router.post("/", response_model=PlannedRecipeDetail)
def create_planned_recipe(
    planned_recipe: PlannedRecipeCreate,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    household = ensure_user_household(session, current_user)
    recipe = session.get(Recipe, planned_recipe.recipe_id)
    if not recipe or not user_can_access_recipe(session, current_user, recipe):
        raise HTTPException(
            status_code=404,
            detail="That recipe couldn’t be found.",
        )

    pr_dict = planned_recipe.model_dump()
    pr_dict["created_by_id"] = current_user.id
    pr_dict["household_id"] = household.id
    pr_dict["created_on"] = datetime.now(UTC)

    db_planned_recipe = PlannedRecipe.model_validate(pr_dict)
    session.add(db_planned_recipe)
    session.commit()
    session.refresh(db_planned_recipe)
    # Re-fetch with relationships for the slim card payload.
    return session.exec(
        select(PlannedRecipe)
        .where(PlannedRecipe.id == db_planned_recipe.id)
        .options(*_planned_recipe_options())
    ).one()


@router.put("/{planned_recipe_id}", response_model=PlannedRecipeDetail)
def update_planned_recipe(
    planned_recipe_id: int,
    planned_recipe: PlannedRecipeUpdate,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    db_planned_recipe = session.get(PlannedRecipe, planned_recipe_id)
    if not db_planned_recipe:
        raise HTTPException(
            status_code=404, detail="That planned meal couldn’t be found."
        )
    if not user_can_edit_plan(session, current_user, db_planned_recipe):
        raise HTTPException(
            status_code=403,
            detail="You can only update meals on your household plan.",
        )

    update_stmt = (
        update(PlannedRecipe)
        .where(PlannedRecipe.id == planned_recipe_id)
        .values(**planned_recipe.model_dump(exclude_unset=True))
        .execution_options(synchronize_session="fetch")
    )
    session.exec(update_stmt)
    session.commit()
    return session.exec(
        select(PlannedRecipe)
        .where(PlannedRecipe.id == planned_recipe_id)
        .options(*_planned_recipe_options())
    ).one()


@router.delete("/{planned_recipe_id}")
def delete_planned_recipe(
    planned_recipe_id: int,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    db_planned_recipe = session.get(PlannedRecipe, planned_recipe_id)
    if not db_planned_recipe:
        raise HTTPException(
            status_code=404, detail="That planned meal couldn’t be found."
        )
    if not user_can_edit_plan(session, current_user, db_planned_recipe):
        raise HTTPException(
            status_code=403,
            detail="You can only remove meals from your household plan.",
        )

    session.delete(db_planned_recipe)
    session.commit()
    return {"message": "Planned recipe deleted successfully"}

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, update
from sqlalchemy.orm import selectinload
from sqlmodel import select

from api.core.authentication import CurrentUserDep, verify_access_token
from api.core.database import SessionDep
from api.core.household import (
    ensure_user_household,
    recipe_access_filter,
    require_membership,
    user_can_access_recipe,
    user_can_edit_recipe,
)
from api.core.image_gen.service import (
    generate_recipe_cover_upload,
    generate_recipe_cover_uploads,
)
from api.core.recipe_ai_edit import (
    RecipeAiEditError,
    apply_recipe_patch,
    patch_recipe_with_llm,
)
from api.core.recipe_import import import_recipe_from_url
from api.core.recipe_import.fetch import RecipeImportError
from api.core.recipe_search import (
    refresh_recipe_embedding,
    refresh_recipe_embedding_by_id,
    search_accessible_recipes,
)
from api.models import Ingredient, Recipe
from api.schemas import (
    CountResponse,
    RecipeAiEditRequest,
    RecipeCard,
    RecipeCoverGenerateRequest,
    RecipeCoverGenerateResponse,
    RecipeCreate,
    RecipeDetail,
    RecipeImportFromUrlRequest,
    RecipeUpdate,
)

router = APIRouter(
    prefix="/recipe",
    dependencies=[Depends(verify_access_token)],
    tags=["Recipe"],
)
unauth_router = APIRouter(
    prefix="/recipe",
    tags=["Recipe"],
)


def _recipe_detail_options():
    return (
        selectinload(Recipe.cover_image),
        selectinload(Recipe.created_by),
        selectinload(Recipe.ingredients),
    )


@router.post("/import-from-url/", response_model=RecipeDetail)
async def import_recipe_from_url_route(
    body: RecipeImportFromUrlRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Fetch a public recipe page, extract structured data, and save a private recipe.

    Prefer schema.org / site scrapers (no LLM). Falls back to OpenRouter when
    structured markup is missing and ``OPENROUTER_API_KEY`` is configured.
    """
    try:
        draft = await import_recipe_from_url(body.url)
    except RecipeImportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    household = ensure_user_household(session, current_user)
    now = datetime.now(UTC)
    db_recipe = Recipe(
        created_by_id=current_user.id,
        household_id=household.id,
        created_on=now,
        name=draft.name,
        description=draft.description,
        instructions=draft.instructions,
        notes=draft.notes,
        public=False,
        prep_time=draft.prep_time,
    )
    session.add(db_recipe)
    session.commit()
    session.refresh(db_recipe)

    for ing in draft.ingredients:
        session.add(
            Ingredient(
                created_by_id=current_user.id,
                created_on=now,
                name=str(ing.get("name") or "ingredient")[:200],
                amount=ing.get("amount"),
                units=(str(ing["units"])[:40] if ing.get("units") else None),
                details=(str(ing["details"])[:200] if ing.get("details") else None),
                recipe_id=db_recipe.id,
            )
        )
    session.commit()

    cover = generate_recipe_cover_upload(
        user=current_user,
        db=session,
        title=draft.name,
        description=draft.description,
        ingredients=draft.ingredients,
    )
    if cover is not None:
        db_recipe.cover_image_id = cover.id
        session.add(db_recipe)
        session.commit()

    recipe = session.exec(
        select(Recipe)
        .where(Recipe.id == db_recipe.id)
        .options(*_recipe_detail_options())
    ).first()
    if recipe is not None:
        refresh_recipe_embedding(session, recipe, commit=True)
        recipe = session.exec(
            select(Recipe)
            .where(Recipe.id == db_recipe.id)
            .options(*_recipe_detail_options())
        ).first()
    return recipe


@router.post("/generate-cover/", response_model=RecipeCoverGenerateResponse)
def generate_recipe_cover(
    body: RecipeCoverGenerateRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Fetch/generate cover image options from the active image provider.

    Search providers (broke / Openverse) return up to ``limit`` candidates so
    the client can show a picker. True generators return a single option.
    Creates Upload rows owned by the current user; the client sets
    ``cover_image_id`` on create/update after the user picks one.
    """
    ingredients = [
        {"name": ing.name} for ing in body.ingredients if (ing.name or "").strip()
    ]
    uploads, provider, mode = generate_recipe_cover_uploads(
        user=current_user,
        db=session,
        title=body.name,
        description=body.description,
        ingredients=ingredients,
        limit=body.limit,
    )
    if not uploads:
        if provider == "stub":
            detail = (
                "Cover image search isn’t enabled on this server. "
                "Upload your own photo, or ask an admin to set "
                "IMAGE_GEN_PROVIDER=broke."
            )
        else:
            detail = (
                "Couldn’t find suitable cover images for that recipe. "
                "Try a clearer dish name, or upload your own photo."
            )
        raise HTTPException(status_code=404, detail=detail)
    return {
        "provider": provider,
        "mode": mode,
        "options": uploads,
    }


@unauth_router.get("/public/", response_model=list[RecipeDetail])
def get_public_recipes(
    session: SessionDep,
    user: int | None = None,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 100,
):
    stmt = (
        select(Recipe)
        .where(Recipe.public)
        .options(*_recipe_detail_options())
        .offset(offset)
        .limit(limit)
    )

    if user:
        stmt = stmt.where(Recipe.created_by_id == user)

    recipes = session.exec(stmt).all()
    return recipes


@router.get("/all/", response_model=list[RecipeCard])
def get_all_recipes(
    current_user: CurrentUserDep,
    session: SessionDep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 50,
):
    household, _ = require_membership(session, current_user)
    recipes = session.exec(
        select(Recipe)
        .where(recipe_access_filter(household.id))
        .options(selectinload(Recipe.cover_image))
        .offset(offset)
        .limit(limit)
    ).all()
    return recipes


@router.get("/user/", response_model=list[RecipeCard])
def get_users_recipes(
    current_user: CurrentUserDep,
    session: SessionDep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 50,
):
    """Recipes in the current user's household (shared library)."""
    household, _ = require_membership(session, current_user)
    recipes = session.exec(
        select(Recipe)
        .where(Recipe.household_id == household.id)
        .options(selectinload(Recipe.cover_image))
        .order_by(Recipe.created_on.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return recipes


@router.get("/user/count/", response_model=CountResponse)
def get_users_recipe_count(current_user: CurrentUserDep, session: SessionDep):
    household, _ = require_membership(session, current_user)
    count = session.exec(
        select(func.count())
        .select_from(Recipe)
        .where(Recipe.household_id == household.id)
    ).one()
    return CountResponse(count=count)


@router.get("/user/recent/", response_model=list[RecipeCard])
def get_users_recently_added_recipes(current_user: CurrentUserDep, session: SessionDep):
    household, _ = require_membership(session, current_user)
    recipes = session.exec(
        select(Recipe)
        .where(Recipe.household_id == household.id)
        .options(selectinload(Recipe.cover_image))
        .order_by(Recipe.created_on.desc())
        .limit(5)
    ).all()
    return recipes


@router.get(
    "/{recipe_id:int}/",
    response_model=RecipeDetail,
)
def get_recipe_by_id(
    recipe_id: int,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    recipe = session.exec(
        select(Recipe).where(Recipe.id == recipe_id).options(*_recipe_detail_options())
    ).first()
    if not recipe:
        raise HTTPException(
            status_code=404,
            detail="That recipe couldn’t be found. It may have been deleted.",
        )
    if not user_can_access_recipe(session, current_user, recipe):
        raise HTTPException(
            status_code=404,
            detail="That recipe couldn’t be found. It may have been deleted.",
        )
    return recipe


@router.get("/search/", response_model=list[RecipeCard])
def search_recipes(
    searchText: str,
    current_user: CurrentUserDep,
    session: SessionDep,
    offset: int = 0,
    limit: Annotated[int, Query(le=100)] = 50,
):
    """Hybrid lexical + semantic search over recipes the user can access."""
    # Membership is required for the library UX; also ensures household exists.
    require_membership(session, current_user)
    return search_accessible_recipes(
        session,
        current_user,
        searchText,
        offset=offset,
        limit=limit,
    )


@router.post(
    "/",
    response_model=RecipeDetail,
)
def create_recipe(
    recipe: RecipeCreate, currentUser: CurrentUserDep, session: SessionDep
):
    household = ensure_user_household(session, currentUser)
    rec_dict = recipe.model_dump()
    rec_dict["created_on"] = datetime.now(UTC)
    rec_dict["created_by_id"] = currentUser.id
    rec_dict["household_id"] = household.id

    db_recipe = Recipe.model_validate(rec_dict)
    session.add(db_recipe)
    session.commit()
    session.refresh(db_recipe)
    refresh_recipe_embedding(session, db_recipe, commit=True)
    session.refresh(db_recipe)
    return db_recipe


@router.put(
    "/{recipe_id:int}/",
    response_model=RecipeDetail,
)
def update_recipe(
    recipe_id: int,
    recipe: RecipeUpdate,
    currentUser: CurrentUserDep,
    session: SessionDep,
):
    existing_recipe = session.exec(select(Recipe).where(Recipe.id == recipe_id)).first()

    if not existing_recipe:
        raise HTTPException(
            status_code=404,
            detail="That recipe couldn’t be found. It may have been deleted.",
        )

    if not user_can_edit_recipe(session, currentUser, existing_recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit recipes in your household.",
        )

    values = recipe.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(
            status_code=400,
            detail="No recipe fields were provided to update.",
        )

    update_stmt = (
        update(Recipe)
        .where(Recipe.id == recipe_id)
        .values(**values)
        .execution_options(synchronize_session="fetch")
    )
    session.exec(update_stmt)
    session.commit()

    updated = session.exec(
        select(Recipe).where(Recipe.id == recipe_id).options(*_recipe_detail_options())
    ).first()
    if updated is not None:
        content_keys = {
            "name",
            "description",
            "instructions",
            "notes",
            "prep_time",
        }
        if content_keys.intersection(values):
            refresh_recipe_embedding(session, updated, commit=True)
            updated = session.exec(
                select(Recipe)
                .where(Recipe.id == recipe_id)
                .options(*_recipe_detail_options())
            ).first()
    return updated


@router.post(
    "/{recipe_id:int}/ai-edit/",
    response_model=RecipeDetail,
)
async def ai_edit_recipe(
    recipe_id: int,
    body: RecipeAiEditRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Apply a free-text edit instruction via the configured LLM and save."""
    existing_recipe = session.exec(
        select(Recipe)
        .where(Recipe.id == recipe_id)
        .options(
            selectinload(Recipe.ingredients),
            selectinload(Recipe.cover_image),
            selectinload(Recipe.created_by),
        )
    ).first()

    if not existing_recipe:
        raise HTTPException(
            status_code=404,
            detail="That recipe couldn’t be found. It may have been deleted.",
        )

    if not user_can_edit_recipe(session, current_user, existing_recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit recipes in your household.",
        )

    try:
        patch = await patch_recipe_with_llm(
            recipe=existing_recipe,
            instruction=body.instruction,
        )
    except RecipeAiEditError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    apply_recipe_patch(
        recipe=existing_recipe,
        patch=patch,
        user_id=current_user.id,
        session=session,
    )
    refresh_recipe_embedding_by_id(session, recipe_id)

    recipe = session.exec(
        select(Recipe)
        .where(Recipe.id == recipe_id)
        .options(
            selectinload(Recipe.cover_image),
            selectinload(Recipe.created_by),
            selectinload(Recipe.ingredients),
        )
    ).first()
    return recipe


@router.delete("/{recipe_id:int}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(recipe_id: int, currentUser: CurrentUserDep, session: SessionDep):
    existing_recipe = session.exec(select(Recipe).where(Recipe.id == recipe_id)).first()

    if not existing_recipe:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That recipe couldn’t be found. It may have already been deleted.",
        )

    if not user_can_edit_recipe(session, currentUser, existing_recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete recipes in your household.",
        )

    # Cascades remove ingredients + planned meal entries for this recipe.
    session.delete(existing_recipe)
    session.commit()

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
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
from api.core.recipe_versions import (
    CHANGE_IMPORT,
    RecipeVersionNotFound,
    apply_recipe_update,
)
from api.core.recipe_versions import create_recipe as save_new_recipe
from api.core.recipe_versions import (
    diff_versions,
    list_versions,
    load_version,
    recipe_card_load_options,
    recipe_detail_load_options,
    restore_version,
    version_detail,
    version_summary,
)
from api.models import Recipe
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
    RecipeVersionDetail,
    RecipeVersionDiff,
    RecipeVersionSummary,
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
    return recipe_detail_load_options()


def _load_recipe(session: SessionDep, recipe_id: int) -> Recipe | None:
    return session.exec(
        select(Recipe).where(Recipe.id == recipe_id).options(*_recipe_detail_options())
    ).first()


def _require_recipe(
    session: SessionDep,
    current_user,
    recipe_id: int,
) -> Recipe:
    recipe = _load_recipe(session, recipe_id)
    if not recipe or not user_can_access_recipe(session, current_user, recipe):
        raise HTTPException(
            status_code=404,
            detail="That recipe couldn’t be found. It may have been deleted.",
        )
    return recipe


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
    cover = generate_recipe_cover_upload(
        user=current_user,
        db=session,
        title=draft.name,
        description=draft.description,
        ingredients=draft.ingredients,
    )
    recipe = save_new_recipe(
        session,
        user_id=current_user.id,
        household_id=household.id,
        public=False,
        name=draft.name,
        description=draft.description,
        instructions=draft.instructions,
        notes=draft.notes,
        prep_time=draft.prep_time,
        cover_image_id=cover.id if cover is not None else None,
        ingredients=draft.ingredients,
        change_kind=CHANGE_IMPORT,
    )
    refresh_recipe_embedding(session, recipe, commit=True)
    return _load_recipe(session, recipe.id)


@router.post("/generate-cover/", response_model=RecipeCoverGenerateResponse)
def generate_recipe_cover(
    body: RecipeCoverGenerateRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Generate cover image options from the active image provider.

    Providers that support multiple candidates return up to ``limit`` options
    so the client can show a picker. Single-image providers return one option.
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
        exclude_keys={k.strip() for k in body.exclude_keys if k and k.strip()},
    )
    if not uploads:
        if provider == "stub":
            detail = (
                "Cover image generation isn’t enabled on this server. "
                "Upload your own photo, or ask an admin to set "
                "IMAGE_GEN_PROVIDER=openrouter."
            )
        elif provider == "openrouter":
            detail = (
                "Couldn’t generate a cover image for that recipe. "
                "Check that OPENROUTER_API_KEY is set and has credits, "
                "or upload your own photo."
            )
        else:
            detail = (
                "Couldn’t find suitable cover images for that recipe. "
                "Try a clearer dish name, dismiss fewer photos, or upload your own."
            )
        raise HTTPException(status_code=404, detail=detail)
    return {
        "provider": provider,
        "mode": mode,
        "options": [
            {
                "id": opt.upload.id,
                "name": opt.upload.name,
                "file_path": opt.upload.file_path,
                "created_on": opt.upload.created_on,
                "created_by_id": opt.upload.created_by_id,
                "skip_key": opt.skip_key,
            }
            for opt in uploads
        ],
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
        .options(*recipe_card_load_options())
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
        .options(*recipe_card_load_options())
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
        .options(*recipe_card_load_options())
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
    """Current (head) version of a recipe, addressed by id."""
    return _require_recipe(session, current_user, recipe_id)


@router.get("/slug/{slug}/", response_model=RecipeDetail)
def get_recipe_by_slug(
    slug: str,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Current (head) version of a recipe, addressed by its stable slug."""
    recipe = session.exec(
        select(Recipe).where(Recipe.slug == slug).options(*_recipe_detail_options())
    ).first()
    if not recipe or not user_can_access_recipe(session, current_user, recipe):
        raise HTTPException(
            status_code=404,
            detail="That recipe couldn’t be found. It may have been deleted.",
        )
    return recipe


@router.get("/{recipe_id:int}/versions/", response_model=list[RecipeVersionSummary])
def get_recipe_versions(
    recipe_id: int,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Append-only history, newest first. Does not change the head version."""
    recipe = _require_recipe(session, current_user, recipe_id)
    return [
        version_summary(version, is_current=version.id == recipe.current_version_id)
        for version in list_versions(session, recipe.id)
    ]


@router.get(
    "/{recipe_id:int}/versions/diff/",
    response_model=RecipeVersionDiff,
)
def get_recipe_version_diff(
    recipe_id: int,
    current_user: CurrentUserDep,
    session: SessionDep,
    from_version: Annotated[int, Query(alias="from", ge=1)],
    to_version: Annotated[int, Query(alias="to", ge=1)],
):
    """On-the-fly diff between two saved versions. Nothing is persisted."""
    recipe = _require_recipe(session, current_user, recipe_id)
    before = load_version(session, recipe.id, from_version)
    after = load_version(session, recipe.id, to_version)
    if before is None or after is None:
        raise HTTPException(
            status_code=404,
            detail="That version couldn’t be found on this recipe.",
        )
    return diff_versions(recipe, before, after)


@router.get(
    "/{recipe_id:int}/versions/{version_number}/",
    response_model=RecipeVersionDetail,
)
def get_recipe_version(
    recipe_id: int,
    version_number: int,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    recipe = _require_recipe(session, current_user, recipe_id)
    version = load_version(session, recipe.id, version_number)
    if version is None:
        raise HTTPException(
            status_code=404,
            detail="That version couldn’t be found on this recipe.",
        )
    return version_detail(version, is_current=version.id == recipe.current_version_id)


@router.post(
    "/{recipe_id:int}/versions/{version_number}/restore/",
    response_model=RecipeDetail,
)
def restore_recipe_version(
    recipe_id: int,
    version_number: int,
    current_user: CurrentUserDep,
    session: SessionDep,
):
    """Append a new head that copies an older version. History is kept."""
    recipe = _require_recipe(session, current_user, recipe_id)
    if not user_can_edit_recipe(session, current_user, recipe):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit recipes in your household.",
        )
    try:
        restored = restore_version(
            session,
            recipe,
            user_id=current_user.id,
            version_number=version_number,
        )
    except RecipeVersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    refresh_recipe_embedding(session, restored, commit=True)
    return _load_recipe(session, recipe_id)


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
    payload = recipe.model_dump()
    ingredients = payload.pop("ingredients")
    db_recipe = save_new_recipe(
        session,
        user_id=currentUser.id,
        household_id=household.id,
        public=payload["public"],
        name=payload["name"],
        description=payload["description"],
        instructions=payload["instructions"],
        notes=payload.get("notes"),
        prep_time=payload.get("prep_time"),
        cover_image_id=payload.get("cover_image_id"),
        ingredients=ingredients,
    )
    refresh_recipe_embedding(session, db_recipe, commit=True)
    return _load_recipe(session, db_recipe.id)


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

    updated = apply_recipe_update(
        session,
        existing_recipe,
        user_id=currentUser.id,
        patch=values,
    )
    content_keys = {
        "name",
        "description",
        "instructions",
        "notes",
        "prep_time",
        "cover_image_id",
        "ingredients",
    }
    if content_keys.intersection(values):
        refresh_recipe_embedding(session, updated, commit=True)
        updated = _load_recipe(session, recipe_id)
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
    existing_recipe = _load_recipe(session, recipe_id)

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

    return _load_recipe(session, recipe_id)


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

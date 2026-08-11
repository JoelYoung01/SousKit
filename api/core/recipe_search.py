"""Hybrid lexical + semantic recipe search for household libraries."""

from __future__ import annotations

import json
import logging
import math
import re
from typing import Any

from sqlalchemy.orm import selectinload
from sqlmodel import Session, and_, col, or_, select

from api.core.embeddings.client import EmbeddingClient, get_embedding_client
from api.core.household import get_membership, recipe_access_filter
from api.models import Ingredient, Recipe, User

logger = logging.getLogger(__name__)

# Cosine scores below this are ignored for semantic ranking (stub + real models).
SEMANTIC_SCORE_FLOOR = 0.15
# Cap how many missing embeddings we backfill during a single search request.
MAX_BACKFILL_PER_SEARCH = 40
# How much of instructions to include in the embedded document.
INSTRUCTIONS_EMBED_CHARS = 800
_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


def recipe_embedding_text(recipe: Recipe) -> str:
    """Compact text blob used for embedding a recipe."""
    ingredient_names: list[str] = []
    for ing in recipe.ingredients or []:
        parts = [ing.name or ""]
        if ing.details:
            parts.append(str(ing.details))
        label = " ".join(p for p in parts if p).strip()
        if label:
            ingredient_names.append(label)

    instructions = (recipe.instructions or "").strip()
    if len(instructions) > INSTRUCTIONS_EMBED_CHARS:
        instructions = instructions[:INSTRUCTIONS_EMBED_CHARS]

    chunks = [
        f"Name: {(recipe.name or '').strip()}",
        f"Description: {(recipe.description or '').strip()}",
        f"Ingredients: {', '.join(ingredient_names)}",
        f"Notes: {(recipe.notes or '').strip()}",
        f"Instructions: {instructions}",
    ]
    if recipe.prep_time is not None:
        chunks.append(f"Prep time minutes: {recipe.prep_time}")
    return "\n".join(chunks)


def dump_embedding(vector: list[float]) -> str:
    return json.dumps(vector, separators=(",", ":"))


def load_embedding(raw: str | None) -> list[float] | None:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, list) or not parsed:
        return None
    try:
        return [float(x) for x in parsed]
    except (TypeError, ValueError):
        return None


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    # Vectors are stored L2-normalized; fall back to full cosine if needed.
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    if math.isfinite(dot):
        return float(dot)
    return 0.0


def refresh_recipe_embedding(
    session: Session,
    recipe: Recipe,
    *,
    client: EmbeddingClient | None = None,
    commit: bool = True,
) -> None:
    """Compute and persist an embedding for ``recipe`` (soft-fails)."""
    embedder = client or get_embedding_client()
    # Ensure ingredients are available for the document blob.
    if recipe.ingredients is None:
        session.refresh(recipe, attribute_names=["ingredients"])
    try:
        vector = embedder.embed_one(recipe_embedding_text(recipe))
    except Exception:
        logger.exception("Failed to embed recipe id=%s", recipe.id)
        return
    recipe.embedding_json = dump_embedding(vector)
    recipe.embedding_model = embedder.model_id
    session.add(recipe)
    if commit:
        session.commit()


def refresh_recipe_embedding_by_id(
    session: Session,
    recipe_id: int,
    *,
    client: EmbeddingClient | None = None,
) -> None:
    recipe = session.exec(
        select(Recipe)
        .where(Recipe.id == recipe_id)
        .options(selectinload(Recipe.ingredients))
    ).first()
    if not recipe:
        return
    refresh_recipe_embedding(session, recipe, client=client, commit=True)


def _ensure_embeddings(
    session: Session,
    recipes: list[Recipe],
    *,
    client: EmbeddingClient,
) -> None:
    """Backfill missing / stale embeddings for a small batch of recipes."""
    model_id = client.model_id
    missing = [
        r for r in recipes if not r.embedding_json or r.embedding_model != model_id
    ]
    if not missing:
        return

    batch = missing[:MAX_BACKFILL_PER_SEARCH]
    texts = [recipe_embedding_text(r) for r in batch]
    try:
        vectors = client.embed(texts)
    except Exception:
        logger.exception("Batch embedding backfill failed (%s recipes)", len(batch))
        return

    for recipe, vector in zip(batch, vectors, strict=True):
        recipe.embedding_json = dump_embedding(vector)
        recipe.embedding_model = model_id
        session.add(recipe)
    session.commit()


def _query_tokens(search_text: str) -> list[str]:
    return _TOKEN_RE.findall(search_text.lower())


def _field_match_clause(like: str) -> Any:
    return or_(
        col(Recipe.name).ilike(like),
        col(Recipe.description).ilike(like),
        col(Recipe.instructions).ilike(like),
        col(Recipe.notes).ilike(like),
        Recipe.ingredients.any(
            or_(
                col(Ingredient.name).ilike(like),
                col(Ingredient.details).ilike(like),
            )
        ),
    )


def _lexical_hits(
    session: Session,
    *,
    access: Any,
    search_text: str,
    limit: int,
) -> list[Recipe]:
    """Match the full phrase or any individual query token (OR)."""
    tokens = _query_tokens(search_text)
    likes = [f"%{search_text}%"]
    for token in tokens:
        like = f"%{token}%"
        if like not in likes:
            likes.append(like)

    match_any = or_(*[_field_match_clause(like) for like in likes])
    query = (
        select(Recipe)
        .distinct()
        .join(Recipe.ingredients, isouter=True)
        .where(and_(access, match_any))
        .options(
            selectinload(Recipe.cover_image),
            selectinload(Recipe.ingredients),
        )
        .limit(max(limit * 4, 80))
    )
    return list(session.exec(query).all())


def _recipe_search_blob(recipe: Recipe) -> str:
    parts = [
        recipe.name or "",
        recipe.description or "",
        recipe.instructions or "",
        recipe.notes or "",
    ]
    for ing in recipe.ingredients or []:
        parts.append(ing.name or "")
        if ing.details:
            parts.append(str(ing.details))
    return " ".join(parts).lower()


def _lexical_score(recipe: Recipe, search_text: str, tokens: list[str]) -> float:
    blob = _recipe_search_blob(recipe)
    needle = search_text.lower().strip()
    if needle and needle in blob:
        return 1.15
    if not tokens:
        return 0.0
    hits = sum(1 for token in tokens if token in blob)
    if hits == 0:
        return 0.0
    # Partial token coverage still ranks above weak semantic noise.
    return 0.55 + 0.45 * (hits / len(tokens))


def search_accessible_recipes(
    session: Session,
    user: User,
    search_text: str,
    *,
    offset: int = 0,
    limit: int = 50,
    client: EmbeddingClient | None = None,
) -> list[Recipe]:
    """Hybrid search: lexical substring matches ∪ semantic nearest neighbors."""
    q = (search_text or "").strip()
    membership = get_membership(session, user.id)
    if membership:
        access = recipe_access_filter(membership.household_id)
    else:
        access = or_(Recipe.public, Recipe.created_by_id == user.id)

    if not q:
        return list(
            session.exec(
                select(Recipe)
                .where(Recipe.public)
                .options(selectinload(Recipe.cover_image))
                .limit(25)
            ).all()
        )

    tokens = _query_tokens(q)
    embedder = client or get_embedding_client()
    lexical = _lexical_hits(session, access=access, search_text=q, limit=limit)
    lexical_ids = {r.id for r in lexical}

    # Candidate pool for semantic ranking: household-accessible recipes.
    # Household libraries are small; load with ingredients for backfill + docs.
    candidates = list(
        session.exec(
            select(Recipe)
            .where(access)
            .options(
                selectinload(Recipe.cover_image),
                selectinload(Recipe.ingredients),
            )
            .limit(500)
        ).all()
    )
    _ensure_embeddings(session, candidates, client=embedder)

    query_vector: list[float] | None = None
    try:
        query_vector = embedder.embed_one(q)
    except Exception:
        logger.exception("Failed to embed search query")

    scored: dict[int, tuple[float, Recipe]] = {}

    for recipe in lexical:
        scored[recipe.id] = (_lexical_score(recipe, q, tokens), recipe)

    if query_vector is not None:
        for recipe in candidates:
            vector = load_embedding(recipe.embedding_json)
            if vector is None:
                continue
            sim = cosine_similarity(query_vector, vector)
            if sim < SEMANTIC_SCORE_FLOOR and recipe.id not in lexical_ids:
                continue
            prev = scored.get(recipe.id)
            if prev is None or sim > prev[0]:
                # Keep lexical boost if already present and higher.
                score = max(sim, prev[0]) if prev else sim
                scored[recipe.id] = (score, recipe if prev is None else prev[1])

    ranked = sorted(scored.values(), key=lambda item: (-item[0], -item[1].id))
    page = ranked[offset : offset + limit]
    return [recipe for _, recipe in page]


def search_user_recipes_dicts(
    session: Session,
    user: User,
    query: str,
    limit: int = 8,
) -> list[dict[str, Any]]:
    """LLM-tool shaped results using the same hybrid search."""
    recipes = search_accessible_recipes(
        session, user, query, offset=0, limit=max(1, min(limit, 25))
    )
    membership = get_membership(session, user.id)
    household_id = membership.household_id if membership else None
    return [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "prep_time": r.prep_time,
            "owned": household_id is not None and r.household_id == household_id,
        }
        for r in recipes
    ]

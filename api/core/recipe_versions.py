"""Append-only recipe version history.

A recipe row is a stable identity (id, slug, household, visibility). Each save
appends a ``RecipeVersion`` and moves ``current_version_id`` forward. Older
rows are never updated. Restoring a past version appends a new head that
copies it, so undo stays on the same linear history.

Everyday reads use the head. ``Recipe`` exposes the head's content as
attributes (``name``, ``ingredients``, and so on) so callers that want "the
recipe" do not have to pick a version.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, select

from api.core.recipe_text import normalize_instruction_newlines
from api.models import Ingredient, Recipe, RecipeVersion

CHANGE_CREATE = "create"
CHANGE_EDIT = "edit"
CHANGE_AI_EDIT = "ai_edit"
CHANGE_IMPORT = "import"
CHANGE_RESTORE = "restore"

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_SLUG_MAX = 80


class RecipeVersionNotFound(LookupError):
    """No version with that number exists on the recipe."""


@dataclass
class RecipeContent:
    name: str
    description: str
    instructions: str
    notes: str | None
    prep_time: float | None
    cover_image_id: int | None


def recipe_detail_load_options():
    return (
        selectinload(Recipe.created_by),
        selectinload(Recipe.current_version).selectinload(RecipeVersion.ingredients),
        selectinload(Recipe.current_version).selectinload(RecipeVersion.cover_image),
    )


def recipe_card_load_options():
    return (
        selectinload(Recipe.current_version).selectinload(RecipeVersion.cover_image),
    )


def slugify(name: str) -> str:
    slug = _SLUG_RE.sub("-", (name or "").lower()).strip("-")
    slug = slug[:_SLUG_MAX].strip("-")
    return slug or "recipe"


def allocate_slug(session: Session, name: str) -> str:
    base = slugify(name)
    candidate = base
    suffix = 2
    while session.exec(select(Recipe.id).where(Recipe.slug == candidate)).first():
        extra = f"-{suffix}"
        candidate = f"{base[: _SLUG_MAX - len(extra)].strip('-')}{extra}"
        suffix += 1
    return candidate


def _blank_none(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _prep(value: float | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return number


def normalize_ingredients(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for row in rows or []:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        amount = row.get("amount")
        try:
            amount_f = float(amount) if amount is not None and amount != "" else None
        except (TypeError, ValueError):
            amount_f = None
        units = row.get("units")
        details = row.get("details")
        normalized.append(
            {
                "name": name[:200],
                "amount": amount_f,
                "units": str(units).strip()[:40] if units else None,
                "details": str(details).strip()[:200] if details else None,
            }
        )
    return normalized


def _content_from_parts(
    *,
    name: str,
    description: str,
    instructions: str,
    notes: str | None,
    prep_time: float | None,
    cover_image_id: int | None,
) -> RecipeContent:
    return RecipeContent(
        name=(name or "").strip()[:200],
        description=(description or "").strip()[:4000],
        instructions=normalize_instruction_newlines(instructions or "")[:20000],
        notes=_blank_none(notes),
        prep_time=_prep(prep_time),
        cover_image_id=cover_image_id,
    )


def content_from_version(version: RecipeVersion) -> RecipeContent:
    return _content_from_parts(
        name=version.name,
        description=version.description,
        instructions=version.instructions,
        notes=version.notes,
        prep_time=version.prep_time,
        cover_image_id=version.cover_image_id,
    )


def _ingredient_rows_from_version(version: RecipeVersion) -> list[dict[str, Any]]:
    return normalize_ingredients(
        [
            {
                "name": ing.name,
                "amount": ing.amount,
                "units": ing.units,
                "details": ing.details,
            }
            for ing in (version.ingredients or [])
        ]
    )


def _fingerprint(
    content: RecipeContent, ingredients: list[dict[str, Any]]
) -> tuple[Any, ...]:
    ing_tuples = tuple(
        (row["name"], row["amount"], row["units"], row["details"])
        for row in ingredients
    )
    return (
        content.name,
        content.description,
        content.instructions,
        content.notes,
        content.prep_time,
        content.cover_image_id,
        ing_tuples,
    )


def _same_snapshot(
    version: RecipeVersion,
    content: RecipeContent,
    ingredients: list[dict[str, Any]],
) -> bool:
    current = _fingerprint(
        content_from_version(version),
        _ingredient_rows_from_version(version),
    )
    return current == _fingerprint(content, ingredients)


def _add_ingredients(
    session: Session,
    version: RecipeVersion,
    ingredients: list[dict[str, Any]],
    *,
    user_id: int,
    now: datetime,
) -> None:
    for row in ingredients:
        session.add(
            Ingredient(
                created_by_id=user_id,
                created_on=now,
                name=row["name"],
                amount=row["amount"],
                units=row["units"],
                details=row["details"],
                recipe_version_id=version.id,
            )
        )


def _reload(session: Session, recipe_id: int) -> Recipe:
    recipe = session.exec(
        select(Recipe)
        .where(Recipe.id == recipe_id)
        .options(*recipe_detail_load_options())
    ).first()
    if recipe is None:
        raise RuntimeError(f"Recipe {recipe_id} disappeared during save.")
    return recipe


def require_current_version(session: Session, recipe: Recipe) -> RecipeVersion:
    version = recipe.current_version
    if version is None and recipe.current_version_id is not None:
        session.refresh(recipe, attribute_names=["current_version"])
        version = recipe.current_version
    if version is None:
        version = session.exec(
            select(RecipeVersion)
            .where(RecipeVersion.id == recipe.current_version_id)
            .options(selectinload(RecipeVersion.ingredients))
        ).first()
    if version is None:
        raise RecipeVersionNotFound("This recipe has no saved version.")
    # Touch the collection so later copies see every row.
    _ = list(version.ingredients or [])
    return version


def create_recipe(
    session: Session,
    *,
    user_id: int,
    household_id: int,
    public: bool,
    name: str,
    description: str,
    instructions: str,
    notes: str | None,
    prep_time: float | None,
    cover_image_id: int | None,
    ingredients: list[dict[str, Any]] | None,
    change_kind: str = CHANGE_CREATE,
    created_on: datetime | None = None,
) -> Recipe:
    """Insert a recipe and its first version in one commit."""
    now = created_on or datetime.now(UTC)
    content = _content_from_parts(
        name=name,
        description=description,
        instructions=instructions,
        notes=notes,
        prep_time=prep_time,
        cover_image_id=cover_image_id,
    )
    recipe = Recipe(
        slug=allocate_slug(session, content.name or name),
        created_by_id=user_id,
        household_id=household_id,
        created_on=now,
        public=public,
        current_version_id=None,
    )
    session.add(recipe)
    session.flush()

    version = RecipeVersion(
        recipe_id=recipe.id,
        version_number=1,
        created_on=now,
        created_by_id=user_id,
        name=content.name,
        description=content.description,
        instructions=content.instructions,
        notes=content.notes,
        prep_time=content.prep_time,
        cover_image_id=content.cover_image_id,
        change_kind=change_kind,
        restored_from_version=None,
    )
    session.add(version)
    session.flush()
    _add_ingredients(
        session,
        version,
        normalize_ingredients(ingredients),
        user_id=user_id,
        now=now,
    )
    recipe.current_version_id = version.id
    session.add(recipe)
    session.commit()
    return _reload(session, recipe.id)


def append_version(
    session: Session,
    recipe: Recipe,
    *,
    user_id: int,
    name: str,
    description: str,
    instructions: str,
    notes: str | None,
    prep_time: float | None,
    cover_image_id: int | None,
    ingredients: list[dict[str, Any]] | None,
    change_kind: str,
    restored_from_version: int | None = None,
) -> Recipe:
    """Append a snapshot and move the head forward.

    ``ingredients is None`` copies the current version's ingredient list.
    When the snapshot matches the head, the history is left unchanged.
    """
    head = require_current_version(session, recipe)
    content = _content_from_parts(
        name=name,
        description=description,
        instructions=instructions,
        notes=notes,
        prep_time=prep_time,
        cover_image_id=cover_image_id,
    )
    rows = (
        normalize_ingredients(ingredients)
        if ingredients is not None
        else _ingredient_rows_from_version(head)
    )
    if _same_snapshot(head, content, rows):
        return _reload(session, recipe.id)

    now = datetime.now(UTC)
    version = RecipeVersion(
        recipe_id=recipe.id,
        version_number=head.version_number + 1,
        created_on=now,
        created_by_id=user_id,
        name=content.name,
        description=content.description,
        instructions=content.instructions,
        notes=content.notes,
        prep_time=content.prep_time,
        cover_image_id=content.cover_image_id,
        change_kind=change_kind,
        restored_from_version=restored_from_version,
    )
    session.add(version)
    session.flush()
    _add_ingredients(session, version, rows, user_id=user_id, now=now)
    recipe.current_version_id = version.id
    session.add(recipe)
    session.commit()
    session.expire(recipe, ["current_version", "versions"])
    return _reload(session, recipe.id)


def apply_recipe_update(
    session: Session,
    recipe: Recipe,
    *,
    user_id: int,
    patch: dict[str, Any],
) -> Recipe:
    """Apply a partial update.

    Visibility stays on the recipe row. Content and ingredient changes append
    one new version. A no-op content save does not grow the history.
    """
    public = patch.get("public", None) if "public" in patch else None
    ingredients = patch.get("ingredients") if "ingredients" in patch else None
    content_keys = {
        "name",
        "description",
        "instructions",
        "notes",
        "prep_time",
        "cover_image_id",
    }
    changing_content = content_keys.intersection(patch) or "ingredients" in patch
    if changing_content:
        head = require_current_version(session, recipe)
        current = content_from_version(head)
        append_version(
            session,
            recipe,
            user_id=user_id,
            name=patch.get("name", current.name),
            description=patch.get("description", current.description),
            instructions=patch.get("instructions", current.instructions),
            notes=patch["notes"] if "notes" in patch else current.notes,
            prep_time=patch["prep_time"] if "prep_time" in patch else current.prep_time,
            cover_image_id=(
                patch["cover_image_id"]
                if "cover_image_id" in patch
                else current.cover_image_id
            ),
            ingredients=ingredients,
            change_kind=CHANGE_EDIT,
        )
        recipe = _reload(session, recipe.id)

    if public is not None and recipe.public != bool(public):
        recipe.public = bool(public)
        session.add(recipe)
        session.commit()
        recipe = _reload(session, recipe.id)
    return recipe


def load_version(
    session: Session,
    recipe_id: int,
    version_number: int,
) -> RecipeVersion | None:
    return session.exec(
        select(RecipeVersion)
        .where(
            RecipeVersion.recipe_id == recipe_id,
            RecipeVersion.version_number == version_number,
        )
        .options(
            selectinload(RecipeVersion.ingredients),
            selectinload(RecipeVersion.cover_image),
            selectinload(RecipeVersion.created_by),
        )
    ).first()


def list_versions(session: Session, recipe_id: int) -> list[RecipeVersion]:
    return list(
        session.exec(
            select(RecipeVersion)
            .where(RecipeVersion.recipe_id == recipe_id)
            .options(selectinload(RecipeVersion.created_by))
            .order_by(col(RecipeVersion.version_number).desc())
        ).all()
    )


def restore_version(
    session: Session,
    recipe: Recipe,
    *,
    user_id: int,
    version_number: int,
) -> Recipe:
    source = load_version(session, recipe.id, version_number)
    if source is None:
        raise RecipeVersionNotFound("That version couldn’t be found on this recipe.")
    content = content_from_version(source)
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
        ingredients=_ingredient_rows_from_version(source),
        change_kind=CHANGE_RESTORE,
        restored_from_version=source.version_number,
    )


def _instruction_hunks(before: str, after: str) -> list[dict[str, Any]]:
    before_lines = (before or "").splitlines()
    after_lines = (after or "").splitlines()
    matcher = difflib.SequenceMatcher(a=before_lines, b=after_lines)
    hunks: list[dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        before_text = "\n".join(before_lines[i1:i2]) or None
        after_text = "\n".join(after_lines[j1:j2]) or None
        hunks.append({"op": tag, "before": before_text, "after": after_text})
    return hunks


def _ingredient_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": row["name"],
        "amount": row["amount"],
        "units": row["units"],
        "details": row["details"],
    }


def _match_key(row: dict[str, Any]) -> tuple[str, str]:
    return (
        row["name"].strip().lower(),
        (row["units"] or "").strip().lower(),
    )


def _ingredient_changes(
    before_rows: list[dict[str, Any]],
    after_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Greedy match on name + units, preserving order within each side."""
    unused = list(enumerate(after_rows))
    changes: list[dict[str, Any]] = []
    for before in before_rows:
        key = _match_key(before)
        match_index = next(
            (idx for idx, (_, row) in enumerate(unused) if _match_key(row) == key),
            None,
        )
        if match_index is None:
            changes.append(
                {
                    "op": "removed",
                    "name": before["name"],
                    "before": _ingredient_snapshot(before),
                    "after": None,
                }
            )
            continue
        _, after = unused.pop(match_index)
        if before["amount"] != after["amount"] or (before["details"] or None) != (
            after["details"] or None
        ):
            changes.append(
                {
                    "op": "changed",
                    "name": after["name"],
                    "before": _ingredient_snapshot(before),
                    "after": _ingredient_snapshot(after),
                }
            )
    for _, after in unused:
        changes.append(
            {
                "op": "added",
                "name": after["name"],
                "before": None,
                "after": _ingredient_snapshot(after),
            }
        )
    return changes


def diff_versions(
    recipe: Recipe,
    before: RecipeVersion,
    after: RecipeVersion,
) -> dict[str, Any]:
    """Structured diff between two saved snapshots. Nothing is stored."""
    before_content = content_from_version(before)
    after_content = content_from_version(after)
    fields: list[dict[str, Any]] = []

    def add_field(field: str, left: Any, right: Any, *, hunks: list | None = None):
        if left == right and not hunks:
            return
        fields.append(
            {
                "field": field,
                "before": None if left is None else str(left),
                "after": None if right is None else str(right),
                "hunks": hunks or [],
            }
        )

    add_field("name", before_content.name, after_content.name)
    add_field("description", before_content.description, after_content.description)
    add_field("notes", before_content.notes, after_content.notes)
    add_field("prep_time", before_content.prep_time, after_content.prep_time)
    if before_content.cover_image_id != after_content.cover_image_id:
        add_field(
            "cover_image",
            before_content.cover_image_id,
            after_content.cover_image_id,
        )
    if before_content.instructions != after_content.instructions:
        add_field(
            "instructions",
            before_content.instructions,
            after_content.instructions,
            hunks=_instruction_hunks(
                before_content.instructions, after_content.instructions
            ),
        )

    return {
        "recipe_id": recipe.id,
        "slug": recipe.slug,
        "from_version": before.version_number,
        "to_version": after.version_number,
        "fields": fields,
        "ingredients": _ingredient_changes(
            _ingredient_rows_from_version(before),
            _ingredient_rows_from_version(after),
        ),
    }


def version_summary(version: RecipeVersion, *, is_current: bool) -> dict[str, Any]:
    author = version.created_by
    return {
        "version_number": version.version_number,
        "created_on": version.created_on,
        "created_by_id": version.created_by_id,
        "created_by_display_name": author.display_name if author is not None else None,
        "change_kind": version.change_kind,
        "restored_from_version": version.restored_from_version,
        "name": version.name,
        "is_current": is_current,
    }


def version_detail(version: RecipeVersion, *, is_current: bool) -> dict[str, Any]:
    payload = version_summary(version, is_current=is_current)
    payload.update(
        {
            "description": version.description,
            "instructions": version.instructions,
            "notes": version.notes,
            "prep_time": version.prep_time,
            "cover_image_id": version.cover_image_id,
            "cover_image": version.cover_image,
            "ingredients": list(version.ingredients or []),
        }
    )
    return payload

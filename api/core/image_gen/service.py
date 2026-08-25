"""High-level helpers for recipe cover generation / search."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from api.core.image_gen.client import ImageGenClient, get_image_gen_client
from api.core.image_gen.persist import save_cover_upload
from api.core.image_gen.prompts import build_recipe_image_prompt, recipe_image_keywords
from api.core.logging import logger
from api.models import Upload, User

CoverMode = Literal["pick", "single"]


@dataclass
class CoverUploadOption:
    """Persisted cover upload plus a stable dismiss key for later searches."""

    upload: Upload
    skip_key: str


def generate_recipe_cover_upload(
    *,
    user: User,
    db,
    title: str,
    description: str | None = None,
    ingredients: list[dict[str, Any]] | None = None,
    image_gen: ImageGenClient | None = None,
    exclude_keys: set[str] | None = None,
) -> Upload | None:
    """Run the configured provider and persist one Upload, or return None."""
    options, _provider, _mode = generate_recipe_cover_uploads(
        user=user,
        db=db,
        title=title,
        description=description,
        ingredients=ingredients,
        image_gen=image_gen,
        limit=1,
        exclude_keys=exclude_keys,
    )
    return options[0].upload if options else None


def generate_recipe_cover_uploads(
    *,
    user: User,
    db,
    title: str,
    description: str | None = None,
    ingredients: list[dict[str, Any]] | None = None,
    image_gen: ImageGenClient | None = None,
    limit: int = 4,
    exclude_keys: set[str] | None = None,
) -> tuple[list[CoverUploadOption], str, CoverMode]:
    """Persist up to ``limit`` cover Uploads.

    Returns ``(options, provider_name, mode)`` where ``mode`` is:
      - ``pick`` — search-based provider; UI should let the user choose
      - ``single`` — true generation / one-shot providers
    """
    clean_title = (title or "").strip()
    client = image_gen or get_image_gen_client()
    mode: CoverMode = "pick" if client.supports_candidates else "single"

    if not clean_title:
        return [], client.name, mode

    prompt = build_recipe_image_prompt(clean_title, description, ingredients)
    keywords = recipe_image_keywords(clean_title, ingredients)
    try:
        images = client.generate_candidates(
            prompt,
            recipe_title=clean_title,
            keywords=keywords,
            limit=max(1, limit),
            exclude_keys=exclude_keys,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cover image provider failed for %r: %s", clean_title, exc)
        return [], client.name, mode

    options: list[CoverUploadOption] = []
    for image in images:
        upload = save_cover_upload(
            user=user,
            image=image,
            recipe_title=clean_title,
            db=db,
        )
        if upload is not None:
            options.append(
                CoverUploadOption(upload=upload, skip_key=image.skip_key)
            )
            logger.info(
                "Created cover upload %s for %r via %s (skip_key=%s)",
                upload.id,
                clean_title,
                image.source,
                image.skip_key,
            )
    return options, client.name, mode

"""Orchestrate URL → structured recipe draft (scrape first, LLM fallback)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from api.core.llm.client import LlmClient
from api.core.logging import logger
from api.core.recipe_import.fetch import (
    RecipeImportError,
    assert_supported_recipe_url,
    fetch_recipe_html,
)
from api.core.recipe_import.llm_extract import extract_recipe_with_llm
from api.core.recipe_import.scrape import scrape_recipe_html


@dataclass
class ImportedRecipeDraft:
    name: str
    description: str
    instructions: str
    notes: str | None
    prep_time: float | None
    ingredients: list[dict[str, Any]] = field(default_factory=list)
    source_url: str = ""
    source_links: list[dict[str, str]] = field(default_factory=list)
    method: str = "schema"  # schema | llm


def _to_draft(
    data: dict[str, Any],
    *,
    source_url: str,
    html: str = "",
) -> ImportedRecipeDraft:
    # Imported lazily: source_links imports this package's fetch module.
    from api.core.source_links import hostname_label, site_name_from_html

    notes = data.get("notes")
    notes_str = str(notes).strip() if notes else None
    site_name = (
        site_name_from_html(html, source_url) if html else hostname_label(source_url)
    )

    return ImportedRecipeDraft(
        name=str(data["name"]).strip(),
        description=str(data["description"]).strip(),
        instructions=str(data["instructions"]).strip(),
        notes=notes_str or None,
        prep_time=data.get("prep_time"),
        ingredients=list(data.get("ingredients") or []),
        source_url=source_url,
        source_links=[{"name": site_name, "url": source_url}],
        method=str(data.get("method") or "schema"),
    )


async def import_recipe_from_url(
    url: str,
    *,
    llm: LlmClient | None = None,
    html: str | None = None,
    final_url: str | None = None,
) -> ImportedRecipeDraft:
    """Fetch and extract a recipe. Raises ``RecipeImportError`` on failure.

    ``html`` / ``final_url`` may be injected for tests (skips network fetch).
    """
    assert_supported_recipe_url(url)

    if html is None:
        page_url, page_html = fetch_recipe_html(url)
    else:
        page_url = final_url or url
        page_html = html

    scraped = scrape_recipe_html(page_html, page_url=page_url)
    if scraped:
        logger.info(
            "Imported recipe via schema scrape from %s (%s ingredients)",
            page_url,
            len(scraped.get("ingredients") or []),
        )
        return _to_draft(scraped, source_url=page_url, html=page_html)

    llm_data = await extract_recipe_with_llm(html=page_html, page_url=page_url, llm=llm)
    if llm_data:
        logger.info(
            "Imported recipe via LLM from %s (%s ingredients)",
            page_url,
            len(llm_data.get("ingredients") or []),
        )
        return _to_draft(llm_data, source_url=page_url, html=page_html)

    raise RecipeImportError(
        "We couldn’t find a recipe on that page. "
        "Try a different link — sites with a written ingredients list work best."
    )

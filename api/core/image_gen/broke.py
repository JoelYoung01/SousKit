"""Broke adapter: hunt public-domain / CC0 food photos on Openverse.

No API key required for light anonymous use. Images are filtered to
``cc0`` and ``pdm`` (public domain mark) so we can store them locally
without attribution plumbing.
"""

from __future__ import annotations

import mimetypes
from typing import Any
from urllib.parse import urlparse

import requests

from api.core.image_gen.client import ImageGenClient, ImageGenResult
from api.core.logging import logger

DEFAULT_UA = "SousKit/0.0.1 (recipe cover search; https://github.com/local)"
MAX_BYTES = 8 * 1024 * 1024  # 8 MiB safety cap
TIMEOUT_S = 20
# Hosts that commonly block hotlinking / bots — try others first.
DEPRIORITIZED_HOST_FRAGMENTS = (
    "cdn.stocksnap.io",
    "stocksnap.io",
)


class BrokeImageSearchClient(ImageGenClient):
    """Search Openverse for free public food images matching a recipe prompt."""

    name = "broke"
    supports_candidates = True

    def __init__(
        self,
        *,
        base_url: str = "https://api.openverse.org/v1",
        licenses: str = "cc0,pdm",
        page_size: int = 20,
        session: requests.Session | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.licenses = licenses
        self.page_size = page_size
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", DEFAULT_UA)

    def generate(
        self,
        prompt: str,
        *,
        recipe_title: str | None = None,
        keywords: list[str] | None = None,
    ) -> ImageGenResult | None:
        results = self.generate_candidates(
            prompt, recipe_title=recipe_title, keywords=keywords, limit=1
        )
        return results[0] if results else None

    def generate_candidates(
        self,
        prompt: str,
        *,
        recipe_title: str | None = None,
        keywords: list[str] | None = None,
        limit: int = 4,
    ) -> list[ImageGenResult]:
        """Download up to ``limit`` distinct images, title-first."""
        if limit < 1:
            return []

        queries = self._query_variants(prompt, recipe_title, keywords)
        seen_urls: set[str] = set()
        chosen: list[ImageGenResult] = []

        for query in queries:
            if len(chosen) >= limit:
                break
            candidates = self._search(query)
            for hit in candidates:
                if len(chosen) >= limit:
                    break
                url = hit.get("url")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                try:
                    result = self._download(url, hit)
                except Exception as exc:  # noqa: BLE001 — try next candidate
                    logger.warning("Broke adapter failed to download %s: %s", url, exc)
                    continue
                if result is not None:
                    logger.info(
                        "Broke adapter chose image %s/%s for query=%r title=%r "
                        "source=%s",
                        len(chosen) + 1,
                        limit,
                        query,
                        recipe_title,
                        result.source_url,
                    )
                    chosen.append(result)

        if not chosen:
            logger.info(
                "Broke adapter found no usable image for prompt=%r title=%r",
                prompt,
                recipe_title,
            )
        return chosen

    def _query_variants(
        self,
        prompt: str,
        recipe_title: str | None,
        keywords: list[str] | None,
    ) -> list[str]:
        """Title-led queries first so renaming the dish changes the search.

        Ingredient queries follow as fallbacks — long phrases often return
        zero hits, so we keep progressive simplifications.
        """
        variants: list[str] = []

        def add(q: str) -> None:
            q = " ".join((q or "").split())
            if q and q not in variants:
                variants.append(q)

        keys = [k.strip().lower() for k in (keywords or []) if k and k.strip()]
        title = (recipe_title or "").strip()
        title_tokens = [
            t for t in title.lower().replace(",", " ").split() if len(t) > 3
        ]

        # 1) Full title — strongest signal when the user renames the recipe.
        if title:
            add(f"{title} food")
            add(title)
            add(f"{title} dinner plated")

        # 2) Dish-form token from the title (tacos, curry, pasta…).
        if title_tokens:
            add(f"{title_tokens[-1]} food")
            if len(title_tokens) >= 2:
                add(f"{title_tokens[-2]} {title_tokens[-1]} food")
            if keys:
                add(f"{keys[0]} {title_tokens[-1]}")

        # 3) Shared prompt (may already be title- or ingredient-led).
        add(prompt)

        # 4) Ingredient fallbacks when title search is thin.
        if len(keys) >= 2:
            add(f"{keys[0]} {keys[1]} food")
            add(f"{keys[0]} {keys[1]} dinner")
        if keys:
            add(f"{keys[0]} dinner food")
            add(f"{keys[0]} food")
        if len(keys) >= 3:
            add(f"{keys[0]} {keys[1]} {keys[2]} food")

        add("homemade dinner plated food")
        return variants

    def _search(self, query: str) -> list[dict[str, Any]]:
        params = {
            "q": query,
            "license": self.licenses,
            "page_size": self.page_size,
            "mature": "false",
        }
        url = f"{self.base_url}/images/"
        try:
            resp = self.session.get(
                url,
                params=params,
                timeout=TIMEOUT_S,
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            logger.warning("Openverse search failed for %r: %s", query, exc)
            return []

        data = resp.json() if resp.content else {}
        results = list(data.get("results") or [])

        def rank_key(r: dict[str, Any]) -> tuple:
            host = urlparse(r.get("url") or "").netloc.lower()
            deprioritized = any(frag in host for frag in DEPRIORITIZED_HOST_FRAGMENTS)
            area = (r.get("width") or 0) * (r.get("height") or 0)
            return (int(deprioritized), -area)

        results.sort(key=rank_key)
        return results

    def _download(self, url: str, hit: dict[str, Any]) -> ImageGenResult | None:
        resp = self.session.get(
            url,
            timeout=TIMEOUT_S,
            stream=True,
            headers={"Accept": "image/*,*/*;q=0.8"},
        )
        resp.raise_for_status()

        content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
        if not content_type or content_type == "application/octet-stream":
            guessed, _ = mimetypes.guess_type(urlparse(url).path)
            content_type = guessed or "image/jpeg"

        if not content_type.startswith("image/"):
            logger.warning(
                "Skipping non-image content-type %s from %s",
                content_type,
                url,
            )
            return None

        chunks: list[bytes] = []
        total = 0
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_BYTES:
                logger.warning("Skipping oversized image from %s", url)
                return None
            chunks.append(chunk)
        content = b"".join(chunks)
        if len(content) < 1024:
            return None

        ext = _ext_for_mime(content_type, url)
        attribution = hit.get("attribution") or None
        return ImageGenResult(
            content=content,
            mime_type=content_type,
            extension=ext,
            source="broke:openverse",
            attribution=attribution,
            source_url=hit.get("foreign_landing_url") or url,
            metadata={
                "openverse_id": hit.get("id"),
                "license": hit.get("license"),
                "title": hit.get("title"),
                "creator": hit.get("creator"),
                "provider": hit.get("provider"),
            },
        )


def _ext_for_mime(mime: str, url: str) -> str:
    mapping = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    if mime in mapping:
        return mapping[mime]
    path = urlparse(url).path.lower()
    for ext in ("jpg", "jpeg", "png", "webp", "gif"):
        if path.endswith(f".{ext}"):
            return "jpg" if ext == "jpeg" else ext
    return "jpg"

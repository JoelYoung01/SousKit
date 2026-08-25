"""Image provider ABC + factory.

Providers:
  - stub  — no network; returns None (recipe keeps the default placeholder)
  - broke — free public-domain / CC0 search via Openverse (default)
  - qwen  — reserved for DashScope Qwen-Image later (needs API key)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from api.core.config import settings
from api.core.logging import logger


@dataclass
class ImageGenResult:
    """Normalized image bytes from any provider."""

    content: bytes
    mime_type: str = "image/jpeg"
    extension: str = "jpg"
    source: str = "unknown"
    attribution: str | None = None
    source_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def skip_key(self) -> str:
        """Stable id so clients can dismiss this image on later searches."""
        meta = self.metadata or {}
        cached = meta.get("skip_key")
        if isinstance(cached, str) and cached.strip():
            return cached.strip()
        ov = meta.get("openverse_id")
        if ov:
            return f"ov:{ov}"
        if self.source_url:
            return f"url:{self.source_url}"
        # Last resort: content fingerprint (not ideal across regenerations).
        import hashlib

        digest = hashlib.sha256(self.content[:8192]).hexdigest()[:20]
        return f"hash:{digest}"


class ImageGenClient(ABC):
    """Provider-agnostic cover image client."""

    name: str = "abstract"
    #: True when the provider searches existing photos (user should pick).
    supports_candidates: bool = False

    @abstractmethod
    def generate(
        self,
        prompt: str,
        *,
        recipe_title: str | None = None,
        keywords: list[str] | None = None,
        exclude_keys: set[str] | None = None,
    ) -> ImageGenResult | None:
        """Return image bytes for ``prompt``, or None when nothing suitable is found."""
        raise NotImplementedError

    def generate_candidates(
        self,
        prompt: str,
        *,
        recipe_title: str | None = None,
        keywords: list[str] | None = None,
        limit: int = 4,
        exclude_keys: set[str] | None = None,
    ) -> list[ImageGenResult]:
        """Return up to ``limit`` distinct images (default: wrap ``generate``)."""
        if limit < 1:
            return []
        image = self.generate(
            prompt,
            recipe_title=recipe_title,
            keywords=keywords,
            exclude_keys=exclude_keys,
        )
        return [image] if image is not None else []


class StubImageGenClient(ImageGenClient):
    """No-op provider for offline / deterministic runs."""

    name = "stub"
    supports_candidates = False

    def generate(
        self,
        prompt: str,
        *,
        recipe_title: str | None = None,
        keywords: list[str] | None = None,
        exclude_keys: set[str] | None = None,
    ) -> ImageGenResult | None:
        logger.info(
            "Stub image gen skipped for prompt=%r title=%r keywords=%r",
            prompt,
            recipe_title,
            keywords,
        )
        return None

    def generate_candidates(
        self,
        prompt: str,
        *,
        recipe_title: str | None = None,
        keywords: list[str] | None = None,
        limit: int = 4,
        exclude_keys: set[str] | None = None,
    ) -> list[ImageGenResult]:
        self.generate(
            prompt,
            recipe_title=recipe_title,
            keywords=keywords,
            exclude_keys=exclude_keys,
        )
        return []


class QwenImageGenClient(ImageGenClient):
    """Placeholder for Qwen-Image-3.0 via DashScope once a key is available."""

    name = "qwen"
    supports_candidates = False

    def __init__(self, api_key: str, model: str, base_url: str):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url

    def generate(
        self,
        prompt: str,
        *,
        recipe_title: str | None = None,
        keywords: list[str] | None = None,
        exclude_keys: set[str] | None = None,
    ) -> ImageGenResult | None:
        raise NotImplementedError(
            "Qwen image client is not wired yet. Set IMAGE_GEN_PROVIDER=broke "
            "(free Openverse search) or IMAGE_GEN_PROVIDER=stub, or implement "
            "the DashScope call here once DASHSCOPE_API_KEY is configured."
        )


def get_image_gen_client() -> ImageGenClient:
    """Factory gated by IMAGE_GEN_PROVIDER (+ optional provider credentials)."""
    provider = (settings.IMAGE_GEN_PROVIDER or "broke").strip().lower()
    if provider in ("", "none", "off", "disabled"):
        return StubImageGenClient()
    if provider == "stub":
        return StubImageGenClient()
    if provider == "broke":
        from api.core.image_gen.broke import BrokeImageSearchClient

        return BrokeImageSearchClient(
            base_url=settings.OPENVERSE_BASE_URL,
            licenses=settings.OPENVERSE_LICENSES,
        )
    if provider == "qwen":
        key = (settings.DASHSCOPE_API_KEY or "").strip()
        if not key:
            logger.warning(
                "IMAGE_GEN_PROVIDER=qwen but DASHSCOPE_API_KEY is unset; "
                "falling back to stub."
            )
            return StubImageGenClient()
        return QwenImageGenClient(
            api_key=key,
            model=settings.QWEN_IMAGE_MODEL,
            base_url=settings.DASHSCOPE_IMAGE_BASE_URL,
        )
    logger.warning("Unknown IMAGE_GEN_PROVIDER=%r; using stub.", provider)
    return StubImageGenClient()

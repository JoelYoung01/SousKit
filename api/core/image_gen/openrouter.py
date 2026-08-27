"""OpenRouter Image API adapter for AI-generated recipe cover photos."""

from __future__ import annotations

import base64
import hashlib
import secrets
from typing import Any

import requests

from api.core.image_gen.client import ImageGenClient, ImageGenResult
from api.core.image_gen.prompts import build_recipe_diffusion_prompt
from api.core.logging import logger

OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images"
DEFAULT_TIMEOUT_S = 120
MAX_CANDIDATES = 4

_MIME_TO_EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


class OpenRouterImageGenClient(ImageGenClient):
    """Generate recipe cover photos via OpenRouter's dedicated Image API.

    Default model is Seedream 4.5 — strong photoreal food shots at ~$0.04/image
    (2K), cheaper than GPT-Image 2 while supporting multiple candidates per call.
    """

    name = "openrouter"
    supports_candidates = True

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        resolution: str = "2K",
        aspect_ratio: str = "1:1",
        base_url: str = OPENROUTER_IMAGES_URL,
        referer: str = "",
        app_title: str = "Sous Kit",
        timeout_s: int = DEFAULT_TIMEOUT_S,
        session: requests.Session | None = None,
    ):
        self.api_key = api_key
        self.model = model
        self.resolution = resolution
        self.aspect_ratio = aspect_ratio
        self.base_url = base_url.rstrip("/")
        self.referer = referer
        self.app_title = app_title
        self.timeout_s = timeout_s
        self.session = session or requests.Session()

    def generate(
        self,
        prompt: str,
        *,
        recipe_title: str | None = None,
        keywords: list[str] | None = None,
        exclude_keys: set[str] | None = None,
    ) -> ImageGenResult | None:
        results = self.generate_candidates(
            prompt,
            recipe_title=recipe_title,
            keywords=keywords,
            limit=1,
            exclude_keys=exclude_keys,
        )
        return results[0] if results else None

    def generate_candidates(
        self,
        prompt: str,
        *,
        recipe_title: str | None = None,
        keywords: list[str] | None = None,
        limit: int = 4,
        exclude_keys: set[str] | None = None,
    ) -> list[ImageGenResult]:
        if limit < 1:
            return []

        diffusion_prompt = build_recipe_diffusion_prompt(
            recipe_title or prompt,
            description=None,
            ingredients=[{"name": k} for k in (keywords or [])],
        )
        excluded = {k.strip() for k in (exclude_keys or set()) if k and k.strip()}
        if excluded:
            diffusion_prompt = (
                f"{diffusion_prompt} Unique composition, variation "
                f"{len(excluded) + 1}."
            )

        requested = min(limit, MAX_CANDIDATES)
        payload: dict[str, Any] = {
            "model": self.model,
            "prompt": diffusion_prompt,
            "n": requested,
            "aspect_ratio": self.aspect_ratio,
        }
        if self.resolution:
            payload["resolution"] = self.resolution
        if excluded:
            payload["seed"] = secrets.randbelow(2**31)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if self.referer:
            headers["HTTP-Referer"] = self.referer
        if self.app_title:
            headers["X-Title"] = self.app_title

        try:
            images = self._request_images(payload, headers=headers)
        except _BatchCountRejected:
            images = self._request_images_sequential(
                payload,
                headers=headers,
                count=requested,
                excluded=excluded,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "OpenRouter image gen failed for %r: %s",
                recipe_title or prompt,
                exc,
            )
            return []

        results: list[ImageGenResult] = []
        seen_keys: set[str] = set(excluded)
        for index, item in enumerate(images):
            parsed = _parse_image_item(item, model=self.model, index=index)
            if parsed is None:
                continue
            if parsed.skip_key in seen_keys:
                continue
            seen_keys.add(parsed.skip_key)
            results.append(parsed)
            if len(results) >= limit:
                break

        if not results:
            logger.info(
                "OpenRouter returned no usable images for title=%r model=%s",
                recipe_title or prompt,
                self.model,
            )
        else:
            logger.info(
                "OpenRouter generated %s image(s) for title=%r model=%s",
                len(results),
                recipe_title or prompt,
                self.model,
            )
        return results

    def _request_images(
        self,
        payload: dict[str, Any],
        *,
        headers: dict[str, str],
    ) -> list[dict[str, Any]]:
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                return self._post_once(payload, headers=headers)
            except _BatchCountRejected:
                raise
            except RuntimeError as exc:
                last_error = exc
                message = str(exc).lower()
                if attempt == 0 and ("502" in message or "429" in message):
                    logger.info(
                        "OpenRouter image gen retry after transient error: %s",
                        exc,
                    )
                    continue
                raise
        raise last_error or RuntimeError("OpenRouter image request failed")

    def _post_once(
        self,
        payload: dict[str, Any],
        *,
        headers: dict[str, str],
    ) -> list[dict[str, Any]]:
        try:
            response = self.session.post(
                self.base_url,
                headers=headers,
                json=payload,
                timeout=self.timeout_s,
            )
        except requests.RequestException as exc:
            raise RuntimeError(f"OpenRouter image request failed: {exc}") from exc

        if response.status_code == 400 and payload.get("n", 1) > 1:
            detail = _response_detail(response)
            if "n" in detail.lower() or "number of images" in detail.lower():
                raise _BatchCountRejected(detail)

        if response.status_code >= 400:
            raise RuntimeError(
                f"OpenRouter image error {response.status_code}: "
                f"{_response_detail(response)}"
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise RuntimeError("OpenRouter image response was not JSON") from exc

        error = body.get("error")
        if isinstance(error, dict) and error.get("message"):
            raise RuntimeError(f"OpenRouter image error: {error['message']}")

        data = body.get("data")
        if not isinstance(data, list) or not data:
            raise RuntimeError("OpenRouter image response missing data")

        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        cost = usage.get("cost")
        if cost is not None:
            logger.info(
                "OpenRouter image usage model=%s n=%s cost_usd=%s",
                payload.get("model"),
                payload.get("n"),
                cost,
            )

        return [item for item in data if isinstance(item, dict)]

    def _request_images_sequential(
        self,
        payload: dict[str, Any],
        *,
        headers: dict[str, str],
        count: int,
        excluded: set[str],
    ) -> list[dict[str, Any]]:
        """Fall back when a model only supports ``n=1`` per request."""
        single_payload = dict(payload)
        single_payload["n"] = 1
        collected: list[dict[str, Any]] = []
        for attempt in range(count):
            single_payload["seed"] = secrets.randbelow(2**31)
            try:
                batch = self._request_images(single_payload, headers=headers)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "OpenRouter sequential image gen failed on attempt %s: %s",
                    attempt + 1,
                    exc,
                )
                break
            for item in batch:
                parsed = _parse_image_item(
                    item, model=str(payload.get("model") or ""), index=attempt
                )
                if parsed is None or parsed.skip_key in excluded:
                    continue
                collected.append(item)
                excluded = set(excluded) | {parsed.skip_key}
                break
            if len(collected) >= count:
                break
        return collected


class _BatchCountRejected(RuntimeError):
    """Raised when the model rejects n > 1 so we can fall back to single calls."""


def _response_detail(response: requests.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return (response.text or response.reason or "unknown error")[:500]
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if body.get("detail"):
            return str(body["detail"])
    return (response.text or response.reason or "unknown error")[:500]


def _parse_image_item(
    item: dict[str, Any],
    *,
    model: str,
    index: int,
) -> ImageGenResult | None:
    b64 = item.get("b64_json")
    if not isinstance(b64, str) or not b64.strip():
        logger.warning("OpenRouter image item missing b64_json at index %s", index)
        return None

    try:
        content = base64.b64decode(b64, validate=True)
    except (ValueError, TypeError) as exc:
        logger.warning("OpenRouter image decode failed at index %s: %s", index, exc)
        return None

    if len(content) < 1024:
        logger.warning("OpenRouter image too small at index %s", index)
        return None

    media_type = item.get("media_type")
    mime_type = (
        media_type if isinstance(media_type, str) and media_type else "image/png"
    )
    extension = _MIME_TO_EXT.get(mime_type.lower(), "png")
    digest = hashlib.sha256(content[:8192]).hexdigest()[:20]

    return ImageGenResult(
        content=content,
        mime_type=mime_type,
        extension=extension,
        source=f"openrouter:{model}",
        metadata={
            "skip_key": f"or:{digest}",
            "model": model,
            "index": index,
        },
    )

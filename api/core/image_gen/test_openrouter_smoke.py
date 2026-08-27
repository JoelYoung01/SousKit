"""Smoke tests for OpenRouter image provider (no pytest required)."""

from __future__ import annotations

import base64
import os
import sys
from unittest.mock import MagicMock, patch

# Minimal 2x2 red PNG
_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8"
    "z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def test_parse_image_item() -> None:
    from api.core.image_gen.openrouter import _parse_image_item

    item = {
        "b64_json": base64.b64encode(_TINY_PNG).decode(),
        "media_type": "image/png",
    }
    # Too small (<1024 bytes) should be rejected
    assert _parse_image_item(item, model="test/model", index=0) is None

    big = _TINY_PNG + b"\x00" * 1024
    item2 = {"b64_json": base64.b64encode(big).decode(), "media_type": "image/png"}
    result = _parse_image_item(item2, model="test/model", index=0)
    assert result is not None
    assert result.extension == "png"
    assert result.source == "openrouter:test/model"
    assert result.skip_key.startswith("or:")


def test_generate_candidates_mocked() -> None:
    from api.core.image_gen.openrouter import OpenRouterImageGenClient

    big = _TINY_PNG + b"\x00" * 2048
    payload = {
        "data": [
            {
                "b64_json": base64.b64encode(big).decode(),
                "media_type": "image/jpeg",
            }
        ],
        "usage": {"cost": 0.04},
    }

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = payload

    session = MagicMock()
    session.post.return_value = mock_response

    client = OpenRouterImageGenClient(
        api_key="test-key",
        model="bytedance-seed/seedream-4.5",
        session=session,
    )
    results = client.generate_candidates(
        "Chicken Tikka Masala dinner plated food",
        recipe_title="Chicken Tikka Masala",
        keywords=["chicken", "yogurt"],
        limit=1,
    )
    assert len(results) == 1
    assert results[0].mime_type == "image/jpeg"
    assert results[0].extension == "jpg"
    session.post.assert_called_once()
    call_json = session.post.call_args.kwargs["json"]
    assert call_json["model"] == "bytedance-seed/seedream-4.5"
    assert call_json["aspect_ratio"] == "1:1"
    assert "Chicken Tikka Masala" in call_json["prompt"]


def test_factory_openrouter_without_key() -> None:
    from api.core.config import settings
    from api.core.image_gen.client import StubImageGenClient, get_image_gen_client

    with patch.object(settings, "IMAGE_GEN_PROVIDER", "openrouter"), patch.object(
        settings, "OPENROUTER_API_KEY", None
    ):
        client = get_image_gen_client()
        assert isinstance(client, StubImageGenClient)


def test_live_openrouter() -> None:
    key = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if not key:
        print("SKIP live OpenRouter test (OPENROUTER_API_KEY unset)")
        return

    from api.core.image_gen.openrouter import OpenRouterImageGenClient

    client = OpenRouterImageGenClient(
        api_key=key,
        model="bytedance-seed/seedream-4.5",
        resolution="2K",
    )
    results = client.generate_candidates(
        "test",
        recipe_title="Margherita Pizza",
        limit=1,
    )
    assert results, "expected at least one generated image"
    assert len(results[0].content) > 1024
    print(
        f"OK live OpenRouter: {len(results[0].content)} bytes, "
        f"skip_key={results[0].skip_key}"
    )


def main() -> int:
    test_parse_image_item()
    test_generate_candidates_mocked()
    test_factory_openrouter_without_key()
    test_live_openrouter()
    print("All image_gen openrouter tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""OpenRouter embeddings client with a deterministic stub fallback."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from abc import ABC, abstractmethod

import httpx

from api.core.config import settings

logger = logging.getLogger(__name__)

OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"

# Keep vectors compact for SQLite JSON storage; OpenAI text-embedding-3-* supports this.
DEFAULT_EMBEDDING_DIM = 384
STUB_MODEL_ID = f"stub/hashing-v1-{DEFAULT_EMBEDDING_DIM}"


class EmbeddingClient(ABC):
    @property
    @abstractmethod
    def model_id(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one L2-normalized embedding per input text."""
        raise NotImplementedError

    def embed_one(self, text: str) -> list[float]:
        vectors = self.embed([text])
        return vectors[0]


class StubEmbeddingClient(EmbeddingClient):
    """Hashing / char-ngram embedder so search works without an API key.

    Not true semantic embeddings — related vocabulary that shares tokens or
    character n-grams still ranks closer than unrelated recipes, and the
    hybrid search path stays exercised in local/dev.
    """

    def __init__(self, dimensions: int = DEFAULT_EMBEDDING_DIM):
        self.dimensions = dimensions

    @property
    def model_id(self) -> str:
        return STUB_MODEL_ID

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [_hash_embed(text or "", self.dimensions) for text in texts]


class OpenRouterEmbeddingClient(EmbeddingClient):
    def __init__(
        self, api_key: str, model: str, dimensions: int = DEFAULT_EMBEDDING_DIM
    ):
        self.api_key = api_key
        self.model = model
        self.dimensions = dimensions

    @property
    def model_id(self) -> str:
        return f"{self.model}:{self.dimensions}"

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        # OpenRouter accepts a single string or an array of strings.
        payload: dict = {
            "model": self.model,
            "input": texts if len(texts) > 1 else texts[0],
            "dimensions": self.dimensions,
            "encoding_format": "float",
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": settings.FRONTEND_HOST,
            "X-Title": settings.PROJECT_NAME,
        }
        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.post(
                    OPENROUTER_EMBEDDINGS_URL, headers=headers, json=payload
                )
        except httpx.HTTPError as exc:
            raise RuntimeError(f"OpenRouter embeddings request failed: {exc}") from exc

        if response.status_code >= 400:
            detail = response.text[:500]
            raise RuntimeError(
                f"OpenRouter embeddings error {response.status_code}: {detail}"
            )

        try:
            body = response.json()
        except json.JSONDecodeError as exc:
            raise RuntimeError("OpenRouter embeddings returned non-JSON") from exc

        rows = body.get("data") or []
        if not isinstance(rows, list) or len(rows) != len(texts):
            raise RuntimeError("OpenRouter embeddings response size mismatch")

        ordered = sorted(
            (row for row in rows if isinstance(row, dict)),
            key=lambda row: int(row.get("index") or 0),
        )
        vectors: list[list[float]] = []
        for row in ordered:
            embedding = row.get("embedding")
            if not isinstance(embedding, list) or not embedding:
                raise RuntimeError("OpenRouter embeddings missing vector")
            vectors.append(_l2_normalize([float(x) for x in embedding]))
        return vectors


def get_embedding_model_id() -> str:
    return get_embedding_client().model_id


def get_embedding_client() -> EmbeddingClient:
    key = (settings.OPENROUTER_API_KEY or "").strip()
    if key:
        return OpenRouterEmbeddingClient(
            api_key=key,
            model=settings.OPENROUTER_EMBEDDING_MODEL,
            dimensions=settings.OPENROUTER_EMBEDDING_DIMENSIONS,
        )
    return StubEmbeddingClient(dimensions=settings.OPENROUTER_EMBEDDING_DIMENSIONS)


def _l2_normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    if norm <= 1e-12:
        return vector
    return [v / norm for v in vector]


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _hash_embed(text: str, dimensions: int) -> list[float]:
    vec = [0.0] * dimensions
    tokens = _TOKEN_RE.findall(text.lower())
    if not tokens:
        # Empty / punctuation-only → tiny deterministic non-zero vector.
        seed = int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)
        vec[seed % dimensions] = 1.0
        return vec

    for token in tokens:
        for salt in (0, 1, 2):
            digest = hashlib.sha256(f"{salt}:{token}".encode()).digest()
            idx = int.from_bytes(digest[:4], "big") % dimensions
            sign = 1.0 if digest[4] & 1 else -1.0
            vec[idx] += sign
        padded = f"^{token}$"
        for i in range(max(0, len(padded) - 2)):
            tri = padded[i : i + 3]
            digest = hashlib.sha256(tri.encode()).digest()
            idx = int.from_bytes(digest[:4], "big") % dimensions
            sign = 0.5 if digest[5] & 1 else -0.5
            vec[idx] += sign

    return _l2_normalize(vec)

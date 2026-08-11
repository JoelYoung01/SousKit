"""Text embedding clients for recipe semantic search."""

from api.core.embeddings.client import (
    EmbeddingClient,
    get_embedding_client,
    get_embedding_model_id,
)

__all__ = [
    "EmbeddingClient",
    "get_embedding_client",
    "get_embedding_model_id",
]

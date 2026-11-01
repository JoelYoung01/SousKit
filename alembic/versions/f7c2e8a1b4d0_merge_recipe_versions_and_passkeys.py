"""merge recipe version history and passkeys

Revision ID: f7c2e8a1b4d0
Revises: c5d9e2a7b184, e5c1a8d3f6b2
Create Date: 2026-11-01 14:10:00.000000

Recipe version history and passkeys both revise d4a7c2e9f1b3. With two
heads, `alembic upgrade head` aborts, so the deploy entrypoint never
starts the API.
"""

from typing import Sequence, Union

revision: str = "f7c2e8a1b4d0"
down_revision: Union[str, None] = ("c5d9e2a7b184", "e5c1a8d3f6b2")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

"""recipe embeddings for semantic search

Revision ID: b3e8d1a6c902
Revises: f1a9c3e7b2d4
Create Date: 2026-08-11 18:45:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3e8d1a6c902"
down_revision: Union[str, None] = "f1a9c3e7b2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("recipe", schema=None) as batch_op:
        batch_op.add_column(sa.Column("embedding_json", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column("embedding_model", sa.String(length=120), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("recipe", schema=None) as batch_op:
        batch_op.drop_column("embedding_model")
        batch_op.drop_column("embedding_json")

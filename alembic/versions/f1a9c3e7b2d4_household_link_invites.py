"""household link invites (nullable email)

Revision ID: f1a9c3e7b2d4
Revises: e8c4f1a2b7d3
Create Date: 2026-08-11 16:50:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a9c3e7b2d4"
down_revision: Union[str, None] = "e8c4f1a2b7d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("householdinvite", schema=None) as batch_op:
        batch_op.alter_column(
            "email",
            existing_type=sqlmodel.sql.sqltypes.AutoString(),
            nullable=True,
        )


def downgrade() -> None:
    # Replace null emails so the NOT NULL restore succeeds.
    op.execute(sa.text("UPDATE householdinvite SET email = '' WHERE email IS NULL"))
    with op.batch_alter_table("householdinvite", schema=None) as batch_op:
        batch_op.alter_column(
            "email",
            existing_type=sqlmodel.sql.sqltypes.AutoString(),
            nullable=False,
        )

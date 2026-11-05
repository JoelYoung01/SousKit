"""ingredient group name

Revision ID: b7e2c4a1d9f0
Revises: a9c4e2b7d815
Create Date: 2026-11-05 21:20:00.000000

Recipe cards group ingredients (Broth, Toppings). The label is stored on
each ingredient row so grocery still keys off the ingredient name.

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "b7e2c4a1d9f0"
down_revision: Union[str, None] = "a9c4e2b7d815"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("ingredient", schema=None) as batch_op:
        batch_op.add_column(sa.Column("group_name", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ingredient", schema=None) as batch_op:
        batch_op.drop_column("group_name")

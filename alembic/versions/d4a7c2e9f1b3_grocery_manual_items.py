"""grocery manual items

Revision ID: d4a7c2e9f1b3
Revises: b3e8d1a6c902
Create Date: 2026-08-25 02:45:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

import api

# revision identifiers, used by Alembic.
revision: str = "d4a7c2e9f1b3"
down_revision: Union[str, None] = "b3e8d1a6c902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "grocerymanualitem",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("household_id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("item_key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=True),
        sa.Column("units", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column(
            "created_on", api.core.timezone_handler.UTCDateTime(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["user.id"],
            name=op.f("fk_grocerymanualitem_created_by_id_user"),
        ),
        sa.ForeignKeyConstraint(
            ["household_id"],
            ["household.id"],
            name=op.f("fk_grocerymanualitem_household_id_household"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_grocerymanualitem")),
    )
    with op.batch_alter_table("grocerymanualitem", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_grocerymanualitem_id"), ["id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_grocerymanualitem_created_by_id"),
            ["created_by_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_grocerymanualitem_household_id"),
            ["household_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_grocerymanualitem_item_key"), ["item_key"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("grocerymanualitem", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_grocerymanualitem_item_key"))
        batch_op.drop_index(batch_op.f("ix_grocerymanualitem_household_id"))
        batch_op.drop_index(batch_op.f("ix_grocerymanualitem_created_by_id"))
        batch_op.drop_index(batch_op.f("ix_grocerymanualitem_id"))
    op.drop_table("grocerymanualitem")

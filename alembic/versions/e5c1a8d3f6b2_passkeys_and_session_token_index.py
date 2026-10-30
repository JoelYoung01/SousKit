"""passkeys and session token index

Revision ID: e5c1a8d3f6b2
Revises: d4a7c2e9f1b3
Create Date: 2026-10-30 15:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel

import api
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5c1a8d3f6b2"
down_revision: Union[str, None] = "d4a7c2e9f1b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("token", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_token_access_token"), ["access_token"], unique=True
        )

    op.create_table(
        "passkey",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("credential_id", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("public_key", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False),
        sa.Column("transports", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("aaguid", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column(
            "created_on", api.core.timezone_handler.UTCDateTime(), nullable=False
        ),
        sa.Column(
            "last_used_on", api.core.timezone_handler.UTCDateTime(), nullable=True
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name=op.f("fk_passkey_user_id_user")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_passkey")),
    )
    op.create_index(op.f("ix_passkey_user_id"), "passkey", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_passkey_credential_id"), "passkey", ["credential_id"], unique=True
    )

    op.create_table(
        "webauthnchallenge",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("challenge", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("purpose", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column(
            "expires_at", api.core.timezone_handler.UTCDateTime(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            name=op.f("fk_webauthnchallenge_user_id_user"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_webauthnchallenge")),
    )
    op.create_index(
        op.f("ix_webauthnchallenge_challenge"),
        "webauthnchallenge",
        ["challenge"],
        unique=True,
    )
    op.create_index(
        op.f("ix_webauthnchallenge_user_id"),
        "webauthnchallenge",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_webauthnchallenge_user_id"), table_name="webauthnchallenge")
    op.drop_index(
        op.f("ix_webauthnchallenge_challenge"), table_name="webauthnchallenge"
    )
    op.drop_table("webauthnchallenge")
    op.drop_index(op.f("ix_passkey_credential_id"), table_name="passkey")
    op.drop_index(op.f("ix_passkey_user_id"), table_name="passkey")
    op.drop_table("passkey")
    with op.batch_alter_table("token", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_token_access_token"))

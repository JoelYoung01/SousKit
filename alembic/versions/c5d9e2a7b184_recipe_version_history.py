"""append-only recipe version history

Revision ID: c5d9e2a7b184
Revises: d4a7c2e9f1b3
Create Date: 2026-10-30 15:30:00.000000

Moves cooked content (name, description, instructions, notes, prep time,
cover, ingredients) onto recipe_version. The recipe row keeps identity and
metadata: id, slug, owner, household, visibility, and a pointer at the
current version.

"""

from typing import Sequence, Union

import sqlalchemy as sa

import api
from alembic import op

revision: str = "c5d9e2a7b184"
down_revision: Union[str, None] = "d4a7c2e9f1b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _slugify(name: str) -> str:
    import re

    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    slug = slug[:80].strip("-")
    return slug or "recipe"


def _allocate(name: str, used: set[str]) -> str:
    base = _slugify(name)
    candidate = base
    suffix = 2
    while candidate in used:
        extra = f"-{suffix}"
        candidate = f"{base[: 80 - len(extra)].strip('-')}{extra}"
        suffix += 1
    used.add(candidate)
    return candidate


def upgrade() -> None:
    op.create_table(
        "recipe_version",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("recipe_id", sa.Integer(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column(
            "created_on", api.core.timezone_handler.UTCDateTime(), nullable=False
        ),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("instructions", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("prep_time", sa.Float(), nullable=True),
        sa.Column("cover_image_id", sa.Integer(), nullable=True),
        sa.Column("change_kind", sa.String(length=32), nullable=False),
        sa.Column("restored_from_version", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["cover_image_id"],
            ["upload.id"],
            name=op.f("fk_recipe_version_cover_image_id_upload"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["user.id"],
            name=op.f("fk_recipe_version_created_by_id_user"),
        ),
        sa.ForeignKeyConstraint(
            ["recipe_id"],
            ["recipe.id"],
            name=op.f("fk_recipe_version_recipe_id_recipe"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_version")),
        sa.UniqueConstraint(
            "recipe_id",
            "version_number",
            name=op.f("uq_recipe_version_recipe_id_version_number"),
        ),
    )
    with op.batch_alter_table("recipe_version", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_recipe_version_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_recipe_version_recipe_id"), ["recipe_id"], unique=False
        )

    with op.batch_alter_table("recipe", schema=None) as batch_op:
        batch_op.add_column(sa.Column("slug", sa.String(length=180), nullable=True))
        batch_op.add_column(
            sa.Column("current_version_id", sa.Integer(), nullable=True)
        )

    with op.batch_alter_table("ingredient", schema=None) as batch_op:
        batch_op.add_column(sa.Column("recipe_version_id", sa.Integer(), nullable=True))

    conn = op.get_bind()
    recipes = conn.execute(
        sa.text(
            "SELECT id, created_by_id, created_on, name, description, "
            "instructions, notes, prep_time, cover_image_id FROM recipe"
        )
    ).mappings()
    used_slugs: set[str] = set()
    for row in recipes:
        slug = _allocate(row["name"], used_slugs)
        version_id = conn.execute(
            sa.text(
                "INSERT INTO recipe_version ("
                "recipe_id, version_number, created_on, created_by_id, name, "
                "description, instructions, notes, prep_time, cover_image_id, "
                "change_kind, restored_from_version"
                ") VALUES ("
                ":recipe_id, 1, :created_on, :created_by_id, :name, "
                ":description, :instructions, :notes, :prep_time, :cover_image_id, "
                "'create', NULL"
                ") RETURNING id"
            ),
            {
                "recipe_id": row["id"],
                "created_on": row["created_on"],
                "created_by_id": row["created_by_id"],
                "name": row["name"],
                "description": row["description"],
                "instructions": row["instructions"],
                "notes": row["notes"],
                "prep_time": row["prep_time"],
                "cover_image_id": row["cover_image_id"],
            },
        ).scalar_one()
        conn.execute(
            sa.text(
                "UPDATE recipe SET slug = :slug, current_version_id = :version_id "
                "WHERE id = :recipe_id"
            ),
            {"slug": slug, "version_id": version_id, "recipe_id": row["id"]},
        )
        conn.execute(
            sa.text(
                "UPDATE ingredient SET recipe_version_id = :version_id "
                "WHERE recipe_id = :recipe_id"
            ),
            {"version_id": version_id, "recipe_id": row["id"]},
        )

    with op.batch_alter_table("recipe", schema=None) as batch_op:
        batch_op.alter_column(
            "slug", existing_type=sa.String(length=180), nullable=False
        )
        batch_op.create_index("ix_recipe_slug", ["slug"], unique=True)
        batch_op.create_index(
            "ix_recipe_current_version_id", ["current_version_id"], unique=False
        )
        batch_op.drop_column("cover_image_id")
        batch_op.drop_column("prep_time")
        batch_op.drop_column("notes")
        batch_op.drop_column("instructions")
        batch_op.drop_column("description")
        batch_op.drop_column("name")

    with op.batch_alter_table("ingredient", schema=None) as batch_op:
        batch_op.alter_column(
            "recipe_version_id", existing_type=sa.Integer(), nullable=False
        )
        batch_op.create_foreign_key(
            "fk_ingredient_recipe_version_id_recipe_version",
            "recipe_version",
            ["recipe_version_id"],
            ["id"],
        )
        batch_op.create_index(
            "ix_ingredient_recipe_version_id", ["recipe_version_id"], unique=False
        )
        batch_op.drop_column("recipe_id")


def downgrade() -> None:
    with op.batch_alter_table("recipe", schema=None) as batch_op:
        batch_op.add_column(sa.Column("name", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("description", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("instructions", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("notes", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("prep_time", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("cover_image_id", sa.Integer(), nullable=True))

    with op.batch_alter_table("ingredient", schema=None) as batch_op:
        batch_op.add_column(sa.Column("recipe_id", sa.Integer(), nullable=True))

    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE recipe SET "
            "name = (SELECT name FROM recipe_version v "
            "WHERE v.id = recipe.current_version_id), "
            "description = (SELECT description FROM recipe_version v "
            "WHERE v.id = recipe.current_version_id), "
            "instructions = (SELECT instructions FROM recipe_version v "
            "WHERE v.id = recipe.current_version_id), "
            "notes = (SELECT notes FROM recipe_version v "
            "WHERE v.id = recipe.current_version_id), "
            "prep_time = (SELECT prep_time FROM recipe_version v "
            "WHERE v.id = recipe.current_version_id), "
            "cover_image_id = (SELECT cover_image_id FROM recipe_version v "
            "WHERE v.id = recipe.current_version_id)"
        )
    )
    conn.execute(
        sa.text(
            "DELETE FROM ingredient WHERE recipe_version_id NOT IN ("
            "SELECT current_version_id FROM recipe "
            "WHERE current_version_id IS NOT NULL)"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE ingredient SET recipe_id = ("
            "SELECT recipe_id FROM recipe_version v "
            "WHERE v.id = ingredient.recipe_version_id)"
        )
    )

    with op.batch_alter_table("ingredient", schema=None) as batch_op:
        batch_op.alter_column("recipe_id", existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key(
            op.f("fk_ingredient_recipe_id_recipe"),
            "recipe",
            ["recipe_id"],
            ["id"],
        )
        batch_op.drop_index("ix_ingredient_recipe_version_id")
        batch_op.drop_constraint(
            "fk_ingredient_recipe_version_id_recipe_version", type_="foreignkey"
        )
        batch_op.drop_column("recipe_version_id")

    with op.batch_alter_table("recipe", schema=None) as batch_op:
        batch_op.alter_column("name", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("description", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("instructions", existing_type=sa.String(), nullable=False)
        batch_op.drop_index("ix_recipe_current_version_id")
        batch_op.drop_index("ix_recipe_slug")
        batch_op.drop_column("current_version_id")
        batch_op.drop_column("slug")

    with op.batch_alter_table("recipe_version", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_recipe_version_recipe_id"))
        batch_op.drop_index(batch_op.f("ix_recipe_version_id"))
    op.drop_table("recipe_version")

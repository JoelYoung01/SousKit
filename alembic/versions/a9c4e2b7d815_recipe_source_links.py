"""recipe source links

Revision ID: a9c4e2b7d815
Revises: f7c2e8a1b4d0
Create Date: 2026-11-05 17:10:00.000000

Stores source URLs on each recipe version as a JSON object:
{"links": [{"name": "Serious Eats", "url": "https://..."}]}.

Older imports kept the URL in notes ("Imported from https://..."). Those lines
move onto the new field so the detail page can show them as chips.

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op
from api.core.source_links import dump_source_links, extract_legacy_import_notes

revision: str = "a9c4e2b7d815"
down_revision: Union[str, None] = "f7c2e8a1b4d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("recipe_version", schema=None) as batch_op:
        batch_op.add_column(sa.Column("source_links_json", sa.Text(), nullable=True))

    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT id, notes FROM recipe_version "
            "WHERE notes IS NOT NULL AND lower(notes) LIKE :pattern"
        ),
        {"pattern": "%imported from http%"},
    ).fetchall()
    for row in rows:
        version_id, notes = row[0], row[1]
        cleaned, links = extract_legacy_import_notes(notes)
        blob = dump_source_links(links)
        if not blob:
            continue
        connection.execute(
            sa.text(
                "UPDATE recipe_version "
                "SET notes = :notes, source_links_json = :links "
                "WHERE id = :id"
            ),
            {"notes": cleaned, "links": blob, "id": version_id},
        )


def downgrade() -> None:
    with op.batch_alter_table("recipe_version", schema=None) as batch_op:
        batch_op.drop_column("source_links_json")

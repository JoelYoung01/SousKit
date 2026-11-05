"""Alembic must keep a single head so deploys can migrate.

Run: uv run python -m unittest api.tests.test_migrations
"""

from __future__ import annotations

import os
import tempfile
import unittest

os.environ.setdefault("VITE_GOOGLE_CLIENT_ID", "test-google-client")
os.environ.setdefault("SUPERUSER_GID", "test-superuser")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-migrations")
os.environ.setdefault("ENVIRONMENT", "development")

from sqlalchemy import create_engine, inspect  # noqa: E402

from alembic import command  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from api.core.config import settings  # noqa: E402
from api.core.migrate import alembic_config, head_revision  # noqa: E402

_BRANCHES = ("c5d9e2a7b184", "e5c1a8d3f6b2")


class AlembicHeadTests(unittest.TestCase):
    def setUp(self) -> None:
        self._previous_db = settings.SQLITE_FILE_NAME

    def tearDown(self) -> None:
        settings.SQLITE_FILE_NAME = self._previous_db

    def test_single_head(self) -> None:
        heads = ScriptDirectory.from_config(alembic_config()).get_heads()
        self.assertEqual(len(heads), 1)
        self.assertEqual(head_revision(), heads[0])

    def test_upgrade_head_on_empty_database(self) -> None:
        self._assert_at_merge(["head"])

    def test_upgrade_head_from_each_branch(self) -> None:
        for branch in _BRANCHES:
            with self.subTest(branch=branch):
                self._assert_at_merge([branch, "head"])

    def test_upgrade_head_when_both_branches_are_already_applied(self) -> None:
        # `upgrade heads` records both revisions. The merge must still collapse
        # that database onto the single deploy head.
        self._assert_at_merge(["heads", "head"])

    def _assert_at_merge(self, steps: list[str]) -> None:
        fd, path = tempfile.mkstemp(prefix="souskit-alembic-", suffix=".db")
        os.close(fd)
        os.unlink(path)
        settings.SQLITE_FILE_NAME = path
        engine = None
        try:
            for step in steps:
                command.upgrade(alembic_config(), step)
            engine = create_engine(f"sqlite:///{path}")
            with engine.connect() as connection:
                rows = connection.exec_driver_sql(
                    "SELECT version_num FROM alembic_version"
                ).fetchall()
                inspected = inspect(connection)
                names = set(inspected.get_table_names())
                indexes = {index["name"] for index in inspected.get_indexes("token")}
                version_columns = {
                    column["name"] for column in inspected.get_columns("recipe_version")
                }
            self.assertEqual([row[0] for row in rows], [head_revision()])
            self.assertIn("recipe_version", names)
            self.assertIn("source_links_json", version_columns)
            self.assertIn("passkey", names)
            self.assertIn("webauthnchallenge", names)
            self.assertIn("ix_token_access_token", indexes)
        finally:
            if engine is not None:
                engine.dispose()
            for suffix in ("", "-journal", "-wal", "-shm"):
                candidate = f"{path}{suffix}"
                if os.path.exists(candidate):
                    os.remove(candidate)

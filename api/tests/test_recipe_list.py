"""The recipes library lists each recipe once, at its current version.

Run: uv run python -m unittest api.tests.test_recipe_list
"""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

# Point the API at a throwaway database before any settings import.
_DB = tempfile.NamedTemporaryFile(prefix="souskit-recipes-", suffix=".db", delete=False)
_DB.close()
os.environ["SQLITE_FILE_NAME"] = _DB.name
os.environ.setdefault("VITE_GOOGLE_CLIENT_ID", "test-google-client")
os.environ.setdefault("SUPERUSER_GID", "test-superuser")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-recipe-list")
os.environ.setdefault("ENVIRONMENT", "development")

from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session  # noqa: E402

from api.core.authentication import create_access_token_for_user  # noqa: E402
from api.core.database import engine  # noqa: E402
from api.core.household import create_household_for_user  # noqa: E402
from api.core.recipe_versions import append_version, create_recipe  # noqa: E402
from api.core.security import hash_password  # noqa: E402
from api.main import app  # noqa: E402
from api.models import BaseDbModel, User  # noqa: E402

BaseDbModel.metadata.create_all(engine)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class RecipeLibraryListTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)
        with Session(engine) as session:
            user = User(
                username="list",
                email="list@example.com",
                display_name="List",
                hashed_password=hash_password("password123"),
                email_verified=True,
                admin=False,
                disabled=False,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            household = create_household_for_user(session, user)
            now = datetime.now(timezone.utc)
            older = create_recipe(
                session,
                user_id=user.id,
                household_id=household.id,
                public=False,
                name="Old Stew",
                description="The first write-up",
                instructions="Simmer the old stew.",
                notes=None,
                prep_time=30,
                cover_image_id=None,
                ingredients=[
                    {"name": "beef", "amount": 1, "units": "lb", "details": None}
                ],
                created_on=now - timedelta(days=10),
            )
            create_recipe(
                session,
                user_id=user.id,
                household_id=household.id,
                public=False,
                name="Fresh Salad",
                description="A newer recipe that was never edited",
                instructions="Toss the salad.",
                notes=None,
                prep_time=10,
                cover_image_id=None,
                ingredients=[
                    {"name": "lettuce", "amount": 1, "units": "head", "details": None}
                ],
                created_on=now - timedelta(days=1),
            )
            append_version(
                session,
                older,
                user_id=user.id,
                name="Revised Stew",
                description="The latest write-up",
                instructions="Simmer the revised stew.",
                notes="Extra thyme",
                prep_time=40,
                cover_image_id=None,
                ingredients=[
                    {"name": "beef", "amount": 2, "units": "lb", "details": None}
                ],
                change_kind="edit",
            )
            token = create_access_token_for_user(user, session)
            cls.headers = _auth(token.access_token)

    def test_library_lists_each_recipe_once_at_its_head(self) -> None:
        response = self.client.get("/api/recipe/user/", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        self.assertEqual([row["name"] for row in rows], ["Revised Stew", "Fresh Salad"])
        self.assertEqual([row["head_version_number"] for row in rows], [2, 1])
        self.assertEqual(len({row["id"] for row in rows}), 2)
        self.assertNotIn("Old Stew", response.text)
        revised = rows[0]
        self.assertGreater(revised["updated_on"], revised["created_on"])

    def test_count_ignores_historical_versions(self) -> None:
        response = self.client.get("/api/recipe/user/count/", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["count"], 2)

    def test_paging_follows_latest_save_order(self) -> None:
        response = self.client.get(
            "/api/recipe/user/?limit=1&offset=1", headers=self.headers
        )
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        self.assertEqual([row["name"] for row in rows], ["Fresh Salad"])

    def test_recently_added_uses_created_on_but_still_shows_the_head(self) -> None:
        response = self.client.get("/api/recipe/user/recent/", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        self.assertEqual(
            [row["name"] for row in rows],
            ["Fresh Salad", "Revised Stew"],
        )
        stew = next(row for row in rows if row["name"] == "Revised Stew")
        self.assertEqual(stew["head_version_number"], 2)

"""Source links are stored as a JSON object and filled in on URL import.

Run: uv run python -m unittest api.tests.test_source_links
"""

from __future__ import annotations

import os
import tempfile
import unittest

_DB = tempfile.NamedTemporaryFile(prefix="souskit-sources-", suffix=".db", delete=False)
_DB.close()
os.environ["SQLITE_FILE_NAME"] = _DB.name
os.environ.setdefault("VITE_GOOGLE_CLIENT_ID", "test-google-client")
os.environ.setdefault("SUPERUSER_GID", "test-superuser")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-source-links")
os.environ.setdefault("ENVIRONMENT", "development")

from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session  # noqa: E402

from api.core.authentication import create_access_token_for_user  # noqa: E402
from api.core.database import engine  # noqa: E402
from api.core.household import create_household_for_user  # noqa: E402
from api.core.recipe_import import import_recipe_from_url  # noqa: E402
from api.core.security import hash_password  # noqa: E402
from api.core.source_links import (  # noqa: E402
    extract_legacy_import_notes,
    hostname_label,
    normalize_source_links,
    site_name_from_html,
)
from api.main import app  # noqa: E402
from api.models import BaseDbModel, User  # noqa: E402

BaseDbModel.metadata.create_all(engine)

_PAGE = """
<html><head>
<meta property="og:site_name" content="Serious Eats">
<title>Best Chili | Serious Eats</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Best Chili",
  "description": "A bowl of chili.",
  "recipeIngredient": ["1 lb beef", "2 cups beans"],
  "recipeInstructions": [
    {"@type": "HowToStep", "text": "Brown the beef."},
    {"@type": "HowToStep", "text": "Simmer the beans."}
  ]
}
</script>
</head><body></body></html>
"""


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class SourceLinkParsingTests(unittest.TestCase):
    def test_site_name_prefers_og_site_name(self) -> None:
        name = site_name_from_html(_PAGE, "https://www.seriouseats.com/best-chili")
        self.assertEqual(name, "Serious Eats")

    def test_title_site_name_matches_the_hostname(self) -> None:
        html = "<title>Best Chili Recipe | Serious Eats</title>"
        name = site_name_from_html(html, "https://www.seriouseats.com/chili")
        self.assertEqual(name, "Serious Eats")

    def test_hostname_label_when_the_page_has_no_site_name(self) -> None:
        name = site_name_from_html(
            "<title>Best Chili</title>", "https://www.the-kitchn.com/soup"
        )
        self.assertEqual(name, hostname_label("https://www.the-kitchn.com/soup"))
        self.assertEqual(name, "The Kitchn")

    def test_comma_separated_urls_keep_order_and_drop_duplicates(self) -> None:
        links = normalize_source_links(
            "https://www.seriouseats.com/chili, "
            "https://cooking.nytimes.com/recipes/1, "
            "https://seriouseats.com/chili/"
        )
        self.assertEqual(
            [link["url"] for link in links],
            [
                "https://www.seriouseats.com/chili",
                "https://cooking.nytimes.com/recipes/1",
            ],
        )
        self.assertEqual(links[0]["name"], "Seriouseats")
        self.assertEqual(links[1]["name"], "Nytimes")

    def test_legacy_import_line_becomes_a_link_and_leaves_the_note(self) -> None:
        notes, links = extract_legacy_import_notes(
            "Rest overnight.\n\nImported from https://www.seriouseats.com/chili."
        )
        self.assertEqual(notes, "Rest overnight.")
        self.assertEqual(links[0]["url"], "https://www.seriouseats.com/chili")
        self.assertEqual(links[0]["name"], "Seriouseats")


class SourceLinkApiTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)
        with Session(engine) as session:
            user = User(
                username="sources",
                email="sources@example.com",
                display_name="Sources",
                hashed_password=hash_password("password123"),
                email_verified=True,
                admin=False,
                disabled=False,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            create_household_for_user(session, user)
            token = create_access_token_for_user(user, session)
            cls.headers = _auth(token.access_token)

    def _recipe(self, **extra: object) -> dict:
        body = {
            "name": "Chili",
            "description": "A bowl of chili.",
            "instructions": "Simmer until thick.",
            "public": False,
            "ingredients": [{"name": "beef", "amount": 1, "units": "lb"}],
        }
        body.update(extra)
        response = self.client.post("/api/recipe/", json=body, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_comma_separated_urls_round_trip(self) -> None:
        created = self._recipe(
            source_links=(
                "https://www.seriouseats.com/chili, https://cooking.nytimes.com/1"
            )
        )
        self.assertEqual(created["source_links"][0]["name"], "Seriouseats")
        self.assertEqual(
            created["source_links"][1]["url"], "https://cooking.nytimes.com/1"
        )

        renamed = self.client.put(
            f"/api/recipe/{created['id']}/",
            json={
                "source_links": [
                    {
                        "name": "Serious Eats",
                        "url": "https://www.seriouseats.com/chili",
                    }
                ]
            },
            headers=self.headers,
        )
        self.assertEqual(renamed.status_code, 200, renamed.text)
        self.assertEqual(renamed.json()["source_links"][0]["name"], "Serious Eats")

        notes = self.client.put(
            f"/api/recipe/{created['id']}/",
            json={"notes": "Rest overnight."},
            headers=self.headers,
        )
        self.assertEqual(notes.status_code, 200, notes.text)
        self.assertEqual(notes.json()["source_links"][0]["name"], "Serious Eats")
        self.assertEqual(notes.json()["notes"], "Rest overnight.")

    def test_private_url_is_rejected(self) -> None:
        response = self.client.post(
            "/api/recipe/",
            json={
                "name": "Chili",
                "description": "A bowl of chili.",
                "instructions": "Simmer until thick.",
                "public": False,
                "ingredients": [{"name": "beef"}],
                "source_links": [{"name": "Local", "url": "http://127.0.0.1/secret"}],
            },
            headers=self.headers,
        )
        self.assertEqual(response.status_code, 422)

    async def test_import_fills_the_first_link_and_leaves_notes_alone(self) -> None:
        draft = await import_recipe_from_url(
            "https://www.seriouseats.com/best-chili",
            html=_PAGE,
            final_url="https://www.seriouseats.com/best-chili",
        )
        self.assertEqual(draft.name, "Best Chili")
        self.assertNotIn("Imported from", draft.notes or "")
        self.assertEqual(len(draft.source_links), 1)
        self.assertEqual(draft.source_links[0]["name"], "Serious Eats")
        self.assertEqual(
            draft.source_links[0]["url"], "https://www.seriouseats.com/best-chili"
        )

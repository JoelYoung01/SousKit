"""Markdown kept from recipe HTML during URL import.

Run: uv run python -m unittest api.tests.test_recipe_markup
"""

from __future__ import annotations

import unittest

from api.core.recipe_import.scrape import scrape_recipe_html
from api.core.recipe_markup import html_to_markdown

_PLAIN_PAGE = """
<html><head>
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

_RICH_PAGE = """
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Best Chili",
  "description": "A hearty bowl.",
  "recipeIngredient": ["1 lb beef", "1 onion"],
  "recipeInstructions": [
    {"@type": "HowToStep", "text": "Brown the beef."},
    {"@type": "HowToStep", "text": "Simmer the chili."}
  ]
}
</script>
</head><body>
<div class="wprm-recipe-summary"><p>A <strong>hearty</strong> bowl.</p></div>
<div class="wprm-recipe-instruction-group">
  <h4 class="wprm-recipe-instruction-group-title">Cook</h4>
  <div class="wprm-recipe-instruction-text">Brown the <strong>beef</strong>.</div>
  <div class="wprm-recipe-instruction-text">Simmer the chili.</div>
</div>
<div class="wprm-recipe-notes">
  <ul>
    <li>Rest <em>overnight</em>.</li>
    <li>Freeze extras.</li>
  </ul>
</div>
</body></html>
"""

_SCHEMA_HTML_PAGE = """
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Weeknight Beans",
  "description": "A <strong>fast</strong> pot of beans.",
  "recipeIngredient": ["2 cups beans"],
  "recipeInstructions": [
    {
      "@type": "HowToSection",
      "name": "Pot",
      "itemListElement": [
        {
          "@type": "HowToStep",
          "text": "Rinse the <strong>beans</strong>.<br>Cover with water."
        },
        {"@type": "HowToStep", "text": "Simmer until tender."}
      ]
    }
  ]
}
</script>
</head><body></body></html>
"""


class HtmlToMarkdownTests(unittest.TestCase):
    def test_inline_formatting_lists_and_links(self) -> None:
        self.assertEqual(
            html_to_markdown("A <strong>bold</strong> and <em>soft</em> soup."),
            "A **bold** and *soft* soup.",
        )
        self.assertEqual(
            html_to_markdown("<p>First</p><p>Second</p>"),
            "First\n\nSecond",
        )
        self.assertEqual(
            html_to_markdown("<ul><li>One</li><li>Two</li></ul>"),
            "- One\n- Two",
        )
        self.assertEqual(
            html_to_markdown("<ol><li><p>Heat</p></li><li>Simmer</li></ol>"),
            "1. Heat\n2. Simmer",
        )
        self.assertEqual(
            html_to_markdown('See <a href="https://example.com/notes">the notes</a>.'),
            "See [the notes](https://example.com/notes).",
        )
        self.assertEqual(
            html_to_markdown('<a href="javascript:alert(1)">click</a>'),
            "click",
        )
        self.assertNotIn(
            "alert",
            html_to_markdown("<script>alert(1)</script><p>Keep</p>"),
        )

    def test_line_break_and_heading(self) -> None:
        self.assertEqual(
            html_to_markdown("<h2>Sauce</h2><p>Whisk the <b>butter</b>.</p>"),
            "## Sauce\n\nWhisk the **butter**.",
        )
        self.assertEqual(html_to_markdown("Line<br>break"), "Line\nbreak")


_UNRELATED_PAGE = """
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Best Chili",
  "description": "A bowl of chili.",
  "recipeIngredient": ["1 lb beef"],
  "recipeInstructions": [
    {"@type": "HowToStep", "text": "Brown the beef."}
  ]
}
</script>
</head><body>
<div class="wprm-recipe-summary">
  <p>A <strong>chocolate</strong> layer cake for birthdays.</p>
</div>
<div class="wprm-recipe-instruction-text">Frost the <strong>cake</strong> layers.</div>
</body></html>
"""


class ScrapeFormattingTests(unittest.TestCase):
    def test_plain_schema_stays_numbered_text(self) -> None:
        scraped = scrape_recipe_html(
            _PLAIN_PAGE, page_url="https://www.seriouseats.com/best-chili"
        )
        self.assertIsNotNone(scraped)
        assert scraped is not None
        self.assertEqual(scraped["description"], "A bowl of chili.")
        self.assertEqual(
            scraped["instructions"], "1. Brown the beef.\n2. Simmer the beans."
        )
        self.assertIsNone(scraped["notes"])

    def test_plugin_html_keeps_bold_lists_and_notes(self) -> None:
        scraped = scrape_recipe_html(
            _RICH_PAGE, page_url="https://www.seriouseats.com/best-chili"
        )
        self.assertIsNotNone(scraped)
        assert scraped is not None
        self.assertEqual(scraped["description"], "A **hearty** bowl.")
        self.assertIn("## Cook", scraped["instructions"])
        self.assertIn("1. Brown the **beef**.", scraped["instructions"])
        self.assertIn("2. Simmer the chili.", scraped["instructions"])
        self.assertEqual(scraped["notes"], "- Rest *overnight*.\n- Freeze extras.")

    def test_schema_html_keeps_sections_and_bold(self) -> None:
        scraped = scrape_recipe_html(
            _SCHEMA_HTML_PAGE, page_url="https://www.example.com/beans"
        )
        self.assertIsNotNone(scraped)
        assert scraped is not None
        self.assertEqual(scraped["description"], "A **fast** pot of beans.")
        self.assertIn("## Pot", scraped["instructions"])
        self.assertIn("Rinse the **beans**.", scraped["instructions"])
        self.assertIn("Cover with water.", scraped["instructions"])
        self.assertIn("Simmer until tender.", scraped["instructions"])

    def test_unrelated_card_html_is_left_alone(self) -> None:
        scraped = scrape_recipe_html(
            _UNRELATED_PAGE, page_url="https://www.example.com/chili"
        )
        self.assertIsNotNone(scraped)
        assert scraped is not None
        self.assertEqual(scraped["description"], "A bowl of chili.")
        self.assertEqual(scraped["instructions"], "1. Brown the beef.")
        self.assertIsNone(scraped["notes"])

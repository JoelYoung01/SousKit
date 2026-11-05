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


_PHO_PAGE = (
    """
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Chicken Pho",
  "description": "Recipe video above. A clear chicken broth.",
  "recipeYield": ["4", "4 - 6 people"],
  "recipeIngredient": ["2 litres / 2 quarts water", "4 cloves"],
  "recipeInstructions": [
    {
      "@type": "HowToSection",
      "name": "BROTH:",
      "itemListElement": [
        {"@type": "HowToStep", "text": "Char the onion - Leave it cut side down."}
      ]
    },
    {
      "@type": "HowToSection",
      "name": "ASSEMBLING:",
      "itemListElement": [
        {"@type": "HowToStep", "text": "Place toppings out."}
      ]
    }
  ]
}
</script>
</head><body>
<div class="wprm-recipe-summary">
  <p><strong>Recipe video above.</strong> A <em>clear</em> chicken broth.
  See <a href="https://www.example.com/beef-pho">Beef Pho</a>.</p>
</div>
<div class="wprm-recipe-ingredient-group">
  <h4 class="wprm-recipe-ingredient-group-name">Pho Soup Broth:</h4>
  <ul>
    <li class="wprm-recipe-ingredient">
      <span class="wprm-recipe-ingredient-amount">2 litres / 2 quarts</span>
      <span class="wprm-recipe-ingredient-name">water</span>
    </li>
    <li class="wprm-recipe-ingredient">
      <span class="wprm-recipe-ingredient-amount">1.5 kg / 3 lb</span>
      <span class="wprm-recipe-ingredient-name">chicken thighs, bone in skin on</span>
      <span class="wprm-recipe-ingredient-notes">(Note 1)</span>
    </li>
    <li class="wprm-recipe-ingredient">
      <span class="wprm-recipe-ingredient-amount">4</span>
      <span class="wprm-recipe-ingredient-name">cloves</span>
    </li>
    <li class="wprm-recipe-ingredient">
      <span class="wprm-recipe-ingredient-amount">3/4</span>
      <span class="wprm-recipe-ingredient-unit">tsp</span>
      <span class="wprm-recipe-ingredient-name">salt</span>
      <span class="wprm-recipe-ingredient-notes">
        (Cooking/kosher salt, or 1/2 tsp table salt)
      </span>
    </li>
    <li class="wprm-recipe-ingredient">
      <span class="wprm-recipe-ingredient-amount">1</span>
      <span class="wprm-recipe-ingredient-name">small bunch coriander/cilantro</span>
      <span class="wprm-recipe-ingredient-notes">(Note 2)</span>
    </li>
  </ul>
</div>
<div class="wprm-recipe-ingredient-group">
  <h4 class="wprm-recipe-ingredient-group-name">Toppings – help yourself</h4>
  <ul>
    <li class="wprm-recipe-ingredient">
      <span class="wprm-recipe-ingredient-amount">1</span>
      <span class="wprm-recipe-ingredient-unit">small bunch</span>
      <span class="wprm-recipe-ingredient-name">
        EACH Thai Basil, min, coriander/cilantro
      </span>
    </li>
    <li class="wprm-recipe-ingredient">
      <span class="wprm-recipe-ingredient-name">Hoisin sauce</span>
    </li>
  </ul>
</div>
<div class="wprm-recipe-instruction-group">
  <h4 class="wprm-recipe-instruction-group-name">BROTH:</h4>
  <div class="wprm-recipe-instruction-text">
    <strong>Char the onion –</strong> Leave it cut side down.
  </div>
</div>
<div class="wprm-recipe-instruction-group">
  <h4 class="wprm-recipe-instruction-group-name">ASSEMBLING:</h4>
  <div class="wprm-recipe-instruction-text">Place toppings out.</div>
</div>
<div class="wprm-recipe-notes"><p>"""
    + ("Store the broth. " * 180)
    + """</p>
<p>Quick pho uses stock instead of water.</p>
</div>
</body></html>
"""
)


class PhoCardTests(unittest.TestCase):
    def test_wprm_groups_dual_measures_and_long_notes(self) -> None:
        scraped = scrape_recipe_html(
            _PHO_PAGE, page_url="https://www.recipetineats.com/chicken-pho"
        )
        self.assertIsNotNone(scraped)
        assert scraped is not None
        self.assertNotIn("Recipe video", scraped["description"])
        self.assertIn("*clear*", scraped["description"])
        self.assertIn(
            "[Beef Pho](https://www.example.com/beef-pho)", scraped["description"]
        )
        self.assertIn("Serves 4–6.", scraped["description"])
        self.assertIn("## BROTH", scraped["instructions"])
        self.assertIn("**Char the onion", scraped["instructions"])
        self.assertIn("## ASSEMBLING", scraped["instructions"])
        self.assertIn("1. Place toppings out.", scraped["instructions"])
        self.assertGreater(len(scraped["notes"]), 2000)
        self.assertIn("Quick pho", scraped["notes"])

        by_name = {row["name"]: row for row in scraped["ingredients"]}
        water = by_name["water"]
        self.assertEqual(water["amount"], 2)
        self.assertEqual(water["units"], "litres")
        self.assertEqual(water["details"], "or 2 quarts")
        self.assertEqual(water["group_name"], "Pho Soup Broth")
        chicken = by_name["chicken thighs"]
        self.assertEqual(chicken["amount"], 1.5)
        self.assertEqual(chicken["units"], "kg")
        self.assertEqual(chicken["details"], "or 3 lb; bone in skin on; Note 1")
        self.assertEqual(by_name["cloves"]["amount"], 4)
        self.assertIsNone(by_name["cloves"]["units"])
        self.assertEqual(by_name["salt"]["amount"], 0.75)
        self.assertEqual(by_name["salt"]["units"], "tsp")
        self.assertEqual(by_name["coriander/cilantro"]["units"], "small bunch")
        herbs = by_name["EACH Thai Basil, min, coriander/cilantro"]
        self.assertEqual(herbs["units"], "small bunch")
        self.assertEqual(herbs["group_name"], "Toppings – help yourself")
        self.assertIsNone(by_name["Hoisin sauce"]["amount"])

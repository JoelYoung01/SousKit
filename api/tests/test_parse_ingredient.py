"""Ingredient line parsing, including dual measurements.

Run: uv run python -m unittest api.tests.test_parse_ingredient
"""

from __future__ import annotations

import unittest

from api.core.recipe_import.parse_ingredient import parse_ingredient_line


class ParseIngredientLineTests(unittest.TestCase):
    def test_simple_amount_and_prep_note(self) -> None:
        parsed = parse_ingredient_line("1 lb beef")
        self.assertEqual(parsed["name"], "beef")
        self.assertEqual(parsed["amount"], 1)
        self.assertEqual(parsed["units"], "lb")
        self.assertIsNone(parsed["details"])

        minced = parse_ingredient_line("garlic, minced")
        self.assertEqual(minced["name"], "garlic")
        self.assertEqual(minced["details"], "minced")

    def test_cloves_are_the_ingredient_when_nothing_follows(self) -> None:
        spice = parse_ingredient_line("4 cloves")
        self.assertEqual(spice["name"], "cloves")
        self.assertEqual(spice["amount"], 4)
        self.assertIsNone(spice["units"])

        garlic = parse_ingredient_line("4 cloves garlic")
        self.assertEqual(garlic["name"], "garlic")
        self.assertEqual(garlic["amount"], 4)
        self.assertEqual(garlic["units"], "cloves")

    def test_fraction_is_not_split_on_the_slash(self) -> None:
        parsed = parse_ingredient_line(
            "3/4 tsp salt (Cooking/kosher salt, or 1/2 tsp table salt)"
        )
        self.assertEqual(parsed["amount"], 0.75)
        self.assertEqual(parsed["units"], "tsp")
        self.assertEqual(parsed["name"], "salt")
        self.assertEqual(
            parsed["details"],
            "Cooking/kosher salt, or 1/2 tsp table salt",
        )

    def test_dual_metric_and_us_measurements(self) -> None:
        water = parse_ingredient_line("2 litres / 2 quarts water")
        self.assertEqual(water["name"], "water")
        self.assertEqual(water["amount"], 2)
        self.assertEqual(water["units"], "litres")
        self.assertEqual(water["details"], "or 2 quarts")

        chicken = parse_ingredient_line(
            "1.5 kg / 3 lb chicken thighs, bone in skin on (Note 1)"
        )
        self.assertEqual(chicken["name"], "chicken thighs")
        self.assertEqual(chicken["amount"], 1.5)
        self.assertEqual(chicken["units"], "kg")
        self.assertEqual(chicken["details"], "or 3 lb; bone in skin on; Note 1")

        noodles = parse_ingredient_line(
            "360g / 13 oz dried rice noodles (, thin flat (or 600g fresh))"
        )
        self.assertEqual(noodles["name"], "dried rice noodles")
        self.assertEqual(noodles["amount"], 360)
        self.assertEqual(noodles["units"], "g")
        self.assertEqual(noodles["details"], "or 13 oz; thin flat (or 600g fresh)")

        ginger = parse_ingredient_line(
            '5cm/ 2" piece of ginger (, sliced 0.75cm / 1/3" thick (unpeeled))'
        )
        self.assertEqual(ginger["name"], "piece of ginger")
        self.assertEqual(ginger["amount"], 5)
        self.assertEqual(ginger["units"], "cm")
        self.assertIn('or 2"', ginger["details"])
        self.assertIn("unpeeled", ginger["details"])

    def test_nested_parenthetical_notes_and_herb_lists(self) -> None:
        oil = parse_ingredient_line(
            "1 tbsp oil (, vegetable or canola (or other plain oil))"
        )
        self.assertEqual(oil["name"], "oil")
        self.assertEqual(oil["units"], "tbsp")
        self.assertEqual(oil["details"], "vegetable or canola (or other plain oil)")

        herbs = parse_ingredient_line(
            "1 small bunch EACH Thai Basil, min, coriander/cilantro (Note 4)"
        )
        self.assertEqual(herbs["amount"], 1)
        self.assertEqual(herbs["units"], "small bunch")
        self.assertEqual(herbs["name"], "EACH Thai Basil, min, coriander/cilantro")
        self.assertEqual(herbs["details"], "Note 4")

        canned = parse_ingredient_line("1 (14 oz) can diced tomatoes")
        self.assertEqual(canned["name"], "diced tomatoes")
        self.assertEqual(canned["units"], "can")
        self.assertEqual(canned["details"], "14 oz")

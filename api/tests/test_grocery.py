"""Grocery aggregation keeps ingredient details as shopping notes.

Run: uv run python -m unittest api.tests.test_grocery
"""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from api.core.grocery import aggregate_grocery_items, normalize_item_note


def _ingredient(
    *,
    id: int,
    name: str,
    amount: float | None = 1,
    units: str | None = None,
    details: str | None = None,
):
    return SimpleNamespace(
        id=id, name=name, amount=amount, units=units, details=details
    )


def _plan(recipe_id: int, recipe_name: str, ingredients: list, day: int):
    planned_for = datetime(2026, 11, day, 18, 0, tzinfo=timezone.utc)
    recipe = SimpleNamespace(
        id=recipe_id,
        name=recipe_name,
        notes="Recipe note that should not appear on every grocery line",
        ingredients=ingredients,
    )
    return SimpleNamespace(recipe=recipe, planned_for=planned_for)


class NormalizeItemNoteTests(unittest.TestCase):
    def test_strips_outer_parentheses_and_whitespace(self):
        self.assertEqual(normalize_item_note("  (Roma)  "), "Roma")
        self.assertEqual(normalize_item_note("((minced))"), "minced")

    def test_blank_notes_are_dropped(self):
        self.assertIsNone(normalize_item_note(None))
        self.assertIsNone(normalize_item_note("   "))
        self.assertIsNone(normalize_item_note("()"))


class AggregateGroceryNotesTests(unittest.TestCase):
    def test_collects_unique_notes_from_every_recipe(self):
        planned = [
            _plan(
                1,
                "Greek Salad",
                [_ingredient(id=1, name="Tomato", amount=2, details="ripe")],
                5,
            ),
            _plan(
                2,
                "Beef Tacos",
                [_ingredient(id=2, name="Tomato", amount=1, details="(Roma)")],
                6,
            ),
            _plan(
                1,
                "Greek Salad",
                [_ingredient(id=1, name="Tomato", amount=2, details="ripe")],
                7,
            ),
        ]

        items = aggregate_grocery_items(planned)
        tomato = next(item for item in items if item["key"] == "tomato")

        self.assertEqual(tomato["notes"], ["ripe", "Roma"])
        self.assertEqual(tomato["recipe_titles"], "Beef Tacos, Greek Salad")

    def test_dedupes_notes_that_differ_only_by_case(self):
        planned = [
            _plan(
                1,
                "Pancakes",
                [_ingredient(id=1, name="Butter", details="unsalted")],
                5,
            ),
            _plan(
                2,
                "Cookies",
                [_ingredient(id=2, name="Butter", details="Unsalted")],
                6,
            ),
        ]

        items = aggregate_grocery_items(planned)
        butter = next(item for item in items if item["key"] == "butter")
        self.assertEqual(butter["notes"], ["unsalted"])

    def test_items_without_details_have_no_notes(self):
        planned = [
            _plan(
                1,
                "Soup",
                [_ingredient(id=1, name="Onion", details="   ")],
                5,
            )
        ]
        items = aggregate_grocery_items(planned)
        self.assertEqual(items[0]["notes"], [])
        self.assertEqual(items[0]["recipe_titles"], "Soup")

    def test_recipe_level_notes_are_not_copied_onto_every_item(self):
        ingredients = [
            _ingredient(id=1, name="Blueberries", details="fresh or frozen"),
            _ingredient(id=2, name="Milk"),
        ]
        planned = [_plan(1, "Blueberry Pancakes", ingredients, 5)]

        items = {item["key"]: item for item in aggregate_grocery_items(planned)}

        self.assertEqual(items["blueberries"]["notes"], ["fresh or frozen"])
        self.assertEqual(items["milk"]["notes"], [])
        self.assertEqual(items["blueberries"]["recipe_titles"], "Blueberry Pancakes")

    def test_manual_items_have_no_notes(self):
        manual = SimpleNamespace(
            id=9,
            item_key="paper towels",
            name="Paper towels",
            amount=1,
            units="pack",
        )
        items = aggregate_grocery_items([], [manual])
        self.assertEqual(items[0]["notes"], [])
        self.assertEqual(items[0]["recipe_titles"], "Added manually")


if __name__ == "__main__":
    unittest.main()

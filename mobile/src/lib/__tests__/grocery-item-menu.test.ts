import { buildGroceryItemMenuOptions } from "@/lib/grocery-item-menu";
import type { GroceryItem } from "@/types";

const mockItem: GroceryItem = {
  key: "chicken",
  name: "Chicken thighs",
  category: "Meat",
  quantities: [],
  quantity_display: "2 lbs",
  recipes: [{ id: 9, name: "Roast chicken" }],
  recipe_titles: "Roast chicken",
  source_ingredient_ids: [1],
  manual_item_ids: [],
  is_manual: false,
  auto_dismissed: false,
  dismissed: false,
  deleted: false
};

describe("buildGroceryItemMenuOptions", () => {
  it("includes view recipe when the item is linked to a recipe", () => {
    const menu = buildGroceryItemMenuOptions(mockItem);
    expect(menu.options).toEqual(["Edit", "View Recipe", "Dismiss", "Delete", "Cancel"]);
    expect(menu.actions[1]).toBe("view-recipe");
    expect(menu.destructiveButtonIndex).toBe(3);
    expect(menu.cancelButtonIndex).toBe(4);
  });

  it("omits view recipe for manual-only items", () => {
    const menu = buildGroceryItemMenuOptions({
      ...mockItem,
      recipes: [],
      recipe_titles: "Added manually",
      is_manual: true
    });
    expect(menu.options).toEqual(["Edit", "Dismiss", "Delete", "Cancel"]);
    expect(menu.actions).toEqual(["edit", "dismiss", "delete", "cancel"]);
  });
});

import {
  formatGroceryExportLine,
  formatGroceryListPlainText,
  getExportableGroceryItems
} from "@/lib/grocery-export";
import type { GroceryItem } from "@/types";

function item(partial: Partial<GroceryItem> & Pick<GroceryItem, "key" | "name">): GroceryItem {
  return {
    category: "Produce",
    quantities: [],
    quantity_display: "",
    recipes: [],
    recipe_titles: "",
    source_ingredient_ids: [],
    manual_item_ids: [],
    is_manual: false,
    auto_dismissed: false,
    dismissed: false,
    deleted: false,
    ...partial
  };
}

describe("getExportableGroceryItems", () => {
  it("drops dismissed and deleted items", () => {
    const items = [
      item({ key: "a", name: "Apples" }),
      item({ key: "b", name: "Bananas", dismissed: true }),
      item({ key: "c", name: "Carrots", deleted: true })
    ];
    expect(getExportableGroceryItems(items).map((i) => i.key)).toEqual(["a"]);
  });
});

describe("formatGroceryExportLine", () => {
  it("includes quantity when present", () => {
    expect(
      formatGroceryExportLine(item({ key: "m", name: "Milk", quantity_display: "1 qt" }))
    ).toBe("Milk (1 qt)");
  });

  it("uses the name alone when quantity is blank", () => {
    expect(formatGroceryExportLine(item({ key: "s", name: "Salt", quantity_display: "  " }))).toBe(
      "Salt"
    );
  });
});

describe("formatGroceryListPlainText", () => {
  it("groups active items by category", () => {
    const text = formatGroceryListPlainText([
      item({ key: "c", name: "Chicken", category: "Meat", quantity_display: "2 lbs" }),
      item({ key: "s", name: "Spinach", category: "Produce" }),
      item({ key: "x", name: "Old milk", category: "Dairy", dismissed: true })
    ]);

    expect(text).toBe(
      ["Grocery", "", "Meat", "- Chicken (2 lbs)", "", "Produce", "- Spinach", ""].join("\n")
    );
  });

  it("handles an empty active list", () => {
    expect(formatGroceryListPlainText([])).toBe("Grocery\n(No items)");
  });
});

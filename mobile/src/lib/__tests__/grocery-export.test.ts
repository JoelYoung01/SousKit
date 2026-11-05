import {
  formatGroceryExportLine,
  formatGroceryItemContextLines,
  formatGroceryListPlainText,
  formatGroceryNotesLine,
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
    notes: [],
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

describe("formatGroceryNotesLine", () => {
  it("joins distinct notes and skips blanks", () => {
    expect(formatGroceryNotesLine([" Roma ", "", "  ", "canned, diced"])).toBe(
      "Roma · canned, diced"
    );
  });
});

describe("formatGroceryItemContextLines", () => {
  it("places notes above the source recipe", () => {
    expect(
      formatGroceryItemContextLines(
        item({
          key: "tomato",
          name: "Tomato",
          notes: ["Roma", "canned, diced"],
          recipe_titles: "Greek Salad, Beef Tacos"
        })
      )
    ).toEqual(["Roma · canned, diced", "Greek Salad, Beef Tacos"]);
  });

  it("omits the source recipe from plain-text context when there are no notes", () => {
    expect(
      formatGroceryItemContextLines(
        item({ key: "salt", name: "Salt", recipe_titles: "Guacamole" })
      )
    ).toEqual([]);
  });

  it("keeps the source recipe for reminders even without notes", () => {
    expect(
      formatGroceryItemContextLines(
        item({ key: "salt", name: "Salt", recipe_titles: "Guacamole" }),
        { includeSource: true }
      )
    ).toEqual(["Guacamole"]);
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

  it("puts ingredient notes between the item and its source recipes", () => {
    const text = formatGroceryListPlainText([
      item({
        key: "tomato",
        name: "Tomato",
        quantity_display: "3",
        notes: ["Roma", "canned, diced"],
        recipe_titles: "Beef Tacos, Greek Salad"
      })
    ]);

    expect(text).toBe(
      [
        "Grocery",
        "",
        "Produce",
        "- Tomato (3)",
        "  Roma · canned, diced",
        "  Beef Tacos, Greek Salad",
        ""
      ].join("\n")
    );
  });
});

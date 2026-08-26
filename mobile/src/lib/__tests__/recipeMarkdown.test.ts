import { recipeToMarkdown } from "../recipeMarkdown";

describe("recipeToMarkdown", () => {
  it("formats a full recipe as markdown", () => {
    const markdown = recipeToMarkdown({
      name: "Garlic Pasta",
      description: "Quick weeknight dinner.",
      prep_time: 25,
      ingredients: [
        { name: "spaghetti", amount: 8, units: "oz", details: null },
        { name: "garlic", amount: 4, units: "cloves", details: "minced" }
      ],
      instructions: "1. Boil pasta.\n\n2. Saute garlic.\n3. Toss and serve.",
      notes: "Add chili flakes if you like heat."
    });

    expect(markdown).toBe(
      [
        "# Garlic Pasta",
        "",
        "**Prep time:** 25 min",
        "",
        "## About",
        "",
        "Quick weeknight dinner.",
        "",
        "## Ingredients",
        "",
        "- 8 oz spaghetti",
        "- 4 cloves garlic (minced)",
        "",
        "## Instructions",
        "",
        "1. Boil pasta.",
        "2. Saute garlic.",
        "3. Toss and serve.",
        "",
        "## Notes",
        "",
        "Add chili flakes if you like heat."
      ].join("\n")
    );
  });

  it("omits optional sections when empty", () => {
    const markdown = recipeToMarkdown({
      name: "Plain Toast",
      description: "",
      ingredients: [{ name: "bread", amount: null, units: null }],
      instructions: "Toast the bread."
    });

    expect(markdown).toBe(
      [
        "# Plain Toast",
        "",
        "## Ingredients",
        "",
        "- bread",
        "",
        "## Instructions",
        "",
        "1. Toast the bread."
      ].join("\n")
    );
  });
});

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
      notes: "Add chili flakes if you like heat.",
      source_links: [{ name: "Serious Eats", url: "https://www.seriouseats.com/garlic-pasta" }]
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
        "Add chili flakes if you like heat.",
        "",
        "## Sources",
        "",
        "- [Serious Eats](https://www.seriouseats.com/garlic-pasta)"
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

  it("keeps formatted instructions instead of renumbering them", () => {
    const markdown = recipeToMarkdown({
      name: "Chili",
      description: "A **hearty** bowl.",
      ingredients: [{ name: "beef", amount: 1, units: "lb" }],
      instructions: "## Cook\n\n1. Brown the **beef**.\n2. Simmer.",
      notes: "- Rest overnight"
    });

    expect(markdown).toContain("A **hearty** bowl.");
    expect(markdown).toContain("## Cook\n\n1. Brown the **beef**.\n2. Simmer.");
    expect(markdown).toContain("- Rest overnight");
  });
});

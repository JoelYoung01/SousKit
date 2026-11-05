import {
  formatIngredientAmountUnits,
  ingredientHasAmountOrUnits,
  normalizeIngredientDetails
} from "../ingredients";

describe("normalizeIngredientDetails", () => {
  it("strips one layer of outer parentheses", () => {
    expect(normalizeIngredientDetails("(diced)")).toBe("diced");
  });

  it("strips multiple redundant wrapping layers", () => {
    expect(normalizeIngredientDetails("((minced))")).toBe("minced");
  });

  it("preserves inner parentheses", () => {
    expect(normalizeIngredientDetails("15 ounce; (rinsed and drained)")).toBe(
      "15 ounce; (rinsed and drained)"
    );
  });

  it("returns null for blank values", () => {
    expect(normalizeIngredientDetails(null)).toBeNull();
    expect(normalizeIngredientDetails("   ")).toBeNull();
  });
});

describe("formatIngredientAmountUnits", () => {
  it("joins amount and units", () => {
    expect(formatIngredientAmountUnits(0.5, "lb")).toBe("1/2 lb");
    expect(formatIngredientAmountUnits(0.75, "tsp")).toBe("3/4 tsp");
    expect(formatIngredientAmountUnits(1.5, "kg")).toBe("1 1/2 kg");
    expect(formatIngredientAmountUnits(2, null)).toBe("2");
  });

  it("handles amount-only and units-only values", () => {
    expect(formatIngredientAmountUnits(2, null)).toBe("2");
    expect(formatIngredientAmountUnits(null, "cloves")).toBe("cloves");
    expect(formatIngredientAmountUnits(null, null)).toBe("");
  });
});

describe("ingredientHasAmountOrUnits", () => {
  it("detects when a separator should be shown", () => {
    expect(ingredientHasAmountOrUnits(1, "tsp")).toBe(true);
    expect(ingredientHasAmountOrUnits(null, "cloves")).toBe(true);
    expect(ingredientHasAmountOrUnits(null, null)).toBe(false);
  });
});

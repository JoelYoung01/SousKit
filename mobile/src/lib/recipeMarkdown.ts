import { formatPrepTime } from "@/lib/dates";
import {
  formatIngredientAmountUnits,
  ingredientHasAmountOrUnits,
  normalizeIngredientDetails,
  type IngredientLike
} from "@/lib/ingredients";
import { splitInstructionSteps } from "@/lib/instructions";

export type RecipeMarkdownSource = {
  name: string;
  description?: string | null;
  prep_time?: number | null;
  ingredients: IngredientLike[];
  instructions: string;
  notes?: string | null;
};

function formatIngredientLine(ingredient: IngredientLike): string {
  const amountUnits = formatIngredientAmountUnits(ingredient.amount, ingredient.units);
  const details = normalizeIngredientDetails(ingredient.details);
  let line = "- ";

  if (ingredientHasAmountOrUnits(ingredient.amount, ingredient.units)) {
    line += `${amountUnits} `;
  }

  line += ingredient.name;

  if (details) {
    line += ` (${details})`;
  }

  return line;
}

function formatInstructionLines(instructions: string): string[] {
  return splitInstructionSteps(instructions).map((step, index) => {
    const cleaned = step.replace(/^\d+\.\s*/, "").trim();
    return `${index + 1}. ${cleaned}`;
  });
}

/** Serialize a recipe into a Markdown text block suitable for sharing or pasting. */
export function recipeToMarkdown(recipe: RecipeMarkdownSource): string {
  const lines: string[] = [`# ${recipe.name.trim()}`, ""];

  const prepTime = formatPrepTime(recipe.prep_time);
  if (prepTime) {
    lines.push(`**Prep time:** ${prepTime}`, "");
  }

  const description = recipe.description?.trim();
  if (description) {
    lines.push("## About", "", description, "");
  }

  lines.push("## Ingredients", "");
  if (recipe.ingredients.length > 0) {
    lines.push(...recipe.ingredients.map(formatIngredientLine));
  } else {
    lines.push("- No ingredients listed.");
  }
  lines.push("");

  const instructionLines = formatInstructionLines(recipe.instructions);
  lines.push("## Instructions", "");
  if (instructionLines.length > 0) {
    lines.push(...instructionLines);
  } else {
    lines.push("No instructions listed.");
  }

  const notes = recipe.notes?.trim();
  if (notes) {
    lines.push("", "## Notes", "", notes);
  }

  return lines.join("\n").trimEnd();
}

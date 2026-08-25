export type IngredientLike = {
  amount: number | null;
  units: string | null;
  name: string;
  details?: string | null;
};

/** Remove redundant outer parentheses so display doesn't double-wrap. */
export function normalizeIngredientDetails(details: string | null | undefined): string | null {
  if (!details?.trim()) return null;

  let text = details.trim();
  while (text.startsWith("(") && text.endsWith(")")) {
    const inner = text.slice(1, -1).trim();
    if (!inner) break;
    text = inner;
  }

  return text;
}

export function formatIngredientAmountUnits(amount: number | null, units: string | null): string {
  const bits: string[] = [];
  if (amount != null) bits.push(String(amount));
  if (units) bits.push(units);
  return bits.join(" ");
}

export function ingredientHasAmountOrUnits(amount: number | null, units: string | null): boolean {
  return amount != null || Boolean(units?.trim());
}

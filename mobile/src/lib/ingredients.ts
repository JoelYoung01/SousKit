export type IngredientLike = {
  amount: number | null;
  units: string | null;
  name: string;
  details?: string | null;
  group_name?: string | null;
};

const COOKING_FRACTIONS: [number, string][] = [
  [0.125, "1/8"],
  [0.25, "1/4"],
  [1 / 3, "1/3"],
  [0.375, "3/8"],
  [0.5, "1/2"],
  [0.625, "5/8"],
  [2 / 3, "2/3"],
  [0.75, "3/4"],
  [0.875, "7/8"]
];

/** Show 0.75 as 3/4 and 1.5 as 1 1/2. Other quantities stay decimal. */
export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "";
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = Math.floor(abs + 1e-9);
  const fraction = abs - whole;
  if (fraction > 0.001) {
    const match = COOKING_FRACTIONS.find(([value]) => Math.abs(fraction - value) < 0.02);
    if (match) return sign + (whole ? `${whole} ${match[1]}` : match[1]);
  }
  const rounded = Math.round(abs * 1000) / 1000;
  return sign + String(rounded);
}

/** Section label for the first ingredient of a group. Later rows in that group return null. */
export function ingredientGroupHeading(
  ingredients: { group_name?: string | null }[],
  index: number
): string | null {
  const group = ingredients[index]?.group_name?.trim() || "";
  if (!group) return null;
  const previous = index > 0 ? ingredients[index - 1]?.group_name?.trim() || "" : "";
  return group !== previous ? group : null;
}

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
  if (amount != null) bits.push(formatAmount(amount));
  if (units) bits.push(units);
  return bits.join(" ");
}

export function ingredientHasAmountOrUnits(amount: number | null, units: string | null): boolean {
  return amount != null || Boolean(units?.trim());
}

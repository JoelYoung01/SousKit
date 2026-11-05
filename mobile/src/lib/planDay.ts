import { addDays, startOfDay, toDateKey } from "@/lib/dates";

/**
 * Day picker for assigning one recipe to a night.
 * Keep this module in sync with `src/lib/planDay.ts`.
 *
 * Planned meals are grouped by the leading `YYYY-MM-DD` of `planned_for`,
 * matching the planner (not a local-timezone conversion of the timestamp).
 */

export const PLAN_DAY_COUNT = 14;

export interface PlanMealRef {
  id: number;
  planned_for: string;
  recipe: { id: number; name: string };
}

export interface PlanDayMeal {
  id: number;
  recipe: { id: number; name: string };
}

export interface PlanDay {
  date: Date;
  key: string;
  label: string;
  dateLabel: string;
  planned: PlanDayMeal[];
}

export type PlanCommit =
  | { kind: "assign" }
  | { kind: "already" }
  | { kind: "replace"; others: PlanDayMeal[] };

export function buildPlanDays(
  today: Date,
  meals: PlanMealRef[],
  count = PLAN_DAY_COUNT
): PlanDay[] {
  const base = startOfDay(today);
  const byKey = new Map<string, PlanDayMeal[]>();
  for (const meal of meals) {
    const key = meal.planned_for.slice(0, 10);
    const bucket = byKey.get(key);
    const entry = { id: meal.id, recipe: meal.recipe };
    if (bucket) bucket.push(entry);
    else byKey.set(key, [entry]);
  }

  return Array.from({ length: count }, (_, i) => {
    const date = addDays(base, i);
    const key = toDateKey(date);
    return {
      date,
      key,
      label:
        i === 0
          ? "Tonight"
          : i === 1
            ? "Tomorrow"
            : date.toLocaleDateString(undefined, { weekday: "long" }),
      dateLabel: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      planned: byKey.get(key) ?? []
    };
  });
}

/** Nights that already have a different recipe need a replace confirmation. */
export function planCommit(recipeId: number, planned: PlanDayMeal[]): PlanCommit {
  const others = planned.filter((meal) => meal.recipe.id !== recipeId);
  if (others.length > 0) return { kind: "replace", others };
  if (planned.some((meal) => meal.recipe.id === recipeId)) return { kind: "already" };
  return { kind: "assign" };
}

export function plannedSummary(planned: PlanDayMeal[]): string | null {
  if (planned.length === 0) return null;
  const extra = planned.length - 1;
  const name = planned[0]?.recipe.name ?? "";
  return extra > 0 ? `${name} +${extra}` : name;
}

export function planWhenLabel(day: Pick<PlanDay, "label" | "dateLabel">): string {
  if (day.label === "Tonight") return "tonight";
  if (day.label === "Tomorrow") return "tomorrow";
  return `${day.label}, ${day.dateLabel}`;
}

export function formatQuotedList(names: string[]): string {
  const quoted = names.map((name) => `“${name}”`);
  if (quoted.length <= 1) return quoted[0] ?? "";
  if (quoted.length === 2) return `${quoted[0]} and ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(", ")}, and ${quoted.at(-1)}`;
}

export function replacePrompt(
  recipeName: string,
  day: Pick<PlanDay, "label" | "dateLabel">,
  otherNames: string[]
): string {
  const dayName =
    day.label === "Tonight" || day.label === "Tomorrow"
      ? day.label
      : `${day.label}, ${day.dateLabel}`;
  const pronoun = otherNames.length === 1 ? "it" : "them";
  return `${dayName} already has ${formatQuotedList(otherNames)}. Replace ${pronoun} with “${recipeName}”?`;
}

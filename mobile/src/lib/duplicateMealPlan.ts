import { addDays, parseDateKey, startOfDay, toDateKey } from "@/lib/dates";

/**
 * Look-back window for duplicating a meal plan.
 *
 * The span is the inclusive calendar length of the nights being planned
 * (earliest through latest), not merely how many nights are checked. Each
 * selected night copies the dinner from that many days earlier, so a
 * Monday–Sunday week copies the previous Monday–Sunday, and any 7-day run
 * (Saturday–Friday, for example) copies the 7 days just before it.
 *
 * A calendar week should pass spanDays 7 via `lookbackWindow` even when some
 * of its days are already past and omitted — Friday still copies last Friday.
 * Keep this module in sync with `src/lib/duplicateMealPlan.ts`.
 */

export interface MealCopyPair {
  targetKey: string;
  sourceKey: string;
}

export interface MealCopyWindow {
  spanDays: number;
  pairs: MealCopyPair[];
  targetStart: string;
  targetEnd: string;
  sourceStart: string;
  sourceEnd: string;
}

export interface PlannedMealRef {
  plannedFor: string;
  recipeId: number;
  title: string;
  description?: string;
  prepTime?: number | null;
  coverUrl?: string | null;
  /** Lower ids win when a night has more than one dinner. */
  id?: number;
}

export interface CopiedMeal {
  recipeId: number;
  title: string;
  description?: string;
  prepTime?: number | null;
  coverUrl?: string | null;
  /** Other dinners on that source night, which this one-dinner copy leaves behind. */
  extraTitles: string[];
}

function calendarDaysBetween(earlier: Date, later: Date): number {
  const ms = startOfDay(later).getTime() - startOfDay(earlier).getTime();
  return Math.round(ms / 86_400_000);
}

/** Local calendar day for a planned_for timestamp or YYYY-MM-DD key. */
export function planDateKey(plannedFor: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(plannedFor)) return plannedFor;
  const d = new Date(plannedFor);
  if (Number.isNaN(d.getTime())) return null;
  return toDateKey(d);
}

/**
 * Pair each target night with the night `spanDays` earlier.
 * Targets are de-duplicated and ordered. Invalid keys are dropped.
 */
export function lookbackWindow(targetKeys: string[], spanDays: number): MealCopyWindow | null {
  if (!Number.isInteger(spanDays) || spanDays < 1) return null;
  const unique = [...new Set(targetKeys)].filter((key) => parseDateKey(key)).sort();
  if (!unique.length) return null;
  const pairs = unique.map((targetKey) => {
    const target = parseDateKey(targetKey)!;
    return { targetKey, sourceKey: toDateKey(addDays(target, -spanDays)) };
  });
  return {
    spanDays,
    pairs,
    targetStart: unique[0]!,
    targetEnd: unique[unique.length - 1]!,
    sourceStart: pairs[0]!.sourceKey,
    sourceEnd: pairs[pairs.length - 1]!.sourceKey
  };
}

/**
 * Look back across the inclusive calendar span of the selected nights.
 * Empty or invalid selections return null.
 */
export function selectionLookbackWindow(dayKeys: string[]): MealCopyWindow | null {
  const unique = [...new Set(dayKeys)].filter((key) => parseDateKey(key)).sort();
  if (!unique.length) return null;
  const start = parseDateKey(unique[0]!)!;
  const end = parseDateKey(unique[unique.length - 1]!)!;
  return lookbackWindow(unique, calendarDaysBetween(start, end) + 1);
}

export function copyPreviousButtonLabel(spanDays: number): string {
  if (spanDays === 1) return "Copy previous day";
  return `Copy previous ${spanDays} days`;
}

export function mealCopySummary(window: MealCopyWindow, weekLabel?: string | null): string {
  const nights = window.pairs.length;
  const nightWord = nights === 1 ? "night" : "nights";
  const dayWord = window.spanDays === 1 ? "day" : "days";
  if (weekLabel) {
    return `Copy last week onto ${weekLabel}. Each of the ${nights} ${nightWord} gets the dinner from the same weekday the week before.`;
  }
  return `Copy the ${window.spanDays} ${dayWord} just before these ${nights} ${nightWord}. Each night gets the dinner from ${window.spanDays} ${dayWord} earlier.`;
}

/** First dinner per local day. Extra titles are reported but not copied. */
export function indexMealsByDay(meals: PlannedMealRef[]): Record<string, CopiedMeal> {
  const grouped = new Map<string, PlannedMealRef[]>();
  for (const meal of meals) {
    const key = planDateKey(meal.plannedFor);
    if (!key || !meal.recipeId || !meal.title.trim()) continue;
    const list = grouped.get(key) ?? [];
    list.push(meal);
    grouped.set(key, list);
  }
  const out: Record<string, CopiedMeal> = {};
  for (const [key, list] of grouped) {
    const sorted = [...list].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const first = sorted[0]!;
    out[key] = {
      recipeId: first.recipeId,
      title: first.title.trim(),
      description: first.description,
      prepTime: first.prepTime ?? null,
      coverUrl: first.coverUrl ?? null,
      extraTitles: sorted
        .slice(1)
        .map((meal) => meal.title.trim())
        .filter(Boolean)
    };
  }
  return out;
}

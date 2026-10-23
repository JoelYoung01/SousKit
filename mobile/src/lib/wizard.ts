import { addDays, parseDateKey, startOfDay, startOfWeekMonday, toDateKey } from "@/lib/dates";
import type {
  MealPlanWizardBuiltRecipe,
  MealPlanWizardNightCommitItem,
  RecipeCard,
  RecipeDetail
} from "@/types";

export interface WizardWeek {
  weekIndex: number;
  weekStart: Date;
  label: string;
  days: Date[];
  dayKeys: string[];
}

export interface DraftNightEntry {
  kind: "generated" | "existing" | "imported";
  title: string;
  description?: string;
  prep_time?: number | null;
  cover_url?: string | null;
  recipeId?: number | null;
  builtRecipe?: MealPlanWizardBuiltRecipe | null;
}

export const INITIAL_WIZARD_WEEKS = 2;

export function formatWizardWeekLabel(weekStart: Date, today: Date): string {
  const thisWeek = startOfWeekMonday(today);
  const nextWeek = addDays(thisWeek, 7);
  if (toDateKey(weekStart) === toDateKey(thisWeek)) return "This week";
  if (toDateKey(weekStart) === toDateKey(nextWeek)) return "Next week";
  const end = addDays(weekStart, 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${weekStart.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

/**
 * Build `weekCount` consecutive Monday-start weeks starting from `today`'s week.
 */
export function buildWizardWeeks(today: Date, weekCount: number): WizardWeek[] {
  const count = Math.max(INITIAL_WIZARD_WEEKS, weekCount);
  const thisWeekStart = startOfWeekMonday(today);
  return Array.from({ length: count }, (_, weekIndex) => {
    const weekStart = addDays(thisWeekStart, weekIndex * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return {
      weekIndex,
      weekStart,
      label: formatWizardWeekLabel(weekStart, today),
      days,
      dayKeys: days.map(toDateKey)
    };
  });
}

/**
 * Ensure enough weeks are mounted to cover any pre-selected date keys in `?days=`.
 */
export function requiredWeekCountForDays(today: Date, dayKeys: string[]): number {
  const thisWeekStart = startOfWeekMonday(today);
  let maxWeeks = INITIAL_WIZARD_WEEKS;
  for (const key of dayKeys) {
    const d = parseDateKey(key);
    if (!d) continue;
    const diffMs = startOfDay(d).getTime() - thisWeekStart.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays >= 0) {
      const needed = Math.floor(diffDays / 7) + 1;
      if (needed > maxWeeks) maxWeeks = needed;
    }
  }
  return maxWeeks;
}

export function draftFromExistingRecipe(recipe: RecipeCard | RecipeDetail): DraftNightEntry {
  return {
    kind: "existing",
    title: recipe.name,
    description: recipe.description,
    prep_time: recipe.prep_time ?? null,
    cover_url: recipe.cover_image?.url ?? null,
    recipeId: recipe.id,
    builtRecipe: null
  };
}

export function draftFromImportedRecipe(recipe: RecipeDetail): DraftNightEntry {
  return {
    kind: "imported",
    title: recipe.name,
    description: recipe.description,
    prep_time: recipe.prep_time ?? null,
    cover_url: recipe.cover_image?.url ?? null,
    recipeId: recipe.id,
    builtRecipe: null
  };
}

export function draftFromBuiltRecipe(built: MealPlanWizardBuiltRecipe): DraftNightEntry {
  return {
    kind: "generated",
    title: built.title || "Untitled dinner",
    description: built.description,
    prep_time: built.prep_time ?? null,
    cover_url: null,
    recipeId: built.created_recipe_id ?? built.existing_recipe_id ?? null,
    builtRecipe: built
  };
}

/**
 * Build commit payload for selected nights that have a draft recipe assigned.
 * Unplanned nights in `selectedDays` are allowed and simply omitted.
 */
export function buildCommitNightsPayload(
  selectedDays: string[],
  draftByDay: Record<string, DraftNightEntry>
): MealPlanWizardNightCommitItem[] {
  const sorted = [...new Set(selectedDays)].sort();
  const items: MealPlanWizardNightCommitItem[] = [];
  for (const day of sorted) {
    const entry = draftByDay[day];
    if (!entry) continue;
    if (entry.recipeId != null) {
      items.push({ day, recipe_id: entry.recipeId });
    } else if (entry.builtRecipe) {
      items.push({ day, built_recipe: entry.builtRecipe });
    }
  }
  return items;
}

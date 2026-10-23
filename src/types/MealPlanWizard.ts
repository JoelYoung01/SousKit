export interface MealPlanWizardPrefs {
  goals: string;
  dietary_restrictions: string;
  preferred_ingredients: string;
  max_cook_minutes: number | null;
  servings: number | null;
  cuisine_notes: string;
  extra_notes: string;
}

export type MealPlanWizardStep =
  | "days"
  | "prefs"
  | "ideate"
  | "select"
  | "build"
  | "review"
  | "committed";

export interface MealPlanWizardIdea {
  id: string;
  title: string;
  justification: string;
}

export interface MealPlanWizardBuiltRecipe {
  idea_id: string;
  title: string;
  description: string;
  instructions: string;
  notes?: string | null;
  prep_time?: number | null;
  ingredients: Array<{
    name: string;
    amount?: number | null;
    units?: string | null;
    details?: string | null;
  }>;
  source: string;
  existing_recipe_id?: number | null;
  created_recipe_id?: number | null;
}

export interface MealPlanWizardProgressEvent {
  stage: string;
  status: "running" | "complete" | "error" | "done" | string;
  message: string;
  progress: number;
  data?: Record<string, unknown> | null;
}

export interface MealPlanWizardSession {
  id: string;
  days: string[];
  prefs: MealPlanWizardPrefs;
  step: MealPlanWizardStep;
  idea_target_count: number;
  select_count: number;
  ideas: MealPlanWizardIdea[];
  selected_idea_ids: string[];
  built_recipes: MealPlanWizardBuiltRecipe[];
  progress_log: MealPlanWizardProgressEvent[];
  stubbed: boolean;
}

export const emptyWizardPrefs = (): MealPlanWizardPrefs => ({
  goals: "",
  dietary_restrictions: "",
  preferred_ingredients: "",
  max_cook_minutes: null,
  servings: null,
  cuisine_notes: "",
  extra_notes: ""
});

export interface MealPlanWizardNightCommitItem {
  day: string;
  recipe_id?: number | null;
  built_recipe?: MealPlanWizardBuiltRecipe | null;
}

export interface MealPlanWizardPlanCommitRequest {
  nights: MealPlanWizardNightCommitItem[];
}

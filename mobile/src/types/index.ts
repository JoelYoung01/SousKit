/** API data contracts — mirrors the FastAPI schemas (api/schemas.py). */

export interface UserResponse {
  id: number;
  username: string;
  email: string;
  display_name: string;
  admin: boolean;
  disabled: boolean;
  email_verified: boolean;
  avatar_url?: string;
  last_login?: string;
}

export interface UploadSlim {
  id: number;
  name: string;
  url: string;
  file_path: string;
  created_on: string;
  created_by_id: number;
}

/** One generate-cover candidate (Upload fields + dismiss key). */
export interface RecipeCoverOption extends UploadSlim {
  /** Stable id so dismissed images are skipped on later searches for this recipe. */
  skip_key: string;
}

/** Response from POST /recipe/generate-cover/ */
export interface RecipeCoverGenerateResponse {
  provider: string;
  /** "pick" = show chooser (Openverse search); "single" = auto-apply */
  mode: "pick" | "single" | string;
  options: RecipeCoverOption[];
}

export interface IngredientSlim {
  id: number;
  name: string;
  amount: number | null;
  units: string | null;
  details?: string | null;
}

export interface IngredientCreate {
  name: string;
  amount?: number | null;
  units?: string | null;
  details?: string | null;
  recipe_id: number;
}

export interface RecipeSlim {
  id: number;
  name: string;
  description: string;
  instructions: string;
  notes?: string;
  created_on: string;
  created_by_id: number;
  household_id: number;
  public: boolean;
  prep_time?: number;
  cover_image_id?: number;
}

export interface RecipeDetail extends RecipeSlim {
  created_by: UserResponse;
  ingredients: IngredientSlim[];
  cover_image?: UploadSlim;
}

/** List/card payload — omits instructions/notes for faster first paint. */
export interface RecipeCard {
  id: number;
  name: string;
  description: string;
  created_on: string;
  created_by_id: number;
  household_id: number;
  public: boolean;
  prep_time?: number;
  cover_image_id?: number;
  cover_image?: UploadSlim;
}

export interface RecipeCreate {
  name: string;
  description: string;
  instructions: string;
  notes?: string | null;
  public: boolean;
  prep_time?: number | null;
  cover_image_id?: number | null;
}

export interface CountResponse {
  count: number;
}

export interface PlannedRecipeSlim {
  id: number;
  created_by_id: number;
  household_id: number;
  created_on: string;
  planned_for: string;
}

export interface PlannedRecipeDetail extends PlannedRecipeSlim {
  created_by: UserResponse;
  recipe: RecipeCard;
}

export interface GroceryQuantity {
  amount: number | null;
  units: string | null;
}

export interface GroceryRecipeRef {
  id: number;
  name: string;
}

export interface GroceryItem {
  key: string;
  name: string;
  category: string;
  quantities: GroceryQuantity[];
  quantity_display: string;
  recipes: GroceryRecipeRef[];
  recipe_titles: string;
  source_ingredient_ids: number[];
  dismissed: boolean;
  deleted: boolean;
}

export interface GroceryListResponse {
  window_start: string;
  window_end: string;
  items: GroceryItem[];
}

export interface GrocerySummaryResponse {
  window_start: string;
  window_end: string;
  active_count: number;
}

export type GroceryItemStatus = "dismissed" | "deleted" | null;

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
  ingredients: {
    name: string;
    amount?: number | null;
    units?: string | null;
    details?: string | null;
  }[];
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

export interface HouseholdMember {
  user_id: number;
  role: "owner" | "member" | string;
  joined_on: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
}

export interface HouseholdInvite {
  id: number;
  email?: string | null;
  status: string;
  created_on: string;
  expires_on: string;
  invited_by_id: number;
  token?: string | null;
  invite_url?: string | null;
}

export interface Household {
  id: number;
  name: string;
  created_by_id: number;
  created_on: string;
  my_role: "owner" | "member" | string;
  member_count: number;
  max_members: number;
  members: HouseholdMember[];
  pending_invites: HouseholdInvite[];
}

export interface PendingHouseholdInvite {
  id: number;
  household_id: number;
  household_name: string;
  invited_by_name: string;
  token: string;
  invite_url?: string | null;
  created_on: string;
  expires_on: string;
}

import type { IngredientSlim } from "./Ingredient";
import type { UploadSlim } from "./Upload";
import type { UserResponse } from "./User";

export interface RecipeSlim {
  id: number;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  notes?: string;
  created_on: string;
  updated_on: string;
  created_by_id: number;
  household_id: number;
  public: boolean;
  prep_time?: number;
  cover_image_id?: number;
  head_version_number: number;
}

export interface RecipeDetail extends RecipeSlim {
  created_by: UserResponse;
  ingredients: IngredientSlim[];
  cover_image?: UploadSlim;
}

export interface RecipeDashboard extends RecipeSlim {
  cover_image?: UploadSlim;
}

/** List/card payload — omits instructions/notes for faster first paint. */
export interface RecipeCard {
  id: number;
  slug: string;
  name: string;
  description: string;
  created_on: string;
  updated_on: string;
  created_by_id: number;
  household_id: number;
  public: boolean;
  prep_time?: number;
  cover_image_id?: number;
  head_version_number: number;
  cover_image?: UploadSlim;
}

export interface RecipeIngredientWrite {
  name: string;
  amount?: number | null;
  units?: string | null;
  details?: string | null;
}

export interface CountResponse {
  count: number;
}

export interface RecipeCreate {
  name: string;
  description: string;
  instructions: string;
  notes?: string;
  public: boolean;
  prep_time?: number;
  cover_image_id?: number;
  ingredients?: RecipeIngredientWrite[];
}

export interface RecipeVersionSummary {
  version_number: number;
  created_on: string;
  created_by_id: number;
  created_by_display_name?: string | null;
  change_kind: string;
  restored_from_version?: number | null;
  name: string;
  is_current: boolean;
}

export interface RecipeVersionDetail extends RecipeVersionSummary {
  description: string;
  instructions: string;
  notes?: string | null;
  prep_time?: number | null;
  cover_image_id?: number | null;
  cover_image?: UploadSlim | null;
  ingredients: IngredientSlim[];
}

export interface InstructionHunk {
  op: string;
  before?: string | null;
  after?: string | null;
}

export interface RecipeFieldChange {
  field: string;
  before?: string | null;
  after?: string | null;
  hunks: InstructionHunk[];
}

export interface IngredientSnapshot {
  name: string;
  amount?: number | null;
  units?: string | null;
  details?: string | null;
}

export interface IngredientChange {
  op: "added" | "removed" | "changed" | string;
  name: string;
  before?: IngredientSnapshot | null;
  after?: IngredientSnapshot | null;
}

export interface RecipeVersionDiff {
  recipe_id: number;
  slug: string;
  from_version: number;
  to_version: number;
  fields: RecipeFieldChange[];
  ingredients: IngredientChange[];
}

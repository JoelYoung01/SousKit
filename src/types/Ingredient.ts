import type { RecipeSlim } from "./Recipe";

export interface IngredientSlim {
  id: number;
  name: string;
  amount: number;
  units: string;
  details?: string;
  group_name?: string | null;
}

export interface IngredientDetail extends IngredientSlim {
  recipe: RecipeSlim;
}

export interface IngredientCreate {
  name: string;
  amount: number;
  units: string;
  details?: string;
  group_name?: string | null;
  recipe_id: number;
}

import type {
  CountResponse,
  IngredientCreate,
  IngredientSlim,
  RecipeCard,
  RecipeCreate,
  RecipeCoverGenerateResponse,
  RecipeDetail,
  RecipeVersionDetail,
  RecipeVersionDiff,
  RecipeVersionSummary
} from "@/types";
import { normalizeCoverOption } from "@/lib/coverMedia";
import { recipeReadPath } from "@/lib/recipePath";
import { del, get, post, put } from "./client";

export const RECIPE_PAGE_SIZE = 50;

export function fetchRecipePage(offset: number): Promise<RecipeCard[]> {
  return get<RecipeCard[]>(`/recipe/user/?limit=${RECIPE_PAGE_SIZE}&offset=${offset}`);
}

export function fetchRecipeCount(): Promise<CountResponse> {
  return get<CountResponse>("/recipe/user/count/");
}

export function searchRecipes(searchText: string): Promise<RecipeCard[]> {
  return get<RecipeCard[]>(`/recipe/search/?searchText=${encodeURIComponent(searchText)}`);
}

export function fetchRecipe(recipeId: number | string): Promise<RecipeDetail> {
  return get<RecipeDetail>(recipeReadPath(recipeId));
}

export function fetchRecipeVersions(recipeId: number): Promise<RecipeVersionSummary[]> {
  return get<RecipeVersionSummary[]>(`/recipe/${recipeId}/versions/`);
}

export function fetchRecipeVersion(
  recipeId: number,
  versionNumber: number
): Promise<RecipeVersionDetail> {
  return get<RecipeVersionDetail>(`/recipe/${recipeId}/versions/${versionNumber}/`);
}

export function diffRecipeVersions(
  recipeId: number,
  fromVersion: number,
  toVersion: number
): Promise<RecipeVersionDiff> {
  return get<RecipeVersionDiff>(
    `/recipe/${recipeId}/versions/diff/?from=${fromVersion}&to=${toVersion}`
  );
}

export function restoreRecipeVersion(
  recipeId: number,
  versionNumber: number
): Promise<RecipeDetail> {
  return post<RecipeDetail>(`/recipe/${recipeId}/versions/${versionNumber}/restore/`, {});
}

export function createRecipe(body: RecipeCreate): Promise<RecipeDetail> {
  return post<RecipeDetail>("/recipe/", body);
}

/** Fetch a recipe website URL, extract structured data, and save a private recipe. */
export function importRecipeFromUrl(url: string): Promise<RecipeDetail> {
  return post<RecipeDetail>("/recipe/import-from-url/", { url });
}

export function updateRecipe(
  recipeId: number | string,
  body: Partial<RecipeCreate>
): Promise<RecipeDetail> {
  return put<RecipeDetail>(`/recipe/${recipeId}/`, body);
}

/** Ask the LLM to patch a recipe from a free-text instruction and save it. */
export function aiEditRecipe(
  recipeId: number | string,
  instruction: string
): Promise<RecipeDetail> {
  return post<RecipeDetail>(`/recipe/${recipeId}/ai-edit/`, { instruction });
}

export function deleteRecipe(recipeId: number | string): Promise<void> {
  return del(`/recipe/${recipeId}/`);
}

/** Find free public-domain cover photos for a recipe (server-side search). */
export async function generateRecipeCover(body: {
  name: string;
  description?: string | null;
  ingredients?: { name: string }[];
  limit?: number;
  exclude_keys?: string[];
}): Promise<RecipeCoverGenerateResponse> {
  const result = await post<RecipeCoverGenerateResponse>("/recipe/generate-cover/", body);
  return {
    ...result,
    options: result.options.map(normalizeCoverOption)
  };
}

export function createIngredient(body: IngredientCreate): Promise<IngredientSlim> {
  return post<IngredientSlim>("/ingredient/", body);
}

export function updateIngredient(
  ingredientId: number,
  body: Partial<IngredientCreate>
): Promise<IngredientSlim> {
  return put<IngredientSlim>(`/ingredient/${ingredientId}/`, body);
}

export function deleteIngredient(ingredientId: number): Promise<void> {
  return del(`/ingredient/${ingredientId}/`);
}

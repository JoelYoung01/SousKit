import {
  RECIPE_PAGE_SIZE,
  fetchRecipe,
  fetchRecipeCount,
  fetchRecipePage,
  searchRecipes
} from "@/api/recipes";
import type { RecipeCard } from "@/types";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";

/** Most recently saved version first. Ties break on id so paging stays stable. */
function byLatestSave(a: RecipeCard, b: RecipeCard): number {
  const delta = new Date(b.updated_on).getTime() - new Date(a.updated_on).getTime();
  if (delta !== 0 && !Number.isNaN(delta)) return delta;
  return b.id - a.id;
}

/** One card per recipe. A later page wins if the same id shows up twice. */
function uniqueRecipes(rows: RecipeCard[]): RecipeCard[] {
  const byId = new Map<number, RecipeCard>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

/** Paged personal recipe list (latest save first), with load-more support. */
export function useRecipeList() {
  return useInfiniteQuery({
    queryKey: ["recipes", "list"],
    queryFn: ({ pageParam }) => fetchRecipePage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length >= RECIPE_PAGE_SIZE
        ? allPages.reduce((n, page) => n + page.length, 0)
        : undefined,
    select: (data) => uniqueRecipes(data.pages.flat()).sort(byLatestSave)
  });
}

export function useRecipeCount() {
  return useQuery({
    queryKey: ["recipes", "count"],
    queryFn: fetchRecipeCount,
    select: (r) => r.count
  });
}

export function useRecipeSearch(searchText: string) {
  const trimmed = searchText.trim();
  return useQuery({
    queryKey: ["recipes", "search", trimmed],
    queryFn: () => searchRecipes(trimmed),
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData
  });
}

export function useRecipe(recipeId: number | string | undefined) {
  return useQuery({
    queryKey: ["recipes", "detail", String(recipeId)],
    queryFn: () => fetchRecipe(recipeId!),
    enabled: recipeId !== undefined && recipeId !== null && recipeId !== ""
  });
}

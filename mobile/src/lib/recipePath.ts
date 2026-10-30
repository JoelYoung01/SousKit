/** Read a recipe by numeric id or stable slug. Writes always use the numeric id. */
export function recipeReadPath(idOrSlug: string | number): string {
  const key = String(idOrSlug);
  if (/^\d+$/.test(key)) return `/recipe/${key}/`;
  return `/recipe/slug/${encodeURIComponent(key)}/`;
}

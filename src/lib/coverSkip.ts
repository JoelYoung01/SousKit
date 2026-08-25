/**
 * Persist dismissed cover skip_keys per recipe so Generate/Search again
 * does not resurface photos the user already rejected.
 */

const PREFIX = "souskit:cover-skip:";
const MAX_KEYS = 120;

function storageKey(recipeKey: string): string {
  return `${PREFIX}${recipeKey || "new"}`;
}

function readRaw(recipeKey: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(recipeKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
  } catch {
    return [];
  }
}

function writeRaw(recipeKey: string, keys: string[]) {
  if (typeof localStorage === "undefined") return;
  const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))].slice(-MAX_KEYS);
  try {
    localStorage.setItem(storageKey(recipeKey), JSON.stringify(unique));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function loadCoverSkipKeys(recipeKey: string): string[] {
  return readRaw(recipeKey);
}

export function rememberCoverSkipKey(recipeKey: string, skipKey: string): string[] {
  const next = [...readRaw(recipeKey), skipKey.trim()].filter(Boolean);
  writeRaw(recipeKey, next);
  return loadCoverSkipKeys(recipeKey);
}

export function rememberCoverSkipKeys(recipeKey: string, skipKeys: string[]): string[] {
  const next = [...readRaw(recipeKey), ...skipKeys];
  writeRaw(recipeKey, next);
  return loadCoverSkipKeys(recipeKey);
}

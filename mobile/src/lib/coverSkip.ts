/**
 * Persist dismissed cover skip_keys per recipe (AsyncStorage on native,
 * localStorage on web) so Generate/Search again skips rejected photos.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const PREFIX = "souskit:cover-skip:";
const MAX_KEYS = 120;

function storageKey(recipeKey: string): string {
  return `${PREFIX}${recipeKey || "new"}`;
}

async function readRaw(recipeKey: string): Promise<string[]> {
  try {
    const raw =
      Platform.OS === "web" && typeof localStorage !== "undefined"
        ? localStorage.getItem(storageKey(recipeKey))
        : await AsyncStorage.getItem(storageKey(recipeKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
  } catch {
    return [];
  }
}

async function writeRaw(recipeKey: string, keys: string[]): Promise<void> {
  const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))].slice(-MAX_KEYS);
  const payload = JSON.stringify(unique);
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      localStorage.setItem(storageKey(recipeKey), payload);
    } else {
      await AsyncStorage.setItem(storageKey(recipeKey), payload);
    }
  } catch {
    /* quota / private mode — ignore */
  }
}

export async function loadCoverSkipKeys(recipeKey: string): Promise<string[]> {
  return readRaw(recipeKey);
}

export async function rememberCoverSkipKey(
  recipeKey: string,
  skipKey: string
): Promise<string[]> {
  const next = [...(await readRaw(recipeKey)), skipKey.trim()].filter(Boolean);
  await writeRaw(recipeKey, next);
  return readRaw(recipeKey);
}

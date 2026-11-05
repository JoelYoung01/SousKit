import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  EntityTypes,
  getCalendars,
  getRemindersPermissions,
  requestRemindersPermissions,
  type ExpoCalendar,
  type PermissionResponse
} from "expo-calendar";
import { PermissionStatus } from "expo-modules-core";
import { Platform } from "react-native";
import {
  formatGroceryExportLine,
  getExportableGroceryItems
} from "@/lib/grocery-export";
import type { GroceryItem } from "@/types";

const LAST_LIST_KEY = "souskit.grocery.remindersListId";

export type ReminderListOption = {
  id: string;
  title: string;
  sourceName?: string;
};

export function isRemindersExportAvailable(): boolean {
  return Platform.OS === "ios";
}

export async function ensureRemindersPermission(): Promise<PermissionResponse> {
  if (!isRemindersExportAvailable()) {
    return {
      status: PermissionStatus.UNDETERMINED,
      granted: false,
      canAskAgain: false,
      expires: "never"
    };
  }
  const current = await getRemindersPermissions();
  if (current.granted) return current;
  return requestRemindersPermissions();
}

function toOption(calendar: ExpoCalendar): ReminderListOption {
  return {
    id: calendar.id,
    title: calendar.title || "Reminders",
    sourceName: calendar.source?.name
  };
}

/**
 * EventKit's calendar `type` is the account kind (local, iCloud, Exchange),
 * not a list purpose, so a grocery list is identified by its name.
 * Exact "Grocery" / "Groceries" ranks above a name that only contains those words.
 */
const EXACT_GROCERY_LIST_NAME = /^(?:grocery|groceries)$/i;
const GROCERY_LIST_NAME = /\bgrocer(?:y|ies)\b/i;

function reminderListLikelihood(title: string): number {
  const normalized = title.trim();
  if (EXACT_GROCERY_LIST_NAME.test(normalized)) return 0;
  if (GROCERY_LIST_NAME.test(normalized)) return 1;
  return 2;
}

export function isLikelyGroceryReminderList(list: Pick<ReminderListOption, "title">): boolean {
  return reminderListLikelihood(list.title) < 2;
}

/** Likely grocery lists first, then the rest. Alphabetical within each group. */
export function orderReminderLists(lists: ReminderListOption[]): ReminderListOption[] {
  return [...lists].sort((a, b) => {
    const rank = reminderListLikelihood(a.title) - reminderListLikelihood(b.title);
    if (rank !== 0) return rank;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

/**
 * Prefer the list used last time. Otherwise pick the most likely grocery list
 * (exact "Grocery" / "Groceries" before a name that only contains those words).
 */
export function pickReminderListId(
  lists: ReminderListOption[],
  lastId: string | null
): string | null {
  if (lastId && lists.some((list) => list.id === lastId)) return lastId;
  const ordered = orderReminderLists(lists);
  return ordered.find(isLikelyGroceryReminderList)?.id ?? ordered[0]?.id ?? null;
}

/** Writable Reminders lists on this device (iOS only). */
export async function listWritableReminderLists(): Promise<ReminderListOption[]> {
  if (!isRemindersExportAvailable()) return [];

  const calendars = await getCalendars(EntityTypes.REMINDER);
  return orderReminderLists(
    calendars.filter((calendar) => calendar.allowsModifications).map(toOption)
  );
}

export async function getLastRemindersListId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_LIST_KEY);
  } catch {
    return null;
  }
}

export async function setLastRemindersListId(listId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_LIST_KEY, listId);
  } catch {
    // Preference only — ignore storage failures.
  }
}

export type PushGroceryRemindersResult = {
  created: number;
  listTitle: string;
};

/**
 * One-shot push of active grocery items into the chosen Reminders list.
 * Does not sync checkoffs and may create duplicates on re-export.
 */
export async function pushGroceryItemsToReminders(
  items: GroceryItem[],
  listId: string
): Promise<PushGroceryRemindersResult> {
  if (!isRemindersExportAvailable()) {
    throw new Error("Apple Reminders export is only available on iOS.");
  }

  const permission = await ensureRemindersPermission();
  if (!permission.granted) {
    throw new Error("Reminders access is required to export the list.");
  }

  // `ExpoCalendar.get` is native `getCalendarById`, which requires calendar
  // write access even for a Reminders list. This app only requests Reminders
  // permission, so resolve the list through `getCalendars` instead.
  const calendars = await getCalendars(EntityTypes.REMINDER);
  const calendar = calendars.find((item) => item.id === listId);
  if (!calendar) {
    throw new Error("That Reminders list is no longer on this device.");
  }
  if (!calendar.allowsModifications) {
    throw new Error("That Reminders list can’t be modified.");
  }

  const exportable = getExportableGroceryItems(items);
  if (exportable.length === 0) {
    throw new Error("There’s nothing to export.");
  }

  for (const item of exportable) {
    await calendar.createReminder({
      title: formatGroceryExportLine(item),
      notes: item.recipe_titles || undefined
    });
  }

  await setLastRemindersListId(listId);

  return {
    created: exportable.length,
    listTitle: calendar.title || "Reminders"
  };
}

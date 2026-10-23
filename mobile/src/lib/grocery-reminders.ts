import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  EntityTypes,
  ExpoCalendar,
  getCalendars,
  getRemindersPermissions,
  requestRemindersPermissions,
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

/** Writable Reminders lists on this device (iOS only). */
export async function listWritableReminderLists(): Promise<ReminderListOption[]> {
  if (!isRemindersExportAvailable()) return [];

  const calendars = await getCalendars(EntityTypes.REMINDER);
  return calendars
    .filter((calendar) => calendar.allowsModifications)
    .map(toOption)
    .sort((a, b) => a.title.localeCompare(b.title));
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

  const calendar = await ExpoCalendar.get(listId);
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

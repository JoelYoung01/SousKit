import {
  isLikelyGroceryReminderList,
  isRemindersExportAvailable,
  listWritableReminderLists,
  orderReminderLists,
  pickReminderListId,
  pushGroceryItemsToReminders,
  type ReminderListOption
} from "@/lib/grocery-reminders";
import type { GroceryItem } from "@/types";
import { Platform } from "react-native";

jest.mock("expo-calendar", () => ({
  EntityTypes: { REMINDER: "reminder", EVENT: "event" },
  ExpoCalendar: {
    get: jest.fn(() => {
      throw new Error(
        "MissionPermissionsException: CALENDARWRITEONLY permission is required to do this operation"
      );
    })
  },
  getCalendars: jest.fn(),
  getRemindersPermissions: jest.fn(),
  requestRemindersPermissions: jest.fn()
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest mock factory
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

const Calendar = jest.requireMock("expo-calendar") as {
  ExpoCalendar: { get: jest.Mock };
  getCalendars: jest.Mock;
  getRemindersPermissions: jest.Mock;
  requestRemindersPermissions: jest.Mock;
};

const lists: ReminderListOption[] = [
  { id: "reminders", title: "Reminders", sourceName: "iCloud" },
  { id: "work", title: "Work" },
  { id: "grocery-list", title: "Grocery List" },
  { id: "groceries", title: "Groceries" },
  { id: "errands", title: "Errands" }
];

const sampleItem: GroceryItem = {
  key: "milk",
  name: "Milk",
  category: "Dairy",
  quantities: [],
  quantity_display: "1 qt",
  recipes: [],
  recipe_titles: "Pancakes",
  source_ingredient_ids: [],
  manual_item_ids: [],
  is_manual: false,
  auto_dismissed: false,
  dismissed: false,
  deleted: false
};

describe("isRemindersExportAvailable", () => {
  const originalOs = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: originalOs });
  });

  it("is true only on iOS", () => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    expect(isRemindersExportAvailable()).toBe(true);
    Object.defineProperty(Platform, "OS", { configurable: true, value: "web" });
    expect(isRemindersExportAvailable()).toBe(false);
  });
});

describe("reminder list ordering", () => {
  it("ranks exact grocery names ahead of names that mention grocery", () => {
    expect(orderReminderLists(lists).map((list) => list.id)).toEqual([
      "groceries",
      "grocery-list",
      "errands",
      "reminders",
      "work"
    ]);
    expect(isLikelyGroceryReminderList({ title: "🛒 Groceries" })).toBe(true);
    expect(isLikelyGroceryReminderList({ title: "Grocery" })).toBe(true);
    expect(isLikelyGroceryReminderList({ title: "Birthdays" })).toBe(false);
  });

  it("keeps the last list when it still exists, otherwise picks a grocery list", () => {
    expect(pickReminderListId(lists, "work")).toBe("work");
    expect(pickReminderListId(lists, "missing")).toBe("groceries");
    expect(pickReminderListId(lists, null)).toBe("groceries");
    expect(pickReminderListId([{ id: "reminders", title: "Reminders" }], null)).toBe(
      "reminders"
    );
  });

  it("lists writable reminder calendars with grocery names first", async () => {
    const originalOs = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    try {
      Calendar.getCalendars.mockResolvedValue([
        {
          id: "reminders",
          title: "Reminders",
          allowsModifications: true,
          source: { name: "iCloud" }
        },
        { id: "birthdays", title: "Birthdays", allowsModifications: false },
        {
          id: "groceries",
          title: "Groceries",
          allowsModifications: true,
          source: { name: "iCloud" }
        }
      ]);

      await expect(listWritableReminderLists()).resolves.toEqual([
        { id: "groceries", title: "Groceries", sourceName: "iCloud" },
        { id: "reminders", title: "Reminders", sourceName: "iCloud" }
      ]);
      expect(Calendar.getCalendars).toHaveBeenCalledWith("reminder");
      expect(Calendar.ExpoCalendar.get).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: originalOs });
    }
  });
});

describe("pushGroceryItemsToReminders", () => {
  const originalOs = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { configurable: true, value: originalOs });
  });

  it("creates one reminder per active item and remembers the list", async () => {
    Calendar.getRemindersPermissions.mockResolvedValue({ granted: true });
    const createReminder = jest.fn().mockResolvedValue({ id: "r1" });
    Calendar.getCalendars.mockResolvedValue([
      {
        id: "list-1",
        title: "Groceries",
        allowsModifications: true,
        createReminder
      }
    ]);

    const result = await pushGroceryItemsToReminders(
      [sampleItem, { ...sampleItem, key: "gone", name: "Gone", dismissed: true }],
      "list-1"
    );

    expect(result).toEqual({ created: 1, listTitle: "Groceries" });
    expect(createReminder).toHaveBeenCalledTimes(1);
    expect(createReminder).toHaveBeenCalledWith({
      title: "Milk (1 qt)",
      notes: "Pancakes"
    });
    expect(Calendar.getCalendars).toHaveBeenCalledWith("reminder");
    expect(Calendar.ExpoCalendar.get).not.toHaveBeenCalled();
  });

  it("does not ask EventKit for the calendar by id", async () => {
    Calendar.getRemindersPermissions.mockResolvedValue({ granted: true });
    Calendar.getCalendars.mockResolvedValue([]);

    await expect(pushGroceryItemsToReminders([sampleItem], "list-1")).rejects.toThrow(
      /no longer on this device/i
    );
    expect(Calendar.ExpoCalendar.get).not.toHaveBeenCalled();
  });

  it("rejects a reminders list that cannot be modified", async () => {
    Calendar.getRemindersPermissions.mockResolvedValue({ granted: true });
    const createReminder = jest.fn();
    Calendar.getCalendars.mockResolvedValue([
      { id: "list-1", title: "Birthdays", allowsModifications: false, createReminder }
    ]);

    await expect(pushGroceryItemsToReminders([sampleItem], "list-1")).rejects.toThrow(
      /can’t be modified/i
    );
    expect(createReminder).not.toHaveBeenCalled();
  });

  it("rejects when reminders permission is denied", async () => {
    Calendar.getRemindersPermissions.mockResolvedValue({ granted: false });
    Calendar.requestRemindersPermissions.mockResolvedValue({ granted: false });

    await expect(pushGroceryItemsToReminders([sampleItem], "list-1")).rejects.toThrow(
      /Reminders access/i
    );
  });
});

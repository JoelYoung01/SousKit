import {
  isRemindersExportAvailable,
  pushGroceryItemsToReminders
} from "@/lib/grocery-reminders";
import type { GroceryItem } from "@/types";
import { Platform } from "react-native";

jest.mock("expo-calendar", () => ({
  EntityTypes: { REMINDER: "reminder", EVENT: "event" },
  ExpoCalendar: {
    get: jest.fn()
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
  getRemindersPermissions: jest.Mock;
  requestRemindersPermissions: jest.Mock;
};

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
    Calendar.ExpoCalendar.get.mockResolvedValue({
      id: "list-1",
      title: "Groceries",
      allowsModifications: true,
      createReminder
    });

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
  });

  it("rejects when reminders permission is denied", async () => {
    Calendar.getRemindersPermissions.mockResolvedValue({ granted: false });
    Calendar.requestRemindersPermissions.mockResolvedValue({ granted: false });

    await expect(pushGroceryItemsToReminders([sampleItem], "list-1")).rejects.toThrow(
      /Reminders access/i
    );
  });
});

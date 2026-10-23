import { GroceryExportSheet } from "@/components/grocery/GroceryExportSheet";
import type { GroceryItem } from "@/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn()
}));

jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    visible,
    children
  }: {
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
  }) => (visible ? children : null)
}));

jest.mock("@/lib/grocery-reminders", () => ({
  isRemindersExportAvailable: () => false,
  ensureRemindersPermission: jest.fn(),
  getLastRemindersListId: jest.fn(),
  listWritableReminderLists: jest.fn(),
  pushGroceryItemsToReminders: jest.fn()
}));

jest.mock("@/stores/toast", () => ({
  toast: {
    success: jest.fn(),
    warning: jest.fn(),
    fromError: jest.fn()
  }
}));

const items: GroceryItem[] = [
  {
    key: "spinach",
    name: "Spinach",
    category: "Produce",
    quantities: [],
    quantity_display: "1 bag",
    recipes: [],
    recipe_titles: "",
    source_ingredient_ids: [],
    manual_item_ids: [],
    is_manual: false,
    auto_dismissed: false,
    dismissed: false,
    deleted: false
  }
];

describe("GroceryExportSheet", () => {
  it("copies the plain-text list via the Copy provider", async () => {
    const onClose = jest.fn();
    (Clipboard.setStringAsync as jest.Mock).mockResolvedValue(undefined);

    await render(<GroceryExportSheet visible items={items} onClose={onClose} />);

    expect(screen.getByText("Export")).toBeTruthy();
    expect(screen.getByText("1 active item")).toBeTruthy();
    expect(screen.queryByText("Apple Reminders")).toBeNull();

    await fireEvent.press(screen.getByText("Copy list"));

    await waitFor(() => {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
        expect.stringContaining("- Spinach (1 bag)")
      );
      expect(onClose).toHaveBeenCalled();
    });
  });
});

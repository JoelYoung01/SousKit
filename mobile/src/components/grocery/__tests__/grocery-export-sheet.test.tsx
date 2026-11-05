import { GroceryExportSheet } from "@/components/grocery/GroceryExportSheet";
import type { GroceryItem } from "@/types";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn()
}));

jest.mock(
  "@/components/ui/sheet",
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest mock factory
  () => require("@/test-utils/sheet-mock")
);

jest.mock("@/lib/grocery-reminders", () => {
  const actual = jest.requireActual<typeof import("@/lib/grocery-reminders")>(
    "@/lib/grocery-reminders"
  );
  return {
    ...actual,
    isRemindersExportAvailable: jest.fn(() => false),
    ensureRemindersPermission: jest.fn(),
    getLastRemindersListId: jest.fn(),
    listWritableReminderLists: jest.fn(),
    pushGroceryItemsToReminders: jest.fn()
  };
});

jest.mock("@/stores/toast", () => ({
  toast: {
    success: jest.fn(),
    warning: jest.fn(),
    fromError: jest.fn()
  }
}));

const reminders = jest.requireMock("@/lib/grocery-reminders") as {
  isRemindersExportAvailable: jest.Mock;
  ensureRemindersPermission: jest.Mock;
  getLastRemindersListId: jest.Mock;
  listWritableReminderLists: jest.Mock;
};

const items: GroceryItem[] = [
  {
    key: "spinach",
    name: "Spinach",
    category: "Produce",
    quantities: [],
    quantity_display: "1 bag",
    recipes: [],
    recipe_titles: "",
    notes: [],
    source_ingredient_ids: [],
    manual_item_ids: [],
    is_manual: false,
    auto_dismissed: false,
    dismissed: false,
    deleted: false
  }
];

function rowTitle(node: Parameters<typeof within>[0]) {
  const [title] = within(node).getAllByText(/./);
  return title.props.children;
}

function selectedListTitle() {
  const selected = screen
    .getAllByRole("radio")
    .find((node) => node.props.accessibilityState?.selected === true);
  if (!selected) throw new Error("No Reminders list is selected");
  return rowTitle(selected);
}

describe("GroceryExportSheet", () => {
  beforeEach(() => {
    reminders.isRemindersExportAvailable.mockReturnValue(false);
  });

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

  it("selects a grocery Reminders list when nothing was saved", async () => {
    reminders.isRemindersExportAvailable.mockReturnValue(true);
    reminders.ensureRemindersPermission.mockResolvedValue({ granted: true });
    reminders.getLastRemindersListId.mockResolvedValue(null);
    reminders.listWritableReminderLists.mockResolvedValue([
      { id: "reminders", title: "Reminders", sourceName: "iCloud" },
      { id: "groceries", title: "Groceries", sourceName: "iCloud" },
      { id: "work", title: "Work" }
    ]);

    await render(<GroceryExportSheet visible items={items} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByText("Apple Reminders"));

    await waitFor(() => {
      expect(selectedListTitle()).toBe("Groceries");
    });
    const titles = screen.getAllByRole("radio").map((node) => rowTitle(node));
    expect(titles).toEqual(["Reminders", "Groceries", "Work"]);
  });

  it("keeps the last Reminders list selected", async () => {
    reminders.isRemindersExportAvailable.mockReturnValue(true);
    reminders.ensureRemindersPermission.mockResolvedValue({ granted: true });
    reminders.getLastRemindersListId.mockResolvedValue("work");
    reminders.listWritableReminderLists.mockResolvedValue([
      { id: "groceries", title: "Groceries" },
      { id: "work", title: "Work" }
    ]);

    await render(<GroceryExportSheet visible items={items} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByText("Apple Reminders"));

    await waitFor(() => {
      expect(selectedListTitle()).toBe("Work");
    });
  });
});

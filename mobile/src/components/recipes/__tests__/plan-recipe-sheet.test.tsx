import { PlanRecipeSheet } from "@/components/recipes/PlanRecipeSheet";
import { addDays, startOfDay, toDateKey } from "@/lib/dates";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockFetch = jest.fn();
const mockCreate = jest.fn();
const mockDelete = jest.fn();
const mockSync = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastFromError = jest.fn();

jest.mock("@/api/planner", () => ({
  fetchPlansBetween: (...args: unknown[]) => mockFetch(...args),
  createPlan: (...args: unknown[]) => mockCreate(...args),
  deletePlan: (...args: unknown[]) => mockDelete(...args)
}));

jest.mock("@/hooks/sync", () => ({
  syncAfterPlanMutation: () => mockSync()
}));

jest.mock("@/stores/toast", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    fromError: (...args: unknown[]) => mockToastFromError(...args)
  }
}));

jest.mock(
  "@/components/ui/sheet",
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest mock factory
  () => require("@/test-utils/sheet-mock")
);

function meal(id: number, dayOffset: number, recipe: { id: number; name: string }) {
  const key = toDateKey(addDays(startOfDay(), dayOffset));
  return {
    id,
    planned_for: `${key}T18:00:00`,
    recipe
  };
}

const pasta = { id: 7, name: "Pasta" };

describe("PlanRecipeSheet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 99 });
    mockDelete.mockResolvedValue(undefined);
  });

  it("plans an open night without deleting what is already scheduled", async () => {
    mockFetch.mockResolvedValue([meal(1, 1, { id: 10, name: "Tacos" })]);
    const onClose = jest.fn();

    await render(<PlanRecipeSheet visible recipe={pasta} onClose={onClose} />);

    expect(await screen.findByText("Tacos")).toBeOnTheScreen();
    expect(screen.getAllByText("Open").length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByRole("button", { name: /Tonight/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Plan" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(7, expect.any(Date));
      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockSync).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
    const plannedFor = mockCreate.mock.calls[0][1] as Date;
    expect(toDateKey(plannedFor)).toBe(toDateKey(startOfDay()));
  });

  it("asks before replacing a planned night, and only then swaps the meal", async () => {
    mockFetch.mockResolvedValue([
      meal(3, 0, { id: 10, name: "Tacos" }),
      meal(4, 0, { id: 11, name: "Chili" })
    ]);
    const onClose = jest.fn();

    await render(<PlanRecipeSheet visible recipe={pasta} onClose={onClose} />);

    expect(await screen.findByText("Tacos +1")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: /Tonight/ }));
    await fireEvent.press(screen.getByText("Replace"));

    expect(
      screen.getByText("Tonight already has “Tacos” and “Chili”. Replace them with “Pasta”?")
    ).toBeOnTheScreen();
    expect(screen.getByText("The night will only have this recipe.")).toBeOnTheScreen();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText("Back"));
    expect(screen.getByText("Tacos +1")).toBeOnTheScreen();
    expect(mockCreate).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText("Replace"));
    await fireEvent.press(screen.getByText("Replace"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith(3);
      expect(mockDelete).toHaveBeenCalledWith(4);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("does not add a second copy when the night is already this recipe", async () => {
    mockFetch.mockResolvedValue([meal(8, 0, pasta)]);

    await render(<PlanRecipeSheet visible recipe={pasta} onClose={jest.fn()} />);

    await screen.findByText("Pasta");
    await fireEvent.press(screen.getByRole("button", { name: /Tonight/ }));
    await fireEvent.press(screen.getByText("Already planned"));

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

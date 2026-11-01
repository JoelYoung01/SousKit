import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { RecipeAiEditSheet } from "@/components/RecipeAiEditSheet";

const mockAiEditRecipe = jest.fn();
const mockSyncAfterRecipeMutation = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastFromError = jest.fn();

jest.mock("@/api/recipes", () => ({
  aiEditRecipe: (...args: unknown[]) => mockAiEditRecipe(...args)
}));

jest.mock("@/hooks/sync", () => ({
  syncAfterRecipeMutation: () => mockSyncAfterRecipeMutation()
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

describe("RecipeAiEditSheet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("submits the instruction and closes on success", async () => {
    mockAiEditRecipe.mockResolvedValue({ id: 7, name: "Edited" });
    const onClose = jest.fn();

    await render(<RecipeAiEditSheet visible recipeId={7} onClose={onClose} />);

    const input = screen.getByPlaceholderText(
      "e.g. Make it dairy-free and cut prep time in half"
    );
    await fireEvent.changeText(input, "Make it spicy");
    await fireEvent.press(screen.getByText("Apply edit"));

    await waitFor(() => {
      expect(mockAiEditRecipe).toHaveBeenCalledWith(7, "Make it spicy");
      expect(mockSyncAfterRecipeMutation).toHaveBeenCalled();
      expect(mockToastSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("surfaces API errors without closing", async () => {
    mockAiEditRecipe.mockRejectedValue(new Error("nope"));
    const onClose = jest.fn();

    await render(<RecipeAiEditSheet visible recipeId={3} onClose={onClose} />);

    await fireEvent.changeText(
      screen.getByPlaceholderText("e.g. Make it dairy-free and cut prep time in half"),
      "Double the servings"
    );
    await fireEvent.press(screen.getByText("Apply edit"));

    await waitFor(() => {
      expect(mockToastFromError).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});

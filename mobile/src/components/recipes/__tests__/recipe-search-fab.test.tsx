import { RecipeSearchFab } from "@/components/recipes/RecipeSearchFab";
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("@/lib/haptics", () => ({
  tapHaptic: jest.fn()
}));

jest.mock("@/components/ui/keyboard", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");
  return {
    KeyboardStickyView: ({
      children,
      style,
      pointerEvents
    }: {
      children: React.ReactNode;
      style?: object;
      pointerEvents?: "box-none" | "auto" | "none";
    }) => (
      <View style={style} pointerEvents={pointerEvents}>
        {children}
      </View>
    )
  };
});

jest.mock("react-native-keyboard-controller", () => ({
  useKeyboardState: (selector: (s: { isVisible: boolean; height: number }) => unknown) =>
    selector({ isVisible: false, height: 0 })
}));

describe("RecipeSearchFab", () => {
  it("expands from the FAB into a search field", async () => {
    const onChangeText = jest.fn();
    await render(<RecipeSearchFab value="" onChangeText={onChangeText} />);

    await fireEvent.press(screen.getByLabelText("Search recipes"));
    expect(screen.getByPlaceholderText("Search recipes…")).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText("Search recipes…"), "chicken");
    expect(onChangeText).toHaveBeenCalledWith("chicken");
  });

  it("clears the query when X is pressed with text present", async () => {
    const onChangeText = jest.fn();
    await render(<RecipeSearchFab value="pasta" onChangeText={onChangeText} />);

    await fireEvent.press(screen.getByLabelText("Search recipes"));
    await fireEvent.press(screen.getByLabelText("Clear search"));
    expect(onChangeText).toHaveBeenCalledWith("");
  });
});

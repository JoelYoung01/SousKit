import { render, screen } from "@testing-library/react-native";
import { Input } from "../input";

function classTokens(testID: string) {
  return String(screen.getByTestId(testID).props.className).split(/\s+/);
}

describe("Input", () => {
  it("does not set lineHeight, so a long unfocused value stays on one line", async () => {
    await render(
      <Input
        testID="name"
        value="Southwest Veggie Omelet with Whole Grain Toast and Sliced Apple"
        className="h-11 rounded-xl"
      />
    );

    const tokens = classTokens("name");
    expect(tokens).toContain("text-[16px]");
    expect(tokens).toContain("h-11");
    expect(tokens).not.toContain("text-base");
    expect(tokens.some((token) => token.startsWith("leading-"))).toBe(false);
  });

  it("keeps a text size override without its built-in line height", async () => {
    await render(<Input testID="ingredient" className="h-9 rounded-lg text-xs leading-5" />);

    const tokens = classTokens("ingredient");
    expect(tokens).toContain("text-[12px]");
    expect(tokens).not.toContain("text-xs");
    expect(tokens).not.toContain("text-[16px]");
    expect(tokens.some((token) => token.startsWith("leading-"))).toBe(false);
  });
});

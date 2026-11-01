import {
  cappedFieldMaxHeight,
  sheetBodyMaxHeight,
  sheetContentBottomPadding,
  sheetPanelMaxHeight
} from "@/components/ui/sheet-layout";

describe("sheet layout", () => {
  it("shrinks the panel by the keyboard height without adding that height again as padding", () => {
    const panel = sheetPanelMaxHeight({
      windowHeight: 844,
      keyboardHeight: 336,
      topInset: 47,
      fullHeight: false
    });

    expect(panel).toBeCloseTo((844 - 336) * 0.88);
    expect(sheetContentBottomPadding(336, 34)).toBe(12);
    expect(sheetContentBottomPadding(0, 34)).toBe(46);
  });

  it("reserves the pinned footer inside the panel so actions stay above the keyboard", () => {
    const panel = sheetPanelMaxHeight({
      windowHeight: 844,
      keyboardHeight: 336,
      topInset: 47,
      fullHeight: false
    });
    const bottomPadding = sheetContentBottomPadding(336, 34);
    const handleHeight = 32;
    const footerHeight = 56;
    const body = sheetBodyMaxHeight({
      panelMaxHeight: panel,
      handleHeight,
      footerHeight,
      bottomPadding
    });

    expect(body + handleHeight + footerHeight + bottomPadding).toBeCloseTo(panel);
    expect(body).toBeGreaterThan(96);
  });

  it("caps a growing field to the body leftover so it scrolls instead of covering the footer", () => {
    expect(cappedFieldMaxHeight(null, 76)).toBeUndefined();
    expect(cappedFieldMaxHeight(220, 76)).toBe(144);
    expect(cappedFieldMaxHeight(80, 76)).toBe(96);
  });

  it("keeps a full-height sheet below the status bar and the keyboard", () => {
    expect(
      sheetPanelMaxHeight({
        windowHeight: 844,
        keyboardHeight: 336,
        topInset: 47,
        fullHeight: true
      })
    ).toBe(844 - 47 - 336);
  });
});

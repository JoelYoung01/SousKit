import { createContext, useContext, type ReactNode } from "react";

/**
 * Space the sheet body can use before it must scroll.
 * Null when the field is rendered outside a Sheet (tests, or a closed tree).
 */
const SheetBodyMaxContext = createContext<number | null>(null);

export function SheetBodyMaxProvider({
  maxHeight,
  children
}: {
  maxHeight: number;
  children: ReactNode;
}) {
  return <SheetBodyMaxContext.Provider value={maxHeight}>{children}</SheetBodyMaxContext.Provider>;
}

export function useSheetBodyMaxHeight(): number | null {
  return useContext(SheetBodyMaxContext);
}

const MIN_BODY = 96;
const OPEN_KEYBOARD_BOTTOM_GAP = 12;

/**
 * Panel cap. KeyboardStickyView already translates the panel by the keyboard
 * height, so the cap shrinks by that same amount. A keyboard-sized spacer
 * inside the panel would double-count and slide the actions off the top.
 */
export function sheetPanelMaxHeight({
  windowHeight,
  keyboardHeight,
  topInset,
  fullHeight
}: {
  windowHeight: number;
  keyboardHeight: number;
  topInset: number;
  fullHeight: boolean;
}): number {
  if (fullHeight) {
    return Math.max(240, windowHeight - Math.max(topInset, 8) - keyboardHeight);
  }
  return (windowHeight - keyboardHeight) * 0.88;
}

/** Home-indicator padding only while the keyboard is closed. The open keyboard covers that inset. */
export function sheetContentBottomPadding(keyboardHeight: number, bottomInset: number): number {
  if (keyboardHeight > 0) return OPEN_KEYBOARD_BOTTOM_GAP;
  return bottomInset + OPEN_KEYBOARD_BOTTOM_GAP;
}

/** Body viewport above a pinned footer, inside the panel cap. */
export function sheetBodyMaxHeight({
  panelMaxHeight,
  handleHeight,
  footerHeight,
  bottomPadding
}: {
  panelMaxHeight: number;
  handleHeight: number;
  footerHeight: number;
  bottomPadding: number;
}): number {
  return Math.max(MIN_BODY, panelMaxHeight - handleHeight - footerHeight - bottomPadding);
}

/**
 * Cap a growing field so it scrolls inside the body instead of pushing a
 * sibling action row past the bottom of the sheet.
 */
export function cappedFieldMaxHeight(
  bodyMaxHeight: number | null,
  occupiedHeight: number,
  min = MIN_BODY
): number | undefined {
  if (bodyMaxHeight == null) return undefined;
  return Math.max(min, bodyMaxHeight - occupiedHeight);
}

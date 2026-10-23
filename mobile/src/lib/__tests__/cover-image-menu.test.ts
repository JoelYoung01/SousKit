import {
  buildCoverImageMenuOptions,
  readClipboardImage,
  showCoverImageContextMenu
} from "@/lib/cover-image-menu";
import * as Clipboard from "expo-clipboard";
import { ActionSheetIOS, Platform } from "react-native";

jest.mock("expo-clipboard", () => ({
  getImageAsync: jest.fn(),
  getStringAsync: jest.fn()
}));

const mockGetImageAsync = Clipboard.getImageAsync as jest.Mock;
const mockGetStringAsync = Clipboard.getStringAsync as jest.Mock;

describe("buildCoverImageMenuOptions", () => {
  it("builds Take photo, Camera roll, Clipboard, and Cancel options", () => {
    const menu = buildCoverImageMenuOptions();
    expect(menu.options).toEqual(["Take photo", "Camera roll", "Clipboard", "Cancel"]);
    expect(menu.actions).toEqual(["take-photo", "camera-roll", "clipboard", "cancel"]);
    expect(menu.cancelButtonIndex).toBe(3);
  });
});

describe("showCoverImageContextMenu", () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
    jest.restoreAllMocks();
  });

  it("opens ActionSheetIOS on iOS and invokes the chosen action", () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    const spy = jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation((_opts, cb) => cb(2));

    const onSelect = jest.fn();
    const handled = showCoverImageContextMenu(onSelect);

    expect(handled).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Upload recipe photo",
        options: ["Take photo", "Camera roll", "Clipboard", "Cancel"],
        cancelButtonIndex: 3
      }),
      expect.any(Function)
    );
    expect(onSelect).toHaveBeenCalledWith("clipboard");
  });

  it("returns false on non-iOS so the sheet fallback is used", () => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    const onSelect = jest.fn();
    expect(showCoverImageContextMenu(onSelect)).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("readClipboardImage", () => {
  beforeEach(() => {
    mockGetImageAsync.mockReset();
    mockGetStringAsync.mockReset();
  });

  it("returns a PickedImage when the clipboard contains an image", async () => {
    mockGetImageAsync.mockResolvedValue({
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      size: { width: 64, height: 64 }
    });

    const picked = await readClipboardImage();
    expect(picked).toEqual({
      uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      fileName: expect.stringMatching(/^clipboard-\d+\.png$/),
      mimeType: "image/png"
    });
  });

  it("falls back to a copied data:image URI string when binary clipboard is empty", async () => {
    mockGetImageAsync.mockResolvedValue(null);
    mockGetStringAsync.mockResolvedValue("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==");

    const picked = await readClipboardImage();
    expect(picked).toEqual({
      uri: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==",
      fileName: expect.stringMatching(/^clipboard-\d+\.jpg$/),
      mimeType: "image/jpeg"
    });
  });

  it("returns null when no image is on the clipboard", async () => {
    mockGetImageAsync.mockResolvedValue(null);
    mockGetStringAsync.mockResolvedValue("just plain recipe notes");

    await expect(readClipboardImage()).resolves.toBeNull();
  });
});

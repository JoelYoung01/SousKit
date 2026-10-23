import type { PickedImage } from "@/api/uploads";
import { normalizeClipboardImageData, parseImageDataUri } from "@/lib/upload-media";
import * as Clipboard from "expo-clipboard";
import { ActionSheetIOS, Platform } from "react-native";

export type CoverImageSourceAction = "take-photo" | "camera-roll" | "clipboard";

export interface CoverImageSourceItem {
  id: CoverImageSourceAction;
  label: string;
  description: string;
}

export const COVER_IMAGE_SOURCE_ITEMS: readonly CoverImageSourceItem[] = [
  {
    id: "take-photo",
    label: "Take photo",
    description: "Use your camera to photograph the dish"
  },
  {
    id: "camera-roll",
    label: "Camera roll",
    description: "Choose a photo from your library"
  },
  {
    id: "clipboard",
    label: "Clipboard",
    description: "Paste an image copied to your clipboard"
  }
];

export function buildCoverImageMenuOptions() {
  const options = [...COVER_IMAGE_SOURCE_ITEMS.map((item) => item.label), "Cancel"];
  const actions: (CoverImageSourceAction | "cancel")[] = [
    ...COVER_IMAGE_SOURCE_ITEMS.map((item) => item.id),
    "cancel"
  ];

  return {
    options,
    actions,
    cancelButtonIndex: options.length - 1
  };
}

/**
 * Show the native iOS ActionSheet when running on iOS.
 * Returns `true` when handled natively, or `false` on web / other platforms
 * so the caller can open its sheet/menu fallback.
 */
export function showCoverImageContextMenu(
  onSelect: (action: CoverImageSourceAction) => void
): boolean {
  if (Platform.OS !== "ios") return false;

  const { options, actions, cancelButtonIndex } = buildCoverImageMenuOptions();

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Upload recipe photo",
      options,
      cancelButtonIndex
    },
    (buttonIndex) => {
      if (buttonIndex < 0) return;
      const action = actions[buttonIndex];
      if (!action || action === "cancel") return;
      onSelect(action);
    }
  );
  return true;
}

/**
 * Scan the system clipboard for a copied image (or a copied `data:image/...` URI)
 * and return an upload-ready `PickedImage` descriptor, or `null` if none is present.
 */
export async function readClipboardImage(): Promise<PickedImage | null> {
  try {
    const clipboardImage = await Clipboard.getImageAsync({ format: "png" });
    if (clipboardImage?.data) {
      const parsed = normalizeClipboardImageData(clipboardImage.data, "image/png");
      if (parsed) {
        return {
          uri: parsed.dataUri,
          fileName: `clipboard-${Date.now()}.${parsed.extension}`,
          mimeType: parsed.mimeType
        };
      }
    }
  } catch {
    /* Fall back to string inspection when binary clipboard read is unavailable */
  }

  try {
    const text = await Clipboard.getStringAsync();
    const parsed = parseImageDataUri(text);
    if (parsed) {
      return {
        uri: parsed.dataUri,
        fileName: `clipboard-${Date.now()}.${parsed.extension}`,
        mimeType: parsed.mimeType
      };
    }
  } catch {
    /* Ignore and report no clipboard image found */
  }

  return null;
}

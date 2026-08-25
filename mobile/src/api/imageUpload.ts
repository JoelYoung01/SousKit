import type { PickedImage } from "./uploads";

/**
 * Normalize a picked image into a multipart-safe file descriptor.
 * Empty filenames make FastAPI treat the part as a text field (not a file),
 * which previously crashed error handling and looked like a "network error".
 */
export function normalizePickedImage(asset: PickedImage): {
  uri: string;
  fileName: string;
  mimeType: string;
} {
  const rawName = (asset.fileName ?? "").trim();
  const mimeType = (asset.mimeType ?? "").trim() || guessMimeFromName(rawName) || "image/jpeg";
  let fileName = rawName || `photo-${Date.now()}`;

  // Ensure there is an extension matching the mime when possible.
  if (!/\.[a-z0-9]+$/i.test(fileName)) {
    fileName = `${fileName}.${extForMime(mimeType)}`;
  }

  return { uri: asset.uri, fileName, mimeType };
}

function guessMimeFromName(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

function extForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/heic" || mime === "image/heif") return "heic";
  return "jpg";
}

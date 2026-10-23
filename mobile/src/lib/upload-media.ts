/** Helpers for preparing picked images before multipart upload. */

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif"
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif"
};

export interface ParsedImageDataUri {
  dataUri: string;
  mimeType: string;
  extension: string;
  base64: string;
}

export function inferImageMimeType(fileName: string, mimeType?: string | null): string {
  if (mimeType?.trim()) return mimeType.trim();
  const ext = fileName.split(".").pop()?.toLowerCase();
  return (ext && MIME_BY_EXT[ext]) || "image/jpeg";
}

export function defaultUploadFileName(
  fileName?: string | null,
  mimeType?: string | null
): string {
  if (fileName?.trim()) return fileName.trim();
  const extFromMime = mimeType?.split("/")[1]?.toLowerCase();
  const ext =
    extFromMime && extFromMime !== "jpeg" && extFromMime !== "jpg" ? extFromMime : "jpg";
  return `photo-${Date.now()}.${ext}`;
}

export function parseImageDataUri(raw?: string | null): ParsedImageDataUri | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) return null;
  const rawMime = match[1]!.toLowerCase();
  const mimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  const base64 = match[2]!.replace(/\s+/g, "");
  if (!base64) return null;
  const extension = EXT_BY_MIME[mimeType] ?? "png";
  return {
    dataUri: `data:${mimeType};base64,${base64}`,
    mimeType,
    extension,
    base64
  };
}

export function normalizeClipboardImageData(
  raw?: string | null,
  fallbackMime = "image/png"
): ParsedImageDataUri | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) {
    return parseImageDataUri(trimmed);
  }
  const clean = trimmed.replace(/\s+/g, "");
  if (clean.length < 16 || !/^[a-z0-9+/=]+$/i.test(clean)) {
    return null;
  }
  return parseImageDataUri(`data:${fallbackMime};base64,${clean}`);
}

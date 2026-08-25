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

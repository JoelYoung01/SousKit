import type { RecipeCoverOption, UploadSlim } from "@/types";

/** Build the API-relative upload URL when the server omits the computed field. */
export function uploadMediaUrl(upload: Pick<UploadSlim, "url" | "file_path">): string {
  const direct = upload.url?.trim();
  if (direct) return direct;
  const path = upload.file_path?.replace(/^\//, "").trim();
  return path ? `/uploads/${path}` : "";
}

export function normalizeCoverOption(option: RecipeCoverOption): RecipeCoverOption {
  return { ...option, url: uploadMediaUrl(option) };
}

export function normalizeUpload(upload: UploadSlim): UploadSlim {
  return { ...upload, url: uploadMediaUrl(upload) };
}

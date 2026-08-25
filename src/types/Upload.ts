export interface UploadSlim {
  id: number;
  name: string;
  url: string;
  file_path: string;
  created_on: string;
  created_by_id: number;
}

/** One generate-cover candidate (Upload fields + dismiss key). */
export interface RecipeCoverOption extends UploadSlim {
  /** Stable id so dismissed images are skipped on later searches for this recipe. */
  skip_key: string;
}

/** Response from POST /recipe/generate-cover/ */
export interface RecipeCoverGenerateResponse {
  provider: string;
  /** "pick" = show chooser (Openverse search); "single" = auto-apply */
  mode: "pick" | "single" | string;
  options: RecipeCoverOption[];
}

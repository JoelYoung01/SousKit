export interface UploadSlim {
  id: number;
  name: string;
  url: string;
  file_path: string;
  created_on: string;
  created_by_id: number;
}

/** Response from POST /recipe/generate-cover/ */
export interface RecipeCoverGenerateResponse {
  provider: string;
  /** "pick" = show chooser (Openverse search); "single" = auto-apply */
  mode: "pick" | "single" | string;
  options: UploadSlim[];
}

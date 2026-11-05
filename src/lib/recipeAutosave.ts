/**
 * Debounced recipe-editor autosave.
 * The same module is copied in `src/lib/recipeAutosave.ts` for the web app.
 * Keep the two files identical.
 */

export const RECIPE_AUTOSAVE_DELAY_MS = 800;

export type RecipeAutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface RecipeDraftIngredient {
  name: string;
  amount: number | null;
  units: string | null;
  details: string | null;
}

/** Canonical recipe body. Callers normalize text before passing it in. */
export interface RecipeDraftPayload {
  name: string;
  description: string;
  instructions: string;
  notes: string | null;
  public: boolean;
  prep_time: number | null;
  cover_image_id: number | null;
  ingredients: RecipeDraftIngredient[];
}

export type RecipeDraftSave = (id: number | null, draft: RecipeDraftPayload) => Promise<number>;

export function recipeDraftKey(draft: RecipeDraftPayload): string {
  return JSON.stringify(draft);
}

export function isSavableRecipeDraft(draft: RecipeDraftPayload): boolean {
  return (
    draft.name.length > 0 &&
    draft.description.length > 0 &&
    draft.instructions.length > 0 &&
    draft.ingredients.length > 0 &&
    draft.ingredients.every((row) => row.name.length > 0)
  );
}

export function recipeAutosaveStatusLabel(status: RecipeAutosaveStatus): string {
  switch (status) {
    case "pending":
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "error":
      return "Couldn’t save";
    default:
      return "";
  }
}

export function unsavedDraftMessage(persisted: boolean): string {
  return persisted
    ? "Latest changes weren’t saved. Add a name, description, instructions, and an ingredient."
    : "Recipe wasn’t saved. Add a name, description, instructions, and an ingredient.";
}

export const LEAVE_WITHOUT_SAVING_MESSAGE = "Leaving without the latest changes.";

function cloneDraft(draft: RecipeDraftPayload): RecipeDraftPayload {
  return {
    ...draft,
    ingredients: draft.ingredients.map((row) => ({ ...row }))
  };
}

/**
 * Saves a normalized recipe draft shortly after it changes.
 * The payload passed to `save` is the snapshot from when that request started,
 * so keystrokes during the request are written by the follow-up pass.
 */
export class RecipeAutosave {
  status: RecipeAutosaveStatus = "idle";

  #draft: RecipeDraftPayload = {
    name: "",
    description: "",
    instructions: "",
    notes: null,
    public: false,
    prep_time: null,
    cover_image_id: null,
    ingredients: []
  };
  #lastSavedKey = "";
  #persistedId: number | null = null;
  #baselined = false;
  #didSave = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #chain: Promise<void> = Promise.resolve();
  #save: RecipeDraftSave | null = null;
  #listeners = new Set<(status: RecipeAutosaveStatus) => void>();

  get persistedId(): number | null {
    return this.#persistedId;
  }

  bindSave(save: RecipeDraftSave) {
    this.#save = save;
  }

  subscribe(listener: (status: RecipeAutosaveStatus) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Remember the loaded draft so opening the editor does not write it back. */
  baseline(draft: RecipeDraftPayload, id: number | null) {
    this.#clearTimer();
    this.#draft = cloneDraft(draft);
    this.#persistedId = id;
    this.#lastSavedKey = recipeDraftKey(this.#draft);
    this.#baselined = true;
    this.#didSave = false;
    this.#setStatus("idle");
  }

  setSnapshot(draft: RecipeDraftPayload) {
    this.#draft = cloneDraft(draft);
    if (!this.#baselined) return;
    this.#arm();
  }

  isDirty(): boolean {
    return this.#baselined && recipeDraftKey(this.#draft) !== this.#lastSavedKey;
  }

  /** Write now if the current draft is savable and different from the last write. */
  flush(): Promise<boolean> {
    this.#clearTimer();
    const run = this.#chain.then(() => this.#runOnce());
    this.#chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  #arm() {
    this.#clearTimer();
    const key = recipeDraftKey(this.#draft);
    const dirty = key !== this.#lastSavedKey;
    const savable = isSavableRecipeDraft(this.#draft);

    if (!dirty || !savable) {
      if (this.status === "saving") return;
      if (!dirty || this.status !== "error") {
        this.#setStatus(this.#didSave ? "saved" : "idle");
      }
      return;
    }

    // An in-flight request reads the latest snapshot when it finishes.
    if (this.status === "saving") return;

    this.#setStatus("pending");
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, RECIPE_AUTOSAVE_DELAY_MS);
  }

  async #runOnce(): Promise<boolean> {
    if (!this.#baselined || !this.#save) return true;

    const draft = this.#draft;
    const key = recipeDraftKey(draft);
    if (!isSavableRecipeDraft(draft) || key === this.#lastSavedKey) return true;

    this.#setStatus("saving");
    try {
      const id = await this.#save(this.#persistedId, draft);
      this.#persistedId = id;
      this.#lastSavedKey = key;
      this.#didSave = true;
    } catch {
      this.#setStatus("error");
      return false;
    }

    if (recipeDraftKey(this.#draft) !== this.#lastSavedKey && isSavableRecipeDraft(this.#draft)) {
      return this.#runOnce();
    }

    this.#setStatus("saved");
    return true;
  }

  #setStatus(status: RecipeAutosaveStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.#listeners) listener(status);
  }

  #clearTimer() {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}

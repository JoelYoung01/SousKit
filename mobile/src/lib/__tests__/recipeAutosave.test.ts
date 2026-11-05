import {
  RECIPE_AUTOSAVE_DELAY_MS,
  RecipeAutosave,
  isSavableRecipeDraft,
  recipeAutosaveStatusLabel,
  type RecipeDraftPayload
} from "@/lib/recipeAutosave";

function draft(overrides: Partial<RecipeDraftPayload> = {}): RecipeDraftPayload {
  return {
    name: "Soup",
    description: "A weeknight soup",
    instructions: "Simmer.",
    notes: null,
    public: false,
    prep_time: 20,
    cover_image_id: null,
    ingredients: [{ name: "Onion", amount: 1, units: null, details: null }],
    ...overrides
  };
}

describe("isSavableRecipeDraft", () => {
  it("requires a name, description, instructions, and a named ingredient", () => {
    expect(isSavableRecipeDraft(draft())).toBe(true);
    expect(isSavableRecipeDraft(draft({ name: "" }))).toBe(false);
    expect(isSavableRecipeDraft(draft({ description: "" }))).toBe(false);
    expect(isSavableRecipeDraft(draft({ instructions: "" }))).toBe(false);
    expect(isSavableRecipeDraft(draft({ ingredients: [] }))).toBe(false);
  });
});

describe("recipeAutosaveStatusLabel", () => {
  it("uses one label while a save is queued or in flight", () => {
    expect(recipeAutosaveStatusLabel("pending")).toBe("Saving…");
    expect(recipeAutosaveStatusLabel("saving")).toBe("Saving…");
    expect(recipeAutosaveStatusLabel("saved")).toBe("Saved");
    expect(recipeAutosaveStatusLabel("error")).toBe("Couldn’t save");
    expect(recipeAutosaveStatusLabel("idle")).toBe("");
  });
});

describe("RecipeAutosave", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not write the baseline draft", async () => {
    const autosave = new RecipeAutosave();
    const save = jest.fn(async () => 1);
    autosave.bindSave(save);
    const initial = draft();
    autosave.baseline(initial, 4);
    autosave.setSnapshot(initial);

    await jest.advanceTimersByTimeAsync(RECIPE_AUTOSAVE_DELAY_MS);
    await autosave.flush();

    expect(save).not.toHaveBeenCalled();
    expect(autosave.isDirty()).toBe(false);
    expect(autosave.status).toBe("idle");
  });

  it("waits until typing pauses, then saves the latest draft once", async () => {
    const autosave = new RecipeAutosave();
    const saved: string[] = [];
    autosave.bindSave(async (_id, body) => {
      saved.push(body.name);
      return 9;
    });
    autosave.baseline(draft({ name: "" }), null);

    autosave.setSnapshot(draft({ name: "S" }));
    autosave.setSnapshot(draft({ name: "So" }));
    autosave.setSnapshot(draft({ name: "Soup" }));
    expect(autosave.status).toBe("pending");

    await jest.advanceTimersByTimeAsync(RECIPE_AUTOSAVE_DELAY_MS - 1);
    expect(saved).toEqual([]);

    await jest.advanceTimersByTimeAsync(1);
    expect(saved).toEqual(["Soup"]);
    expect(autosave.persistedId).toBe(9);
    expect(autosave.status).toBe("saved");
    expect(autosave.isDirty()).toBe(false);
  });

  it("updates with the id returned from the first create", async () => {
    const autosave = new RecipeAutosave();
    const ids: (number | null)[] = [];
    autosave.bindSave(async (id) => {
      ids.push(id);
      return id ?? 12;
    });
    autosave.baseline(draft({ name: "" }), null);

    autosave.setSnapshot(draft({ name: "Soup" }));
    await autosave.flush();
    autosave.setSnapshot(draft({ name: "Stew" }));
    await autosave.flush();

    expect(ids).toEqual([null, 12]);
  });

  it("saves again when the draft changes during a request", async () => {
    const autosave = new RecipeAutosave();
    let release: (id: number) => void = () => undefined;
    const first = new Promise<number>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    const names: string[] = [];
    autosave.bindSave((id, body) => {
      names.push(body.name);
      if (names.length === 1) {
        started();
        return first;
      }
      return Promise.resolve(id ?? 3);
    });
    autosave.baseline(draft({ name: "" }), null);
    autosave.setSnapshot(draft({ name: "One" }));

    const pending = autosave.flush();
    await startedGate;
    autosave.setSnapshot(draft({ name: "Two" }));
    release(6);
    await pending;

    expect(names).toEqual(["One", "Two"]);
    expect(autosave.persistedId).toBe(6);
    expect(autosave.status).toBe("saved");
    expect(autosave.isDirty()).toBe(false);
  });

  it("keeps the snapshot that started the request if the caller mutates the object", async () => {
    const autosave = new RecipeAutosave();
    let seen = "";
    autosave.bindSave(async (_id, body) => {
      seen = body.name;
      return 2;
    });
    autosave.baseline(draft({ name: "" }), null);
    const next = draft({ name: "Original" });
    autosave.setSnapshot(next);
    next.name = "Mutated";
    await autosave.flush();
    expect(seen).toBe("Original");
  });

  it("does not save an incomplete draft", async () => {
    const autosave = new RecipeAutosave();
    const save = jest.fn(async () => 1);
    autosave.bindSave(save);
    autosave.baseline(draft({ name: "" }), null);
    autosave.setSnapshot(draft({ name: "Only a name", description: "", instructions: "" }));

    await jest.advanceTimersByTimeAsync(RECIPE_AUTOSAVE_DELAY_MS * 2);
    await autosave.flush();

    expect(save).not.toHaveBeenCalled();
    expect(autosave.isDirty()).toBe(true);
  });

  it("reports an error and retries on the next flush", async () => {
    const autosave = new RecipeAutosave();
    const statuses: string[] = [];
    autosave.subscribe((status) => statuses.push(status));
    let fail = true;
    autosave.bindSave(async () => {
      if (fail) throw new Error("offline");
      return 5;
    });
    autosave.baseline(draft({ name: "" }), 5);
    autosave.setSnapshot(draft({ name: "Soup" }));

    await expect(autosave.flush()).resolves.toBe(false);
    expect(autosave.status).toBe("error");
    expect(autosave.isDirty()).toBe(true);

    fail = false;
    await expect(autosave.flush()).resolves.toBe(true);
    expect(autosave.status).toBe("saved");
    expect(statuses).toContain("error");
    expect(statuses.at(-1)).toBe("saved");
  });

  it("ignores snapshots taken before the editor has loaded", async () => {
    const autosave = new RecipeAutosave();
    const save = jest.fn(async () => 1);
    autosave.bindSave(save);
    autosave.setSnapshot(draft());
    await jest.advanceTimersByTimeAsync(RECIPE_AUTOSAVE_DELAY_MS);
    expect(save).not.toHaveBeenCalled();
  });
});

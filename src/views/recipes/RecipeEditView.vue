<script setup lang="ts">
import ImageUploadDialog from "@/components/ImageUploadDialog.vue";
import CoverImagePickerDialog from "@/components/CoverImagePickerDialog.vue";
import SourceLinkEditor from "@/components/recipes/SourceLinkEditor.vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MarkdownField from "@/components/recipes/MarkdownField.vue";
import { mediaUrl } from "@/lib/media";
import { recipeReadPath } from "@/lib/recipePath";
import { loadCoverSkipKeys, rememberCoverSkipKey } from "@/lib/coverSkip";
import {
  LEAVE_WITHOUT_SAVING_MESSAGE,
  RecipeAutosave,
  isSavableRecipeDraft,
  recipeAutosaveStatusLabel,
  recipeDraftKey,
  unsavedDraftMessage,
  type RecipeAutosaveStatus,
  type RecipeDraftPayload
} from "@/lib/recipeAutosave";
import { paths } from "@/sitemap";
import { syncAfterRecipeMutation } from "@/stores/sync";
import type {
  IngredientCreate,
  RecipeCoverGenerateResponse,
  RecipeCoverOption,
  RecipeCreate,
  RecipeDetail,
  RecipeSourceLink,
  UploadSlim
} from "@/types";
import { ApiError, del, get, getErrorMessage, post, put, toast } from "@/utils";
import { LoaderCircle, Plus, Sparkles, Trash2 } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { isNavigationFailure, onBeforeRouteLeave, useRoute, useRouter } from "vue-router";

type IngredientForm = Partial<IngredientCreate> & { id?: number };

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalText(value: unknown): string | null {
  const text = asText(value);
  return text.length > 0 ? text : null;
}

function asAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const router = useRouter();
const route = useRoute();

const defaultIngredient: IngredientForm = {
  id: undefined,
  name: undefined,
  amount: undefined,
  units: undefined,
  details: undefined
};

const recipeDetail = ref<RecipeDetail>();
const loading = ref(route.name !== "recipe-new");
const ready = ref(false);
const leaving = ref(false);
const saveStatus = ref<RecipeAutosaveStatus>("idle");
const leaveFailures = ref(0);
const generatingCover = ref(false);
const coverError = ref("");
const coverOptions = ref<RecipeCoverOption[]>([]);
const coverPickerOpen = ref(false);
const coverPreviewUrl = ref<string>("");
const coverSkipKeys = ref<string[]>([]);
const dismissingCoverId = ref<number | null>(null);

const autosave = new RecipeAutosave();
const stopStatus = autosave.subscribe((status) => {
  saveStatus.value = status;
});
onBeforeUnmount(stopStatus);

const coverPreviewSrc = computed(() =>
  coverPreviewUrl.value ? mediaUrl(coverPreviewUrl.value) : ""
);
const statusLabel = computed(() => recipeAutosaveStatusLabel(saveStatus.value));

const form = reactive<Partial<RecipeCreate>>({
  name: undefined,
  description: undefined,
  instructions: undefined,
  notes: undefined,
  public: false,
  prep_time: undefined,
  cover_image_id: undefined
});
watch(
  () => form.cover_image_id,
  async (id) => {
    if (!id) {
      coverPreviewUrl.value = "";
      return;
    }
    try {
      const upload = await get<UploadSlim>(`/upload/${id}/`);
      coverPreviewUrl.value = upload.url;
    } catch {
      /* preview is best-effort */
    }
  }
);
const ingredientForms = reactive<IngredientForm[]>([]);
const sourceLinks = ref<RecipeSourceLink[]>([]);

const draft = computed<RecipeDraftPayload>(() => ({
  name: asText(form.name),
  description: asText(form.description),
  instructions: asText(form.instructions),
  notes: asOptionalText(form.notes),
  public: Boolean(form.public),
  prep_time: asAmount(form.prep_time),
  cover_image_id: typeof form.cover_image_id === "number" ? form.cover_image_id : null,
  source_links: sourceLinks.value
    .map((link) => ({ name: link.name.trim(), url: link.url.trim() }))
    .filter((link) => link.url.length > 0),
  ingredients: ingredientForms
    .map((row) => ({
      name: asText(row.name),
      amount: asAmount(row.amount),
      units: asOptionalText(row.units),
      details: asOptionalText(row.details)
    }))
    .filter((row) => row.name.length > 0)
}));

const creating = computed(() => route.name === "recipe-new");
const coverRecipeKey = computed(() =>
  creating.value ? "new" : String(route.params.recipeId ?? "new")
);
const returnUrl = computed(() => {
  const param = Array.isArray(route.query.returnUrl)
    ? route.query.returnUrl.at(-1)
    : route.query.returnUrl;
  if (param) return param;

  if (creating.value) return paths.home;

  const detailParam = Array.isArray(route.query.detailReturnUrl)
    ? route.query.detailReturnUrl.at(-1)
    : route.query.detailReturnUrl;

  let url = paths.recipeDetail(String(route.params.recipeId));
  if (detailParam) url += `?returnUrl=${encodeURIComponent(detailParam)}`;
  return url;
});

const canGenerateCover = computed(
  () => Boolean(form.name?.trim()) && !generatingCover.value && !loading.value
);

autosave.bindSave(async (id, body) => {
  try {
    if (id == null) {
      const created = await post<RecipeDetail>("/recipe/", body);
      syncAfterRecipeMutation();
      return created.id;
    }
    await put(`/recipe/${id}/`, body);
    syncAfterRecipeMutation();
    return id;
  } catch (error) {
    console.error(error);
    toast.fromError(error, "Couldn’t save this recipe.");
    throw error;
  }
});

// `null` means the editor is still loading. The first real key is the baseline.
watch(
  () => (ready.value ? recipeDraftKey(draft.value) : null),
  (_key, previous) => {
    if (!ready.value) return;
    if (previous == null) {
      autosave.baseline(draft.value, recipeDetail.value?.id ?? null);
      return;
    }
    autosave.setSnapshot(draft.value);
  }
);

function saveNow() {
  void autosave.flush();
}

async function done() {
  if (leaving.value) return;
  leaving.value = true;
  try {
    await router.push(returnUrl.value);
  } catch (error) {
    if (!isNavigationFailure(error)) throw error;
  } finally {
    leaving.value = false;
  }
}

onBeforeRouteLeave(async () => {
  if (leaveFailures.value >= 1 && saveStatus.value === "error") {
    toast.error(LEAVE_WITHOUT_SAVING_MESSAGE);
    return true;
  }
  const saved = await autosave.flush();
  if (!saved) {
    leaveFailures.value = 1;
    return false;
  }
  if (autosave.isDirty() && !isSavableRecipeDraft(draft.value)) {
    toast.error(unsavedDraftMessage(autosave.persistedId != null));
  }
  return true;
});

async function generateCoverImage() {
  if (!canGenerateCover.value || !form.name?.trim()) return;
  generatingCover.value = true;
  coverError.value = "";
  try {
    const result = await post<RecipeCoverGenerateResponse>("/recipe/generate-cover/", {
      name: form.name.trim(),
      description: form.description?.trim() || null,
      ingredients: ingredientForms
        .filter((ing) => ing.name?.trim())
        .map((ing) => ({ name: ing.name!.trim() })),
      limit: 4,
      exclude_keys: coverSkipKeys.value
    });
    if (!result.options.length) {
      coverError.value =
        "No cover photos found. Try a clearer dish name, clear dismissed photos, or upload your own.";
      return;
    }
    if (result.mode === "single" || result.options.length === 1) {
      applyCoverOption(result.options[0]!);
      return;
    }
    coverOptions.value = result.options;
    coverPickerOpen.value = true;
  } catch (er) {
    console.error(er);
    coverError.value = getErrorMessage(er, "Could not find cover images.");
    toast.fromError(er, "Could not find cover images.");
  } finally {
    generatingCover.value = false;
  }
}

function applyCoverOption(upload: RecipeCoverOption | UploadSlim) {
  form.cover_image_id = upload.id;
  coverPreviewUrl.value = upload.url;
  coverPickerOpen.value = false;
  coverOptions.value = [];
}

async function dismissCoverOption(option: RecipeCoverOption) {
  if (dismissingCoverId.value) return;
  dismissingCoverId.value = option.id;
  try {
    coverSkipKeys.value = rememberCoverSkipKey(coverRecipeKey.value, option.skip_key);
    coverOptions.value = coverOptions.value.filter((o) => o.id !== option.id);
    // Best-effort cleanup of the unused upload.
    void del(`/upload/${option.id}/`).catch(() => undefined);

    // Refill so the user can keep cycling without leaving the picker.
    if (coverOptions.value.length < 3 && form.name?.trim()) {
      const refill = await post<RecipeCoverGenerateResponse>("/recipe/generate-cover/", {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        ingredients: ingredientForms
          .filter((ing) => ing.name?.trim())
          .map((ing) => ({ name: ing.name!.trim() })),
        limit: 1,
        exclude_keys: [...coverSkipKeys.value, ...coverOptions.value.map((o) => o.skip_key)]
      });
      for (const next of refill.options) {
        if (!coverOptions.value.some((o) => o.id === next.id || o.skip_key === next.skip_key)) {
          coverOptions.value = [...coverOptions.value, next];
        }
      }
    }
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t dismiss that photo.");
  } finally {
    dismissingCoverId.value = null;
  }
}

async function getRecipeDetails() {
  if (creating.value) return;
  loading.value = true;
  try {
    recipeDetail.value = await get(recipeReadPath(String(route.params.recipeId)));
    fillForms();
    ready.value = true;
  } catch (er) {
    if ((er as ApiError).status === 404) {
      router.push({ name: "not-found" });
    } else {
      console.error(er);
      toast.fromError(er, "Couldn’t load this recipe.");
    }
  }
  loading.value = false;
}

function fillForms() {
  if (!recipeDetail.value) return;
  for (const key of Object.keys(form) as (keyof typeof form)[]) {
    // @ts-expect-error keyed assign from detail
    form[key] = recipeDetail.value[key] ?? null;
  }
  coverPreviewUrl.value = recipeDetail.value.cover_image?.url ?? "";
  sourceLinks.value = (recipeDetail.value.source_links ?? []).map((link) => ({
    name: link.name,
    url: link.url
  }));
  ingredientForms.splice(0);
  for (const ingredient of recipeDetail.value.ingredients) {
    ingredientForms.push({
      id: ingredient.id,
      name: ingredient.name,
      amount: ingredient.amount,
      units: ingredient.units,
      details: ingredient.details
    });
  }
}

function addIngredient() {
  ingredientForms.push({ ...defaultIngredient });
}

function removeIngredient(index: number) {
  ingredientForms.splice(index, 1);
}

onMounted(() => {
  coverSkipKeys.value = loadCoverSkipKeys(coverRecipeKey.value);
  if (creating.value) {
    if (ingredientForms.length === 0) addIngredient();
    ready.value = true;
  } else {
    void getRecipeDetails();
  }
});

watch(coverRecipeKey, (key) => {
  coverSkipKeys.value = loadCoverSkipKeys(key);
});
</script>

<template>
  <div>
    <header
      class="sticky top-0 z-20 flex items-center border-b border-border/80 bg-background/95 px-2 py-1.5 backdrop-blur-sm"
    >
      <div class="w-16 shrink-0" aria-hidden="true" />
      <div class="min-w-0 flex-1 text-center">
        <h1 class="truncate text-base font-semibold">
          {{ creating ? "New recipe" : "Edit recipe" }}
        </h1>
        <p
          v-if="statusLabel"
          class="truncate text-[11px]"
          :class="saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'"
          aria-live="polite"
        >
          {{ statusLabel }}
        </p>
      </div>
      <div class="flex w-16 shrink-0 justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="h-8 px-2 font-semibold text-primary"
          :disabled="leaving"
          @click="done"
        >
          Done
        </Button>
      </div>
    </header>

    <div v-if="loading" class="flex justify-center px-4 py-16">
      <LoaderCircle class="size-6 animate-spin text-muted-foreground" />
    </div>
    <p v-else-if="!creating && !ready" class="px-4 py-16 text-center text-sm text-muted-foreground">
      Couldn’t load this recipe.
    </p>
    <form v-else class="flex flex-col gap-4 px-4 pt-4 pb-4" @submit.prevent="saveNow">
      <div class="space-y-2">
        <img
          v-if="coverPreviewUrl"
          :src="coverPreviewSrc"
          alt="Recipe cover"
          class="h-40 w-full rounded-xl object-cover"
        />
        <div class="flex flex-wrap items-center gap-2">
          <ImageUploadDialog v-model="form.cover_image_id" />
          <Button
            type="button"
            variant="secondary"
            class="gap-1.5"
            :disabled="!canGenerateCover"
            @click="generateCoverImage"
          >
            <LoaderCircle v-if="generatingCover" class="size-4 animate-spin" />
            <Sparkles v-else class="size-4 text-[#22c55e]" />
            {{ generatingCover ? "Generating…" : "Generate image" }}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Upload a photo by taking a picture, choosing from your camera roll, or pasting an image
          copied to your clipboard.
        </p>
        <p v-if="coverError" class="text-sm text-destructive">{{ coverError }}</p>
      </div>

      <div class="space-y-2">
        <Label for="name">Name</Label>
        <Input id="name" v-model="form.name" class="h-11 rounded-xl bg-card" required />
      </div>

      <MarkdownField
        id="description"
        v-model="form.description"
        label="Description"
        min-height-class="min-h-24"
        required
      />
      <MarkdownField
        id="instructions"
        v-model="form.instructions"
        label="Instructions"
        min-height-class="min-h-32"
        required
      />
      <MarkdownField id="notes" v-model="form.notes" label="Notes" min-height-class="min-h-20" />

      <SourceLinkEditor :links="sourceLinks" @update:links="sourceLinks = $event" />

      <div class="space-y-2">
        <Label for="prep">Prep time (min)</Label>
        <Input
          id="prep"
          v-model.number="form.prep_time"
          type="number"
          min="0"
          class="h-11 rounded-xl bg-card"
        />
      </div>

      <label class="flex items-center gap-2 text-sm">
        <Checkbox :model-value="!!form.public" @update:model-value="form.public = !!$event" />
        Public recipe
      </label>

      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">Ingredients</h2>
        <Button type="button" size="icon-sm" variant="ghost" @click="addIngredient">
          <Plus class="size-4" />
        </Button>
      </div>

      <div
        v-for="(ingredient, index) in ingredientForms"
        :key="index"
        class="grid grid-cols-[1fr_4.5rem_4rem_1fr_auto] gap-1.5"
      >
        <Input
          v-model="ingredient.name"
          placeholder="Name"
          class="h-9 rounded-lg bg-card text-xs"
        />
        <Input
          v-model.number="ingredient.amount"
          type="number"
          placeholder="Amt"
          class="h-9 rounded-lg bg-card text-xs"
        />
        <Input
          v-model="ingredient.units"
          placeholder="Unit"
          class="h-9 rounded-lg bg-card text-xs"
        />
        <Input
          v-model="ingredient.details"
          placeholder="Details"
          class="h-9 rounded-lg bg-card text-xs"
        />
        <Button type="button" size="icon-sm" variant="destructive" @click="removeIngredient(index)">
          <Trash2 class="size-3.5" />
        </Button>
      </div>
    </form>

    <CoverImagePickerDialog
      v-model:open="coverPickerOpen"
      :options="coverOptions"
      :dismissing-id="dismissingCoverId"
      @select="applyCoverOption"
      @search-again="generateCoverImage"
      @dismiss="dismissCoverOption"
    />
  </div>
</template>

<script setup lang="ts">
import ImageUploadDialog from "@/components/ImageUploadDialog.vue";
import CoverImagePickerDialog from "@/components/CoverImagePickerDialog.vue";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { paths } from "@/sitemap";
import { syncAfterRecipeMutation } from "@/stores/sync";
import type {
  IngredientCreate,
  RecipeCoverGenerateResponse,
  RecipeCreate,
  RecipeDetail,
  UploadSlim
} from "@/types";
import { ApiError, del, get, getErrorMessage, post, put, toast } from "@/utils";
import { LoaderCircle, Plus, Sparkles, Trash2 } from "@lucide/vue";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

type IngredientForm = Partial<IngredientCreate> & { id?: number };

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
const saving = ref(false);
const loading = ref(false);
const generatingCover = ref(false);
const coverError = ref("");
const coverOptions = ref<UploadSlim[]>([]);
const coverPickerOpen = ref(false);
const form = reactive<Partial<RecipeCreate>>({
  name: undefined,
  description: undefined,
  instructions: undefined,
  notes: undefined,
  public: false,
  prep_time: undefined,
  cover_image_id: undefined
});
const ingredientForms = reactive<IngredientForm[]>([]);

const creating = computed(() => route.name === "recipe-new");
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

const validForm = computed(
  () =>
    form.name &&
    form.description &&
    form.instructions &&
    ingredientForms.length > 0 &&
    ingredientForms.every((ing) => ing.name)
);
const canSave = computed(() => !!validForm.value && !saving.value && !loading.value);

const canGenerateCover = computed(
  () => Boolean(form.name?.trim()) && !generatingCover.value && !saving.value && !loading.value
);

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
      limit: 4
    });
    if (!result.options.length) {
      coverError.value = "No cover photos found. Try a clearer dish name or upload your own.";
      return;
    }
    if (result.mode === "single" || result.options.length === 1) {
      form.cover_image_id = result.options[0]!.id;
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

function applyCoverOption(upload: UploadSlim) {
  form.cover_image_id = upload.id;
  coverPickerOpen.value = false;
  coverOptions.value = [];
}

async function getRecipeDetails() {
  if (creating.value) return;
  loading.value = true;
  try {
    recipeDetail.value = await get(`/recipe/${route.params.recipeId}/`);
    fillForms();
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

async function saveChanges() {
  if (saving.value || !canSave.value) return;
  saving.value = true;
  try {
    if (!form.prep_time && form.prep_time !== 0) form.prep_time = undefined;

    let recipeId: number;
    if (creating.value) {
      const result = await post(`/recipe/`, form);
      recipeId = result.id;
    } else {
      const result = await put(`/recipe/${route.params.recipeId}/`, form);
      recipeId = result.id;
    }

    await saveIngredients(recipeId);
    syncAfterRecipeMutation();
    toast.success(creating.value ? "Recipe created." : "Recipe saved.");
    router.push(returnUrl.value);
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t save this recipe.");
  }
  saving.value = false;
}

async function saveIngredients(recipeId: number) {
  const existingIngredients = recipeDetail.value?.ingredients ?? [];
  const newIngredients = ingredientForms.filter((ingredient) => !ingredient.id);
  const updateIngredients = ingredientForms.filter((ingredient) => ingredient.id);
  const deleteIngredients = existingIngredients.filter(
    (ingredient) => !ingredientForms.some((formIngredient) => formIngredient.id === ingredient.id)
  );

  await Promise.all([
    ...newIngredients.map((ing) => post(`/ingredient/`, { ...ing, recipe_id: recipeId })),
    ...updateIngredients.map((ing) => put(`/ingredient/${ing.id}/`, ing)),
    ...deleteIngredients.map((ing) => del(`/ingredient/${ing.id}/`))
  ]);
}

function fillForms() {
  if (!recipeDetail.value) return;
  for (const key of Object.keys(form) as (keyof typeof form)[]) {
    // @ts-expect-error keyed assign from detail
    form[key] = recipeDetail.value[key] ?? null;
  }
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
  if (creating.value && ingredientForms.length === 0) addIngredient();
  getRecipeDetails();
});
</script>

<template>
  <div class="px-4 pt-5 pb-24">
    <h1 class="text-xl font-bold">{{ creating ? "New recipe" : "Edit recipe" }}</h1>

    <form class="mt-4 flex flex-col gap-4" @submit.prevent="saveChanges">
      <div class="space-y-2">
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
            {{ generatingCover ? "Finding image…" : "Generate image" }}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Generate searches free public-domain food photos from the recipe name and shows a few
          options to pick from. Enter a name first.
        </p>
        <p v-if="coverError" class="text-sm text-destructive">{{ coverError }}</p>
      </div>

      <div class="space-y-2">
        <Label for="name">Name</Label>
        <Input id="name" v-model="form.name" class="h-11 rounded-xl bg-card" required />
      </div>

      <div class="space-y-2">
        <Label for="description">Description</Label>
        <Textarea
          id="description"
          v-model="form.description"
          class="min-h-24 rounded-xl bg-card"
          required
        />
      </div>

      <div class="space-y-2">
        <Label for="instructions">Instructions</Label>
        <Textarea
          id="instructions"
          v-model="form.instructions"
          class="min-h-32 rounded-xl bg-card"
          required
        />
      </div>

      <div class="space-y-2">
        <Label for="notes">Notes</Label>
        <Textarea id="notes" v-model="form.notes" class="min-h-20 rounded-xl bg-card" />
      </div>

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

    <div
      class="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-30 flex w-full max-w-md -translate-x-1/2 gap-2 px-4"
    >
      <Button
        variant="outline"
        class="flex-1 border-border bg-card"
        :disabled="saving"
        @click="router.push(returnUrl)"
      >
        Cancel
      </Button>
      <Button class="flex-1" :disabled="!canSave" @click="saveChanges">
        {{ saving ? "Saving…" : "Save" }}
      </Button>
    </div>

    <CoverImagePickerDialog
      v-model:open="coverPickerOpen"
      :options="coverOptions"
      @select="applyCoverOption"
      @search-again="generateCoverImage"
    />
  </div>
</template>

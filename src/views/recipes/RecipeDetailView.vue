<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { splitInstructionSteps } from "@/lib/instructions";
import { formatPrepTime, mediaUrl } from "@/lib/media";
import { recipeToMarkdown } from "@/lib/recipeMarkdown";
import { useSessionStore } from "@/stores/session";
import { syncAfterRecipeMutation } from "@/stores/sync";
import { paths } from "@/sitemap";
import type { RecipeDetail } from "@/types";
import {
  formatIngredientAmountUnits,
  ingredientHasAmountOrUnits,
  normalizeIngredientDetails
} from "@/utils/ingredients";
import { ApiError, del, get, post, toast } from "@/utils";
import { fetchHousehold } from "@/utils/household";
import { ArrowLeft, Copy, LoaderCircle, Pencil, Sparkles } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

const sessionStore = useSessionStore();
const router = useRouter();
const route = useRoute();

const recipe = ref<RecipeDetail>();
const deleteOpen = ref(false);
const aiEditOpen = ref(false);
const aiInstruction = ref("");
const aiSaving = ref(false);
const copying = ref(false);
const loading = ref(false);
const householdId = ref<number | null>(null);

const authored = computed(() => recipe.value?.created_by.id === sessionStore.currentUser?.id);
const canEdit = computed(() => {
  if (!recipe.value) return false;
  if (householdId.value != null && recipe.value.household_id === householdId.value) {
    return true;
  }
  return authored.value;
});
const owned = canEdit;
const returnUrl = computed(() => {
  const param = Array.isArray(route.query.returnUrl)
    ? route.query.returnUrl.at(-1)
    : route.query.returnUrl;
  return param || paths.home;
});
const imageUrl = computed(() => mediaUrl(recipe.value?.cover_image?.url));
const formattedTime = computed(() => formatPrepTime(recipe.value?.prep_time) || "—");
const canAiSave = computed(() => aiInstruction.value.trim().length > 0 && !aiSaving.value);
const displayedIngredients = computed(() =>
  (recipe.value?.ingredients ?? []).map((ingredient) => ({
    ...ingredient,
    amountUnits: formatIngredientAmountUnits(ingredient.amount, ingredient.units),
    hasAmountUnits: ingredientHasAmountOrUnits(ingredient.amount, ingredient.units),
    detailsText: normalizeIngredientDetails(ingredient.details)
  }))
);

watch(aiEditOpen, (open) => {
  if (open) {
    aiInstruction.value = "";
    aiSaving.value = false;
  }
});

async function getRecipeDetails() {
  loading.value = true;
  try {
    recipe.value = await get(`/recipe/${route.params.recipeId}/`);
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

async function copyRecipe() {
  if (!recipe.value || copying.value) return;
  copying.value = true;
  try {
    await navigator.clipboard.writeText(recipeToMarkdown(recipe.value));
    toast.success("Recipe copied to clipboard.");
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t copy this recipe.");
  }
  copying.value = false;
}

async function deleteRecipe() {
  if (!owned.value) return;
  loading.value = true;
  try {
    await del(`/recipe/${route.params.recipeId}/`);
    deleteOpen.value = false;
    syncAfterRecipeMutation();
    toast.success("Recipe deleted.");
    router.push(returnUrl.value);
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t delete this recipe.");
  }
  loading.value = false;
}

async function applyAiEdit() {
  if (!owned.value || !canAiSave.value) return;
  aiSaving.value = true;
  try {
    recipe.value = await post<RecipeDetail>(`/recipe/${route.params.recipeId}/ai-edit/`, {
      instruction: aiInstruction.value.trim()
    });
    syncAfterRecipeMutation();
    toast.success("Recipe updated with AI.");
    aiEditOpen.value = false;
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t apply that AI edit.");
  }
  aiSaving.value = false;
}

function scrollToIngredients() {
  document.getElementById("ingredients")?.scrollIntoView({ behavior: "smooth" });
}

onMounted(async () => {
  try {
    householdId.value = (await fetchHousehold()).id;
  } catch {
    householdId.value = null;
  }
  await getRecipeDetails();
});
</script>

<template>
  <div v-if="recipe" class="relative">
    <div class="relative h-56 overflow-hidden">
      <img :src="imageUrl" :alt="recipe.name" class="size-full object-cover" />
      <div
        class="absolute inset-0 bg-gradient-to-b from-background/55 via-transparent to-background"
      />
      <div class="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <Button
          size="icon-sm"
          variant="secondary"
          class="rounded-full bg-background/50 text-foreground backdrop-blur"
          :aria-label="'Back'"
          @click="router.push(returnUrl)"
        >
          <ArrowLeft class="size-4 opacity-80" />
        </Button>
        <div v-if="owned" class="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="secondary"
            class="rounded-full bg-background/50 text-foreground backdrop-blur"
            :aria-label="'Edit with AI'"
            @click="aiEditOpen = true"
          >
            <Sparkles class="size-4 text-[#22c55e]" />
          </Button>
          <Button
            size="icon-sm"
            class="rounded-full"
            :aria-label="'Edit'"
            @click="
              router.push({
                path: paths.recipeEdit(String(route.params.recipeId)),
                query: { detailReturnUrl: returnUrl }
              })
            "
          >
            <Pencil class="size-4" />
          </Button>
        </div>
      </div>
    </div>

    <!-- No top border: hero gradient already divides — avoid stacked hard edges -->
    <div class="-mt-4 rounded-t-2xl border border-t-0 border-border bg-card px-5 pt-5 pb-8">
      <div class="flex items-start justify-between gap-3">
        <h1 class="text-xl font-bold tracking-tight leading-tight">{{ recipe.name }}</h1>
        <Button size="sm" class="shrink-0" @click="scrollToIngredients">Cook</Button>
      </div>

      <p v-if="!authored" class="mt-2 text-sm text-muted-foreground">
        Added by
        <RouterLink
          :to="paths.publicUser(recipe.created_by_id)"
          class="font-medium text-[#22c55e] hover:underline"
        >
          {{ recipe.created_by.display_name }}
        </RouterLink>
      </p>

      <div class="mt-4 grid grid-cols-2 gap-2">
        <div class="rounded-xl bg-secondary/50 px-3 py-3 text-center">
          <p class="text-xs text-muted-foreground">Total time</p>
          <p class="mt-1 text-sm font-semibold">{{ formattedTime }}</p>
        </div>
        <div class="rounded-xl bg-secondary/50 px-3 py-3 text-center">
          <p class="text-xs text-muted-foreground">Ingredients</p>
          <p class="mt-1 text-sm font-semibold">{{ recipe.ingredients.length }}</p>
        </div>
      </div>

      <section class="mt-5">
        <h2 class="mb-1 text-sm font-semibold">About</h2>
        <p class="text-base leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {{ recipe.description }}
        </p>
        <p v-if="recipe.public && owned" class="mt-2 text-xs text-[#4ade80]">
          This recipe is public.
        </p>
      </section>

      <section id="ingredients" class="mt-5 scroll-mt-4">
        <h2 class="mb-2 text-sm font-semibold">Ingredients</h2>
        <ul class="space-y-1.5 text-base">
          <li
            v-for="ingredient in displayedIngredients"
            :key="ingredient.id"
            class="rounded-lg bg-secondary/40 px-3 py-2"
          >
            <span v-if="ingredient.hasAmountUnits" class="text-muted-foreground">
              {{ ingredient.amountUnits }}
            </span>
            <template v-if="ingredient.hasAmountUnits"> • </template>
            {{ ingredient.name }}
            <span v-if="ingredient.detailsText" class="text-faint">
              ({{ ingredient.detailsText }})
            </span>
          </li>
        </ul>
      </section>

      <section class="mt-5">
        <h2 class="mb-1 text-sm font-semibold">Instructions</h2>
        <div class="space-y-2.5 font-sans text-base leading-relaxed text-muted-foreground">
          <p v-for="(step, idx) in splitInstructionSteps(recipe.instructions)" :key="idx">
            {{ step }}
          </p>
        </div>
      </section>

      <section v-if="recipe.notes" class="mt-5">
        <h2 class="mb-1 text-sm font-semibold">Notes</h2>
        <pre
          class="font-sans text-base leading-relaxed whitespace-pre-wrap text-muted-foreground"
          >{{ recipe.notes }}</pre
        >
      </section>

      <div class="mt-8 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" :disabled="copying" @click="copyRecipe">
          <Copy class="size-4" />
          {{ copying ? "Copying…" : "Copy recipe" }}
        </Button>
        <Button v-if="owned" variant="destructive" size="sm" @click="deleteOpen = true">
          Delete recipe
        </Button>
      </div>
    </div>

    <Dialog v-model:open="deleteOpen">
      <DialogContent class="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle>Delete recipe?</DialogTitle>
          <DialogDescription>This can’t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <Button variant="outline" :disabled="loading" @click="deleteOpen = false">Cancel</Button>
          <Button variant="destructive" :disabled="loading" @click="deleteRecipe">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="aiEditOpen">
      <DialogContent class="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Sparkles class="size-4 text-[#22c55e]" />
            Edit with AI
          </DialogTitle>
          <DialogDescription>
            Describe what to change — ingredients, servings, style, etc.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          v-model="aiInstruction"
          :disabled="aiSaving"
          placeholder="e.g. Make it dairy-free and cut prep time in half"
          class="min-h-28 rounded-xl bg-card"
        />
        <DialogFooter class="gap-2">
          <Button variant="outline" :disabled="aiSaving" @click="aiEditOpen = false">Cancel</Button>
          <Button :disabled="!canAiSave" @click="applyAiEdit">
            <LoaderCircle v-if="aiSaving" class="size-4 animate-spin" />
            {{ aiSaving ? "Updating…" : "Apply edit" }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>

  <div v-else-if="loading" class="px-4 pt-20 text-center text-sm text-muted-foreground">
    Loading…
  </div>
</template>

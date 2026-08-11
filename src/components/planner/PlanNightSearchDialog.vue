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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { mediaUrl, toDateKey } from "@/lib/media";
import { paths } from "@/sitemap";
import { useRecipesStore } from "@/stores/recipes";
import { syncAfterPlanMutation } from "@/stores/sync";
import type { RecipeCard } from "@/types";
import { post, toast } from "@/utils";
import { Search, Sparkles } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";

const props = defineProps<{
  date: Date | null;
}>();
const open = defineModel<boolean>("open", { required: true });

const router = useRouter();
const recipesStore = useRecipesStore();

const searchText = ref("");
const searchResults = ref<RecipeCard[] | null>(null);
const searching = ref(false);
const loadingList = ref(false);
const savingId = ref<number | null>(null);

const dateLabel = computed(() => {
  if (!props.date) return "";
  return props.date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  });
});

const displayList = computed(() => {
  // Preserve API relevance order for search; browse stays newest-first.
  if (searchResults.value) return searchResults.value;
  return recipesStore.sorted;
});

async function runSearch() {
  const q = searchText.value.trim();
  if (!q) {
    searchResults.value = null;
    searching.value = false;
    return;
  }
  searching.value = true;
  try {
    searchResults.value = await recipesStore.search(q);
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t search recipes.");
  }
  searching.value = false;
}

let debounce: ReturnType<typeof setTimeout> | undefined;
watch(searchText, () => {
  clearTimeout(debounce);
  debounce = setTimeout(runSearch, 300);
});

watch(open, async (isOpen) => {
  if (!isOpen) return;
  searchText.value = "";
  searchResults.value = null;
  searching.value = false;
  savingId.value = null;
  if (!recipesStore.loaded) {
    loadingList.value = true;
    try {
      await recipesStore.ensureLoaded();
    } finally {
      loadingList.value = false;
    }
  }
});

async function pickRecipe(recipe: RecipeCard) {
  if (!props.date || savingId.value !== null) return;
  savingId.value = recipe.id;
  try {
    await post("/planned-recipe/", {
      recipe_id: recipe.id,
      planned_for: props.date.toISOString()
    });
    syncAfterPlanMutation();
    open.value = false;
    toast.success(`Planned for ${dateLabel.value}.`);
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t add that recipe to the plan.");
  }
  savingId.value = null;
}

function goCreate() {
  if (!props.date) return;
  open.value = false;
  router.push({
    path: paths.plannerFill,
    query: { days: toDateKey(props.date) }
  });
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[80dvh] max-w-sm overflow-hidden border-border bg-card">
      <DialogHeader>
        <DialogTitle>Plan {{ dateLabel }}</DialogTitle>
        <DialogDescription
          >Search your recipes, or create a new one for this night.</DialogDescription
        >
      </DialogHeader>

      <div class="relative">
        <Search
          class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
        />
        <Input
          v-model="searchText"
          type="search"
          placeholder="Search recipes…"
          class="h-11 rounded-xl border-border bg-secondary/40 pl-10"
        />
      </div>

      <div class="max-h-[42dvh] space-y-2 overflow-y-auto pr-1">
        <template v-if="loadingList || (searching && !displayList.length)">
          <div
            v-for="n in 4"
            :key="n"
            class="flex items-center gap-3 rounded-xl border border-border px-2 py-2"
          >
            <Skeleton class="size-12 rounded-lg" />
            <div class="min-w-0 flex-1 space-y-1.5">
              <Skeleton class="h-3.5 w-2/3" />
              <Skeleton class="h-2.5 w-full" />
            </div>
          </div>
        </template>
        <template v-else>
          <button
            v-for="recipe in displayList"
            :key="recipe.id"
            type="button"
            class="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/40 px-2 py-2 text-left transition-opacity active:opacity-80"
            :disabled="savingId !== null"
            @click="pickRecipe(recipe)"
          >
            <img
              :src="mediaUrl(recipe.cover_image?.url)"
              :alt="recipe.name"
              class="size-12 shrink-0 rounded-lg object-cover"
            />
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold">{{ recipe.name }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{
                recipe.description
              }}</span>
            </span>
          </button>
          <p v-if="!displayList.length" class="py-6 text-center text-sm text-muted-foreground">
            {{
              searchText.trim()
                ? "No recipes matched that search."
                : "No recipes yet — create one below."
            }}
          </p>
        </template>
      </div>

      <DialogFooter class="gap-2 sm:flex-col">
        <Button class="w-full gap-1.5" @click="goCreate">
          <Sparkles class="size-3.5" />
          Create with wizard
        </Button>
        <Button variant="outline" class="w-full" @click="open = false">Cancel</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

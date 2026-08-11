<script setup lang="ts">
import RecipeCard from "@/components/RecipeCard.vue";
import RecipeCardSkeleton from "@/components/RecipeCardSkeleton.vue";
import RecipeSearchFab from "@/components/recipes/RecipeSearchFab.vue";
import ScheduleRecipeDialog from "@/components/recipes/ScheduleRecipeDialog.vue";
import SwipeRow from "@/components/SwipeRow.vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { useRecipesStore } from "@/stores/recipes";
import { useSessionStore } from "@/stores/session";
import { syncAfterRecipeMutation } from "@/stores/sync";
import type { RecipeCard as RecipeCardType } from "@/types";
import { del, toast } from "@/utils";
import { fetchHousehold } from "@/utils/household";
import { CalendarPlus, Trash2 } from "@lucide/vue";
import { computed, onActivated, onMounted, ref, watch } from "vue";

defineOptions({ name: "RecipesView" });

const recipesStore = useRecipesStore();
const sessionStore = useSessionStore();

const searchText = ref("");
const searchResults = ref<RecipeCardType[] | null>(null);
const searching = ref(false);
const householdId = ref<number | null>(null);

const scheduleTarget = ref<RecipeCardType | null>(null);
const scheduleOpen = ref(false);
const deleteTarget = ref<RecipeCardType | null>(null);
const deleteOpen = ref(false);
const deleting = ref(false);

const displayList = computed(() => {
  // Preserve API relevance order for search; library browse stays newest-first.
  if (searchResults.value) return searchResults.value;
  return recipesStore.sorted;
});

const showSkeleton = computed(
  () =>
    (recipesStore.loading && !recipesStore.recipes.length) ||
    (searching.value && !searchResults.value?.length && !!searchText.value.trim())
);

/** Household recipes (and ones you authored) can be deleted; public outsiders can’t. */
function owned(recipe: RecipeCardType) {
  if (householdId.value != null && recipe.household_id === householdId.value) {
    return true;
  }
  return recipe.created_by_id === sessionStore.currentUser?.id;
}

function openSchedule(recipe: RecipeCardType) {
  scheduleTarget.value = recipe;
  scheduleOpen.value = true;
}

function askDelete(recipe: RecipeCardType) {
  deleteTarget.value = recipe;
  deleteOpen.value = true;
}

async function confirmDelete() {
  const target = deleteTarget.value;
  if (!target || deleting.value) return;
  deleting.value = true;
  try {
    await del(`/recipe/${target.id}/`);
    recipesStore.removeLocal(target.id);
    if (searchResults.value) {
      searchResults.value = searchResults.value.filter((r) => r.id !== target.id);
    }
    syncAfterRecipeMutation();
    deleteOpen.value = false;
    toast.success("Recipe deleted.");
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t delete this recipe.");
  }
  deleting.value = false;
}

async function loadMine() {
  try {
    householdId.value = (await fetchHousehold()).id;
  } catch {
    householdId.value = null;
  }
  await recipesStore.ensureLoaded();
}

async function runSearch() {
  const q = searchText.value.trim();
  if (!q) {
    searchResults.value = null;
    searching.value = false;
    await recipesStore.ensureLoaded();
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

onMounted(loadMine);
onActivated(() => {
  if (!searchText.value.trim()) {
    void recipesStore.ensureLoaded();
  }
});
</script>

<template>
  <div class="px-4 pt-4 pb-24">
    <h1 class="sr-only">Recipes</h1>

    <div class="flex flex-col gap-2">
      <template v-if="showSkeleton">
        <RecipeCardSkeleton v-for="n in 4" :key="n" />
      </template>
      <template v-else>
        <SwipeRow
          v-for="recipe in displayList"
          :key="recipe.id"
          class="rounded-xl"
          :action-width="96"
          :can-swipe-left="owned(recipe)"
          @swipe-right="openSchedule(recipe)"
        >
          <template #hint>
            <div class="flex w-28 items-center gap-1.5 bg-[rgba(34,197,94,0.22)] pl-4">
              <CalendarPlus class="size-4 text-[#4ade80]" :stroke-width="2" />
              <span class="text-xs font-semibold text-[#4ade80]">Plan</span>
            </div>
          </template>

          <RecipeCard :recipe="recipe" />

          <template #actions="{ open, close }">
            <button
              type="button"
              class="flex flex-1 items-center justify-center bg-[#dc2626] text-primary-foreground transition-opacity active:opacity-80"
              :tabindex="open ? 0 : -1"
              :aria-label="`Delete ${recipe.name}`"
              @click.stop="
                close();
                askDelete(recipe);
              "
            >
              <Trash2 class="size-5" :stroke-width="2" />
            </button>
          </template>
        </SwipeRow>
        <p
          v-if="displayList.length === 0"
          class="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground"
        >
          {{
            searchText.trim()
              ? "No recipes matched that search."
              : "No recipes yet — add one with +"
          }}
        </p>
        <button
          v-else-if="!searchText.trim() && recipesStore.hasMore"
          type="button"
          class="mt-1 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-[#22c55e] transition-opacity active:opacity-70"
          :disabled="recipesStore.refreshing"
          @click="recipesStore.loadMore()"
        >
          {{ recipesStore.refreshing ? "Loading…" : "Load more" }}
        </button>
      </template>
    </div>

    <RecipeSearchFab v-model="searchText" />

    <ScheduleRecipeDialog v-model:open="scheduleOpen" :recipe="scheduleTarget" />

    <Dialog v-model:open="deleteOpen">
      <DialogContent class="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle>Delete recipe?</DialogTitle>
          <DialogDescription>
            “{{ deleteTarget?.name }}” and its planned meals will be removed. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <Button variant="outline" :disabled="deleting" @click="deleteOpen = false">Cancel</Button>
          <Button variant="destructive" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? "Deleting…" : "Delete" }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

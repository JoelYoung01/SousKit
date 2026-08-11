<script setup lang="ts">
import PlanNightSearchDialog from "@/components/planner/PlanNightSearchDialog.vue";
import RecipeCard from "@/components/RecipeCard.vue";
import SwipeRow from "@/components/SwipeRow.vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, endOfDay, mediaUrl, startOfDay, startOfWeekMonday, toDateKey } from "@/lib/media";
import { paths } from "@/sitemap";
import { usePlannerStore } from "@/stores/planner";
import { useRecipesStore } from "@/stores/recipes";
import { syncAfterPlanMutation } from "@/stores/sync";
import type { PlannedRecipeDetail } from "@/types/PlannedRecipe";
import { del, post, toast } from "@/utils";
import { CalendarDays, Sparkles, Trash2 } from "@lucide/vue";
import { computed, onActivated, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

defineOptions({ name: "PlannerView" });

const route = useRoute();
const router = useRouter();
const plannerStore = usePlannerStore();
const recipesStore = useRecipesStore();

const WEEK_COUNT = 8;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fromQueryOrToday(): Date {
  const q = typeof route.query.date === "string" ? route.query.date : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const [y, m, d] = q.split("-").map(Number);
    return startOfDay(new Date(y, m - 1, d));
  }
  return startOfDay();
}

const selectedDate = ref(fromQueryOrToday());
const showRecipeDialog = ref(false);
const nightSearchOpen = ref(false);
const selectedIds = ref<number[]>([]);
const dialogLoading = ref(false);

const today = startOfDay();
const currentWeekStart = startOfWeekMonday(today);

const weeks = computed(() =>
  Array.from({ length: WEEK_COUNT }, (_, weekIndex) => {
    const weekStart = addDays(currentWeekStart, weekIndex * 7);
    const days = Array.from({ length: 7 }, (_, dayIndex) => addDays(weekStart, dayIndex));
    return { weekIndex, weekStart, days };
  })
);

const rangeStart = computed(() => currentWeekStart);
const rangeEnd = computed(() => endOfDay(addDays(currentWeekStart, WEEK_COUNT * 7 - 1)));

const plannedByDay = computed(() => {
  const map = new Map<string, PlannedRecipeDetail[]>();
  for (const p of plannerStore.plannedRecipes) {
    const key = p.planned_for.slice(0, 10);
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return map;
});

const currentPlannedRecipes = computed(
  () => plannedByDay.value.get(toDateKey(selectedDate.value)) ?? []
);

function gapDaysForWeek(days: Date[]): Date[] {
  return days.filter((d) => (plannedByDay.value.get(toDateKey(d)) ?? []).length === 0);
}

const formattedSelectedDate = computed(() => {
  const date = selectedDate.value;
  const currentYear = new Date().getFullYear();
  const weekday = date.toLocaleString("en-US", { weekday: "long" });
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  const year = date.getFullYear();
  const datePart = year === currentYear ? `${month} ${day}` : `${month} ${day}, ${year}`;
  return `${weekday} · ${datePart}`;
});

const showDaySkeletons = computed(
  () => plannerStore.loading && plannerStore.plannedRecipes.length === 0
);

function weekLabel(weekStart: Date, weekIndex: number): string {
  if (weekIndex === 0) return "This week";
  if (weekIndex === 1) return "Next week";
  const end = addDays(weekStart, 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${weekStart.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

function selectDay(date: Date) {
  const day = startOfDay(date);
  selectedDate.value = day;
  const plans = plannedByDay.value.get(toDateKey(day)) ?? [];
  if (plans.length) {
    const recipeId = plans[0]?.recipe.id;
    if (recipeId != null) {
      void router.push({
        path: paths.recipeDetail(recipeId),
        query: { returnUrl: route.fullPath }
      });
    }
    return;
  }
  // Defer so the row’s pointerup isn’t treated as an outside-dismiss on the
  // dialog that is about to open (Reka Dialog listens for pointer events).
  openNightSearch();
}

function openNightSearch() {
  window.setTimeout(() => {
    nightSearchOpen.value = true;
  }, 0);
}

function openFillGaps(days: Date[]) {
  const keys = days.map(toDateKey);
  router.push({
    path: paths.plannerFill,
    query: keys.length ? { days: keys.join(",") } : {}
  });
}

function openWeekFillGaps(weekDays: Date[]) {
  openFillGaps(gapDaysForWeek(weekDays));
}

/** Week containing the selected day — target for the thumb-reach Plan week FAB. */
const selectedWeekDays = computed(() => {
  const weekStart = startOfWeekMonday(selectedDate.value);
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
});

function openPlanWeekFab() {
  void router.push({
    path: paths.plannerFill,
    query: { days: selectedWeekDays.value.map(toDateKey).join(",") }
  });
}

async function getPlannedRecipes(force = false) {
  try {
    await plannerStore.ensureRange(rangeStart.value, rangeEnd.value, { force });
    selectedIds.value = currentPlannedRecipes.value.map((p) => p.recipe.id);
  } catch (error) {
    console.error("Error fetching planned recipes:", error);
    toast.fromError(error, "Couldn’t load your meal plan.");
  }
}

async function openAssign() {
  selectedIds.value = currentPlannedRecipes.value.map((p) => p.recipe.id);
  showRecipeDialog.value = true;
  if (!recipesStore.loaded) {
    dialogLoading.value = true;
    try {
      await recipesStore.ensureLoaded();
    } finally {
      dialogLoading.value = false;
    }
  }
}

function toggleRecipe(id: number) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

async function assignRecipe() {
  const existing = currentPlannedRecipes.value;
  const existingIds = existing.map((p) => p.recipe.id);
  const added = selectedIds.value.filter((id) => !existingIds.includes(id));
  const removed = existing.filter((pr) => !selectedIds.value.includes(pr.recipe.id));

  try {
    await Promise.all([
      ...added.map((id) =>
        post("/planned-recipe/", {
          recipe_id: id,
          planned_for: selectedDate.value.toISOString()
        })
      ),
      ...removed.map((pr) => del(`/planned-recipe/${pr.id}/`))
    ]);
    syncAfterPlanMutation();
    await getPlannedRecipes(true);
    showRecipeDialog.value = false;
    toast.success("Meal plan updated.");
  } catch (error) {
    console.error("Error assigning recipe:", error);
    toast.fromError(error, "Couldn’t update this day’s plan.");
  }
}

async function removePlanned(planned: PlannedRecipeDetail) {
  try {
    await del(`/planned-recipe/${planned.id}/`);
    syncAfterPlanMutation();
    await getPlannedRecipes(true);
    toast.success("Removed from plan.");
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t remove that meal.");
  }
}

/** Unplan every meal on a night (swipe-left delete on a filled day row). */
async function unplanDay(date: Date) {
  const plans = plannedByDay.value.get(toDateKey(date)) ?? [];
  if (!plans.length) return;
  try {
    await Promise.all(plans.map((pr) => del(`/planned-recipe/${pr.id}/`)));
    syncAfterPlanMutation();
    await getPlannedRecipes(true);
    toast.success("Removed from plan.");
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t remove that meal.");
  }
}

watch(selectedDate, () => {
  selectedIds.value = currentPlannedRecipes.value.map((p) => p.recipe.id);
});

// Wizard (and other pages) invalidate via revision; refetch while this tab is cached.
watch(
  () => plannerStore.revision,
  () => {
    void getPlannedRecipes();
  }
);

onMounted(() => {
  void getPlannedRecipes();
});
onActivated(() => {
  void getPlannedRecipes();
});
</script>

<template>
  <div class="px-4 pt-5 pb-28">
    <h1 class="text-xl font-bold">Planner</h1>

    <div class="mt-4 space-y-5">
      <section v-for="week in weeks" :key="week.weekIndex" class="space-y-2">
        <div
          class="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-border/80 bg-background/95 px-4 py-2 backdrop-blur-sm"
        >
          <div class="min-w-0 flex-1">
            <h2 class="text-sm font-semibold">{{ weekLabel(week.weekStart, week.weekIndex) }}</h2>
            <p class="text-[11px] text-faint">
              {{ week.days.filter((d) => (plannedByDay.get(toDateKey(d)) ?? []).length).length }}
              / 7 planned
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            class="shrink-0 gap-1.5"
            :disabled="!gapDaysForWeek(week.days).length"
            @click="openWeekFillGaps(week.days)"
          >
            <Sparkles class="size-3.5" />
            Fill gaps
          </Button>
        </div>

        <div class="overflow-hidden rounded-xl border border-border bg-card">
          <SwipeRow
            v-for="(day, dayIndex) in week.days"
            :key="toDateKey(day)"
            class="rounded-none"
            :action-width="72"
            :can-swipe-left="(plannedByDay.get(toDateKey(day)) ?? []).length > 0"
            :can-swipe-right="false"
          >
            <button
              type="button"
              class="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors"
              :class="[
                dayIndex === 6 ? 'border-b-0' : '',
                toDateKey(day) === toDateKey(selectedDate)
                  ? 'bg-[rgba(34,197,94,0.1)]'
                  : 'active:bg-secondary/50'
              ]"
              @click="selectDay(day)"
            >
              <div class="w-11 shrink-0 text-center">
                <div
                  class="text-[10px] font-semibold uppercase tracking-wide"
                  :class="toDateKey(day) === toDateKey(today) ? 'text-[#22c55e]' : 'text-faint'"
                >
                  {{ DAY_LABELS[dayIndex] }}
                </div>
                <div
                  class="mt-0.5 text-base font-bold leading-none"
                  :class="
                    toDateKey(day) === toDateKey(today) ? 'text-[#22c55e]' : 'text-foreground'
                  "
                >
                  {{ day.getDate() }}
                </div>
              </div>

              <div class="min-w-0 flex-1">
                <template v-if="showDaySkeletons && week.weekIndex === 0">
                  <div class="flex items-center gap-2">
                    <Skeleton class="size-9 rounded-lg" />
                    <div class="min-w-0 flex-1 space-y-1.5">
                      <Skeleton class="h-3.5 w-2/3" />
                      <Skeleton class="h-2.5 w-1/3" />
                    </div>
                  </div>
                </template>
                <template v-else-if="(plannedByDay.get(toDateKey(day)) ?? []).length">
                  <div class="flex items-center gap-2">
                    <img
                      v-for="planned in (plannedByDay.get(toDateKey(day)) ?? []).slice(0, 1)"
                      :key="planned.id"
                      :src="mediaUrl(planned.recipe.cover_image?.url)"
                      :alt="planned.recipe.name"
                      draggable="false"
                      class="size-9 shrink-0 rounded-lg object-cover"
                    />
                    <div class="min-w-0">
                      <p class="truncate text-sm font-semibold">
                        {{ (plannedByDay.get(toDateKey(day)) ?? [])[0]?.recipe.name }}
                      </p>
                      <p
                        v-if="(plannedByDay.get(toDateKey(day)) ?? []).length > 1"
                        class="truncate text-[11px] text-muted-foreground"
                      >
                        +{{ (plannedByDay.get(toDateKey(day)) ?? []).length - 1 }} more
                      </p>
                      <p v-else class="truncate text-[11px] text-muted-foreground">
                        Dinner planned
                      </p>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div class="flex items-center gap-2">
                    <span class="size-1.5 rounded-full bg-[#3f463f]" />
                    <span class="text-sm text-muted-foreground">Open night</span>
                  </div>
                </template>
              </div>
            </button>

            <template #actions="{ open, close }">
              <button
                type="button"
                class="flex flex-1 items-center justify-center bg-[#dc2626] text-primary-foreground transition-opacity active:opacity-80"
                :tabindex="open ? 0 : -1"
                :aria-label="`Unplan ${toDateKey(day)}`"
                @click.stop="
                  close();
                  unplanDay(day);
                "
              >
                <Trash2 class="size-5" :stroke-width="2" />
              </button>
            </template>
          </SwipeRow>
        </div>
      </section>
    </div>

    <div class="mt-5 rounded-xl border border-border bg-card p-4">
      <h2 class="font-semibold">{{ formattedSelectedDate }}</h2>

      <div v-if="currentPlannedRecipes.length" class="mt-3 space-y-2">
        <div
          v-for="planned in currentPlannedRecipes"
          :key="planned.id"
          class="flex items-start gap-2"
        >
          <RecipeCard :recipe="planned.recipe" size="sm" class="flex-1" />
          <Button
            size="icon-sm"
            variant="ghost"
            class="text-destructive"
            @click="removePlanned(planned)"
          >
            <Trash2 class="size-4" />
          </Button>
        </div>
      </div>
      <p v-else class="mt-3 text-sm text-muted-foreground">No recipes planned for this date</p>

      <div class="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          @click="currentPlannedRecipes.length ? openAssign() : openNightSearch()"
        >
          {{ currentPlannedRecipes.length ? "Change" : "Add recipes" }}
        </Button>
        <Button variant="secondary" class="gap-1.5" @click="openFillGaps([selectedDate])">
          <Sparkles class="size-3.5" />
          Autofill
        </Button>
      </div>
    </div>

    <!--
      Prefer primary planner actions low on the screen for thumb reach —
      don’t bury Plan week in week-section headers. Cleared above the raised
      tab-bar "+" so center taps aren’t swallowed by Add (z-60). Keep
      route-gated (not teleported) so KeepAlive doesn’t leave it on fill.
    -->
    <div
      v-show="route.name === 'planner'"
      class="pointer-events-none fixed bottom-[calc(7.25rem+env(safe-area-inset-bottom))] left-1/2 z-[70] w-full max-w-md -translate-x-1/2 px-4"
    >
      <div class="pointer-events-auto">
        <Button class="w-full gap-1.5" aria-label="Plan week" @click="openPlanWeekFab()">
          <CalendarDays class="size-4" />
          Plan week
        </Button>
      </div>
    </div>

    <PlanNightSearchDialog v-model:open="nightSearchOpen" :date="selectedDate" />

    <Dialog v-model:open="showRecipeDialog">
      <DialogContent class="max-h-[80dvh] max-w-sm overflow-hidden border-border bg-card">
        <DialogHeader>
          <DialogTitle>Select recipes</DialogTitle>
        </DialogHeader>
        <div class="max-h-[50dvh] space-y-2 overflow-y-auto pr-1">
          <template v-if="dialogLoading">
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
              v-for="recipe in recipesStore.sorted"
              :key="recipe.id"
              type="button"
              class="flex w-full items-center gap-3 rounded-xl border px-2 py-2 text-left transition-colors"
              :class="
                selectedIds.includes(recipe.id)
                  ? 'border-[rgba(34,197,94,0.45)] bg-[rgba(34,197,94,0.12)]'
                  : 'border-border bg-secondary/40'
              "
              @click="toggleRecipe(recipe.id)"
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
            <p
              v-if="!recipesStore.sorted.length"
              class="py-6 text-center text-sm text-muted-foreground"
            >
              Add recipes first.
            </p>
          </template>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="showRecipeDialog = false">Cancel</Button>
          <Button :disabled="!selectedIds.length" @click="assignRecipe">Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

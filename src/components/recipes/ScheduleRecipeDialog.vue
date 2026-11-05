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
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildPlanDays,
  formatQuotedList,
  planCommit,
  planWhenLabel,
  plannedSummary,
  replacePrompt,
  type PlanCommit,
  type PlanDay
} from "@/lib/planDay";
import { endOfDay, startOfDay, startOfWeekMonday, addDays } from "@/lib/media";
import { usePlannerStore } from "@/stores/planner";
import { syncAfterPlanMutation } from "@/stores/sync";
import type { PlannedRecipeDetail } from "@/types";
import { del, post, toast } from "@/utils";
import { Check } from "@lucide/vue";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  recipe: { id: number; name: string } | null;
  /**
   * When true, choosing a night that already has a different recipe asks
   * before replacing it. The recipes library keeps the default add behavior.
   */
  replaceExisting?: boolean;
}>();
const open = defineModel<boolean>("open", { required: true });

const plannerStore = usePlannerStore();

const baseDate = ref(startOfDay());
const selectedKey = ref<string | null>(null);
const loadingDays = ref(false);
const saving = ref(false);
const confirming = ref(false);

const days = computed(() =>
  buildPlanDays(baseDate.value, plannerStore.plannedRecipes as PlannedRecipeDetail[])
);

const selected = computed(() => days.value.find((day) => day.key === selectedKey.value) ?? null);

const decision = computed<PlanCommit | null>(() => {
  if (!props.recipe || !selected.value) return null;
  return planCommit(props.recipe.id, selected.value.planned);
});

const description = computed(() => {
  const name = props.recipe?.name ?? "this recipe";
  if (props.replaceExisting) {
    return `Pick a night for “${name}”. A night that already has a meal can be replaced.`;
  }
  const openNight = days.value.some((day) => day.planned.length === 0);
  return openNight && !loadingDays.value
    ? `Pick a night for “${name}” — the next open one is preselected.`
    : `Pick a night for “${name}”.`;
});

const replacingSeveral = computed(
  () => decision.value?.kind === "replace" && decision.value.others.length > 1
);

const confirmMessage = computed(() => {
  if (!props.recipe || !selected.value || decision.value?.kind !== "replace") return "";
  return replacePrompt(
    props.recipe.name,
    selected.value,
    decision.value.others.map((meal) => meal.recipe.name)
  );
});

const commitLabel = computed(() => {
  if (saving.value) return confirming.value ? "Replacing…" : "Planning…";
  if (!props.replaceExisting) return "Add to plan";
  if (decision.value?.kind === "replace") return "Replace";
  if (decision.value?.kind === "already") return "Already planned";
  return "Plan";
});

const canCommit = computed(
  () =>
    !!selected.value &&
    !loadingDays.value &&
    !saving.value &&
    (props.replaceExisting ? decision.value?.kind !== "already" : true)
);

watch(selectedKey, () => {
  confirming.value = false;
});

watch(open, async (isOpen) => {
  if (!isOpen || !props.recipe) return;
  baseDate.value = startOfDay();
  selectedKey.value = null;
  confirming.value = false;
  loadingDays.value = true;
  try {
    // Same window as the planner view so both share the store cache.
    const weekStart = startOfWeekMonday(baseDate.value);
    await plannerStore.ensureRange(weekStart, endOfDay(addDays(weekStart, 55)));
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t load your meal plan.");
  }
  loadingDays.value = false;
  selectedKey.value =
    days.value.find((day) => day.planned.length === 0)?.key ?? days.value[0]?.key ?? null;
});

function onPrimary() {
  if (!canCommit.value) return;
  if (props.replaceExisting && decision.value?.kind === "replace") {
    confirming.value = true;
    return;
  }
  void save(false);
}

async function save(replacing: boolean) {
  const recipe = props.recipe;
  const day = selected.value;
  const choice = decision.value;
  if (!recipe || !day || !choice || saving.value) return;
  if (replacing && choice.kind !== "replace") return;
  saving.value = true;
  try {
    const alreadyThere = day.planned.some((meal) => meal.recipe.id === recipe.id);
    if (!alreadyThere || !replacing) {
      await post("/planned-recipe/", {
        recipe_id: recipe.id,
        planned_for: day.date.toISOString()
      });
    }
    if (replacing && choice.kind === "replace") {
      await Promise.all(choice.others.map((meal) => del(`/planned-recipe/${meal.id}/`)));
      toast.success(
        `Replaced ${formatQuotedList(choice.others.map((meal) => meal.recipe.name))} with “${recipe.name}” for ${planWhenLabel(day)}.`
      );
    } else {
      toast.success(
        `Planned for ${day.label === "Tonight" ? "tonight" : `${day.label}, ${day.dateLabel}`}.`
      );
    }
    syncAfterPlanMutation();
    open.value = false;
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t add this recipe to your plan.");
  }
  saving.value = false;
}

function summary(day: PlanDay) {
  return plannedSummary(day.planned);
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-sm border-border bg-card">
      <DialogHeader>
        <DialogTitle>{{ replaceExisting ? "Plan" : "Add to plan" }}</DialogTitle>
        <DialogDescription>
          {{ confirming ? confirmMessage : description }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="!confirming" class="max-h-[45dvh] overflow-y-auto rounded-xl border border-border">
        <template v-if="loadingDays">
          <div
            v-for="n in 5"
            :key="n"
            class="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
          >
            <div class="min-w-0 flex-1 space-y-1.5">
              <Skeleton class="h-3.5 w-24" />
              <Skeleton class="h-2.5 w-14" />
            </div>
            <Skeleton class="h-3 w-10" />
          </div>
        </template>
        <template v-else>
          <button
            v-for="day in days"
            :key="day.key"
            type="button"
            class="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0"
            :class="day.key === selectedKey ? 'bg-[rgba(34,197,94,0.1)]' : 'active:bg-secondary/50'"
            :aria-pressed="day.key === selectedKey"
            @click="selectedKey = day.key"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold">{{ day.label }}</p>
              <p class="text-[11px] text-faint">{{ day.dateLabel }}</p>
            </div>
            <span v-if="!summary(day)" class="text-[11px] font-semibold text-[#4ade80]">
              Open
            </span>
            <span v-else class="max-w-[45%] truncate text-[11px] text-faint">
              {{ summary(day) }}
            </span>
            <Check
              v-if="day.key === selectedKey"
              class="size-4 shrink-0 text-[#22c55e]"
              :stroke-width="2.5"
            />
          </button>
        </template>
      </div>

      <p v-else-if="replacingSeveral" class="text-sm leading-relaxed text-muted-foreground">
        The night will only have this recipe.
      </p>

      <DialogFooter class="gap-2">
        <template v-if="confirming">
          <Button variant="outline" :disabled="saving" @click="confirming = false">Back</Button>
          <Button :disabled="saving" @click="save(true)">
            {{ saving ? "Replacing…" : "Replace" }}
          </Button>
        </template>
        <template v-else>
          <Button variant="outline" :disabled="saving" @click="open = false">Cancel</Button>
          <Button :disabled="!canCommit" @click="onPrimary">
            {{ commitLabel }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

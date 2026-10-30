<script setup lang="ts">
import SingleNightPrefsFields from "@/components/planner/SingleNightPrefsFields.vue";
import WizardPrefsFields from "@/components/planner/WizardPrefsFields.vue";
import WizardProgressPanel from "@/components/planner/WizardProgressPanel.vue";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useMealPlanWizardPrefs } from "@/composables/useMealPlanWizardPrefs";
import { splitInstructionSteps } from "@/lib/instructions";
import {
  copyPreviousButtonLabel,
  indexMealsByDay,
  lookbackWindow,
  mealCopySummary,
  selectionLookbackWindow,
  type CopiedMeal,
  type MealCopyWindow
} from "@/lib/duplicateMealPlan";
import {
  addDays,
  endOfDay,
  formatPrepTime,
  mediaUrl,
  startOfDay,
  startOfWeekMonday,
  toDateKey
} from "@/lib/media";
import { paths } from "@/sitemap";
import { usePlannerStore } from "@/stores/planner";
import { useRecipesStore } from "@/stores/recipes";
import { syncAfterPlanMutation, syncAfterRecipeMutation } from "@/stores/sync";
import {
  emptyWizardPrefs,
  type MealPlanWizardBuiltRecipe,
  type MealPlanWizardNightCommitItem,
  type MealPlanWizardPrefs,
  type MealPlanWizardProgressEvent,
  type MealPlanWizardSession,
  type MealPlanWizardStep,
  type PlannedRecipeDetail,
  type RecipeCard,
  type RecipeDetail
} from "@/types";
import { get, getErrorMessage, patch, post, postSse, toast } from "@/utils";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2
} from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
const plannerStore = usePlannerStore();
const recipesStore = useRecipesStore();
const { prefs: savedPrefs, save: persistPrefs } = useMealPlanWizardPrefs();

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ASSIGN_DAY_COUNT = 14;

type UiStep =
  | "days"
  | "hub"
  | "prefs"
  | "ideate"
  | "select"
  | "build"
  | "review"
  | "assign"
  | "saving";
type FlowContext = "week-fill" | "single-night" | "standalone-recipe";
type InputMode = "structured" | "simple";

interface DraftNightEntry {
  kind: "generated" | "existing" | "imported";
  title: string;
  description?: string;
  prep_time?: number | null;
  cover_url?: string | null;
  recipeId?: number | null;
  builtRecipe?: MealPlanWizardBuiltRecipe | null;
}

const recipeMode = computed(() => route.query.mode === "recipe");
const today = startOfDay();
const todayKey = computed(() => toDateKey(today));
const thisWeekStart = startOfWeekMonday(today);

function parseDateKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  return startOfDay(new Date(y, m - 1, d));
}

function isDayPast(dayOrKey: Date | string): boolean {
  const key = typeof dayOrKey === "string" ? dayOrKey : toDateKey(dayOrKey);
  return key < todayKey.value;
}

function parseDaysFromQuery(): string[] {
  const raw = typeof route.query.days === "string" ? route.query.days : "";
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => Boolean(parseDateKey(s)));
}

function requiredWeekCountForDays(dayKeys: string[]): number {
  let maxWeeks = 2;
  for (const key of dayKeys) {
    const d = parseDateKey(key);
    if (!d) continue;
    const diffDays = Math.floor(
      (startOfDay(d).getTime() - thisWeekStart.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays >= 0) {
      const needed = Math.floor(diffDays / 7) + 1;
      if (needed > maxWeeks) maxWeeks = needed;
    }
  }
  return maxWeeks;
}

function formatWeekLabel(weekStart: Date): string {
  const nextWeek = addDays(thisWeekStart, 7);
  if (toDateKey(weekStart) === toDateKey(thisWeekStart)) return "This week";
  if (toDateKey(weekStart) === toDateKey(nextWeek)) return "Next week";
  const end = addDays(weekStart, 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${weekStart.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

const weekCount = ref(recipeMode.value ? 2 : requiredWeekCountForDays(parseDaysFromQuery()));

const weeks = computed(() =>
  Array.from({ length: weekCount.value }, (_, weekIndex) => {
    const weekStart = addDays(thisWeekStart, weekIndex * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return {
      weekIndex,
      weekStart,
      label: formatWeekLabel(weekStart),
      days,
      dayKeys: days.map(toDateKey)
    };
  })
);

const uiStep = ref<UiStep>(recipeMode.value ? "prefs" : "days");
const flowContext = ref<FlowContext>(recipeMode.value ? "standalone-recipe" : "week-fill");
const activeNightKey = ref<string | null>(null);
const fillTargetDays = ref<string[]>([]);

const inputMode = ref<InputMode>("simple");
const simplePrompt = ref("");
const localPrefs = ref<MealPlanWizardPrefs>(emptyWizardPrefs());
const singleNightPrefs = ref<MealPlanWizardPrefs>(emptyWizardPrefs());

const selectedDays = ref<string[]>([]);
/** Persistent night draft recipes across wizard steps — never wiped on Back. */
const draftByDay = ref<Record<string, DraftNightEntry>>({});
const expandedHubDays = ref<string[]>([]);

const session = ref<MealPlanWizardSession | null>(null);
const selectedIdeaIds = ref<string[]>([]);
const liveEvents = ref<MealPlanWizardProgressEvent[]>([]);
const running = ref(false);
const error = ref("");
const refineText = ref("");
const busy = ref(false);
const loadingDays = ref(true);
const copyOpen = ref(false);
const copyLoading = ref(false);
const copyWindow = ref<MealCopyWindow | null>(null);
const copyMeals = ref<Record<string, CopiedMeal>>({});
const copyWeekLabel = ref<string | null>(null);
let copyRequestId = 0;
const plannedTitles = ref<Record<string, string>>({});
const expandedDays = ref<string[]>([]);
const regenIdeaIds = ref<string[]>([]);

// ---- Night action menu, Find existing dialog, Import dialog ----
const menuNightKey = ref<string | null>(null);
const menuDialogOpen = computed({
  get: () => menuNightKey.value !== null,
  set: (v: boolean) => {
    if (!v) menuNightKey.value = null;
  }
});

const findDialogOpen = ref(false);
const findSearchText = ref("");
const findSearchResults = ref<RecipeCard[] | null>(null);
const findSearching = ref(false);
const findLoadingList = ref(false);

const importDialogOpen = ref(false);
const importMethod = ref<"link" | "photo">("link");
const importUrl = ref("");
const importing = ref(false);
const importError = ref("");

// ---- Standalone recipeMode assign step ----
const assignDayKey = ref<string | null>(null);
const assignPlansByKey = ref<Record<string, string>>({});
const loadingAssignDays = ref(false);
const lastAssignDayOption = ref<string | null>(null);
const savingTargetCount = ref(0);

// ---- Infinite scroll sentinel ----
const sentinelRef = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
let abortController: AbortController | null = null;

const canContinueDays = computed(() => selectedDays.value.length > 0);
const selectionCopyWindow = computed(() =>
  selectionLookbackWindow(selectedDays.value.filter((key) => !isDayPast(key)))
);
const copyPreviousLabel = computed(() =>
  selectionCopyWindow.value
    ? copyPreviousButtonLabel(selectionCopyWindow.value.spanDays)
    : "Copy previous"
);
const plannedSelectedCount = computed(
  () => selectedDays.value.filter((d) => Boolean(draftByDay.value[d])).length
);
const openSelectedDays = computed(() => selectedDays.value.filter((d) => !draftByDay.value[d]));

const isSingleNightFlow = computed(
  () => flowContext.value === "single-night" || flowContext.value === "standalone-recipe"
);

const activeGenerationDays = computed(() => {
  if (flowContext.value === "standalone-recipe") return [todayKey.value];
  if (flowContext.value === "single-night") {
    return activeNightKey.value ? [activeNightKey.value] : [todayKey.value];
  }
  return fillTargetDays.value.length ? fillTargetDays.value : selectedDays.value;
});

const selectCount = computed(
  () => session.value?.select_count ?? activeGenerationDays.value.length
);
const selectionFull = computed(
  () => selectedIdeaIds.value.length >= selectCount.value && selectCount.value > 0
);
const canContinueSelect = computed(
  () => selectedIdeaIds.value.length === selectCount.value && selectCount.value > 0
);
const canStartIdeate = computed(() =>
  inputMode.value === "simple" ? Boolean(simplePrompt.value.trim()) && !busy.value : !busy.value
);
const canRefineRecipes = computed(
  () => Boolean(refineText.value.trim()) && regenIdeaIds.value.length > 0 && !busy.value
);

function dayLabel(key: string) {
  const date = parseDateKey(key);
  if (!date) return key;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function dayFullLabel(key: string | null) {
  if (!key) return "";
  const date = parseDateKey(key);
  if (!date) return key;
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

const headerEyebrow = computed(() => {
  if (recipeMode.value) return "Create";
  if (uiStep.value === "days" || uiStep.value === "hub" || uiStep.value === "saving")
    return "Meal plan";
  if (flowContext.value === "single-night" && activeNightKey.value) {
    return dayLabel(activeNightKey.value);
  }
  return "Fill plan";
});

const headerTitle = computed(() => {
  switch (uiStep.value) {
    case "days":
      return "Which nights?";
    case "hub":
      return "Plan your nights";
    case "prefs":
      if (isSingleNightFlow.value) {
        return inputMode.value === "simple" ? "Describe your dinner" : "Dinner details";
      }
      return inputMode.value === "simple" ? "Describe your dinners" : "Set the vibe";
    case "ideate":
      return "Cooking up ideas";
    case "select":
      return isSingleNightFlow.value ? "Pick 1 of 3 options" : "Pick your dinners";
    case "build":
      return isSingleNightFlow.value ? "Building your recipe" : "Building recipes";
    case "review":
      return "Review your recipe";
    case "assign":
      return "Add to a night?";
    case "saving":
      return recipeMode.value ? "Saving your recipe" : "Saving your meal plan";
    default:
      return "Plan meals";
  }
});

// ---- Step 1: Days helpers ----
function isDaySelected(key: string) {
  return selectedDays.value.includes(key);
}

function toggleDay(key: string) {
  if (isDayPast(key)) return;
  if (isDaySelected(key)) {
    selectedDays.value = selectedDays.value.filter((d) => d !== key);
  } else {
    selectedDays.value = [...new Set([...selectedDays.value, key])].sort();
  }
}

function selectWeekOpen(dayKeys: string[]) {
  const open = dayKeys.filter((k) => !plannedTitles.value[k] && !isDayPast(k));
  selectedDays.value = [...new Set([...selectedDays.value, ...open])].sort();
}

function clearWeekDays(dayKeys: string[]) {
  const removeSet = new Set(dayKeys);
  selectedDays.value = selectedDays.value.filter((k) => !removeSet.has(k));
}

function futureDayKeys(dayKeys: string[]) {
  return dayKeys.filter((key) => !isDayPast(key));
}

function formatKeyRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startDate = parseDateKey(start);
  const endDate = parseDateKey(end);
  if (!startDate || !endDate) return start;
  if (start === end) return startDate.toLocaleDateString(undefined, opts);
  return `${startDate.toLocaleDateString(undefined, opts)} – ${endDate.toLocaleDateString(undefined, opts)}`;
}

const copySummary = computed(() =>
  copyWindow.value ? mealCopySummary(copyWindow.value, copyWeekLabel.value) : ""
);
const copyRangeLabel = computed(() => {
  const window = copyWindow.value;
  if (!window) return "";
  return `${formatKeyRange(window.sourceStart, window.sourceEnd)} → ${formatKeyRange(window.targetStart, window.targetEnd)}`;
});
const copyableCount = computed(
  () => copyWindow.value?.pairs.filter((pair) => copyMeals.value[pair.sourceKey]).length ?? 0
);
const copyDialogOpen = computed({
  get: () => copyOpen.value,
  set: (open: boolean) => {
    if (!open) closeMealCopy();
    else copyOpen.value = true;
  }
});

async function openMealCopy(targetKeys: string[], spanDays: number, weekLabel: string | null) {
  const window = lookbackWindow(targetKeys, spanDays);
  if (!window) return;
  const requestId = ++copyRequestId;
  copyWeekLabel.value = weekLabel;
  copyWindow.value = window;
  copyMeals.value = {};
  copyOpen.value = true;
  copyLoading.value = true;
  error.value = "";
  try {
    const start = parseDateKey(window.sourceStart);
    const end = parseDateKey(window.sourceEnd);
    if (!start || !end) return;
    const plans = await post<PlannedRecipeDetail[]>("/planned-recipe/time-frame/", {
      start: start.toISOString(),
      end: endOfDay(end).toISOString()
    });
    if (requestId !== copyRequestId) return;
    copyMeals.value = indexMealsByDay(
      plans.map((plan) => ({
        id: plan.id,
        plannedFor: plan.planned_for,
        recipeId: plan.recipe.id,
        title: plan.recipe.name,
        description: plan.recipe.description,
        prepTime: plan.recipe.prep_time ?? null,
        coverUrl: plan.recipe.cover_image?.url ?? null
      }))
    );
  } catch (e) {
    if (requestId !== copyRequestId) return;
    copyOpen.value = false;
    toast.fromError(e, "Couldn’t load previous dinners.");
  } finally {
    if (requestId === copyRequestId) copyLoading.value = false;
  }
}

function openWeekCopy(dayKeys: string[], label: string) {
  void openMealCopy(futureDayKeys(dayKeys), 7, label);
}

function openSelectionCopy() {
  const window = selectionCopyWindow.value;
  if (!window) return;
  void openMealCopy(
    window.pairs.map((pair) => pair.targetKey),
    window.spanDays,
    null
  );
}

function closeMealCopy() {
  copyRequestId += 1;
  copyOpen.value = false;
  copyLoading.value = false;
}

function replacingTitle(targetKey: string): string | null {
  return draftByDay.value[targetKey]?.title || plannedTitles.value[targetKey] || null;
}

function applyMealCopy() {
  const window = copyWindow.value;
  if (!window || copyLoading.value) return;
  const nextDrafts = { ...draftByDay.value };
  const copiedTargets: string[] = [];
  for (const pair of window.pairs) {
    const meal = copyMeals.value[pair.sourceKey];
    if (!meal) continue;
    nextDrafts[pair.targetKey] = {
      kind: "existing",
      title: meal.title,
      description: meal.description,
      prep_time: meal.prepTime ?? null,
      cover_url: meal.coverUrl ?? null,
      recipeId: meal.recipeId,
      builtRecipe: null
    };
    copiedTargets.push(pair.targetKey);
  }
  if (!copiedTargets.length) return;
  draftByDay.value = nextDrafts;
  selectedDays.value = [
    ...new Set([...selectedDays.value, ...window.pairs.map((pair) => pair.targetKey)])
  ].sort();
  const count = copiedTargets.length;
  closeMealCopy();
  uiStep.value = "hub";
  toast.success(
    count === 1
      ? "Copied 1 dinner. Review it, then save."
      : `Copied ${count} dinners. Review them, then save.`
  );
}

function loadAnotherWeek() {
  weekCount.value += 1;
}

async function loadPlannedForLoadedWeeks() {
  const firstDay = weeks.value[0]?.days[0];
  const lastWeek = weeks.value[weeks.value.length - 1];
  const lastDay = lastWeek?.days[6];
  if (!firstDay || !lastDay) return;
  try {
    await plannerStore.ensureRange(firstDay, endOfDay(lastDay));
    const titles: Record<string, string> = {};
    for (const plan of plannerStore.plansInRange(firstDay, endOfDay(lastDay))) {
      const key = plan.planned_for.slice(0, 10);
      if (!titles[key]) titles[key] = plan.recipe.name;
    }
    plannedTitles.value = { ...plannedTitles.value, ...titles };
  } catch (er) {
    console.error(er);
    toast.fromError(er, "Couldn’t load existing dinners.");
  }
}

watch(weekCount, () => {
  if (!recipeMode.value) {
    void loadPlannedForLoadedWeeks();
  }
});

// ---- Hub actions ----
function openNightMenu(dayKey: string) {
  menuNightKey.value = dayKey;
}

function toggleHubExpand(dayKey: string) {
  if (expandedHubDays.value.includes(dayKey)) {
    expandedHubDays.value = expandedHubDays.value.filter((k) => k !== dayKey);
  } else {
    expandedHubDays.value = [...expandedHubDays.value, dayKey];
  }
}

function startSingleNightGenerate(dayKey: string) {
  menuNightKey.value = null;
  error.value = "";
  activeNightKey.value = dayKey;
  flowContext.value = "single-night";
  inputMode.value = "simple";
  simplePrompt.value = "";
  singleNightPrefs.value = {
    ...emptyWizardPrefs(),
    dietary_restrictions: savedPrefs.value.dietary_restrictions,
    servings: savedPrefs.value.servings
  };
  session.value = null;
  selectedIdeaIds.value = [];
  uiStep.value = "prefs";
}

async function startFindForNight(dayKey: string) {
  menuNightKey.value = null;
  activeNightKey.value = dayKey;
  findSearchText.value = "";
  findSearchResults.value = null;
  findDialogOpen.value = true;
  if (!recipesStore.loaded) {
    findLoadingList.value = true;
    try {
      await recipesStore.ensureLoaded();
    } finally {
      findLoadingList.value = false;
    }
  }
}

const findDisplayList = computed(() => {
  if (findSearchResults.value) return findSearchResults.value;
  return recipesStore.sorted;
});

let findDebounce: ReturnType<typeof setTimeout> | undefined;
watch(findSearchText, () => {
  clearTimeout(findDebounce);
  findDebounce = setTimeout(async () => {
    const q = findSearchText.value.trim();
    if (!q) {
      findSearchResults.value = null;
      findSearching.value = false;
      return;
    }
    findSearching.value = true;
    try {
      findSearchResults.value = await recipesStore.search(q);
    } catch (er) {
      toast.fromError(er, "Couldn’t search recipes.");
    } finally {
      findSearching.value = false;
    }
  }, 280);
});

function pickExistingRecipeForNight(recipe: RecipeCard) {
  const dayKey = activeNightKey.value;
  if (!dayKey) return;
  draftByDay.value = {
    ...draftByDay.value,
    [dayKey]: {
      kind: "existing",
      title: recipe.name,
      description: recipe.description,
      prep_time: recipe.prep_time ?? null,
      cover_url: recipe.cover_image?.url ?? null,
      recipeId: recipe.id,
      builtRecipe: null
    }
  };
  findDialogOpen.value = false;
  toast.success(`Added to ${dayLabel(dayKey)}.`);
}

function startImportForNight(dayKey: string) {
  menuNightKey.value = null;
  activeNightKey.value = dayKey;
  importMethod.value = "link";
  importUrl.value = "";
  importError.value = "";
  importDialogOpen.value = true;
}

async function handleImportForNight() {
  const dayKey = activeNightKey.value;
  if (!dayKey || !importUrl.value.trim() || importing.value) return;
  importing.value = true;
  importError.value = "";
  try {
    const recipe = await post<RecipeDetail>("/recipe/import-from-url/", {
      url: importUrl.value.trim()
    });
    syncAfterRecipeMutation();
    draftByDay.value = {
      ...draftByDay.value,
      [dayKey]: {
        kind: "imported",
        title: recipe.name,
        description: recipe.description,
        prep_time: recipe.prep_time ?? null,
        cover_url: recipe.cover_image?.url ?? null,
        recipeId: recipe.id,
        builtRecipe: null
      }
    };
    importDialogOpen.value = false;
    toast.success(`Imported “${recipe.name}” for ${dayLabel(dayKey)}.`);
  } catch (er) {
    importError.value = getErrorMessage(er, "Couldn’t import that recipe.");
    toast.fromError(er, "Couldn’t import that recipe.");
  } finally {
    importing.value = false;
  }
}

function removeNightDraft(dayKey: string) {
  menuNightKey.value = null;
  const next = { ...draftByDay.value };
  delete next[dayKey];
  draftByDay.value = next;
}

function startFillWeekFlow() {
  error.value = "";
  const targets = openSelectedDays.value.length ? openSelectedDays.value : selectedDays.value;
  fillTargetDays.value = [...targets];
  activeNightKey.value = null;
  flowContext.value = "week-fill";
  inputMode.value = "structured";
  simplePrompt.value = "";
  session.value = null;
  selectedIdeaIds.value = [];
  uiStep.value = "prefs";
}

// ---- LLM Session Plumbing ----
function effectivePrefsForSession(): MealPlanWizardPrefs {
  if (inputMode.value === "simple") {
    const text = simplePrompt.value.trim();
    return {
      ...emptyWizardPrefs(),
      goals: text,
      extra_notes: text
    };
  }
  if (isSingleNightFlow.value) {
    return singleNightPrefs.value;
  }
  return localPrefs.value;
}

async function syncGenerationSession(): Promise<MealPlanWizardSession> {
  const days = activeGenerationDays.value;
  const prefsToUse = effectivePrefsForSession();
  if (!isSingleNightFlow.value && inputMode.value === "structured") {
    persistPrefs(localPrefs.value);
  }
  if (!session.value) {
    session.value = await post<MealPlanWizardSession>("/meal-plan-wizard/sessions/", {
      days,
      prefs: prefsToUse
    });
  } else {
    const [daysRes, prefsRes] = await Promise.all([
      patch<MealPlanWizardSession>(`/meal-plan-wizard/sessions/${session.value.id}/days/`, {
        days
      }),
      patch<MealPlanWizardSession>(
        `/meal-plan-wizard/sessions/${session.value.id}/prefs/`,
        prefsToUse
      )
    ]);
    session.value = prefsRes ?? daysRes;
  }
  selectedIdeaIds.value = session.value.selected_idea_ids;
  return session.value;
}

async function refreshSession() {
  if (!session.value) return;
  session.value = await get<MealPlanWizardSession>(
    `/meal-plan-wizard/sessions/${session.value.id}/`
  );
}

async function runIdeate(refinement?: string) {
  if (inputMode.value === "simple" && !simplePrompt.value.trim() && !refinement) {
    error.value = "Describe what you’d like to cook.";
    return;
  }
  error.value = "";
  busy.value = true;
  running.value = true;
  liveEvents.value = [];
  uiStep.value = "ideate";
  try {
    const s = await syncGenerationSession();
    abortController?.abort();
    abortController = new AbortController();
    await postSse<MealPlanWizardProgressEvent>(
      `/meal-plan-wizard/sessions/${s.id}/ideate/`,
      { refinement: refinement || null },
      (event) => {
        if (event.status === "done") return;
        liveEvents.value = [...liveEvents.value, event];
        if (event.status === "error") error.value = event.message;
      },
      abortController.signal
    );
    await refreshSession();
    selectedIdeaIds.value = session.value?.selected_idea_ids ?? [];
    refineText.value = "";
    if (!error.value) uiStep.value = "select";
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      error.value = getErrorMessage(e, "Ideation failed");
      toast.fromError(e, "Ideation failed");
    }
  } finally {
    running.value = false;
    busy.value = false;
  }
}

function applyBuiltToHubAndReturn() {
  const current = session.value;
  if (!current) return;
  const days = current.days ?? [];
  const recipes = current.built_recipes ?? [];
  const next = { ...draftByDay.value };
  days.forEach((day, idx) => {
    const built = recipes[idx];
    if (built) {
      next[day] = {
        kind: "generated",
        title: built.title || "Untitled dinner",
        description: built.description,
        prep_time: built.prep_time ?? null,
        cover_url: null,
        recipeId: built.created_recipe_id ?? built.existing_recipe_id ?? null,
        builtRecipe: built
      };
    }
  });
  draftByDay.value = next;
  uiStep.value = "hub";
  if (flowContext.value === "single-night" && activeNightKey.value) {
    toast.success(`Recipe ready for ${dayLabel(activeNightKey.value)}.`);
  } else {
    toast.success(`Filled ${recipes.length} night${recipes.length === 1 ? "" : "s"}.`);
  }
}

function isIdeaSelected(id: string) {
  return selectedIdeaIds.value.includes(id);
}

function isIdeaDisabled(id: string) {
  if (selectCount.value === 1) return false;
  return selectionFull.value && !isIdeaSelected(id);
}

function toggleIdea(id: string) {
  if (selectCount.value === 1) {
    selectedIdeaIds.value = isIdeaSelected(id) ? [] : [id];
    return;
  }
  if (isIdeaDisabled(id)) return;
  if (isIdeaSelected(id)) {
    selectedIdeaIds.value = selectedIdeaIds.value.filter((x) => x !== id);
    return;
  }
  if (selectedIdeaIds.value.length >= selectCount.value) return;
  selectedIdeaIds.value = [...selectedIdeaIds.value, id];
}

async function confirmSelectionAndBuild(refinement?: string) {
  const current = session.value;
  if (!current || !canContinueSelect.value) return;
  error.value = "";
  busy.value = true;
  try {
    const prefsToUse = effectivePrefsForSession();
    if (!isSingleNightFlow.value && inputMode.value === "structured") {
      persistPrefs(localPrefs.value);
    }
    const afterPrefs = await patch<MealPlanWizardSession>(
      `/meal-plan-wizard/sessions/${current.id}/prefs/`,
      prefsToUse
    );
    session.value = afterPrefs;
    if (!afterPrefs.ideas.length) {
      await runIdeate();
      return;
    }
    session.value = await post<MealPlanWizardSession>(
      `/meal-plan-wizard/sessions/${afterPrefs.id}/select/`,
      { idea_ids: selectedIdeaIds.value }
    );
    await runBuild(refinement);
  } catch (e) {
    error.value = getErrorMessage(e, "Could not continue");
    toast.fromError(e, "Could not continue");
    busy.value = false;
  }
}

async function runBuild(refinement?: string, ideaIds?: string[]) {
  if (!session.value) return;
  error.value = "";
  busy.value = true;
  running.value = true;
  liveEvents.value = [];
  uiStep.value = "build";
  try {
    abortController?.abort();
    abortController = new AbortController();
    await postSse<MealPlanWizardProgressEvent>(
      `/meal-plan-wizard/sessions/${session.value.id}/build/`,
      {
        refinement: refinement || null,
        idea_ids: ideaIds?.length ? ideaIds : null
      },
      (event) => {
        if (event.status === "done") return;
        liveEvents.value = [...liveEvents.value, event];
        if (event.status === "error") error.value = event.message;
      },
      abortController.signal
    );
    await refreshSession();
    refineText.value = "";
    regenIdeaIds.value = [];
    if (!error.value) {
      if (flowContext.value === "standalone-recipe") {
        uiStep.value = "review";
      } else {
        applyBuiltToHubAndReturn();
      }
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      error.value = getErrorMessage(e, "Build failed");
      toast.fromError(e, "Build failed");
    }
  } finally {
    running.value = false;
    busy.value = false;
  }
}

async function applyRefinement() {
  const text = refineText.value.trim();
  if (!text) return;
  if (uiStep.value === "select" || uiStep.value === "ideate") {
    await runIdeate(text);
  } else if (uiStep.value === "review" || uiStep.value === "build") {
    if (!regenIdeaIds.value.length) {
      error.value = "Mark at least one dinner to regenerate.";
      return;
    }
    await runBuild(text, [...regenIdeaIds.value]);
  }
}

async function rewindTo(step: UiStep) {
  if (!session.value) {
    uiStep.value = step;
    return;
  }
  if (step === "prefs") {
    if (session.value.ideas.length || session.value.built_recipes.length) {
      try {
        session.value = await post(`/meal-plan-wizard/sessions/${session.value.id}/rewind/`, {
          to_step: "prefs"
        });
      } catch (e) {
        toast.fromError(e, "Couldn’t reset the wizard step.");
      }
    }
    selectedIdeaIds.value = [];
    liveEvents.value = [];
    uiStep.value = "prefs";
    return;
  }
  try {
    const rewound = await post<MealPlanWizardSession>(
      `/meal-plan-wizard/sessions/${session.value.id}/rewind/`,
      { to_step: step as MealPlanWizardStep }
    );
    session.value = rewound;
    selectedIdeaIds.value = rewound.selected_idea_ids;
    uiStep.value = step;
  } catch (e) {
    error.value = getErrorMessage(e, "Could not go back");
    toast.fromError(e, "Could not go back");
  }
}

async function leaveWizard() {
  await router.push(recipeMode.value ? paths.recipes : paths.planner);
}

async function goBack() {
  error.value = "";
  if (uiStep.value === "days" || (recipeMode.value && uiStep.value === "prefs")) {
    await leaveWizard();
    return;
  }
  if (uiStep.value === "hub") {
    // Non-destructive Back to night selection: keep draftByDay intact!
    uiStep.value = "days";
    return;
  }
  if (uiStep.value === "prefs") {
    uiStep.value = "hub";
    return;
  }
  if (uiStep.value === "assign") {
    uiStep.value = "review";
    return;
  }
  abortController?.abort();
  running.value = false;
  busy.value = false;
  if (uiStep.value === "saving") {
    uiStep.value = recipeMode.value ? "assign" : "hub";
    return;
  }
  if (uiStep.value === "ideate" || uiStep.value === "select") {
    await rewindTo("prefs");
    return;
  }
  if (uiStep.value === "build" || uiStep.value === "review") {
    await rewindTo("select");
    return;
  }
}

async function saveHubPlan() {
  error.value = "";
  const sorted = [...new Set(selectedDays.value)].sort();
  const nights: MealPlanWizardNightCommitItem[] = [];
  for (const day of sorted) {
    const entry = draftByDay.value[day];
    if (!entry) continue;
    if (entry.recipeId != null) {
      nights.push({ day, recipe_id: entry.recipeId });
    } else if (entry.builtRecipe) {
      nights.push({ day, built_recipe: entry.builtRecipe });
    }
  }
  if (!nights.length) {
    await router.push(paths.planner);
    return;
  }
  savingTargetCount.value = nights.length;
  liveEvents.value = [];
  busy.value = true;
  running.value = true;
  uiStep.value = "saving";
  let sawError = false;
  try {
    abortController?.abort();
    abortController = new AbortController();
    await postSse<MealPlanWizardProgressEvent>(
      "/meal-plan-wizard/commit-plan-stream/",
      { nights },
      (event) => {
        if (event.status === "done") return;
        liveEvents.value = [...liveEvents.value, event];
        if (event.status === "error") {
          sawError = true;
          error.value = event.message;
        }
      },
      abortController.signal
    );
    if (sawError || error.value) return;
    const hadGenerated = nights.some((n) => Boolean(n.built_recipe));
    syncAfterPlanMutation({ recipesChanged: hadGenerated });
    toast.success("Meal plan saved.");
    await router.push(paths.planner);
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      error.value = getErrorMessage(e, "Could not save plan");
      toast.fromError(e, "Could not save plan");
    }
  } finally {
    running.value = false;
    busy.value = false;
  }
}

// ---- Standalone recipeMode review & assign ----
const planRows = computed(() => {
  const days = session.value?.days ?? [];
  const recipes = session.value?.built_recipes ?? [];
  return days.map((day, i) => ({
    day,
    recipe: recipes[i] ?? null
  }));
});

const assignDays = computed(() =>
  Array.from({ length: ASSIGN_DAY_COUNT }, (_, i) => {
    const date = addDays(today, i);
    const key = toDateKey(date);
    return {
      date,
      key,
      label:
        i === 0
          ? "Tonight"
          : i === 1
            ? "Tomorrow"
            : date.toLocaleDateString(undefined, { weekday: "long" }),
      dateLabel: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      plannedTitle: assignPlansByKey.value[key] ?? null
    };
  })
);

const recipeTitle = computed(() => session.value?.built_recipes[0]?.title?.trim() || "your recipe");

function toggleExpanded(day: string) {
  if (expandedDays.value.includes(day)) {
    expandedDays.value = expandedDays.value.filter((d) => d !== day);
  } else {
    expandedDays.value = [...expandedDays.value, day];
  }
}

function isExpanded(day: string) {
  return expandedDays.value.includes(day);
}

function toggleRegen(ideaId: string) {
  if (regenIdeaIds.value.includes(ideaId)) {
    regenIdeaIds.value = regenIdeaIds.value.filter((id) => id !== ideaId);
  } else {
    regenIdeaIds.value = [...regenIdeaIds.value, ideaId];
  }
}

function isMarkedForRegen(ideaId: string) {
  return regenIdeaIds.value.includes(ideaId);
}

function formatIngredient(ing: MealPlanWizardBuiltRecipe["ingredients"][number]): string {
  return [
    ing.amount != null ? String(ing.amount) : "",
    ing.units || "",
    ing.name,
    ing.details ? `(${ing.details})` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

async function openAssignStep() {
  error.value = "";
  assignDayKey.value = null;
  loadingAssignDays.value = true;
  uiStep.value = "assign";
  try {
    const rangeEnd = endOfDay(addDays(today, ASSIGN_DAY_COUNT - 1));
    await plannerStore.ensureRange(today, rangeEnd);
    const titles: Record<string, string> = {};
    for (const p of plannerStore.plansInRange(today, rangeEnd)) {
      const key = p.planned_for.slice(0, 10);
      if (!titles[key]) titles[key] = p.recipe.name;
    }
    assignPlansByKey.value = titles;
    assignDayKey.value =
      Array.from({ length: ASSIGN_DAY_COUNT }, (_, i) => toDateKey(addDays(today, i))).find(
        (key) => !titles[key]
      ) ?? null;
  } catch (e) {
    toast.fromError(e, "Couldn’t load your meal plan.");
  } finally {
    loadingAssignDays.value = false;
  }
}

async function commitStandaloneRecipe(opts?: { assignDay?: string | null }) {
  if (!session.value) return;
  const dayKey = opts?.assignDay ?? null;
  lastAssignDayOption.value = dayKey;
  savingTargetCount.value = 1;
  error.value = "";
  liveEvents.value = [];
  busy.value = true;
  running.value = true;
  uiStep.value = "saving";
  let sawError = false;
  try {
    abortController?.abort();
    abortController = new AbortController();
    await postSse<MealPlanWizardProgressEvent>(
      `/meal-plan-wizard/sessions/${session.value.id}/commit-stream/`,
      { plan: false },
      (event) => {
        if (event.status === "done") return;
        liveEvents.value = [...liveEvents.value, event];
        if (event.status === "error") {
          sawError = true;
          error.value = event.message;
        }
      },
      abortController.signal
    );
    if (sawError || error.value) return;
    await refreshSession();
    const built = session.value?.built_recipes[0];
    const recipeId = built?.created_recipe_id ?? built?.existing_recipe_id ?? null;
    if (dayKey && recipeId != null) {
      const date = parseDateKey(dayKey);
      if (date) {
        liveEvents.value = [
          ...liveEvents.value,
          {
            stage: "commit",
            status: "running",
            message: `Scheduling for ${dayLabel(dayKey)}…`,
            progress: 0.96
          }
        ];
        await post("/planned-recipe/", {
          recipe_id: recipeId,
          planned_for: date.toISOString()
        });
        syncAfterPlanMutation({ recipesChanged: true });
        toast.success("Recipe saved and added to your plan.");
        await router.push(paths.recipeDetail(recipeId));
        return;
      }
    }
    syncAfterRecipeMutation();
    toast.success("Recipe saved.");
    if (recipeId != null) {
      await router.push(paths.recipeDetail(recipeId));
    } else {
      await router.push(paths.recipes);
    }
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      error.value = getErrorMessage(e, "Could not save recipe");
      toast.fromError(e, "Could not save recipe");
    }
  } finally {
    running.value = false;
    busy.value = false;
  }
}

onMounted(async () => {
  localPrefs.value = { ...savedPrefs.value };
  singleNightPrefs.value = {
    ...emptyWizardPrefs(),
    dietary_restrictions: savedPrefs.value.dietary_restrictions,
    servings: savedPrefs.value.servings
  };

  if (recipeMode.value) {
    selectedDays.value = [todayKey.value];
    loadingDays.value = false;
    uiStep.value = "prefs";
    return;
  }

  loadingDays.value = true;
  await loadPlannedForLoadedWeeks();
  loadingDays.value = false;

  const fromQuery = parseDaysFromQuery();
  if (fromQuery.length) {
    const valid = [...new Set(fromQuery.filter((k) => !isDayPast(k)))].sort();
    const openValid = valid.filter((k) => !plannedTitles.value[k]);
    selectedDays.value = openValid.length ? openValid : valid;
  } else {
    const firstWeekKeys = weeks.value[0]?.dayKeys ?? [];
    selectedDays.value = firstWeekKeys.filter((k) => !plannedTitles.value[k] && !isDayPast(k));
  }

  if (typeof IntersectionObserver !== "undefined") {
    // Load one week per time the sentinel scrolls into view. A tall window
    // keeps the sentinel intersecting, and re-firing on that would append
    // every future week in one pass.
    let seenHidden = false;
    let wasVisible = false;
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (!visible) seenHidden = true;
        if (visible && seenHidden && !wasVisible && uiStep.value === "days") {
          weekCount.value += 1;
        }
        wasVisible = visible;
      },
      { rootMargin: "120px" }
    );
    if (sentinelRef.value) observer.observe(sentinelRef.value);
  }
});

watch(sentinelRef, (el) => {
  if (observer && el) observer.observe(el);
});

onUnmounted(() => {
  abortController?.abort();
  observer?.disconnect();
});
</script>

<template>
  <div class="px-4 pt-4 pb-48">
    <!-- Header -->
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-opacity active:opacity-70"
        aria-label="Back"
        @click="goBack"
      >
        <ArrowLeft class="size-4" />
      </button>
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-bold uppercase tracking-[0.08em] text-success-soft">
          {{ headerEyebrow }}
        </p>
        <h1 class="truncate text-lg font-bold">{{ headerTitle }}</h1>
      </div>
      <span
        v-if="session?.stubbed === true && uiStep !== 'days' && uiStep !== 'hub'"
        class="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold text-faint"
      >
        Stub LLM
      </span>
    </div>

    <p
      v-if="error"
      class="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {{ error }}
    </p>

    <!-- STEP 1: SCROLLABLE MULTI-WEEK NIGHT SELECTION -->
    <section v-if="uiStep === 'days'" class="mt-4 space-y-5">
      <p class="text-sm text-muted-foreground">
        <template v-if="loadingDays">Checking what’s already planned…</template>
        <template v-else>
          Tap nights to include in your meal plan. Copy last week onto a week, or copy the previous
          stretch onto the nights you’ve selected.
        </template>
      </p>

      <div v-for="week in weeks" :key="week.weekIndex" class="space-y-2">
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm font-semibold text-foreground">{{ week.label }}</p>
          <div class="flex shrink-0 gap-3">
            <button
              type="button"
              class="text-[12px] font-semibold text-[#22c55e] transition-opacity active:opacity-70"
              @click="selectWeekOpen(week.dayKeys)"
            >
              Open
            </button>
            <button
              type="button"
              class="text-[12px] font-semibold text-faint transition-opacity active:opacity-70"
              @click="clearWeekDays(week.dayKeys)"
            >
              None
            </button>
          </div>
        </div>

        <button
          v-if="futureDayKeys(week.dayKeys).length"
          type="button"
          class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.08)] py-2 text-[12px] font-semibold text-[#86efac] transition-opacity active:opacity-70"
          :data-testid="`wizard-copy-week-${week.weekIndex}`"
          @click="openWeekCopy(week.dayKeys, week.label)"
        >
          <Copy class="size-3.5" />
          Copy last week
        </button>

        <div class="overflow-hidden rounded-xl border border-border bg-card">
          <button
            v-for="(day, i) in week.days"
            :key="week.dayKeys[i]"
            type="button"
            class="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors last:border-b-0"
            :class="
              isDayPast(day)
                ? 'cursor-not-allowed bg-transparent opacity-40'
                : isDaySelected(week.dayKeys[i]!)
                  ? 'bg-[rgba(34,197,94,0.14)]'
                  : 'bg-transparent opacity-70'
            "
            :disabled="isDayPast(day)"
            :aria-disabled="isDayPast(day) || undefined"
            :aria-pressed="isDaySelected(week.dayKeys[i]!)"
            @click="toggleDay(week.dayKeys[i]!)"
          >
            <span
              class="flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors"
              :class="
                isDaySelected(week.dayKeys[i]!)
                  ? 'border-[#16a34a] bg-[#16a34a] text-primary-foreground'
                  : 'border-border bg-secondary/40'
              "
            >
              <Check v-if="isDaySelected(week.dayKeys[i]!)" class="size-3.5" />
            </span>
            <div class="min-w-0 flex-1">
              <p
                class="text-sm font-semibold"
                :class="
                  isDaySelected(week.dayKeys[i]!) ? 'text-foreground' : 'text-muted-foreground'
                "
              >
                {{ DAY_LABELS[i] }} · {{ day.getDate() }}
                <span
                  v-if="week.dayKeys[i] === todayKey"
                  class="ml-1 text-[11px] font-bold uppercase tracking-wide text-[#22c55e]"
                >
                  Today
                </span>
              </p>
              <p v-if="isDayPast(day)" class="mt-0.5 truncate text-[12px] text-faint">Past</p>
              <p
                v-else-if="draftByDay[week.dayKeys[i]!]"
                class="mt-0.5 truncate text-[12px] font-medium text-[#86efac]"
              >
                {{ draftByDay[week.dayKeys[i]!]!.title }}
              </p>
              <p
                v-else-if="plannedTitles[week.dayKeys[i]!]"
                class="mt-0.5 truncate text-[12px]"
                :class="
                  isDaySelected(week.dayKeys[i]!) ? 'text-muted-foreground' : 'text-[#86efac]/80'
                "
              >
                {{
                  isDaySelected(week.dayKeys[i]!)
                    ? `Replace · ${plannedTitles[week.dayKeys[i]!]}`
                    : plannedTitles[week.dayKeys[i]!]
                }}
              </p>
              <p v-else class="mt-0.5 text-[11px] text-muted-foreground">
                {{ isDaySelected(week.dayKeys[i]!) ? "Open night" : "Skipping" }}
              </p>
            </div>
            <span
              class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              :class="
                isDayPast(day)
                  ? 'bg-secondary text-faint'
                  : draftByDay[week.dayKeys[i]!]
                    ? 'border border-[rgba(34,197,94,0.4)] bg-[rgba(34,197,94,0.18)] text-[#86efac]'
                    : isDaySelected(week.dayKeys[i]!)
                      ? 'bg-[rgba(34,197,94,0.18)] text-[#86efac]'
                      : plannedTitles[week.dayKeys[i]!]
                        ? 'bg-secondary text-muted-foreground'
                        : 'bg-secondary text-faint'
              "
            >
              {{
                isDayPast(day)
                  ? "Past"
                  : draftByDay[week.dayKeys[i]!]
                    ? "Planned"
                    : isDaySelected(week.dayKeys[i]!)
                      ? plannedTitles[week.dayKeys[i]!]
                        ? "Replan"
                        : "Plan"
                      : plannedTitles[week.dayKeys[i]!]
                        ? "Kept"
                        : "Skip"
              }}
            </span>
          </button>
        </div>
      </div>

      <div ref="sentinelRef" class="pt-1">
        <button
          type="button"
          class="w-full rounded-xl border border-dashed border-border py-3 text-center text-xs font-semibold text-muted-foreground transition-opacity active:opacity-70"
          @click="loadAnotherWeek"
        >
          + Show next week ({{ weeks.length }} weeks loaded)
        </button>
      </div>
    </section>

    <!-- STEP 2: NIGHT-BY-NIGHT PLANNING HUB -->
    <section v-else-if="uiStep === 'hub'" class="mt-4 space-y-4">
      <div
        class="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5"
      >
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">
            {{ plannedSelectedCount }} of {{ selectedDays.length }} night{{
              selectedDays.length === 1 ? "" : "s"
            }}
            planned
          </p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Plan each night below, or auto-fill the rest at once.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          class="shrink-0 gap-1.5"
          :disabled="busy"
          @click="startFillWeekFlow"
        >
          <Sparkles class="size-3.5" />
          Fill plan
        </Button>
      </div>

      <Button
        variant="outline"
        class="w-full gap-1.5"
        data-testid="wizard-copy-previous"
        :disabled="busy || !selectionCopyWindow"
        @click="openSelectionCopy"
      >
        <Copy class="size-4" />
        {{ copyPreviousLabel }}
      </Button>

      <div class="space-y-2.5">
        <div
          v-for="dayKey in selectedDays"
          :key="dayKey"
          class="overflow-hidden rounded-xl border bg-card"
          :class="draftByDay[dayKey] ? 'border-[rgba(34,197,94,0.35)]' : 'border-border'"
        >
          <div class="flex items-center gap-3 px-3.5 py-3">
            <button
              type="button"
              class="min-w-0 flex-1 text-left"
              @click="draftByDay[dayKey] ? toggleHubExpand(dayKey) : openNightMenu(dayKey)"
            >
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-bold uppercase tracking-wide text-faint">
                  {{ dayLabel(dayKey) }}
                </span>
                <span
                  v-if="dayKey === todayKey"
                  class="text-[10px] font-bold uppercase text-[#22c55e]"
                >
                  Today
                </span>
                <span
                  v-if="draftByDay[dayKey]"
                  class="rounded-full bg-[rgba(34,197,94,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[#86efac]"
                >
                  {{
                    draftByDay[dayKey]!.kind === "generated"
                      ? "Generated"
                      : draftByDay[dayKey]!.kind === "imported"
                        ? "Imported"
                        : "Saved"
                  }}
                </span>
              </div>

              <div v-if="draftByDay[dayKey]" class="mt-1 flex items-center gap-2.5">
                <img
                  v-if="draftByDay[dayKey]!.cover_url"
                  :src="mediaUrl(draftByDay[dayKey]!.cover_url!)"
                  :alt="draftByDay[dayKey]!.title"
                  class="size-9 shrink-0 rounded-lg object-cover"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold">
                    {{ draftByDay[dayKey]!.title }}
                  </p>
                  <p
                    v-if="draftByDay[dayKey]!.prep_time"
                    class="mt-0.5 text-[11px] text-muted-foreground"
                  >
                    {{ formatPrepTime(draftByDay[dayKey]!.prep_time!) }}
                  </p>
                </div>
              </div>
              <p v-else class="mt-1 text-sm text-muted-foreground">
                {{
                  plannedTitles[dayKey] ? `Replacing: ${plannedTitles[dayKey]}` : "Not planned yet"
                }}
              </p>
            </button>

            <Button
              size="sm"
              :variant="draftByDay[dayKey] ? 'outline' : 'default'"
              @click="openNightMenu(dayKey)"
            >
              {{ draftByDay[dayKey] ? "Change" : "Plan" }}
            </Button>
          </div>

          <div
            v-if="draftByDay[dayKey] && expandedHubDays.includes(dayKey)"
            class="space-y-3 border-t border-border px-3.5 pb-3.5 pt-2.5"
          >
            <p v-if="draftByDay[dayKey]!.description" class="text-sm text-muted-foreground">
              {{ draftByDay[dayKey]!.description }}
            </p>

            <div v-if="draftByDay[dayKey]!.builtRecipe?.ingredients?.length">
              <p class="text-xs font-semibold uppercase tracking-wide text-faint">Ingredients</p>
              <ul class="mt-1.5 space-y-1">
                <li
                  v-for="(ing, idx) in draftByDay[dayKey]!.builtRecipe!.ingredients"
                  :key="`${dayKey}-ing-${idx}`"
                  class="text-sm text-foreground/90"
                >
                  {{ formatIngredient(ing) }}
                </li>
              </ul>
            </div>

            <div v-if="draftByDay[dayKey]!.builtRecipe?.instructions">
              <p class="text-xs font-semibold uppercase tracking-wide text-faint">Instructions</p>
              <div class="mt-1.5 space-y-2 text-sm leading-relaxed text-foreground/90">
                <p
                  v-for="(step, idx) in splitInstructionSteps(
                    draftByDay[dayKey]!.builtRecipe!.instructions
                  )"
                  :key="idx"
                >
                  {{ step }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- PREFS -->
    <section v-else-if="uiStep === 'prefs'" class="mt-5">
      <div class="mb-4 flex rounded-xl border border-border bg-secondary/40 p-1">
        <button
          type="button"
          class="flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
          :class="
            inputMode === 'simple' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
          "
          @click="inputMode = 'simple'"
        >
          Describe it
        </button>
        <button
          type="button"
          class="flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
          :class="
            inputMode === 'structured'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground'
          "
          @click="inputMode = 'structured'"
        >
          {{ isSingleNightFlow ? "Dinner form" : "Week form" }}
        </button>
      </div>

      <template v-if="inputMode === 'simple'">
        <p class="mb-3 text-sm text-muted-foreground">
          {{
            isSingleNightFlow
              ? "Describe what you want to cook — ingredients on hand, style, dietary needs, etc. We’ll generate 3 options."
              : `Describe dinners for your ${activeGenerationDays.length} night${activeGenerationDays.length === 1 ? "" : "s"}.`
          }}
        </p>
        <Textarea
          v-model="simplePrompt"
          :disabled="busy"
          placeholder="e.g. Spicy Thai basil chicken with jasmine rice, under 30 minutes and dairy-free"
          class="min-h-32 rounded-xl bg-card"
        />
      </template>
      <template v-else-if="isSingleNightFlow">
        <p class="mb-4 text-sm text-muted-foreground">
          Tell us what sounds good for this dinner and we’ll propose 3 options.
        </p>
        <SingleNightPrefsFields v-model="singleNightPrefs" />
      </template>
      <template v-else>
        <p class="mb-4 text-sm text-muted-foreground">
          Everything here is optional. We’ll remember goals and diet for next time.
        </p>
        <WizardPrefsFields v-model="localPrefs" />
      </template>

      <div class="mt-5 grid grid-cols-2 gap-2">
        <Button variant="outline" :disabled="busy" @click="goBack">Back</Button>
        <Button class="gap-1.5" :disabled="!canStartIdeate" @click="runIdeate()">
          <Sparkles class="size-3.5" />
          {{ isSingleNightFlow ? "Get 3 options" : "Generate ideas" }}
        </Button>
      </div>
    </section>

    <!-- IDEATE / BUILD / SAVING progress -->
    <section
      v-else-if="uiStep === 'ideate' || uiStep === 'build' || uiStep === 'saving'"
      class="mt-5 space-y-4"
    >
      <WizardProgressPanel
        :events="liveEvents"
        :running="running"
        :title="
          uiStep === 'ideate'
            ? 'Ideating dinners'
            : uiStep === 'saving'
              ? recipeMode
                ? 'Saving your recipe'
                : 'Saving your meal plan'
              : 'Writing full recipes'
        "
        :subtitle="
          uiStep === 'ideate'
            ? isSingleNightFlow
              ? 'Generating 3 dinner options'
              : `Aiming for ${session?.idea_target_count ?? activeGenerationDays.length + 5} options`
            : uiStep === 'saving'
              ? recipeMode
                ? `Saving “${recipeTitle}” and cover photo`
                : `Persisting ${savingTargetCount} planned night${savingTargetCount === 1 ? '' : 's'} to your calendar`
              : isSingleNightFlow
                ? 'Writing your chosen recipe'
                : `Building ${selectCount} recipes from your picks`
        "
      />
      <div v-if="!running && error" class="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          @click="
            uiStep === 'saving' ? (uiStep = recipeMode ? 'assign' : 'hub') : rewindTo('prefs')
          "
        >
          {{ uiStep === "saving" ? "Back" : "Edit input" }}
        </Button>
        <Button
          @click="
            uiStep === 'ideate'
              ? runIdeate()
              : uiStep === 'saving'
                ? recipeMode
                  ? commitStandaloneRecipe({ assignDay: lastAssignDayOption })
                  : saveHubPlan()
                : runBuild()
          "
        >
          Retry
        </Button>
      </div>
      <div v-else class="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
        <LoaderCircle class="size-4 animate-spin" />
        {{
          uiStep === "saving"
            ? "Saving recipes, cover photos, and calendar slots…"
            : "Hang tight — the pipeline is moving…"
        }}
      </div>
    </section>

    <!-- SELECT -->
    <section v-else-if="uiStep === 'select'" class="mt-5 space-y-4">
      <div class="flex items-end justify-between gap-2">
        <p class="text-sm text-muted-foreground">
          <template v-if="selectCount === 1">
            Pick 1 of the 3 options below to generate the full recipe.
          </template>
          <template v-else-if="selectionFull">
            All set — deselect one if you want to swap.
          </template>
          <template v-else>
            Choose <span class="font-semibold text-foreground">{{ selectCount }}</span> of
            {{ session?.ideas.length ?? 0 }} ideas
          </template>
        </p>
        <p
          class="text-xs tabular-nums"
          :class="selectionFull ? 'font-semibold text-[#86efac]' : 'text-faint'"
        >
          {{ selectedIdeaIds.length }} / {{ selectCount }}
        </p>
      </div>

      <div class="space-y-2">
        <button
          v-for="idea in session?.ideas ?? []"
          :key="idea.id"
          type="button"
          class="flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors"
          :class="
            isIdeaSelected(idea.id)
              ? 'border-[rgba(34,197,94,0.45)] bg-[rgba(34,197,94,0.12)]'
              : isIdeaDisabled(idea.id)
                ? 'cursor-not-allowed border-border/60 bg-card/40 opacity-40'
                : 'border-border bg-card'
          "
          :disabled="isIdeaDisabled(idea.id)"
          :aria-disabled="isIdeaDisabled(idea.id)"
          @click="toggleIdea(idea.id)"
        >
          <span
            class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border"
            :class="
              isIdeaSelected(idea.id)
                ? 'border-[#16a34a] bg-[#16a34a] text-primary-foreground'
                : 'border-border'
            "
          >
            <Check v-if="isIdeaSelected(idea.id)" class="size-3.5" />
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-semibold leading-snug">{{ idea.title }}</span>
          </span>
        </button>
      </div>

      <details v-if="!isSingleNightFlow" class="rounded-xl border border-border bg-card px-3 py-2">
        <summary class="cursor-pointer text-sm font-semibold">Adjust goals / diet</summary>
        <div class="mt-3 pb-2">
          <WizardPrefsFields v-model="localPrefs" />
        </div>
      </details>

      <div class="rounded-xl border border-border bg-card p-3">
        <p class="text-sm font-semibold">Refine options</p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          Tweaks re-run ideation with prior context — not from scratch.
        </p>
        <Textarea
          v-model="refineText"
          class="mt-2 min-h-16"
          placeholder="More vegetarian options, less pasta, something spicier…"
        />
        <Button
          variant="secondary"
          size="sm"
          class="mt-2 gap-1.5"
          :disabled="busy || !refineText.trim()"
          @click="applyRefinement"
        >
          <RefreshCw class="size-3.5" />
          Re-run with feedback
        </Button>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <Button variant="outline" :disabled="busy" @click="rewindTo('prefs')">Back</Button>
        <Button :disabled="!canContinueSelect || busy" @click="confirmSelectionAndBuild()">
          {{ isSingleNightFlow ? "Generate recipe" : "Build recipes" }}
        </Button>
      </div>
    </section>

    <!-- REVIEW (standalone recipeMode only) -->
    <section v-else-if="uiStep === 'review'" class="mt-5 space-y-4">
      <p class="text-sm text-muted-foreground">
        Here’s your recipe. Expand for the full write-up, or mark it to regenerate.
      </p>

      <div class="space-y-2">
        <div
          v-for="row in planRows"
          :key="row.day"
          class="overflow-hidden rounded-xl border border-border bg-card"
          :class="
            row.recipe && isMarkedForRegen(row.recipe.idea_id) ? 'border-[rgba(34,197,94,0.4)]' : ''
          "
        >
          <button
            type="button"
            class="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors active:bg-secondary/40"
            @click="toggleExpanded(row.day)"
          >
            <ChevronDown
              class="mt-0.5 size-4 shrink-0 text-faint transition-transform"
              :class="isExpanded(row.day) ? 'rotate-0' : '-rotate-90'"
            />
            <div class="min-w-0 flex-1">
              <p class="text-[11px] font-semibold uppercase tracking-wide text-faint">New recipe</p>
              <p class="mt-0.5 text-sm font-semibold leading-snug">
                {{ row.recipe?.title || "Untitled dinner" }}
              </p>
              <p v-if="row.recipe?.prep_time" class="mt-0.5 text-[11px] text-muted-foreground">
                {{ formatPrepTime(row.recipe.prep_time) }}
              </p>
            </div>
            <label
              v-if="row.recipe"
              class="mt-0.5 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] font-semibold"
              :class="
                isMarkedForRegen(row.recipe.idea_id)
                  ? 'border-[rgba(34,197,94,0.45)] bg-[rgba(34,197,94,0.12)] text-[#86efac]'
                  : 'text-faint'
              "
              @click.stop
            >
              <input
                type="checkbox"
                class="size-3.5 accent-[#16a34a]"
                :checked="isMarkedForRegen(row.recipe.idea_id)"
                @change="toggleRegen(row.recipe.idea_id)"
              />
              Regen
            </label>
          </button>

          <div
            v-if="row.recipe && isExpanded(row.day)"
            class="space-y-3 border-t border-border px-3 pb-3 pt-2"
          >
            <p v-if="row.recipe.description" class="text-sm text-muted-foreground">
              {{ row.recipe.description }}
            </p>

            <div v-if="row.recipe.ingredients?.length">
              <p class="text-xs font-semibold uppercase tracking-wide text-faint">Ingredients</p>
              <ul class="mt-1.5 space-y-1">
                <li
                  v-for="(ing, idx) in row.recipe.ingredients"
                  :key="`${row.recipe.idea_id}-ing-${idx}`"
                  class="text-sm text-foreground/90"
                >
                  {{ formatIngredient(ing) }}
                </li>
              </ul>
            </div>

            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-faint">Instructions</p>
              <div class="mt-1.5 space-y-2.5 text-sm leading-relaxed text-foreground/90">
                <p v-for="(step, idx) in splitInstructionSteps(row.recipe.instructions)" :key="idx">
                  {{ step }}
                </p>
              </div>
            </div>

            <p v-if="row.recipe.notes" class="text-xs text-muted-foreground">
              Notes: {{ row.recipe.notes }}
            </p>
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-border bg-card p-3">
        <p class="text-sm font-semibold">Refine recipe</p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          Mark the recipe above, then describe any tweaks.
        </p>
        <Textarea
          v-model="refineText"
          class="mt-2 min-h-16"
          placeholder="Make it spicier, cut cook time, swap tofu for chicken…"
        />
        <Button
          variant="secondary"
          size="sm"
          class="mt-2 gap-1.5"
          :disabled="!canRefineRecipes"
          @click="applyRefinement"
        >
          <RefreshCw class="size-3.5" />
          Regenerate
        </Button>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <Button variant="outline" :disabled="busy" @click="rewindTo('select')">Back</Button>
        <Button :disabled="busy" @click="openAssignStep()">
          {{ busy ? "Saving…" : "Continue" }}
        </Button>
      </div>
    </section>

    <!-- ASSIGN (standalone recipeMode only) -->
    <section v-else-if="uiStep === 'assign'" class="mt-5 space-y-4">
      <p class="text-sm text-muted-foreground">
        “{{ recipeTitle }}” is ready. Put it on a night if you want — or skip and keep it in your
        recipes.
      </p>

      <div class="max-h-[45dvh] overflow-y-auto rounded-xl border border-border">
        <template v-if="loadingAssignDays">
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
            v-for="day in assignDays"
            :key="day.key"
            type="button"
            class="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0"
            :class="
              day.key === assignDayKey ? 'bg-[rgba(34,197,94,0.1)]' : 'active:bg-secondary/50'
            "
            @click="assignDayKey = day.key"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold">{{ day.label }}</p>
              <p class="text-[11px] text-faint">{{ day.dateLabel }}</p>
            </div>
            <span v-if="!day.plannedTitle" class="text-[11px] font-semibold text-[#4ade80]">
              Open
            </span>
            <span v-else class="max-w-[45%] truncate text-[11px] text-faint">
              {{ day.plannedTitle }}
            </span>
            <Check
              v-if="day.key === assignDayKey"
              class="size-4 shrink-0 text-[#22c55e]"
              :stroke-width="2.5"
            />
          </button>
        </template>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          :disabled="busy"
          @click="commitStandaloneRecipe({ assignDay: null })"
        >
          {{ busy ? "Saving…" : "Skip" }}
        </Button>
        <Button
          :disabled="busy || loadingAssignDays || !assignDayKey"
          @click="commitStandaloneRecipe({ assignDay: assignDayKey })"
        >
          {{ busy ? "Saving…" : "Save & plan" }}
        </Button>
      </div>
    </section>

    <!-- FLOATING FOOTER FOR STEP 1 (DAYS) & STEP 2 (HUB) -->
    <div
      v-if="uiStep === 'days'"
      class="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-border/80 bg-background/95 px-4 py-3 backdrop-blur-sm"
    >
      <div class="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          class="w-full gap-1.5"
          data-testid="wizard-copy-previous"
          :disabled="!selectionCopyWindow || busy || loadingDays"
          @click="openSelectionCopy"
        >
          <Copy class="size-4" />
          {{ copyPreviousLabel }}
        </Button>
        <Button
          type="button"
          class="w-full"
          data-testid="wizard-continue-days"
          :disabled="!canContinueDays || busy || loadingDays"
          @click="uiStep = 'hub'"
        >
          Continue with {{ selectedDays.length }} night{{ selectedDays.length === 1 ? "" : "s" }}
        </Button>
      </div>
    </div>

    <div
      v-else-if="uiStep === 'hub'"
      class="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 grid w-full max-w-md -translate-x-1/2 grid-cols-2 gap-2 border-t border-border/80 bg-background/95 px-4 py-3 backdrop-blur-sm"
    >
      <Button variant="outline" :disabled="busy" @click="uiStep = 'days'">Back</Button>
      <Button :disabled="busy" @click="saveHubPlan">
        {{ busy ? "Saving…" : "Save" }}
      </Button>
    </div>

    <!-- COPY PREVIOUS MEALS -->
    <Dialog v-model:open="copyDialogOpen">
      <DialogContent class="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle>Copy previous meals</DialogTitle>
          <DialogDescription>{{ copySummary }}</DialogDescription>
        </DialogHeader>
        <p v-if="copyRangeLabel" class="-mt-2 text-xs text-faint">{{ copyRangeLabel }}</p>

        <div class="max-h-[50dvh] space-y-2 overflow-y-auto pr-1">
          <template v-if="copyLoading">
            <div
              v-for="n in 4"
              :key="n"
              class="space-y-1.5 rounded-xl border border-border px-3 py-2.5"
            >
              <Skeleton class="h-3 w-32" />
              <Skeleton class="h-4 w-40" />
            </div>
          </template>
          <template v-else-if="copyWindow">
            <div
              v-for="pair in copyWindow.pairs"
              :key="pair.targetKey"
              class="rounded-xl border border-border bg-secondary/40 px-3 py-2.5"
            >
              <p class="text-[11px] font-bold uppercase tracking-wide text-faint">
                {{ dayLabel(pair.targetKey) }}
                <span class="font-semibold tracking-normal text-muted-foreground normal-case">
                  ← {{ dayLabel(pair.sourceKey) }}
                </span>
              </p>
              <p v-if="copyMeals[pair.sourceKey]" class="mt-0.5 text-sm font-semibold">
                {{ copyMeals[pair.sourceKey]!.title }}
              </p>
              <p v-else class="mt-0.5 text-sm text-muted-foreground">Nothing planned</p>
              <p
                v-if="copyMeals[pair.sourceKey]?.extraTitles.length"
                class="mt-0.5 text-[11px] text-faint"
              >
                Also on that night: {{ copyMeals[pair.sourceKey]!.extraTitles.join(", ") }}. This
                copy keeps the first dinner.
              </p>
              <p
                v-if="copyMeals[pair.sourceKey] && replacingTitle(pair.targetKey)"
                class="mt-0.5 text-[11px] text-muted-foreground"
              >
                {{
                  replacingTitle(pair.targetKey) === copyMeals[pair.sourceKey]!.title
                    ? "Already on this night"
                    : `Replaces ${replacingTitle(pair.targetKey)}`
                }}
              </p>
            </div>
          </template>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="closeMealCopy">Cancel</Button>
          <Button
            data-testid="wizard-copy-confirm"
            :disabled="copyLoading || copyableCount === 0"
            @click="applyMealCopy"
          >
            {{
              copyableCount === 0
                ? "Nothing to copy"
                : copyableCount === 1
                  ? "Copy 1 dinner"
                  : `Copy ${copyableCount} dinners`
            }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- NIGHT ACTION MENU DIALOG -->
    <Dialog v-model:open="menuDialogOpen">
      <DialogContent class="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle>{{ dayFullLabel(menuNightKey) }}</DialogTitle>
          <DialogDescription>Choose how you’d like to plan this night.</DialogDescription>
        </DialogHeader>

        <div class="space-y-1.5">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-xl border border-[rgba(34,197,94,0.4)] bg-[rgba(34,197,94,0.1)] px-3 py-3 text-left transition-opacity active:opacity-80"
            @click="menuNightKey && startSingleNightGenerate(menuNightKey)"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#16a34a]">
              <Sparkles class="size-4 text-primary-foreground" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold">Generate a recipe</span>
              <span class="block text-xs text-muted-foreground">
                Describe a craving or use the dinner form
              </span>
            </span>
            <ChevronRight class="size-4 text-faint" />
          </button>

          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-3 text-left transition-opacity active:opacity-80"
            @click="menuNightKey && startFindForNight(menuNightKey)"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <Search class="size-4 text-foreground" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold">Choose from existing</span>
              <span class="block text-xs text-muted-foreground">
                Search and pick from your saved recipe book
              </span>
            </span>
            <ChevronRight class="size-4 text-faint" />
          </button>

          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-3 text-left transition-opacity active:opacity-80"
            @click="menuNightKey && startImportForNight(menuNightKey)"
          >
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <Plus class="size-4 text-foreground" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold">Import new</span>
              <span class="block text-xs text-muted-foreground">
                Paste a recipe link to save and attach
              </span>
            </span>
            <ChevronRight class="size-4 text-faint" />
          </button>

          <button
            v-if="menuNightKey && draftByDay[menuNightKey]"
            type="button"
            class="mt-1 flex w-full items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-left text-destructive transition-opacity active:opacity-80"
            @click="removeNightDraft(menuNightKey)"
          >
            <Trash2 class="size-4" />
            <span class="text-sm font-semibold">Remove from this night</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- CHOOSE FROM EXISTING DIALOG -->
    <Dialog v-model:open="findDialogOpen">
      <DialogContent class="max-h-[80dvh] max-w-sm overflow-hidden border-border bg-card">
        <DialogHeader>
          <DialogTitle>Choose recipe for {{ dayLabel(activeNightKey ?? "") }}</DialogTitle>
          <DialogDescription>Tap any saved recipe to attach it to this night.</DialogDescription>
        </DialogHeader>

        <div class="relative">
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
          />
          <Input
            v-model="findSearchText"
            type="search"
            placeholder="Search recipes…"
            class="h-11 rounded-xl border-border bg-secondary/40 pl-10"
          />
        </div>

        <div class="max-h-[42dvh] space-y-2 overflow-y-auto pr-1">
          <template v-if="findLoadingList || (findSearching && !findDisplayList.length)">
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
              v-for="recipe in findDisplayList"
              :key="recipe.id"
              type="button"
              class="flex w-full items-center gap-3 rounded-xl border border-border bg-secondary/40 px-2 py-2 text-left transition-opacity active:opacity-80"
              @click="pickExistingRecipeForNight(recipe)"
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
              v-if="!findDisplayList.length"
              class="py-6 text-center text-sm text-muted-foreground"
            >
              {{
                findSearchText.trim() ? "No recipes matched that search." : "No saved recipes yet."
              }}
            </p>
          </template>
        </div>

        <DialogFooter>
          <Button variant="outline" class="w-full" @click="findDialogOpen = false">Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- IMPORT RECIPE DIALOG -->
    <Dialog v-model:open="importDialogOpen">
      <DialogContent class="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle>Import for {{ dayLabel(activeNightKey ?? "") }}</DialogTitle>
          <DialogDescription>
            Paste a recipe link to save it to your book and attach it to this night.
          </DialogDescription>
        </DialogHeader>

        <div class="flex gap-2">
          <Button
            type="button"
            size="sm"
            :variant="importMethod === 'link' ? 'default' : 'outline'"
            @click="importMethod = 'link'"
          >
            <Link2 class="size-4" />
            Link
          </Button>
          <Button
            type="button"
            size="sm"
            :variant="importMethod === 'photo' ? 'default' : 'outline'"
            @click="importMethod = 'photo'"
          >
            <Camera class="size-4" />
            Photo
          </Button>
        </div>

        <template v-if="importMethod === 'link'">
          <div>
            <Label for="wizard-import-url" class="text-muted-foreground">Recipe URL</Label>
            <Input
              id="wizard-import-url"
              v-model="importUrl"
              type="url"
              inputmode="url"
              placeholder="https://…"
              class="mt-2 h-11 rounded-xl border-border bg-secondary"
              :disabled="importing"
              @keydown.enter.prevent="handleImportForNight"
            />
            <p v-if="importError" class="mt-2 text-xs text-destructive">{{ importError }}</p>
          </div>
          <DialogFooter class="gap-2">
            <Button variant="outline" :disabled="importing" @click="importDialogOpen = false">
              Cancel
            </Button>
            <Button :disabled="!importUrl.trim() || importing" @click="handleImportForNight">
              <LoaderCircle v-if="importing" class="size-4 animate-spin" />
              {{ importing ? "Importing…" : "Import & attach" }}
            </Button>
          </DialogFooter>
        </template>
        <template v-else>
          <div
            class="flex min-h-[140px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/50 px-4 text-center"
          >
            <Camera class="mb-2 size-7 text-[#22c55e]" />
            <p class="text-sm font-semibold">Scan a photo</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Cookbook pages and handwritten cards — not available yet.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" class="w-full" @click="importDialogOpen = false">
              Close
            </Button>
          </DialogFooter>
        </template>
      </DialogContent>
    </Dialog>
  </div>
</template>

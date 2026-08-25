import { getErrorMessage } from "@/api/errors";
import { createPlan, fetchPlansBetween } from "@/api/planner";
import {
  commitWizard,
  createWizardSession,
  fetchWizardSession,
  rewindWizard,
  selectWizardIdeas,
  streamBuild,
  streamFreeformBuild,
  streamIdeate,
  updateWizardDays,
  updateWizardPrefs
} from "@/api/wizard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { WizardPrefsFields } from "@/components/wizard/WizardPrefsFields";
import { WizardProgressPanel } from "@/components/wizard/WizardProgressPanel";
import { syncAfterPlanMutation, syncAfterRecipeMutation } from "@/hooks/sync";
import { useWizardPrefs } from "@/hooks/use-wizard-prefs";
import { colors } from "@/lib/colors";
import {
  addDays,
  endOfDay,
  formatPrepTime,
  parseDateKey,
  startOfDay,
  startOfWeekMonday,
  toDateKey
} from "@/lib/dates";
import { tapHaptic } from "@/lib/haptics";
import { splitInstructionSteps } from "@/lib/instructions";
import { toast } from "@/stores/toast";
import {
  emptyWizardPrefs,
  type MealPlanWizardBuiltRecipe,
  type MealPlanWizardProgressEvent,
  type MealPlanWizardSession,
  type MealPlanWizardStep
} from "@/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, ChevronDown, ChevronRight, RefreshCw, Sparkles } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAwareScrollView } from "@/components/ui/keyboard";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Days offered when optionally assigning a created recipe to a night. */
const ASSIGN_DAY_COUNT = 14;
type UiStep = "days" | "prefs" | "ideate" | "select" | "build" | "review" | "assign";
type InputMode = "structured" | "simple";

export default function MealPlanWizardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ days?: string; mode?: string }>();
  const { prefs: savedPrefs, savePrefs, loaded: prefsLoaded } = useWizardPrefs();

  const today = useMemo(() => startOfDay(), []);
  /** Ad-hoc create from Home / + menu — one recipe; day assign is optional at the end. */
  const recipeMode = params.mode === "recipe";
  /** Structured week form vs single free-text prompt (like AI edit). */
  const [inputMode, setInputMode] = useState<InputMode>(recipeMode ? "simple" : "structured");
  const [simplePrompt, setSimplePrompt] = useState("");
  const STEP_ORDER: UiStep[] =
    inputMode === "simple"
      ? recipeMode
        ? ["prefs", "build", "review", "assign"]
        : ["days", "prefs", "build", "review"]
      : recipeMode
        ? ["prefs", "ideate", "select", "build", "review", "assign"]
        : ["days", "prefs", "ideate", "select", "build", "review"];

  const [uiStep, setUiStep] = useState<UiStep>(recipeMode ? "prefs" : "days");
  const [session, setSession] = useState<MealPlanWizardSession | null>(null);
  const [localPrefs, setLocalPrefs] = useState(emptyWizardPrefs());
  const [selectedDays, setSelectedDays] = useState<string[]>(() =>
    recipeMode ? [toDateKey(today)] : []
  );
  const [selectedIdeaIds, setSelectedIdeaIds] = useState<string[]>([]);
  const [liveEvents, setLiveEvents] = useState<MealPlanWizardProgressEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [refineText, setRefineText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingDays, setLoadingDays] = useState(!recipeMode);
  const [plannedTitles, setPlannedTitles] = useState<Record<string, string>>({});
  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const [regenIdeaIds, setRegenIdeaIds] = useState<string[]>([]);
  const [prefsOpen, setPrefsOpen] = useState(false);
  /** Optional night to plan after creating a single recipe (recipeMode only). */
  const [assignDayKey, setAssignDayKey] = useState<string | null>(null);
  const [assignPlansByKey, setAssignPlansByKey] = useState<Record<string, string>>({});
  const [loadingAssignDays, setLoadingAssignDays] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<MealPlanWizardSession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // ?days= — pre-selected night keys handed over from the planner.
  const daysFromQuery = useMemo(() => {
    const raw = typeof params.days === "string" ? params.days : "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => Boolean(parseDateKey(s)));
  }, [params.days]);

  const [weekDays] = useState<Date[]>(() => {
    const seed = daysFromQuery.length ? (parseDateKey(daysFromQuery[0]!) ?? today) : today;
    return Array.from({ length: 7 }, (_, i) => addDays(startOfWeekMonday(seed), i));
  });
  const weekDayKeys = useMemo(() => weekDays.map(toDateKey), [weekDays]);

  // Seed editable prefs once the persisted ones finish loading.
  const [prefsSeeded, setPrefsSeeded] = useState(false);
  if (prefsLoaded && !prefsSeeded) {
    setPrefsSeeded(true);
    setLocalPrefs({ ...savedPrefs });
  }

  const todayKey = toDateKey(today);
  const isDayPast = (key: string) => key < todayKey;

  const selectCount = session?.select_count ?? selectedDays.length;
  const canContinueDays = selectedDays.length > 0;
  const skippedCount = weekDayKeys.length - selectedDays.length;
  const openNightKeys = weekDayKeys.filter((key) => !plannedTitles[key] && !isDayPast(key));
  const alreadyPlannedCount = Object.keys(plannedTitles).length;
  const selectionFull = selectedIdeaIds.length >= selectCount && selectCount > 0;
  const canContinueSelect = selectedIdeaIds.length === selectCount && selectCount > 0;
  const canContinueSimple = Boolean(simplePrompt.trim()) && !busy;
  const canRefineRecipes = Boolean(refineText.trim()) && regenIdeaIds.length > 0 && !busy;
  const stepIndex = STEP_ORDER.indexOf(uiStep);

  const planRows = useMemo(() => {
    const days = session?.days ?? [];
    const recipes = session?.built_recipes ?? [];
    return days.map((day, i) => ({ day, recipe: recipes[i] ?? null }));
  }, [session]);

  const weekHeading = useMemo(() => {
    const start = weekDays[0];
    if (!start) return "This week";
    const thisWeek = startOfWeekMonday(today);
    const nextWeek = addDays(thisWeek, 7);
    if (toDateKey(start) === toDateKey(thisWeek)) return "This week";
    if (toDateKey(start) === toDateKey(nextWeek)) return "Next week";
    const end = weekDays[6] ?? start;
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
  }, [weekDays, today]);

  const headerTitle = recipeMode
    ? {
        days: "Create a recipe",
        prefs: inputMode === "simple" ? "Describe your recipe" : "What are you craving?",
        ideate: "Cooking up ideas",
        select: "Pick one idea",
        build: "Building your recipe",
        review: "Review your recipe",
        assign: "Add to a night?"
      }[uiStep]
    : {
        days: "Which nights?",
        prefs: inputMode === "simple" ? "Describe your dinners" : "Set the vibe",
        ideate: "Cooking up ideas",
        select: "Pick your dinners",
        build: "Building recipes",
        review: "Lock the plan",
        assign: "Lock the plan"
      }[uiStep];

  const assignDays = useMemo(
    () =>
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
          plannedTitle: assignPlansByKey[key] ?? null
        };
      }),
    [today, assignPlansByKey]
  );

  const recipeTitle =
    session?.built_recipes[0]?.title?.trim() || "your recipe";

  // ---- bootstrap: load existing dinners for the week, preselect open nights ----
  useEffect(() => {
    // recipeMode seeds selectedDays / loadingDays in useState (placeholder day only).
    if (recipeMode) return;
    const keys = weekDays.map(toDateKey);
    fetchPlansBetween(weekDays[0]!, endOfDay(weekDays[6]!))
      .then((plans) => {
        const titles: Record<string, string> = {};
        for (const plan of plans) {
          const key = plan.planned_for.slice(0, 10);
          if (!titles[key]) titles[key] = plan.recipe.name;
        }
        setPlannedTitles(titles);
        const allowed = new Set(keys);
        const preferred = daysFromQuery.length
          ? [...new Set(daysFromQuery.filter((k) => allowed.has(k)))].sort()
          : [...keys];
        setSelectedDays(preferred.filter((key) => !titles[key] && !isDayPast(key)));
      })
      .catch((er) => {
        toast.fromError(er, "Couldn’t load existing dinners for this week.");
        const fallback = daysFromQuery.length ? daysFromQuery : [...keys];
        setSelectedDays(fallback.filter((key) => !isDayPast(key)));
      })
      .finally(() => setLoadingDays(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const clampDaysToWeek = (keys: string[]) => {
    const allowed = new Set(weekDayKeys);
    return [...new Set(keys.filter((k) => allowed.has(k) && !isDayPast(k)))].sort();
  };

  const toggleDay = (key: string) => {
    if (!weekDayKeys.includes(key) || isDayPast(key)) return;
    tapHaptic();
    setSelectedDays((days) =>
      days.includes(key) ? days.filter((d) => d !== key) : clampDaysToWeek([...days, key])
    );
  };

  const dayLabel = (key: string) => {
    const date = parseDateKey(key);
    if (!date) return key;
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };

  // ---- session plumbing ----
  const ensureSession = async (): Promise<MealPlanWizardSession> => {
    if (sessionRef.current) return sessionRef.current;
    const created = await createWizardSession(clampDaysToWeek(selectedDays), localPrefs);
    setSession(created);
    sessionRef.current = created;
    return created;
  };

  const syncDaysAndPrefs = async (): Promise<MealPlanWizardSession> => {
    const days = clampDaysToWeek(selectedDays);
    setSelectedDays(days);
    savePrefs(localPrefs);
    const s = await ensureSession();
    await updateWizardDays(s.id, days);
    const prefsRes = await updateWizardPrefs(s.id, localPrefs);
    setSession(prefsRes);
    sessionRef.current = prefsRes;
    setSelectedIdeaIds(prefsRes.selected_idea_ids);
    return prefsRes;
  };

  const refreshSession = async (): Promise<MealPlanWizardSession | null> => {
    const current = sessionRef.current;
    if (!current) return null;
    const fresh = await fetchWizardSession(current.id);
    setSession(fresh);
    sessionRef.current = fresh;
    return fresh;
  };

  const runFreeformBuild = async (refinement?: string, ideaIds?: string[]) => {
    const prompt = simplePrompt.trim();
    if (!prompt && !refinement) {
      setError("Describe what you’d like to cook.");
      return;
    }
    setError("");
    setBusy(true);
    setRunning(true);
    setLiveEvents([]);
    setUiStep("build");
    let sawError = false;
    const controller = new AbortController();
    try {
      const s = await syncDaysAndPrefs();
      abortRef.current?.abort();
      abortRef.current = controller;
      await streamFreeformBuild(
        s.id,
        {
          prompt,
          refinement: refinement || null,
          idea_ids: ideaIds?.length ? ideaIds : null
        },
        (event) => {
          if (event.status === "done") return;
          setLiveEvents((ev) => [...ev, event]);
          if (event.status === "error") {
            sawError = true;
            setError(event.message);
          }
        },
        controller.signal
      );
      await refreshSession();
      setRefineText("");
      setRegenIdeaIds([]);
      if (!sawError) setUiStep("review");
    } catch (e) {
      if (!controller.signal.aborted && (e as Error).name !== "AbortError") {
        setError(getErrorMessage(e, "Build failed"));
        toast.fromError(e, "Build failed");
      }
    } finally {
      setRunning(false);
      setBusy(false);
    }
  };

  const runIdeate = async (refinement?: string) => {
    setError("");
    setBusy(true);
    setRunning(true);
    setLiveEvents([]);
    setUiStep("ideate");
    let sawError = false;
    const controller = new AbortController();
    try {
      const s = await syncDaysAndPrefs();
      abortRef.current?.abort();
      abortRef.current = controller;
      await streamIdeate(
        s.id,
        refinement || null,
        (event) => {
          if (event.status === "done") return;
          setLiveEvents((ev) => [...ev, event]);
          if (event.status === "error") {
            sawError = true;
            setError(event.message);
          }
        },
        controller.signal
      );
      const fresh = await refreshSession();
      setSelectedIdeaIds(fresh?.selected_idea_ids ?? []);
      setRefineText("");
      if (!sawError) setUiStep("select");
    } catch (e) {
      if (!controller.signal.aborted && (e as Error).name !== "AbortError") {
        setError(getErrorMessage(e, "Ideation failed"));
        toast.fromError(e, "Ideation failed");
      }
    } finally {
      setRunning(false);
      setBusy(false);
    }
  };

  const runBuild = async (refinement?: string, ideaIds?: string[]) => {
    const current = sessionRef.current;
    if (!current) return;
    setError("");
    setBusy(true);
    setRunning(true);
    setLiveEvents([]);
    setUiStep("build");
    let sawError = false;
    const controller = new AbortController();
    try {
      abortRef.current?.abort();
      abortRef.current = controller;
      await streamBuild(
        current.id,
        { refinement: refinement || null, idea_ids: ideaIds?.length ? ideaIds : null },
        (event) => {
          if (event.status === "done") return;
          setLiveEvents((ev) => [...ev, event]);
          if (event.status === "error") {
            sawError = true;
            setError(event.message);
          }
        },
        controller.signal
      );
      await refreshSession();
      setRefineText("");
      setRegenIdeaIds([]);
      if (!sawError) setUiStep("review");
    } catch (e) {
      if (!controller.signal.aborted && (e as Error).name !== "AbortError") {
        setError(getErrorMessage(e, "Build failed"));
        toast.fromError(e, "Build failed");
      }
    } finally {
      setRunning(false);
      setBusy(false);
    }
  };

  const toggleIdea = (id: string) => {
    const disabled = selectionFull && !selectedIdeaIds.includes(id);
    if (disabled) return;
    tapHaptic();
    setSelectedIdeaIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      if (ids.length >= selectCount) return ids;
      return [...ids, id];
    });
  };

  const confirmSelectionAndBuild = async () => {
    const current = sessionRef.current;
    if (!current || !canContinueSelect) return;
    setError("");
    setBusy(true);
    try {
      savePrefs(localPrefs);
      const afterPrefs = await updateWizardPrefs(current.id, localPrefs);
      setSession(afterPrefs);
      sessionRef.current = afterPrefs;
      if (!afterPrefs.ideas.length) {
        await runIdeate();
        return;
      }
      const selected = await selectWizardIdeas(afterPrefs.id, selectedIdeaIds);
      setSession(selected);
      sessionRef.current = selected;
      await runBuild();
    } catch (e) {
      setError(getErrorMessage(e, "Could not continue"));
      toast.fromError(e, "Could not continue");
      setBusy(false);
    }
  };

  const applyRefinement = async () => {
    const text = refineText.trim();
    if (!text) return;
    if (uiStep === "select" || uiStep === "ideate") {
      await runIdeate(text);
    } else if (uiStep === "review" || uiStep === "build") {
      if (!regenIdeaIds.length) {
        setError("Mark at least one dinner to regenerate.");
        return;
      }
      if (inputMode === "simple") {
        await runFreeformBuild(text, [...regenIdeaIds]);
      } else {
        await runBuild(text, [...regenIdeaIds]);
      }
    }
  };

  const rewindTo = async (step: UiStep) => {
    const current = sessionRef.current;
    if (!current) {
      setUiStep(step);
      return;
    }
    if (step === "days" || step === "prefs") {
      if (current.ideas.length || current.built_recipes.length) {
        try {
          const rewound = await rewindWizard(current.id, step as MealPlanWizardStep);
          setSession(rewound);
          sessionRef.current = rewound;
        } catch (e) {
          toast.fromError(e, "Couldn’t reset the wizard step.");
        }
      }
      setSelectedIdeaIds([]);
      setLiveEvents([]);
      setUiStep(step);
      return;
    }
    try {
      const rewound = await rewindWizard(current.id, step as MealPlanWizardStep);
      setSession(rewound);
      sessionRef.current = rewound;
      setSelectedIdeaIds(rewound.selected_idea_ids);
      setUiStep(step);
    } catch (e) {
      setError(getErrorMessage(e, "Could not go back"));
      toast.fromError(e, "Could not go back");
    }
  };

  const leaveWizard = () => {
    if (router.canGoBack()) router.back();
    else router.replace(recipeMode ? "/recipes" : "/planner");
  };

  const goBack = async () => {
    tapHaptic();
    if (uiStep === "days" || (recipeMode && uiStep === "prefs")) {
      leaveWizard();
      return;
    }
    // Assign is client-only (after review) — just return without rewinding the session.
    if (uiStep === "assign") {
      setUiStep("review");
      return;
    }
    const previous: Record<UiStep, UiStep> = {
      days: "days",
      prefs: recipeMode ? "prefs" : "days",
      ideate: "prefs",
      select: "prefs",
      build: inputMode === "simple" ? "prefs" : "select",
      review: inputMode === "simple" ? "prefs" : "select",
      assign: "review"
    };
    abortRef.current?.abort();
    setRunning(false);
    await rewindTo(previous[uiStep]);
  };

  const openAssignStep = async () => {
    tapHaptic();
    setError("");
    setAssignDayKey(null);
    setLoadingAssignDays(true);
    setUiStep("assign");
    try {
      const plans = await fetchPlansBetween(today, addDays(today, ASSIGN_DAY_COUNT - 1));
      const titles: Record<string, string> = {};
      for (const p of plans) {
        const key = p.planned_for.slice(0, 10);
        if (!titles[key]) titles[key] = p.recipe.name;
      }
      setAssignPlansByKey(titles);
      const firstOpen = Array.from({ length: ASSIGN_DAY_COUNT }, (_, i) => toDateKey(addDays(today, i))).find(
        (key) => !titles[key]
      );
      setAssignDayKey(firstOpen ?? null);
    } catch (e) {
      console.error(e);
      toast.fromError(e, "Couldn’t load your meal plan.");
    } finally {
      setLoadingAssignDays(false);
    }
  };

  const commitPlan = async (opts?: { assignDay?: string | null }) => {
    const current = sessionRef.current;
    if (!current) return;
    setError("");
    setBusy(true);
    try {
      // Recipe create always persists recipes first; day assign is a separate optional step.
      await commitWizard(current.id, { plan: !recipeMode });
      if (recipeMode) {
        const refreshed = await fetchWizardSession(current.id);
        setSession(refreshed);
        sessionRef.current = refreshed;
        const built = refreshed.built_recipes[0];
        // New generates set created_recipe_id; library reuse sets existing_recipe_id.
        const recipeId = built?.created_recipe_id ?? built?.existing_recipe_id ?? null;
        const dayKey = opts?.assignDay ?? null;
        if (dayKey && recipeId != null) {
          const date = parseDateKey(dayKey);
          if (date) {
            await createPlan(recipeId, date);
            syncAfterPlanMutation({ recipesChanged: true });
            toast.success("Recipe saved and added to your plan.");
            router.replace(`/recipes/${recipeId}` as never);
            return;
          }
        }
        syncAfterRecipeMutation();
        toast.success("Recipe saved.");
        if (recipeId != null) router.replace(`/recipes/${recipeId}` as never);
        else router.replace("/recipes");
        return;
      }
      syncAfterPlanMutation({ recipesChanged: true });
      toast.success("Meal plan saved.");
      router.replace("/planner");
    } catch (e) {
      const msg = recipeMode ? "Could not save recipe" : "Could not save plan";
      setError(getErrorMessage(e, msg));
      toast.fromError(e, msg);
    } finally {
      setBusy(false);
    }
  };

  const formatIngredient = (ing: MealPlanWizardBuiltRecipe["ingredients"][number]): string =>
    [
      ing.amount != null ? String(ing.amount) : "",
      ing.units || "",
      ing.name,
      ing.details ? `(${ing.details})` : ""
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 16,
        paddingBottom: insets.bottom + 32
      }}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
        {/* Header */}
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => void goBack()}
            className="h-9 w-9 items-center justify-center rounded-full border border-border bg-card active:opacity-70"
          >
            <ArrowLeft size={16} color={colors.mutedForeground} />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="font-sans-bold text-[11px] uppercase tracking-[1px] text-success-soft">
              {recipeMode ? "Create" : "Meal plan wizard"}
            </Text>
            <Text className="font-sans-bold text-lg" numberOfLines={1}>
              {headerTitle}
            </Text>
          </View>
          {session?.stubbed ? (
            <View className="rounded-full border border-border bg-secondary px-2 py-0.5">
              <Text className="font-sans-semibold text-[10px] text-faint">Stub LLM</Text>
            </View>
          ) : null}
        </View>

        {/* Step dots */}
        <View className="mt-3 flex-row items-center gap-1.5">
          {STEP_ORDER.map((s, i) => (
            <Pressable
              key={s}
              disabled={i >= stepIndex || running || s === "ideate" || s === "build"}
              onPress={() => void rewindTo(s)}
              className={i <= stepIndex ? "h-1 flex-1 rounded-full bg-primary" : "h-1 flex-1 rounded-full bg-secondary"}
            />
          ))}
        </View>

        {error ? (
          <View className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2">
            <Text className="text-sm text-destructive">{error}</Text>
          </View>
        ) : null}

        {/* DAYS */}
        {uiStep === "days" ? (
          <View className="mt-5">
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="font-sans-semibold text-sm">{weekHeading}</Text>
                <Text className="mt-0.5 text-sm text-muted-foreground">
                  {loadingDays
                    ? "Checking what’s already planned…"
                    : alreadyPlannedCount
                      ? "Nights with a dinner are skipped — tap one to replan it anyway."
                      : "Tap nights to plan. Highlighted nights get a dinner; the rest are skipped."}
                </Text>
              </View>
              <View className="flex-row gap-3">
                <Pressable onPress={() => setSelectedDays([...openNightKeys])} hitSlop={8}>
                  <Text className="font-sans-semibold text-[12px] text-[#22c55e]">Open</Text>
                </Pressable>
                <Pressable onPress={() => setSelectedDays([])} hitSlop={8}>
                  <Text className="font-sans-semibold text-[12px] text-faint">None</Text>
                </Pressable>
              </View>
            </View>

            <View className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
              {weekDays.map((day, i) => {
                const key = toDateKey(day);
                const selected = selectedDays.includes(key);
                const plannedTitle = plannedTitles[key] ?? null;
                const past = isDayPast(key);
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: past }}
                    disabled={past}
                    onPress={() => toggleDay(key)}
                    className={
                      past
                        ? "flex-row items-center gap-3 border-b border-border px-3 py-3 opacity-40"
                        : selected
                          ? "flex-row items-center gap-3 border-b border-border bg-[#22c55e]/15 px-3 py-3"
                          : "flex-row items-center gap-3 border-b border-border px-3 py-3 opacity-70"
                    }
                    style={i === 6 ? { borderBottomWidth: 0 } : undefined}
                  >
                    <View
                      className={
                        selected && !past
                          ? "h-5 w-5 items-center justify-center rounded-md border border-primary bg-primary"
                          : "h-5 w-5 items-center justify-center rounded-md border border-border bg-secondary/40"
                      }
                    >
                      {selected && !past ? (
                        <Check size={13} color={colors.foreground} strokeWidth={3} />
                      ) : null}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text
                        className={
                          selected && !past
                            ? "font-sans-semibold text-sm text-foreground"
                            : "font-sans-semibold text-sm text-muted-foreground"
                        }
                      >
                        {DAY_LABELS[i]} · {day.getDate()}
                        {key === todayKey && !past ? (
                          <Text className="font-sans-bold text-[11px] uppercase text-[#22c55e]">
                            {"  Today"}
                          </Text>
                        ) : null}
                      </Text>
                      {past ? (
                        <Text className="mt-0.5 text-[12px] text-faint">Past</Text>
                      ) : plannedTitle ? (
                        <Text
                          className={
                            selected
                              ? "mt-0.5 text-[12px] text-muted-foreground"
                              : "mt-0.5 text-[12px] text-success-soft/80"
                          }
                          numberOfLines={1}
                        >
                          {selected ? `Replace · ${plannedTitle}` : plannedTitle}
                        </Text>
                      ) : (
                        <Text className="mt-0.5 text-[11px] text-muted-foreground">
                          {selected ? "Open night" : "Skipping"}
                        </Text>
                      )}
                    </View>
                    <View
                      className={
                        past
                          ? "rounded-full bg-secondary px-2 py-0.5"
                          : selected
                            ? "rounded-full bg-[#22c55e]/20 px-2 py-0.5"
                            : "rounded-full bg-secondary px-2 py-0.5"
                      }
                    >
                      <Text
                        className={
                          past
                            ? "font-sans-semibold text-[11px] text-faint"
                            : selected
                              ? "font-sans-semibold text-[11px] text-success-soft"
                              : plannedTitle
                                ? "font-sans-semibold text-[11px] text-muted-foreground"
                                : "font-sans-semibold text-[11px] text-faint"
                        }
                      >
                        {past
                          ? "Past"
                          : selected
                            ? plannedTitle
                              ? "Replan"
                              : "Plan"
                            : plannedTitle
                              ? "Kept"
                              : "Skip"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text className="mt-2 text-xs text-faint">
              {loadingDays
                ? "Loading plans…"
                : `Planning ${selectedDays.length} of ${weekDayKeys.length}` +
                  (alreadyPlannedCount
                    ? ` · ${alreadyPlannedCount} already planned`
                    : skippedCount
                      ? ` · skipping ${skippedCount}`
                      : "")}
            </Text>
            <Button
              className="mt-4 w-full"
              disabled={!canContinueDays || busy || loadingDays}
              onPress={() => {
                setError("");
                setUiStep("prefs");
              }}
            >
              {`Continue with ${selectedDays.length} night${selectedDays.length === 1 ? "" : "s"}`}
            </Button>
            {!loadingDays && !selectedDays.length && alreadyPlannedCount ? (
              <Text className="mt-2 text-center text-xs text-muted-foreground">
                Every night already has a dinner. Tap one to replan it, or head back.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* PREFS */}
        {uiStep === "prefs" ? (
          <View className="mt-5">
            <View className="mb-4 flex-row rounded-xl border border-border bg-secondary/40 p-1">
              <Pressable
                className={`flex-1 rounded-lg px-3 py-2 ${inputMode === "simple" ? "bg-card" : ""}`}
                onPress={() => {
                  tapHaptic();
                  setInputMode("simple");
                }}
              >
                <Text
                  className={`text-center text-sm font-sans-semibold ${
                    inputMode === "simple" ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Describe it
                </Text>
              </Pressable>
              <Pressable
                className={`flex-1 rounded-lg px-3 py-2 ${inputMode === "structured" ? "bg-card" : ""}`}
                onPress={() => {
                  tapHaptic();
                  setInputMode("structured");
                }}
              >
                <Text
                  className={`text-center text-sm font-sans-semibold ${
                    inputMode === "structured" ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  Week form
                </Text>
              </Pressable>
            </View>

            {inputMode === "simple" ? (
              <>
                <Text className="mb-3 text-sm text-muted-foreground">
                  {recipeMode
                    ? "Describe the recipe you want — ingredients, style, dietary needs, etc."
                    : `Describe dinners for your ${selectedDays.length} selected night${selectedDays.length === 1 ? "" : "s"}.`}
                </Text>
                <Textarea
                  value={simplePrompt}
                  onChangeText={setSimplePrompt}
                  editable={!busy}
                  placeholder="e.g. Spicy Thai basil chicken with jasmine rice, under 30 minutes and dairy-free"
                  className="min-h-[128px] rounded-xl"
                  autoFocus
                />
              </>
            ) : (
              <>
                <Text className="mb-4 text-sm text-muted-foreground">
                  Everything here is optional. We’ll remember goals and diet for next time.
                </Text>
                <WizardPrefsFields prefs={localPrefs} onChange={setLocalPrefs} />
              </>
            )}

            <View className="mt-5 flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onPress={() => (recipeMode ? leaveWizard() : void rewindTo("days"))}
              >
                Back
              </Button>
              {inputMode === "simple" ? (
                <Button
                  className="flex-1"
                  disabled={!canContinueSimple}
                  onPress={() => void runFreeformBuild()}
                >
                  <Sparkles size={14} color={colors.foreground} />
                  {recipeMode
                    ? "Generate recipe"
                    : `Build ${selectedDays.length} dinner${selectedDays.length === 1 ? "" : "s"}`}
                </Button>
              ) : (
                <Button className="flex-1" disabled={busy} onPress={() => void runIdeate()}>
                  <Sparkles size={14} color={colors.foreground} />
                  Generate ideas
                </Button>
              )}
            </View>
          </View>
        ) : null}

        {/* IDEATE / BUILD */}
        {uiStep === "ideate" || uiStep === "build" ? (
          <View className="mt-5 gap-4">
            <WizardProgressPanel
              events={liveEvents}
              running={running}
              title={uiStep === "ideate" ? "Ideating dinners" : "Writing full recipes"}
              subtitle={
                uiStep === "ideate"
                  ? `Aiming for ${session?.idea_target_count ?? selectedDays.length + 5} options`
                  : inputMode === "simple"
                    ? recipeMode
                      ? "Writing your recipe from your description"
                      : `Writing ${selectCount} recipes from your description`
                    : `Building ${selectCount} recipes from your picks`
              }
            />
            {!running && error ? (
              <View className="flex-row gap-2">
                <Button variant="outline" className="flex-1" onPress={() => void rewindTo("prefs")}>
                  Edit input
                </Button>
                <Button
                  className="flex-1"
                  onPress={() =>
                    uiStep === "ideate"
                      ? void runIdeate()
                      : inputMode === "simple"
                        ? void runFreeformBuild()
                        : void runBuild()
                  }
                >
                  Retry
                </Button>
              </View>
            ) : (
              <Text className="py-2 text-center text-sm text-muted-foreground">
                Hang tight — the pipeline is moving…
              </Text>
            )}
          </View>
        ) : null}

        {/* SELECT */}
        {uiStep === "select" ? (
          <View className="mt-5 gap-4">
            <View className="flex-row items-end justify-between gap-2">
              <Text className="flex-1 text-sm text-muted-foreground">
                {selectionFull ? (
                  "All set — deselect one if you want to swap."
                ) : (
                  <>
                    Choose <Text className="font-sans-semibold text-sm">{selectCount}</Text> of{" "}
                    {session?.ideas.length ?? 0} ideas
                  </>
                )}
              </Text>
              <Text
                className={
                  selectionFull ? "font-sans-semibold text-xs text-success-soft" : "text-xs text-faint"
                }
              >
                {selectedIdeaIds.length} / {selectCount}
              </Text>
            </View>

            <View className="gap-2">
              {(session?.ideas ?? []).map((idea) => {
                const selected = selectedIdeaIds.includes(idea.id);
                const disabled = selectionFull && !selected;
                return (
                  <Pressable
                    key={idea.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled }}
                    disabled={disabled}
                    onPress={() => toggleIdea(idea.id)}
                    className={
                      selected
                        ? "flex-row items-start gap-3 rounded-xl border border-[#22c55e]/45 bg-[#22c55e]/10 px-3 py-3"
                        : disabled
                          ? "flex-row items-start gap-3 rounded-xl border border-border/60 bg-card/40 px-3 py-3 opacity-40"
                          : "flex-row items-start gap-3 rounded-xl border border-border bg-card px-3 py-3"
                    }
                  >
                    <View
                      className={
                        selected
                          ? "mt-0.5 h-5 w-5 items-center justify-center rounded-md border border-primary bg-primary"
                          : "mt-0.5 h-5 w-5 items-center justify-center rounded-md border border-border"
                      }
                    >
                      {selected ? <Check size={13} color={colors.foreground} strokeWidth={3} /> : null}
                    </View>
                    <Text className="min-w-0 flex-1 font-sans-semibold text-sm leading-5">
                      {idea.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="rounded-xl border border-border bg-card px-3 py-2">
              <Pressable
                className="flex-row items-center justify-between py-1"
                onPress={() => setPrefsOpen((v) => !v)}
              >
                <Text className="font-sans-semibold text-sm">Adjust goals / diet</Text>
                <ChevronDown
                  size={16}
                  color={colors.faint}
                  style={{ transform: [{ rotate: prefsOpen ? "180deg" : "0deg" }] }}
                />
              </Pressable>
              {prefsOpen ? (
                <View className="mt-3 pb-2">
                  <WizardPrefsFields prefs={localPrefs} onChange={setLocalPrefs} />
                </View>
              ) : null}
            </View>

            <View className="rounded-xl border border-border bg-card p-3">
              <Text className="font-sans-semibold text-sm">Refine ideas</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                Tweaks re-run ideation with prior context — not from scratch.
              </Text>
              <Textarea
                className="mt-2 min-h-16"
                placeholder="More vegetarian options, less pasta, add a spicy night…"
                value={refineText}
                onChangeText={setRefineText}
              />
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 self-start"
                disabled={busy || !refineText.trim()}
                onPress={() => void applyRefinement()}
              >
                <RefreshCw size={14} color={colors.foreground} />
                Re-run with feedback
              </Button>
            </View>

            <View className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onPress={() => void rewindTo("prefs")}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={!canContinueSelect || busy}
                onPress={() => void confirmSelectionAndBuild()}
              >
                Build recipes
              </Button>
            </View>
          </View>
        ) : null}

        {/* REVIEW */}
        {uiStep === "review" ? (
          <View className="mt-5 gap-4">
            <Text className="text-sm text-muted-foreground">
              {recipeMode
                ? "Here’s your recipe. Expand for the full write-up, or mark it to regenerate."
                : "Here’s your week. Expand a night for the full recipe, or mark dinners to regenerate."}
            </Text>

            <View className="gap-2">
              {planRows.map((row) => {
                const expanded = expandedDays.includes(row.day);
                const marked = row.recipe ? regenIdeaIds.includes(row.recipe.idea_id) : false;
                return (
                  <View
                    key={row.day}
                    className={
                      marked
                        ? "overflow-hidden rounded-xl border border-[#22c55e]/40 bg-card"
                        : "overflow-hidden rounded-xl border border-border bg-card"
                    }
                  >
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        setExpandedDays((days) =>
                          days.includes(row.day)
                            ? days.filter((d) => d !== row.day)
                            : [...days, row.day]
                        )
                      }
                      className="flex-row items-start gap-3 px-3 py-3 active:bg-secondary/40"
                    >
                      <ChevronRight
                        size={16}
                        color={colors.faint}
                        style={{ marginTop: 2, transform: [{ rotate: expanded ? "90deg" : "0deg" }] }}
                      />
                      <View className="min-w-0 flex-1">
                        <Text className="font-sans-semibold text-[11px] uppercase tracking-wide text-faint">
                          {recipeMode ? "New recipe" : dayLabel(row.day)}
                        </Text>
                        <Text className="mt-0.5 font-sans-semibold text-sm leading-5">
                          {row.recipe?.title || "Untitled dinner"}
                        </Text>
                        {row.recipe?.prep_time ? (
                          <Text className="mt-0.5 text-[11px] text-muted-foreground">
                            {formatPrepTime(row.recipe.prep_time)}
                          </Text>
                        ) : null}
                      </View>
                      {row.recipe ? (
                        <View
                          className={
                            marked
                              ? "mt-0.5 flex-row items-center gap-1.5 rounded-md border border-[#22c55e]/45 bg-[#22c55e]/10 px-2 py-1"
                              : "mt-0.5 flex-row items-center gap-1.5 rounded-md border border-border px-2 py-1"
                          }
                        >
                          <Checkbox
                            checked={marked}
                            onCheckedChange={() => {
                              const ideaId = row.recipe!.idea_id;
                              setRegenIdeaIds((ids) =>
                                ids.includes(ideaId)
                                  ? ids.filter((id) => id !== ideaId)
                                  : [...ids, ideaId]
                              );
                            }}
                            className="h-4 w-4 rounded"
                          />
                          <Text
                            className={
                              marked
                                ? "font-sans-semibold text-[10px] text-success-soft"
                                : "font-sans-semibold text-[10px] text-faint"
                            }
                          >
                            Regen
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>

                    {row.recipe && expanded ? (
                      <View className="gap-3 border-t border-border px-3 pb-3 pt-2">
                        {row.recipe.description ? (
                          <Text className="text-sm text-muted-foreground">
                            {row.recipe.description}
                          </Text>
                        ) : null}

                        {row.recipe.ingredients?.length ? (
                          <View>
                            <Text className="font-sans-semibold text-xs uppercase tracking-wide text-faint">
                              Ingredients
                            </Text>
                            <View className="mt-1.5 gap-1">
                              {row.recipe.ingredients.map((ing, idx) => (
                                <Text
                                  key={`${row.recipe!.idea_id}-ing-${idx}`}
                                  className="text-sm text-foreground/90"
                                >
                                  {formatIngredient(ing)}
                                </Text>
                              ))}
                            </View>
                          </View>
                        ) : null}

                        <View>
                          <Text className="font-sans-semibold text-xs uppercase tracking-wide text-faint">
                            Instructions
                          </Text>
                          <View className="mt-1.5 gap-2.5">
                            {splitInstructionSteps(row.recipe.instructions).map((step, idx) => (
                              <Text
                                key={`${row.recipe!.idea_id}-step-${idx}`}
                                className="text-sm leading-6 text-foreground/90"
                              >
                                {step}
                              </Text>
                            ))}
                          </View>
                        </View>

                        {row.recipe.notes ? (
                          <Text className="text-xs text-muted-foreground">
                            Notes: {row.recipe.notes}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View className="rounded-xl border border-border bg-card p-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="font-sans-semibold text-sm">Refine recipes</Text>
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={() =>
                      setRegenIdeaIds((session?.built_recipes ?? []).map((r) => r.idea_id))
                    }
                    hitSlop={8}
                  >
                    <Text className="font-sans-semibold text-[11.5px] text-[#22c55e]">Mark all</Text>
                  </Pressable>
                  <Pressable onPress={() => setRegenIdeaIds([])} hitSlop={8}>
                    <Text className="font-sans-semibold text-[11.5px] text-faint">Clear</Text>
                  </Pressable>
                </View>
              </View>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                Mark dinners above, then describe changes. Prior turns stay in context so the week
                stays coherent.
              </Text>
              <Text className="mt-1.5 text-xs text-faint">
                {regenIdeaIds.length} marked for regeneration
              </Text>
              <Textarea
                className="mt-2 min-h-16"
                placeholder="Make the pasta spicier, cut cook time on Tuesday, swap tofu for chicken…"
                value={refineText}
                onChangeText={setRefineText}
              />
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 self-start"
                disabled={!canRefineRecipes}
                onPress={() => void applyRefinement()}
              >
                <RefreshCw size={14} color={colors.foreground} />
                {`Regenerate marked${regenIdeaIds.length ? ` (${regenIdeaIds.length})` : ""}`}
              </Button>
            </View>

            <View className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onPress={() => void rewindTo("select")}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={busy}
                onPress={() => (recipeMode ? void openAssignStep() : void commitPlan())}
              >
                {busy ? "Saving…" : recipeMode ? "Continue" : "Save to planner"}
              </Button>
            </View>
          </View>
        ) : null}

        {/* ASSIGN (recipeMode only) — optional night after create */}
        {uiStep === "assign" ? (
          <View className="mt-5 gap-4">
            <Text className="text-sm text-muted-foreground">
              “{recipeTitle}” is ready. Put it on a night if you want — or skip and keep it in your
              recipes.
            </Text>

            <View className="overflow-hidden rounded-xl border border-border">
              {loadingAssignDays
                ? Array.from({ length: 5 }, (_, n) => (
                    <View
                      key={n}
                      className="flex-row items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
                    >
                      <View className="min-w-0 flex-1 gap-1.5">
                        <Skeleton className="h-3.5 w-24" />
                        <Skeleton className="h-2.5 w-14" />
                      </View>
                      <Skeleton className="h-3 w-10" />
                    </View>
                  ))
                : assignDays.map((day) => {
                    const selected = day.key === assignDayKey;
                    return (
                      <Pressable
                        key={day.key}
                        accessibilityRole="button"
                        onPress={() => setAssignDayKey(day.key)}
                        className={
                          selected
                            ? "flex-row items-center gap-3 border-b border-border bg-[#22c55e]/10 px-3 py-2.5 last:border-b-0"
                            : "flex-row items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 active:bg-secondary/50"
                        }
                      >
                        <View className="min-w-0 flex-1">
                          <Text className="font-sans-semibold text-sm">{day.label}</Text>
                          <Text className="text-[11px] text-faint">{day.dateLabel}</Text>
                        </View>
                        {day.plannedTitle ? (
                          <Text className="max-w-[45%] truncate text-[11px] text-faint">
                            {day.plannedTitle}
                          </Text>
                        ) : (
                          <Text className="font-sans-semibold text-[11px] text-[#4ade80]">Open</Text>
                        )}
                        {selected ? (
                          <Check size={16} color="#22c55e" strokeWidth={2.5} />
                        ) : null}
                      </Pressable>
                    );
                  })}
            </View>

            <View className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onPress={() => void commitPlan({ assignDay: null })}
              >
                {busy ? "Saving…" : "Skip"}
              </Button>
              <Button
                className="flex-1"
                disabled={busy || loadingAssignDays || !assignDayKey}
                onPress={() => void commitPlan({ assignDay: assignDayKey })}
              >
                {busy ? "Saving…" : "Save & plan"}
              </Button>
            </View>
          </View>
        ) : null}
    </KeyboardAwareScrollView>
  );
}

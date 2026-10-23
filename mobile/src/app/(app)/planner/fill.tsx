import { getErrorMessage } from "@/api/errors";
import { createPlan, fetchPlansBetween } from "@/api/planner";
import { importRecipeFromUrl } from "@/api/recipes";
import {
  commitWizard,
  commitWizardNights,
  createWizardSession,
  fetchWizardSession,
  rewindWizard,
  selectWizardIdeas,
  streamBuild,
  streamIdeate,
  updateWizardDays,
  updateWizardPrefs
} from "@/api/wizard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { KeyboardAwareScrollView } from "@/components/ui/keyboard";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { SingleNightPrefsFields } from "@/components/wizard/SingleNightPrefsFields";
import { WizardPrefsFields } from "@/components/wizard/WizardPrefsFields";
import { WizardProgressPanel } from "@/components/wizard/WizardProgressPanel";
import { syncAfterPlanMutation, syncAfterRecipeMutation } from "@/hooks/sync";
import { useRecipeList, useRecipeSearch } from "@/hooks/use-recipes";
import { useWizardPrefs } from "@/hooks/use-wizard-prefs";
import { colors } from "@/lib/colors";
import {
  addDays,
  endOfDay,
  formatPrepTime,
  parseDateKey,
  startOfDay,
  toDateKey
} from "@/lib/dates";
import { tapHaptic } from "@/lib/haptics";
import { splitInstructionSteps } from "@/lib/instructions";
import { mediaSource } from "@/lib/media";
import {
  buildCommitNightsPayload,
  buildWizardWeeks,
  draftFromBuiltRecipe,
  draftFromExistingRecipe,
  draftFromImportedRecipe,
  requiredWeekCountForDays,
  type DraftNightEntry
} from "@/lib/wizard";
import { toast } from "@/stores/toast";
import {
  emptyWizardPrefs,
  type MealPlanWizardBuiltRecipe,
  type MealPlanWizardPrefs,
  type MealPlanWizardProgressEvent,
  type MealPlanWizardSession,
  type MealPlanWizardStep,
  type RecipeCard
} from "@/types";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  TextInput,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ASSIGN_DAY_COUNT = 14;

type UiStep = "days" | "hub" | "prefs" | "ideate" | "select" | "build" | "review" | "assign";
type FlowContext = "week-fill" | "single-night" | "standalone-recipe";
type InputMode = "structured" | "simple";

export default function MealPlanWizardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ days?: string; mode?: string }>();
  const { prefs: savedPrefs, savePrefs, loaded: prefsLoaded } = useWizardPrefs();

  const today = useMemo(() => startOfDay(), []);
  const todayKey = toDateKey(today);
  const isDayPast = (key: string) => key < todayKey;

  const recipeMode = params.mode === "recipe";

  const daysFromQuery = useMemo(() => {
    const raw = typeof params.days === "string" ? params.days : "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => Boolean(parseDateKey(s)));
  }, [params.days]);

  // ---- Dynamic scrollable multi-week state ----
  const [weekCount, setWeekCount] = useState<number>(() =>
    recipeMode ? 2 : requiredWeekCountForDays(today, daysFromQuery)
  );
  const weeks = useMemo(() => buildWizardWeeks(today, weekCount), [today, weekCount]);
  const allLoadedDayKeys = useMemo(() => weeks.flatMap((w) => w.dayKeys), [weeks]);

  const [uiStep, setUiStep] = useState<UiStep>(recipeMode ? "prefs" : "days");
  const [flowContext, setFlowContext] = useState<FlowContext>(
    recipeMode ? "standalone-recipe" : "week-fill"
  );
  const [activeNightKey, setActiveNightKey] = useState<string | null>(null);
  const [fillTargetDays, setFillTargetDays] = useState<string[]>([]);

  const [inputMode, setInputMode] = useState<InputMode>("simple");
  const [simplePrompt, setSimplePrompt] = useState("");
  const [localPrefs, setLocalPrefs] = useState<MealPlanWizardPrefs>(emptyWizardPrefs());
  const [singleNightPrefs, setSingleNightPrefs] = useState<MealPlanWizardPrefs>(emptyWizardPrefs());

  const [selectedDays, setSelectedDays] = useState<string[]>(() =>
    recipeMode ? [todayKey] : []
  );
  /** Persistent in-progress night assignments in the hub — never wiped on Back. */
  const [draftByDay, setDraftByDay] = useState<Record<string, DraftNightEntry>>({});
  const [expandedHubDays, setExpandedHubDays] = useState<string[]>([]);

  const [session, setSession] = useState<MealPlanWizardSession | null>(null);
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

  // ---- Night action menu & modal sheets ----
  const [menuNightKey, setMenuNightKey] = useState<string | null>(null);
  const [findSheetOpen, setFindSheetOpen] = useState(false);
  const [findSearchText, setFindSearchText] = useState("");
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [importMethod, setImportMethod] = useState<"link" | "photo">("link");
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  // ---- Standalone recipeMode assign step ----
  const [assignDayKey, setAssignDayKey] = useState<string | null>(null);
  const [assignPlansByKey, setAssignPlansByKey] = useState<Record<string, string>>({});
  const [loadingAssignDays, setLoadingAssignDays] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<MealPlanWizardSession | null>(null);
  const autoLoadLockRef = useRef<number>(0);
  const findInputRef = useRef<TextInput>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [prefsSeeded, setPrefsSeeded] = useState(false);
  if (prefsLoaded && !prefsSeeded) {
    setPrefsSeeded(true);
    setLocalPrefs({ ...savedPrefs });
  }

  // ---- Recipes queries for "Choose from existing" ----
  const recipeList = useRecipeList();
  const recipeSearch = useRecipeSearch(findSearchText);
  const findResults: RecipeCard[] = useMemo(() => {
    if (findSearchText.trim()) return recipeSearch.data ?? [];
    return recipeList.data ?? [];
  }, [findSearchText, recipeSearch.data, recipeList.data]);

  useEffect(() => {
    if (!findSheetOpen) return;
    const timer = setTimeout(() => findInputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [findSheetOpen]);

  // ---- Load existing planned recipes across loaded weeks ----
  const initializedSelectionRef = useRef(false);
  useEffect(() => {
    if (recipeMode) return;
    const firstDay = weeks[0]?.days[0];
    const lastWeek = weeks[weeks.length - 1];
    const lastDay = lastWeek?.days[6];
    if (!firstDay || !lastDay) return;

    fetchPlansBetween(firstDay, endOfDay(lastDay))
      .then((plans) => {
        const titles: Record<string, string> = {};
        for (const plan of plans) {
          const key = plan.planned_for.slice(0, 10);
          if (!titles[key]) titles[key] = plan.recipe.name;
        }
        setPlannedTitles((prev) => ({ ...prev, ...titles }));
        if (!initializedSelectionRef.current) {
          initializedSelectionRef.current = true;
          if (daysFromQuery.length) {
            const valid = [...new Set(daysFromQuery.filter((k) => !isDayPast(k)))].sort();
            const openValid = valid.filter((k) => !titles[k]);
            setSelectedDays(openValid.length ? openValid : valid);
          } else {
            const firstWeekKeys = weeks[0]?.dayKeys ?? [];
            setSelectedDays(firstWeekKeys.filter((k) => !titles[k] && !isDayPast(k)));
          }
        }
      })
      .catch((er) => {
        toast.fromError(er, "Couldn’t load existing dinners.");
        if (!initializedSelectionRef.current) {
          initializedSelectionRef.current = true;
          const fallback = daysFromQuery.length ? daysFromQuery : (weeks[0]?.dayKeys ?? []);
          setSelectedDays(fallback.filter((k) => !isDayPast(k)));
        }
      })
      .finally(() => setLoadingDays(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekCount, recipeMode]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ---- Infinite scroll handler for Step 1 (days) ----
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (uiStep !== "days") return;
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (layoutMeasurement.height + contentOffset.y);
    if (distanceFromBottom < 140 && autoLoadLockRef.current !== weekCount) {
      autoLoadLockRef.current = weekCount;
      setWeekCount((c) => c + 1);
    }
  };

  const loadAnotherWeek = () => {
    tapHaptic();
    autoLoadLockRef.current = weekCount + 1;
    setWeekCount((c) => c + 1);
  };

  const toggleDay = (key: string) => {
    if (isDayPast(key)) return;
    tapHaptic();
    setSelectedDays((days) =>
      days.includes(key) ? days.filter((d) => d !== key) : [...new Set([...days, key])].sort()
    );
  };

  const selectWeekOpen = (dayKeys: string[]) => {
    tapHaptic();
    const open = dayKeys.filter((k) => !plannedTitles[k] && !isDayPast(k));
    setSelectedDays((prev) => [...new Set([...prev, ...open])].sort());
  };

  const clearWeekDays = (dayKeys: string[]) => {
    tapHaptic();
    const removeSet = new Set(dayKeys);
    setSelectedDays((prev) => prev.filter((k) => !removeSet.has(k)));
  };

  const dayLabel = (key: string) => {
    const date = parseDateKey(key);
    if (!date) return key;
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  };

  const dayFullLabel = (key: string | null) => {
    if (!key) return "";
    const date = parseDateKey(key);
    if (!date) return key;
    return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  };

  // ---- Derived counts ----
  const canContinueDays = selectedDays.length > 0;
  const plannedSelectedCount = useMemo(
    () => selectedDays.filter((d) => Boolean(draftByDay[d])).length,
    [selectedDays, draftByDay]
  );
  const openSelectedDays = useMemo(
    () => selectedDays.filter((d) => !draftByDay[d]),
    [selectedDays, draftByDay]
  );

  const isSingleNightFlow =
    flowContext === "single-night" || flowContext === "standalone-recipe";
  const activeGenerationDays = useMemo(() => {
    if (flowContext === "standalone-recipe") return [todayKey];
    if (flowContext === "single-night") return activeNightKey ? [activeNightKey] : [todayKey];
    return fillTargetDays.length ? fillTargetDays : selectedDays;
  }, [flowContext, activeNightKey, fillTargetDays, selectedDays, todayKey]);

  const selectCount = session?.select_count ?? activeGenerationDays.length;
  const selectionFull = selectedIdeaIds.length >= selectCount && selectCount > 0;
  const canContinueSelect = selectedIdeaIds.length === selectCount && selectCount > 0;
  const canStartIdeate = inputMode === "simple" ? Boolean(simplePrompt.trim()) && !busy : !busy;
  const canRefineRecipes = Boolean(refineText.trim()) && regenIdeaIds.length > 0 && !busy;

  const headerEyebrow = useMemo(() => {
    if (recipeMode) return "Create";
    if (uiStep === "days" || uiStep === "hub") return "Meal plan";
    if (flowContext === "single-night" && activeNightKey) return dayLabel(activeNightKey);
    return "Fill plan";
  }, [recipeMode, uiStep, flowContext, activeNightKey]);

  const headerTitle = useMemo(() => {
    switch (uiStep) {
      case "days":
        return "Which nights?";
      case "hub":
        return "Plan your nights";
      case "prefs":
        if (isSingleNightFlow) {
          return inputMode === "simple" ? "Describe your dinner" : "Dinner details";
        }
        return inputMode === "simple" ? "Describe your dinners" : "Set the vibe";
      case "ideate":
        return "Cooking up ideas";
      case "select":
        return isSingleNightFlow ? "Pick 1 of 3 options" : "Pick your dinners";
      case "build":
        return isSingleNightFlow ? "Building your recipe" : "Building recipes";
      case "review":
        return "Review your recipe";
      case "assign":
        return "Add to a night?";
    }
  }, [uiStep, isSingleNightFlow, inputMode]);

  // ---- Hub actions ----
  const openNightMenu = (dayKey: string) => {
    tapHaptic();
    setMenuNightKey(dayKey);
  };

  const startSingleNightGenerate = (dayKey: string) => {
    tapHaptic();
    setMenuNightKey(null);
    setError("");
    setActiveNightKey(dayKey);
    setFlowContext("single-night");
    setInputMode("simple");
    setSimplePrompt("");
    setSingleNightPrefs({
      ...emptyWizardPrefs(),
      dietary_restrictions: savedPrefs.dietary_restrictions,
      servings: savedPrefs.servings
    });
    setSession(null);
    sessionRef.current = null;
    setSelectedIdeaIds([]);
    setUiStep("prefs");
  };

  const startFindForNight = (dayKey: string) => {
    tapHaptic();
    setMenuNightKey(null);
    setActiveNightKey(dayKey);
    setFindSearchText("");
    setFindSheetOpen(true);
  };

  const pickExistingRecipeForNight = (recipe: RecipeCard) => {
    if (!activeNightKey) return;
    tapHaptic();
    setDraftByDay((prev) => ({
      ...prev,
      [activeNightKey]: draftFromExistingRecipe(recipe)
    }));
    setFindSheetOpen(false);
    toast.success(`Added to ${dayLabel(activeNightKey)}.`);
  };

  const startImportForNight = (dayKey: string) => {
    tapHaptic();
    setMenuNightKey(null);
    setActiveNightKey(dayKey);
    setImportMethod("link");
    setImportUrl("");
    setImportError("");
    setImportSheetOpen(true);
  };

  const handleImportForNight = async () => {
    if (!activeNightKey || !importUrl.trim() || importing) return;
    setImporting(true);
    setImportError("");
    try {
      const recipe = await importRecipeFromUrl(importUrl.trim());
      syncAfterRecipeMutation();
      setDraftByDay((prev) => ({
        ...prev,
        [activeNightKey]: draftFromImportedRecipe(recipe)
      }));
      setImportSheetOpen(false);
      toast.success(`Imported “${recipe.name}” for ${dayLabel(activeNightKey)}.`);
    } catch (er) {
      const message = getErrorMessage(er, "Couldn’t import that recipe.");
      setImportError(message);
      toast.fromError(er, "Couldn’t import that recipe.");
    } finally {
      setImporting(false);
    }
  };

  const removeNightDraft = (dayKey: string) => {
    tapHaptic();
    setMenuNightKey(null);
    setDraftByDay((prev) => {
      const next = { ...prev };
      delete next[dayKey];
      return next;
    });
  };

  const startFillWeekFlow = () => {
    tapHaptic();
    setError("");
    const targets = openSelectedDays.length ? openSelectedDays : selectedDays;
    setFillTargetDays(targets);
    setActiveNightKey(null);
    setFlowContext("week-fill");
    setInputMode("structured");
    setSimplePrompt("");
    setSession(null);
    sessionRef.current = null;
    setSelectedIdeaIds([]);
    setUiStep("prefs");
  };

  // ---- LLM Session Plumbing ----
  const effectivePrefsForSession = (): MealPlanWizardPrefs => {
    if (inputMode === "simple") {
      const text = simplePrompt.trim();
      return {
        ...emptyWizardPrefs(),
        goals: text,
        extra_notes: text
      };
    }
    if (isSingleNightFlow) {
      return singleNightPrefs;
    }
    return localPrefs;
  };

  const syncGenerationSession = async (): Promise<MealPlanWizardSession> => {
    const days = activeGenerationDays;
    const prefsToUse = effectivePrefsForSession();
    if (!isSingleNightFlow && inputMode === "structured") {
      savePrefs(localPrefs);
    }
    let s = sessionRef.current;
    if (!s) {
      s = await createWizardSession(days, prefsToUse);
    } else {
      await updateWizardDays(s.id, days);
      s = await updateWizardPrefs(s.id, prefsToUse);
    }
    setSession(s);
    sessionRef.current = s;
    setSelectedIdeaIds(s.selected_idea_ids);
    return s;
  };

  const refreshSession = async (): Promise<MealPlanWizardSession | null> => {
    const current = sessionRef.current;
    if (!current) return null;
    const fresh = await fetchWizardSession(current.id);
    setSession(fresh);
    sessionRef.current = fresh;
    return fresh;
  };

  const runIdeate = async (refinement?: string) => {
    if (inputMode === "simple" && !simplePrompt.trim() && !refinement) {
      setError("Describe what you’d like to cook.");
      return;
    }
    setError("");
    setBusy(true);
    setRunning(true);
    setLiveEvents([]);
    setUiStep("ideate");
    let sawError = false;
    const controller = new AbortController();
    try {
      const s = await syncGenerationSession();
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

  const applyBuiltToHubAndReturn = (fresh: MealPlanWizardSession | null) => {
    if (!fresh) return;
    const days = fresh.days ?? [];
    const recipes = fresh.built_recipes ?? [];
    setDraftByDay((prev) => {
      const next = { ...prev };
      days.forEach((day, idx) => {
        const built = recipes[idx];
        if (built) {
          next[day] = draftFromBuiltRecipe(built);
        }
      });
      return next;
    });
    setUiStep("hub");
    if (flowContext === "single-night" && activeNightKey) {
      toast.success(`Recipe ready for ${dayLabel(activeNightKey)}.`);
    } else {
      toast.success(`Filled ${recipes.length} night${recipes.length === 1 ? "" : "s"}.`);
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
      const fresh = await refreshSession();
      setRefineText("");
      setRegenIdeaIds([]);
      if (!sawError) {
        if (flowContext === "standalone-recipe") {
          setUiStep("review");
        } else {
          applyBuiltToHubAndReturn(fresh);
        }
      }
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
    tapHaptic();
    if (selectCount === 1) {
      setSelectedIdeaIds((ids) => (ids.includes(id) ? [] : [id]));
      return;
    }
    const disabled = selectionFull && !selectedIdeaIds.includes(id);
    if (disabled) return;
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
      const prefsToUse = effectivePrefsForSession();
      if (!isSingleNightFlow && inputMode === "structured") {
        savePrefs(localPrefs);
      }
      const afterPrefs = await updateWizardPrefs(current.id, prefsToUse);
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
      await runBuild(text, [...regenIdeaIds]);
    }
  };

  const rewindTo = async (step: UiStep) => {
    const current = sessionRef.current;
    if (!current) {
      setUiStep(step);
      return;
    }
    if (step === "prefs") {
      if (current.ideas.length || current.built_recipes.length) {
        try {
          const rewound = await rewindWizard(current.id, "prefs");
          setSession(rewound);
          sessionRef.current = rewound;
        } catch (e) {
          toast.fromError(e, "Couldn’t reset the wizard step.");
        }
      }
      setSelectedIdeaIds([]);
      setLiveEvents([]);
      setUiStep("prefs");
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
    setError("");
    if (uiStep === "days" || (recipeMode && uiStep === "prefs")) {
      leaveWizard();
      return;
    }
    if (uiStep === "hub") {
      // Non-destructive Back to night selection: keep draftByDay intact!
      setUiStep("days");
      return;
    }
    if (uiStep === "prefs") {
      setUiStep("hub");
      return;
    }
    if (uiStep === "assign") {
      setUiStep("review");
      return;
    }
    abortRef.current?.abort();
    setRunning(false);
    if (uiStep === "ideate" || uiStep === "select") {
      await rewindTo("prefs");
      return;
    }
    if (uiStep === "build" || uiStep === "review") {
      await rewindTo("select");
      return;
    }
  };

  // ---- Save plan from Hub ----
  const saveHubPlan = async () => {
    setError("");
    const items = buildCommitNightsPayload(selectedDays, draftByDay);
    if (!items.length) {
      router.replace("/planner");
      return;
    }
    setBusy(true);
    try {
      await commitWizardNights(items);
      const hadGenerated = items.some((i) => Boolean(i.built_recipe));
      syncAfterPlanMutation({ recipesChanged: hadGenerated });
      toast.success("Meal plan saved.");
      router.replace("/planner");
    } catch (e) {
      const msg = "Could not save plan";
      setError(getErrorMessage(e, msg));
      toast.fromError(e, msg);
    } finally {
      setBusy(false);
    }
  };

  // ---- Standalone recipeMode review & assign ----
  const planRows = useMemo(() => {
    const days = session?.days ?? [];
    const recipes = session?.built_recipes ?? [];
    return days.map((day, i) => ({ day, recipe: recipes[i] ?? null }));
  }, [session]);

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

  const recipeTitle = session?.built_recipes[0]?.title?.trim() || "your recipe";

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
      const firstOpen = Array.from({ length: ASSIGN_DAY_COUNT }, (_, i) =>
        toDateKey(addDays(today, i))
      ).find((key) => !titles[key]);
      setAssignDayKey(firstOpen ?? null);
    } catch (e) {
      toast.fromError(e, "Couldn’t load your meal plan.");
    } finally {
      setLoadingAssignDays(false);
    }
  };

  const commitStandaloneRecipe = async (opts?: { assignDay?: string | null }) => {
    const current = sessionRef.current;
    if (!current) return;
    setError("");
    setBusy(true);
    try {
      await commitWizard(current.id, { plan: false });
      const refreshed = await fetchWizardSession(current.id);
      setSession(refreshed);
      sessionRef.current = refreshed;
      const built = refreshed.built_recipes[0];
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
    } catch (e) {
      const msg = "Could not save recipe";
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

  const hasFloatingFooter = uiStep === "days" || uiStep === "hub";

  return (
    <View className="flex-1 bg-background">
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: hasFloatingFooter ? insets.bottom + 116 : insets.bottom + 32
        }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        onScroll={handleScroll}
        scrollEventThrottle={16}
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
              {headerEyebrow}
            </Text>
            <Text className="font-sans-bold text-lg" numberOfLines={1}>
              {headerTitle}
            </Text>
          </View>
          {session?.stubbed && uiStep !== "days" && uiStep !== "hub" ? (
            <View className="rounded-full border border-border bg-secondary px-2 py-0.5">
              <Text className="font-sans-semibold text-[10px] text-faint">Stub LLM</Text>
            </View>
          ) : null}
        </View>

        {error ? (
          <View className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2">
            <Text className="text-sm text-destructive">{error}</Text>
          </View>
        ) : null}

        {/* STEP 1: SCROLLABLE MULTI-WEEK NIGHT SELECTION */}
        {uiStep === "days" ? (
          <View className="mt-4 gap-5">
            <Text className="text-sm text-muted-foreground">
              {loadingDays
                ? "Checking what’s already planned…"
                : "Tap nights to include in your meal plan. Scroll down to add more weeks."}
            </Text>

            {weeks.map((week) => (
              <View key={week.weekIndex} className="gap-2">
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="font-sans-semibold text-sm">{week.label}</Text>
                  <View className="flex-row gap-3">
                    <Pressable onPress={() => selectWeekOpen(week.dayKeys)} hitSlop={8}>
                      <Text className="font-sans-semibold text-[12px] text-[#22c55e]">Open</Text>
                    </Pressable>
                    <Pressable onPress={() => clearWeekDays(week.dayKeys)} hitSlop={8}>
                      <Text className="font-sans-semibold text-[12px] text-faint">None</Text>
                    </Pressable>
                  </View>
                </View>

                <View className="overflow-hidden rounded-xl border border-border bg-card">
                  {week.days.map((day, i) => {
                    const key = week.dayKeys[i]!;
                    const selected = selectedDays.includes(key);
                    const draft = draftByDay[key] ?? null;
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
                          ) : draft ? (
                            <Text
                              className="mt-0.5 font-sans-medium text-[12px] text-success-soft"
                              numberOfLines={1}
                            >
                              {draft.title}
                            </Text>
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
                              : draft
                                ? "rounded-full border border-[#22c55e]/40 bg-[#22c55e]/20 px-2 py-0.5"
                                : selected
                                  ? "rounded-full bg-[#22c55e]/20 px-2 py-0.5"
                                  : "rounded-full bg-secondary px-2 py-0.5"
                          }
                        >
                          <Text
                            className={
                              past
                                ? "font-sans-semibold text-[11px] text-faint"
                                : draft || selected
                                  ? "font-sans-semibold text-[11px] text-success-soft"
                                  : plannedTitle
                                    ? "font-sans-semibold text-[11px] text-muted-foreground"
                                    : "font-sans-semibold text-[11px] text-faint"
                            }
                          >
                            {past
                              ? "Past"
                              : draft
                                ? "Planned"
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
              </View>
            ))}

            <Pressable
              accessibilityRole="button"
              onPress={loadAnotherWeek}
              className="items-center justify-center rounded-xl border border-dashed border-border py-3 active:opacity-70"
            >
              <Text className="font-sans-semibold text-xs text-muted-foreground">
                + Show next week ({allLoadedDayKeys.length / 7} weeks loaded)
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* STEP 2: NIGHT-BY-NIGHT PLANNING HUB */}
        {uiStep === "hub" ? (
          <View className="mt-4 gap-4">
            {/* Top summary & lazy Fill Plan bar */}
            <View className="flex-row items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5">
              <View className="min-w-0 flex-1">
                <Text className="font-sans-semibold text-sm">
                  {plannedSelectedCount} of {selectedDays.length} night
                  {selectedDays.length === 1 ? "" : "s"} planned
                </Text>
                <Text className="mt-0.5 text-xs text-muted-foreground">
                  Plan each night below, or auto-fill the rest at once.
                </Text>
              </View>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={busy}
                onPress={startFillWeekFlow}
              >
                <Sparkles size={14} color={colors.foreground} />
                Fill plan
              </Button>
            </View>

            {/* Night-by-night cards */}
            <View className="gap-2.5">
              {selectedDays.map((dayKey) => {
                const entry = draftByDay[dayKey] ?? null;
                const existingTitle = plannedTitles[dayKey] ?? null;
                const expanded = expandedHubDays.includes(dayKey);
                const canExpand = Boolean(
                  entry && (entry.builtRecipe || entry.description)
                );

                return (
                  <View
                    key={dayKey}
                    className={
                      entry
                        ? "overflow-hidden rounded-xl border border-[#22c55e]/35 bg-card"
                        : "overflow-hidden rounded-xl border border-border bg-card"
                    }
                  >
                    <View className="flex-row items-center gap-3 px-3.5 py-3">
                      <Pressable
                        className="min-w-0 flex-1"
                        disabled={!canExpand && Boolean(entry)}
                        onPress={() => {
                          if (!entry) {
                            openNightMenu(dayKey);
                            return;
                          }
                          if (canExpand) {
                            setExpandedHubDays((prev) =>
                              prev.includes(dayKey)
                                ? prev.filter((k) => k !== dayKey)
                                : [...prev, dayKey]
                            );
                          }
                        }}
                      >
                        <View className="flex-row items-center gap-2">
                          <Text className="font-sans-bold text-[11px] uppercase tracking-wide text-faint">
                            {dayLabel(dayKey)}
                          </Text>
                          {dayKey === todayKey ? (
                            <Text className="font-sans-bold text-[10px] uppercase text-[#22c55e]">
                              Today
                            </Text>
                          ) : null}
                          {entry ? (
                            <View className="rounded-full bg-[#22c55e]/15 px-2 py-0.5">
                              <Text className="font-sans-semibold text-[10px] text-success-soft">
                                {entry.kind === "generated"
                                  ? "Generated"
                                  : entry.kind === "imported"
                                    ? "Imported"
                                    : "Saved"}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        {entry ? (
                          <View className="mt-1 flex-row items-center gap-2.5">
                            {entry.cover_url ? (
                              <Image
                                source={mediaSource(entry.cover_url)}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 8,
                                  backgroundColor: colors.muted
                                }}
                                contentFit="cover"
                              />
                            ) : null}
                            <View className="min-w-0 flex-1">
                              <Text className="font-sans-semibold text-sm leading-5" numberOfLines={2}>
                                {entry.title}
                              </Text>
                              {entry.prep_time ? (
                                <Text className="mt-0.5 text-[11px] text-muted-foreground">
                                  {formatPrepTime(entry.prep_time)}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        ) : (
                          <Text className="mt-1 text-sm text-muted-foreground">
                            {existingTitle ? `Replacing: ${existingTitle}` : "Not planned yet"}
                          </Text>
                        )}
                      </Pressable>

                      <Button
                        size="sm"
                        variant={entry ? "outline" : "default"}
                        onPress={() => openNightMenu(dayKey)}
                      >
                        {entry ? "Change" : "Plan"}
                      </Button>
                    </View>

                    {entry && expanded ? (
                      <View className="gap-3 border-t border-border px-3.5 pb-3.5 pt-2.5">
                        {entry.description ? (
                          <Text className="text-sm text-muted-foreground">
                            {entry.description}
                          </Text>
                        ) : null}

                        {entry.builtRecipe?.ingredients?.length ? (
                          <View>
                            <Text className="font-sans-semibold text-xs uppercase tracking-wide text-faint">
                              Ingredients
                            </Text>
                            <View className="mt-1.5 gap-1">
                              {entry.builtRecipe.ingredients.map((ing, idx) => (
                                <Text
                                  key={`${dayKey}-ing-${idx}`}
                                  className="text-sm text-foreground/90"
                                >
                                  {formatIngredient(ing)}
                                </Text>
                              ))}
                            </View>
                          </View>
                        ) : null}

                        {entry.builtRecipe?.instructions ? (
                          <View>
                            <Text className="font-sans-semibold text-xs uppercase tracking-wide text-faint">
                              Instructions
                            </Text>
                            <View className="mt-1.5 gap-2">
                              {splitInstructionSteps(entry.builtRecipe.instructions).map(
                                (step, idx) => (
                                  <Text
                                    key={`${dayKey}-step-${idx}`}
                                    className="text-sm leading-6 text-foreground/90"
                                  >
                                    {step}
                                  </Text>
                                )
                              )}
                            </View>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* PREFS (for Single-Night Generate, Fill Plan, or Standalone Recipe) */}
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
                  className={`text-center font-sans-semibold text-sm ${
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
                  className={`text-center font-sans-semibold text-sm ${
                    inputMode === "structured" ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {isSingleNightFlow ? "Dinner form" : "Week form"}
                </Text>
              </Pressable>
            </View>

            {inputMode === "simple" ? (
              <>
                <Text className="mb-3 text-sm text-muted-foreground">
                  {isSingleNightFlow
                    ? "Describe what you want to cook — ingredients on hand, style, dietary needs, etc. We’ll generate 3 options."
                    : `Describe dinners for your ${activeGenerationDays.length} night${activeGenerationDays.length === 1 ? "" : "s"}.`}
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
            ) : isSingleNightFlow ? (
              <>
                <Text className="mb-4 text-sm text-muted-foreground">
                  Tell us what sounds good for this dinner and we’ll propose 3 options.
                </Text>
                <SingleNightPrefsFields prefs={singleNightPrefs} onChange={setSingleNightPrefs} />
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
                onPress={() => void goBack()}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={!canStartIdeate}
                onPress={() => void runIdeate()}
              >
                <Sparkles size={14} color={colors.foreground} />
                {isSingleNightFlow ? "Get 3 options" : "Generate ideas"}
              </Button>
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
                  ? isSingleNightFlow
                    ? "Generating 3 dinner options"
                    : `Aiming for ${session?.idea_target_count ?? activeGenerationDays.length + 5} options`
                  : isSingleNightFlow
                    ? "Writing your chosen recipe"
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
                  onPress={() => (uiStep === "ideate" ? void runIdeate() : void runBuild())}
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
                {selectCount === 1 ? (
                  "Pick 1 of the 3 options below to generate the full recipe."
                ) : selectionFull ? (
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
                  selectionFull
                    ? "font-sans-semibold text-xs text-success-soft"
                    : "text-xs text-faint"
                }
              >
                {selectedIdeaIds.length} / {selectCount}
              </Text>
            </View>

            <View className="gap-2">
              {(session?.ideas ?? []).map((idea) => {
                const selected = selectedIdeaIds.includes(idea.id);
                const disabled = selectCount > 1 && selectionFull && !selected;
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
                      {selected ? (
                        <Check size={13} color={colors.foreground} strokeWidth={3} />
                      ) : null}
                    </View>
                    <Text className="min-w-0 flex-1 font-sans-semibold text-sm leading-5">
                      {idea.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {!isSingleNightFlow ? (
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
            ) : null}

            <View className="rounded-xl border border-border bg-card p-3">
              <Text className="font-sans-semibold text-sm">Refine options</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                Tweaks re-run ideation with prior context — not from scratch.
              </Text>
              <Textarea
                className="mt-2 min-h-16"
                placeholder="More vegetarian options, less pasta, something spicier…"
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
                {isSingleNightFlow ? "Generate recipe" : "Build recipes"}
              </Button>
            </View>
          </View>
        ) : null}

        {/* REVIEW (standalone recipeMode only) */}
        {uiStep === "review" ? (
          <View className="mt-5 gap-4">
            <Text className="text-sm text-muted-foreground">
              Here’s your recipe. Expand for the full write-up, or mark it to regenerate.
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
                        style={{
                          marginTop: 2,
                          transform: [{ rotate: expanded ? "90deg" : "0deg" }]
                        }}
                      />
                      <View className="min-w-0 flex-1">
                        <Text className="font-sans-semibold text-[11px] uppercase tracking-wide text-faint">
                          New recipe
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
              <Text className="font-sans-semibold text-sm">Refine recipe</Text>
              <Text className="mt-0.5 text-xs text-muted-foreground">
                Mark the recipe above, then describe any tweaks.
              </Text>
              <Textarea
                className="mt-2 min-h-16"
                placeholder="Make it spicier, cut cook time, swap tofu for chicken…"
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
                Regenerate
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
              <Button className="flex-1" disabled={busy} onPress={() => void openAssignStep()}>
                {busy ? "Saving…" : "Continue"}
              </Button>
            </View>
          </View>
        ) : null}

        {/* ASSIGN (standalone recipeMode only) */}
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
                onPress={() => void commitStandaloneRecipe({ assignDay: null })}
              >
                {busy ? "Saving…" : "Skip"}
              </Button>
              <Button
                className="flex-1"
                disabled={busy || loadingAssignDays || !assignDayKey}
                onPress={() => void commitStandaloneRecipe({ assignDay: assignDayKey })}
              >
                {busy ? "Saving…" : "Save & plan"}
              </Button>
            </View>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      {/* FLOATING FOOTER FOR STEP 1 (DAYS) & STEP 2 (HUB) */}
      {uiStep === "days" ? (
        <View
          className="border-t border-border/80 bg-background/95 px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <Button
            className="w-full"
            disabled={!canContinueDays || busy || loadingDays}
            onPress={() => {
              tapHaptic();
              setError("");
              setUiStep("hub");
            }}
          >
            {`Continue with ${selectedDays.length} night${selectedDays.length === 1 ? "" : "s"}`}
          </Button>
        </View>
      ) : null}

      {uiStep === "hub" ? (
        <View
          className="flex-row gap-2 border-t border-border/80 bg-background/95 px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onPress={() => {
              tapHaptic();
              setUiStep("days");
            }}
          >
            Back
          </Button>
          <Button
            className="flex-1"
            disabled={busy}
            onPress={() => void saveHubPlan()}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </View>
      ) : null}

      {/* NIGHT ACTION MENU SHEET (Generate / Choose from existing / Import) */}
      <Sheet visible={menuNightKey !== null} onClose={() => setMenuNightKey(null)}>
        <Text className="px-1 pb-1 font-sans-semibold text-base">
          {dayFullLabel(menuNightKey)}
        </Text>
        <Text className="px-1 pb-3 text-xs text-muted-foreground">
          Choose how you’d like to plan this night.
        </Text>

        <View className="gap-1.5">
          <Pressable
            accessibilityRole="button"
            onPress={() => menuNightKey && startSingleNightGenerate(menuNightKey)}
            className="flex-row items-center gap-3 rounded-xl border border-[#22c55e]/40 bg-[#22c55e]/10 px-3 py-3 active:opacity-80"
          >
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Sparkles size={17} color={colors.foreground} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="font-sans-semibold text-sm">Generate a recipe</Text>
              <Text className="text-xs text-muted-foreground">
                Describe a craving or use the dinner form
              </Text>
            </View>
            <ChevronRight size={16} color={colors.faint} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => menuNightKey && startFindForNight(menuNightKey)}
            className="flex-row items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-3 active:opacity-80"
          >
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-secondary">
              <Search size={17} color={colors.foreground} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="font-sans-semibold text-sm">Choose from existing</Text>
              <Text className="text-xs text-muted-foreground">
                Search and pick from your saved recipe book
              </Text>
            </View>
            <ChevronRight size={16} color={colors.faint} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => menuNightKey && startImportForNight(menuNightKey)}
            className="flex-row items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-3 active:opacity-80"
          >
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-secondary">
              <Plus size={17} color={colors.foreground} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="font-sans-semibold text-sm">Import new</Text>
              <Text className="text-xs text-muted-foreground">
                Paste a recipe link to save and attach
              </Text>
            </View>
            <ChevronRight size={16} color={colors.faint} />
          </Pressable>

          {menuNightKey && draftByDay[menuNightKey] ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => removeNightDraft(menuNightKey)}
              className="mt-1 flex-row items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 active:opacity-80"
            >
              <Trash2 size={16} color={colors.destructive} />
              <Text className="font-sans-semibold text-sm text-destructive">
                Remove from this night
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Sheet>

      {/* CHOOSE FROM EXISTING RECIPE SHEET */}
      <Sheet
        fullHeight
        visible={findSheetOpen}
        onClose={() => {
          setFindSheetOpen(false);
          setFindSearchText("");
        }}
      >
        <View className="min-h-0 flex-1">
          <Text className="px-1 pb-1 font-sans-semibold text-lg">
            Choose recipe for {dayLabel(activeNightKey ?? "")}
          </Text>
          <Text className="px-1 pb-3 text-sm text-muted-foreground">
            Tap any saved recipe to attach it to this night.
          </Text>
          <View className="relative mb-3">
            <View className="absolute left-3 top-0 z-10 h-11 justify-center">
              <Search size={16} color={colors.faint} />
            </View>
            <Input
              ref={findInputRef}
              value={findSearchText}
              onChangeText={setFindSearchText}
              placeholder="Search recipes…"
              className="h-11 rounded-xl bg-secondary/40 pl-10"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
          </View>
          <ScrollView
            className="min-h-0 flex-1"
            contentContainerClassName="gap-2 pb-2"
            keyboardShouldPersistTaps="handled"
          >
            {recipeList.isPending ||
            (findSearchText.trim() && recipeSearch.isFetching && !findResults.length) ? (
              [0, 1, 2, 3].map((n) => (
                <View
                  key={n}
                  className="flex-row items-center gap-3 rounded-xl border border-border px-2 py-2"
                >
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <View className="flex-1 gap-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-2.5 w-full" />
                  </View>
                </View>
              ))
            ) : findResults.length ? (
              findResults.map((recipe) => (
                <Pressable
                  key={recipe.id}
                  accessibilityRole="button"
                  onPress={() => pickExistingRecipeForNight(recipe)}
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-secondary/40 px-2 py-2 active:opacity-80"
                >
                  <Image
                    source={mediaSource(recipe.cover_image?.url)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      backgroundColor: colors.muted
                    }}
                    contentFit="cover"
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="font-sans-semibold text-sm" numberOfLines={1}>
                      {recipe.name}
                    </Text>
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {recipe.description}
                    </Text>
                  </View>
                </Pressable>
              ))
            ) : (
              <Text className="py-6 text-center text-sm text-muted-foreground">
                {findSearchText.trim()
                  ? "No recipes matched that search."
                  : "No saved recipes yet."}
              </Text>
            )}
          </ScrollView>
          <View className="mt-2">
            <Button variant="outline" className="w-full" onPress={() => setFindSheetOpen(false)}>
              Cancel
            </Button>
          </View>
        </View>
      </Sheet>

      {/* IMPORT RECIPE SHEET */}
      <Sheet
        visible={importSheetOpen}
        onClose={() => {
          if (!importing) setImportSheetOpen(false);
        }}
      >
        <Text className="px-1 pb-1 font-sans-semibold text-lg">
          Import for {dayLabel(activeNightKey ?? "")}
        </Text>
        <Text className="px-1 pb-3 text-sm text-muted-foreground">
          Paste a recipe link to save it to your book and attach it to this night.
        </Text>

        <View className="mb-3 flex-row gap-2">
          <Button
            size="sm"
            variant={importMethod === "link" ? "default" : "outline"}
            onPress={() => setImportMethod("link")}
          >
            <Link2 size={15} color={colors.foreground} />
            Link
          </Button>
          <Button
            size="sm"
            variant={importMethod === "photo" ? "default" : "outline"}
            onPress={() => setImportMethod("photo")}
          >
            <Camera size={15} color={colors.foreground} />
            Photo
          </Button>
        </View>

        {importMethod === "link" ? (
          <View>
            <Label className="text-muted-foreground">Recipe URL</Label>
            <Input
              value={importUrl}
              onChangeText={setImportUrl}
              placeholder="https://…"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!importing}
              onSubmitEditing={() => void handleImportForNight()}
              returnKeyType="go"
              className="mt-2 h-11 rounded-xl bg-secondary"
            />
            {importError ? (
              <Text className="mt-2 text-xs text-destructive">{importError}</Text>
            ) : null}
            <View className="mt-4 flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={importing}
                onPress={() => setImportSheetOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={!importUrl.trim() || importing}
                onPress={() => void handleImportForNight()}
              >
                {importing ? <Spinner color={colors.foreground} /> : null}
                {importing ? "Importing…" : "Import & attach"}
              </Button>
            </View>
          </View>
        ) : (
          <View>
            <View className="min-h-[140px] items-center justify-center rounded-xl border border-dashed border-border bg-secondary/50 px-4">
              <Camera size={28} color={colors.green500} />
              <Text className="mt-2 font-sans-semibold text-sm">Scan a photo</Text>
              <Text className="mt-1 text-center text-xs text-muted-foreground">
                Cookbook pages and handwritten cards — not available yet.
              </Text>
            </View>
            <Button
              variant="outline"
              className="mt-3 w-full"
              onPress={() => setImportSheetOpen(false)}
            >
              Close
            </Button>
          </View>
        )}
      </Sheet>
    </View>
  );
}

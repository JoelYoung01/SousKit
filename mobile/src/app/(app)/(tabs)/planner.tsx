import { createPlan, deletePlan } from "@/api/planner";
import { SwipeRow } from "@/components/SwipeRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { addDays, endOfDay, parseDateKey, startOfDay, startOfWeekMonday, toDateKey } from "@/lib/dates";
import { tapHaptic } from "@/lib/haptics";
import { mediaSource } from "@/lib/media";
import { syncAfterPlanMutation } from "@/hooks/sync";
import { groupPlansByDay, usePlansRange } from "@/hooks/use-planner";
import { useRecipeList, useRecipeSearch } from "@/hooks/use-recipes";
import { toast } from "@/stores/toast";
import type { PlannedRecipeDetail, RecipeCard } from "@/types";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, Search, Sparkles, Trash2 } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const WEEK_COUNT = 8;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function PlannerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardState((s) => (s.isVisible ? s.height : 0));
  // Keep sheet action rows above the keyboard by shrinking the recipe list.
  const sheetListMaxHeight = Math.min(
    320,
    Math.max(120, (windowHeight - keyboardHeight) * 0.88 - 260)
  );
  const params = useLocalSearchParams<{ date?: string }>();

  const today = useMemo(() => startOfDay(), []);
  const todayKey = toDateKey(today);
  const currentWeekStart = useMemo(() => startOfWeekMonday(today), [today]);

  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const fromParam = typeof params.date === "string" ? parseDateKey(params.date) : null;
    return fromParam ?? today;
  });

  // Follow ?date= updates (e.g. tapping a day on Home while Planner is
  // mounted) via the adjust-state-in-render pattern.
  const [seenDateParam, setSeenDateParam] = useState(params.date);
  if (params.date !== seenDateParam) {
    setSeenDateParam(params.date);
    const parsed = typeof params.date === "string" ? parseDateKey(params.date) : null;
    if (parsed) setSelectedDate(parsed);
  }

  const rangeEnd = useMemo(
    () => endOfDay(addDays(currentWeekStart, WEEK_COUNT * 7 - 1)),
    [currentWeekStart]
  );
  const plansQuery = usePlansRange(currentWeekStart, rangeEnd);

  useEffect(() => {
    if (plansQuery.isError) toast.fromError(plansQuery.error, "Couldn’t load your meal plan.");
  }, [plansQuery.isError, plansQuery.error]);

  const plannedByDay = useMemo(() => groupPlansByDay(plansQuery.data), [plansQuery.data]);
  const showDaySkeletons = plansQuery.isPending;

  const weeks = useMemo(
    () =>
      Array.from({ length: WEEK_COUNT }, (_, weekIndex) => {
        const weekStart = addDays(currentWeekStart, weekIndex * 7);
        const days = Array.from({ length: 7 }, (_, dayIndex) => addDays(weekStart, dayIndex));
        return { weekIndex, weekStart, days };
      }),
    [currentWeekStart]
  );

  const selectedKey = toDateKey(selectedDate);
  const currentPlannedRecipes = plannedByDay.get(selectedKey) ?? [];
  const currentWeekGapDays = (weeks[0]?.days ?? []).filter(
    (d) => (plannedByDay.get(toDateKey(d)) ?? []).length === 0
  );

  const formattedSelectedDate = useMemo(() => {
    const date = selectedDate;
    const currentYear = new Date().getFullYear();
    const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const datePart =
      date.getFullYear() === currentYear
        ? `${month} ${date.getDate()}`
        : `${month} ${date.getDate()}, ${date.getFullYear()}`;
    return `${weekday} · ${datePart}`;
  }, [selectedDate]);

  function weekLabel(weekStart: Date, weekIndex: number): string {
    if (weekIndex === 0) return "This week";
    if (weekIndex === 1) return "Next week";
    const end = addDays(weekStart, 6);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${weekStart.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
  }

  const openFill = (days: Date[]) => {
    tapHaptic();
    const keys = days.map(toDateKey).join(",");
    router.push((keys ? `/planner/fill?days=${keys}` : "/planner/fill") as never);
  };

  /** Week containing the selected day — target for the thumb-reach Plan week FAB. */
  const selectedWeekDays = useMemo(() => {
    const weekStart = startOfWeekMonday(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [selectedDate]);

  const openPlanWeekFab = () => openFill(selectedWeekDays);

  // ---- Assign sheet (multi-select "Change") ----
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [assigning, setAssigning] = useState(false);
  const recipeList = useRecipeList();

  // ---- Empty-night search sheet ----
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [pickingId, setPickingId] = useState<number | null>(null);
  const recipeSearch = useRecipeSearch(searchText);
  const searchResults: RecipeCard[] = useMemo(() => {
    // Preserve API relevance order for search results.
    if (searchText.trim()) return recipeSearch.data ?? [];
    return recipeList.data ?? [];
  }, [searchText, recipeSearch.data, recipeList.data]);

  const openNightSearch = () => {
    tapHaptic();
    setSearchText("");
    setSearchSheetOpen(true);
  };

  const onDayPress = (day: Date, dayPlans: PlannedRecipeDetail[]) => {
    tapHaptic();
    const next = startOfDay(day);
    setSelectedDate(next);
    if (dayPlans.length) {
      router.push(`/recipes/${dayPlans[0]!.recipe.id}` as never);
      return;
    }
    openNightSearch();
  };

  const pickRecipeForNight = async (recipe: RecipeCard) => {
    if (pickingId !== null) return;
    setPickingId(recipe.id);
    try {
      await createPlan(recipe.id, selectedDate);
      syncAfterPlanMutation();
      setSearchSheetOpen(false);
      toast.success("Added to plan.");
    } catch (error) {
      toast.fromError(error, "Couldn’t add that recipe to the plan.");
    } finally {
      setPickingId(null);
    }
  };

  const openAssign = () => {
    tapHaptic();
    setSelectedIds(currentPlannedRecipes.map((p) => p.recipe.id));
    setSheetOpen(true);
  };

  const toggleRecipe = (id: number) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const assignRecipes = async () => {
    if (assigning) return;
    const existing = currentPlannedRecipes;
    const existingIds = existing.map((p) => p.recipe.id);
    const added = selectedIds.filter((id) => !existingIds.includes(id));
    const removed = existing.filter((pr) => !selectedIds.includes(pr.recipe.id));
    setAssigning(true);
    try {
      await Promise.all([
        ...added.map((id) => createPlan(id, selectedDate)),
        ...removed.map((pr) => deletePlan(pr.id))
      ]);
      syncAfterPlanMutation();
      setSheetOpen(false);
      toast.success("Meal plan updated.");
    } catch (error) {
      toast.fromError(error, "Couldn’t update this day’s plan.");
    } finally {
      setAssigning(false);
    }
  };

  const removePlanned = async (planned: PlannedRecipeDetail) => {
    try {
      await deletePlan(planned.id);
      syncAfterPlanMutation();
      toast.success("Removed from plan.");
    } catch (er) {
      toast.fromError(er, "Couldn’t remove that meal.");
    }
  };

  const unplanDay = async (plans: PlannedRecipeDetail[]) => {
    if (!plans.length) return;
    try {
      await Promise.all(plans.map((pr) => deletePlan(pr.id)));
      syncAfterPlanMutation();
      toast.success("Removed from plan.");
    } catch (er) {
      toast.fromError(er, "Couldn’t remove that meal.");
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: insets.top + 20,
          paddingHorizontal: 16,
          // Clear the floating Plan week CTA above the tab bar.
          paddingBottom: 88
        }}
      >
        <View className="flex-row items-start justify-between gap-3">
          <View>
            <Text className="font-sans-bold text-xl">Planner</Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              This week up top — scroll for more
            </Text>
          </View>
          <Button size="sm" className="shrink-0" onPress={() => openFill(currentWeekGapDays)}>
            <Sparkles size={14} color={colors.foreground} />
            Fill gaps
          </Button>
        </View>

        <View className="mt-4 gap-5">
          {weeks.map((week) => {
            const plannedCount = week.days.filter(
              (d) => (plannedByDay.get(toDateKey(d)) ?? []).length
            ).length;
            return (
              <View key={week.weekIndex} className="gap-2">
                <View className="border-b border-border/80 py-2">
                  <Text className="font-sans-semibold text-sm">
                    {weekLabel(week.weekStart, week.weekIndex)}
                  </Text>
                  <Text className="text-[11px] text-faint">{plannedCount} / 7 planned</Text>
                </View>

                <View className="overflow-hidden rounded-xl border border-border bg-card">
                  {week.days.map((day, dayIndex) => {
                    const key = toDateKey(day);
                    const dayPlans = plannedByDay.get(key) ?? [];
                    const isSelected = key === selectedKey;
                    const isToday = key === todayKey;
                    const row = (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => onDayPress(day, dayPlans)}
                        className={
                          isSelected
                            ? "flex-row items-center gap-3 border-b border-border bg-[#22c55e]/10 px-3 py-2.5"
                            : "flex-row items-center gap-3 border-b border-border px-3 py-2.5 active:bg-secondary/50"
                        }
                        style={dayIndex === 6 ? { borderBottomWidth: 0 } : undefined}
                      >
                        <View className="w-11 items-center">
                          <Text
                            className={
                              isToday
                                ? "font-sans-semibold text-[10px] uppercase tracking-wide text-[#22c55e]"
                                : "font-sans-semibold text-[10px] uppercase tracking-wide text-faint"
                            }
                          >
                            {DAY_LABELS[dayIndex]}
                          </Text>
                          <Text
                            className={
                              isToday
                                ? "mt-0.5 font-sans-bold text-base text-[#22c55e]"
                                : "mt-0.5 font-sans-bold text-base text-foreground"
                            }
                          >
                            {day.getDate()}
                          </Text>
                        </View>

                        <View className="min-w-0 flex-1">
                          {showDaySkeletons && week.weekIndex === 0 ? (
                            <View className="flex-row items-center gap-2">
                              <Skeleton className="h-9 w-9 rounded-lg" />
                              <View className="flex-1 gap-1.5">
                                <Skeleton className="h-3.5 w-2/3" />
                                <Skeleton className="h-2.5 w-1/3" />
                              </View>
                            </View>
                          ) : dayPlans.length ? (
                            <View className="flex-row items-center gap-2">
                              <Image
                                source={mediaSource(dayPlans[0]!.recipe.cover_image?.url)}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 10,
                                  backgroundColor: colors.muted
                                }}
                                contentFit="cover"
                              />
                              <View className="min-w-0 flex-1">
                                <Text className="font-sans-semibold text-sm" numberOfLines={1}>
                                  {dayPlans[0]!.recipe.name}
                                </Text>
                                <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
                                  {dayPlans.length > 1
                                    ? `+${dayPlans.length - 1} more`
                                    : "Dinner planned"}
                                </Text>
                              </View>
                            </View>
                          ) : (
                            <View className="flex-row items-center gap-2">
                              <View className="h-1.5 w-1.5 rounded-full bg-gap-dot" />
                              <Text className="text-sm text-muted-foreground">Open night</Text>
                            </View>
                          )}
                        </View>
                      </Pressable>
                    );

                    if (!dayPlans.length) {
                      return <View key={key}>{row}</View>;
                    }

                    return (
                      <SwipeRow
                        key={key}
                        canSwipeRight={false}
                        actionWidth={72}
                        deleteLabel="Unplan"
                        onDelete={() => void unplanDay(dayPlans)}
                      >
                        {row}
                      </SwipeRow>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>

        {/* Selected day detail */}
        <View className="mt-5 rounded-xl border border-border bg-card p-4">
          <Text className="font-sans-semibold text-base">{formattedSelectedDate}</Text>

          {currentPlannedRecipes.length ? (
            <View className="mt-3 gap-2">
              {currentPlannedRecipes.map((planned) => (
                <View key={planned.id} className="flex-row items-center gap-2">
                  <Pressable
                    className="flex-1 flex-row items-center gap-3 rounded-xl border border-border bg-secondary/40 p-2 active:opacity-80"
                    onPress={() => router.push(`/recipes/${planned.recipe.id}` as never)}
                  >
                    <Image
                      source={mediaSource(planned.recipe.cover_image?.url)}
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
                        {planned.recipe.name}
                      </Text>
                      <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                        {planned.recipe.description}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove from plan"
                    onPress={() => void removePlanned(planned)}
                    hitSlop={6}
                    className="h-9 w-9 items-center justify-center rounded-lg active:bg-secondary"
                  >
                    <Trash2 size={16} color={colors.destructive} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text className="mt-3 text-sm text-muted-foreground">
              No recipes planned for this date
            </Text>
          )}

          <View className="mt-4 flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onPress={currentPlannedRecipes.length ? openAssign : openNightSearch}
            >
              {currentPlannedRecipes.length ? "Change" : "Add recipes"}
            </Button>
            <Button variant="secondary" className="flex-1" onPress={() => openFill([selectedDate])}>
              <Sparkles size={14} color={colors.foreground} />
              Autofill
            </Button>
          </View>
        </View>
      </ScrollView>

      {/*
        Prefer primary planner actions low on the screen for thumb reach —
        don’t bury Plan week in week-section headers. Lifted above the raised
        tab-bar "+" (-mt-5 ≈ 20px into the scene) so center taps hit this button.
      */}
      <View pointerEvents="box-none" className="absolute inset-x-0 bottom-7 z-50 px-4">
        <Button accessibilityLabel="Plan week" className="w-full" onPress={openPlanWeekFab}>
          <CalendarDays size={16} color={colors.foreground} />
          Plan week
        </Button>
      </View>

      {/* Empty-night search sheet */}
      <Sheet
        visible={searchSheetOpen}
        onClose={() => {
          setSearchSheetOpen(false);
          setSearchText("");
        }}
      >
        <Text className="px-1 pb-1 font-sans-semibold text-lg">Plan this night</Text>
        <Text className="px-1 pb-3 text-sm text-muted-foreground">
          Search your recipes, or create a new one with the wizard.
        </Text>
        <View className="relative mb-3">
          <View className="absolute left-3 top-0 z-10 h-11 justify-center">
            <Search size={16} color={colors.faint} />
          </View>
          <Input
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search recipes…"
            className="h-11 rounded-xl bg-secondary/40 pl-10"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>
        <ScrollView
          style={{ maxHeight: sheetListMaxHeight }}
          contentContainerClassName="gap-2 pb-2"
          keyboardShouldPersistTaps="handled"
        >
          {recipeList.isPending || (searchText.trim() && recipeSearch.isFetching && !searchResults.length) ? (
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
          ) : searchResults.length ? (
            searchResults.map((recipe) => (
              <Pressable
                key={recipe.id}
                accessibilityRole="button"
                disabled={pickingId !== null}
                onPress={() => void pickRecipeForNight(recipe)}
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
              {searchText.trim()
                ? "No recipes matched that search."
                : "No recipes yet — create one below."}
            </Text>
          )}
        </ScrollView>
        <View className="mt-2 gap-2">
          <Button
            className="w-full"
            onPress={() => {
              setSearchSheetOpen(false);
              openFill([selectedDate]);
            }}
          >
            <Sparkles size={14} color={colors.foreground} />
            Create with wizard
          </Button>
          <Button variant="outline" className="w-full" onPress={() => setSearchSheetOpen(false)}>
            Cancel
          </Button>
        </View>
      </Sheet>

      {/* Recipe select sheet */}
      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <Text className="px-1 pb-2 font-sans-semibold text-lg">Select recipes</Text>
        <ScrollView
          style={{ maxHeight: sheetListMaxHeight }}
          contentContainerClassName="gap-2 pb-2"
          keyboardShouldPersistTaps="handled"
        >
          {recipeList.isPending ? (
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
          ) : (recipeList.data ?? []).length ? (
            (recipeList.data ?? []).map((recipe) => {
              const selected = selectedIds.includes(recipe.id);
              return (
                <Pressable
                  key={recipe.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => toggleRecipe(recipe.id)}
                  className={
                    selected
                      ? "flex-row items-center gap-3 rounded-xl border border-[#22c55e]/45 bg-[#22c55e]/10 px-2 py-2"
                      : "flex-row items-center gap-3 rounded-xl border border-border bg-secondary/40 px-2 py-2"
                  }
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
              );
            })
          ) : (
            <Text className="py-6 text-center text-sm text-muted-foreground">
              Add recipes first.
            </Text>
          )}
        </ScrollView>
        <View className="mt-2 flex-row gap-2">
          <Button variant="outline" className="flex-1" onPress={() => setSheetOpen(false)}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!selectedIds.length || assigning}
            onPress={assignRecipes}
          >
            {assigning ? "Assigning…" : "Assign"}
          </Button>
        </View>
      </Sheet>
    </View>
  );
}

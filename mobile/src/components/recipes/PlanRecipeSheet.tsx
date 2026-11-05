import { createPlan, deletePlan, fetchPlansBetween } from "@/api/planner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { syncAfterPlanMutation } from "@/hooks/sync";
import { addDays, startOfDay } from "@/lib/dates";
import {
  PLAN_DAY_COUNT,
  buildPlanDays,
  formatQuotedList,
  planCommit,
  planWhenLabel,
  plannedSummary,
  replacePrompt,
  type PlanMealRef
} from "@/lib/planDay";
import { toast } from "@/stores/toast";
import { Check } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

type Props = {
  visible: boolean;
  recipe: { id: number; name: string } | null;
  onClose: () => void;
};

export function PlanRecipeSheet({ visible, recipe, onClose }: Props) {
  const [today, setToday] = useState(() => startOfDay());
  const [meals, setMeals] = useState<PlanMealRef[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(visible);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [opened, setOpened] = useState(visible);

  // Reset the picker when it opens. Adjusting state during render (instead of
  // in an effect) keeps the list in sync before the plan fetch resolves.
  if (visible !== opened) {
    setOpened(visible);
    if (visible) {
      setToday(startOfDay());
      setMeals([]);
      setSelectedKey(null);
      setConfirming(false);
      setSaving(false);
      setLoading(true);
    }
  }

  const days = useMemo(() => buildPlanDays(today, meals), [today, meals]);
  const selected = days.find((day) => day.key === selectedKey) ?? null;
  const decision = recipe && selected ? planCommit(recipe.id, selected.planned) : null;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const base = today;
    fetchPlansBetween(base, addDays(base, PLAN_DAY_COUNT - 1))
      .then((plans) => {
        if (cancelled) return;
        setMeals(plans);
        const next = buildPlanDays(base, plans);
        setSelectedKey(next.find((day) => day.planned.length === 0)?.key ?? next[0]?.key ?? null);
      })
      .catch((er) => {
        if (!cancelled) toast.fromError(er, "Couldn’t load your meal plan.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, today]);

  const description = recipe
    ? `Pick a night for “${recipe.name}”. A night that already has a meal can be replaced.`
    : "Pick a night.";

  const confirmMessage =
    recipe && selected && decision?.kind === "replace"
      ? replacePrompt(
          recipe.name,
          selected,
          decision.others.map((meal) => meal.recipe.name)
        )
      : "";

  const commitLabel = saving
    ? "Planning…"
    : decision?.kind === "replace"
      ? "Replace"
      : decision?.kind === "already"
        ? "Already planned"
        : "Plan";

  const canCommit = !!recipe && !!selected && !loading && !saving && decision?.kind !== "already";

  const persist = async (replacing: boolean) => {
    if (!recipe || !selected || !decision || saving) return;
    if (replacing && decision.kind !== "replace") return;
    if (!replacing && decision.kind === "already") return;
    setSaving(true);
    try {
      const alreadyThere = selected.planned.some((meal) => meal.recipe.id === recipe.id);
      if (!alreadyThere || !replacing) {
        await createPlan(recipe.id, selected.date);
      }
      if (replacing && decision.kind === "replace") {
        await Promise.all(decision.others.map((meal) => deletePlan(meal.id)));
        toast.success(
          `Replaced ${formatQuotedList(decision.others.map((meal) => meal.recipe.name))} with “${recipe.name}” for ${planWhenLabel(selected)}.`
        );
      } else {
        toast.success(`Planned for ${planWhenLabel(selected)}.`);
      }
      syncAfterPlanMutation();
      onClose();
    } catch (er) {
      toast.fromError(er, "Couldn’t add this recipe to your plan.");
    } finally {
      setSaving(false);
    }
  };

  const footer = confirming ? (
    <View className="flex-row gap-2">
      <Button
        variant="outline"
        className="flex-1"
        disabled={saving}
        onPress={() => setConfirming(false)}
      >
        Back
      </Button>
      <Button className="flex-1" disabled={saving} onPress={() => void persist(true)}>
        {saving ? "Replacing…" : "Replace"}
      </Button>
    </View>
  ) : (
    <View className="flex-row gap-2">
      <Button variant="outline" className="flex-1" disabled={saving} onPress={onClose}>
        Cancel
      </Button>
      <Button
        className="flex-1"
        disabled={!canCommit}
        onPress={() => {
          if (decision?.kind === "replace") setConfirming(true);
          else void persist(false);
        }}
      >
        {commitLabel}
      </Button>
    </View>
  );

  return (
    <Sheet visible={visible} onClose={onClose} footer={footer}>
      <View className="gap-3 pb-1">
        <View>
          <Text className="font-sans-semibold text-base">Plan</Text>
          <Text className="mt-1 text-sm leading-5 text-muted-foreground">
            {confirming ? confirmMessage : description}
          </Text>
        </View>

        {confirming && decision?.kind === "replace" && decision.others.length > 1 ? (
          <Text className="text-sm leading-5 text-muted-foreground">
            The night will only have this recipe.
          </Text>
        ) : null}

        {!confirming && loading ? (
          <View className="overflow-hidden rounded-xl border border-border">
            {Array.from({ length: 5 }, (_, n) => (
              <View
                key={n}
                className="flex-row items-center gap-3 border-b border-border px-3 py-3"
              >
                <View className="min-w-0 flex-1 gap-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-2.5 w-14" />
                </View>
                <Skeleton className="h-3 w-10" />
              </View>
            ))}
          </View>
        ) : null}

        {!confirming && !loading ? (
          <View className="overflow-hidden rounded-xl border border-border">
            {days.map((day) => {
              const selectedDay = day.key === selectedKey;
              const summary = plannedSummary(day.planned);
              return (
                <Pressable
                  key={day.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.label}, ${day.dateLabel}. ${summary ?? "Open"}`}
                  accessibilityState={{ selected: selectedDay }}
                  onPress={() => {
                    setSelectedKey(day.key);
                    setConfirming(false);
                  }}
                  className={
                    selectedDay
                      ? "flex-row items-center gap-3 border-b border-border bg-[#22c55e]/10 px-3 py-2.5"
                      : "flex-row items-center gap-3 border-b border-border px-3 py-2.5 active:bg-secondary/50"
                  }
                >
                  <View className="min-w-0 flex-1">
                    <Text className="font-sans-semibold text-sm">{day.label}</Text>
                    <Text className="text-[11px] text-faint">{day.dateLabel}</Text>
                  </View>
                  {summary ? (
                    <Text className="max-w-[45%] text-[11px] text-faint" numberOfLines={1}>
                      {summary}
                    </Text>
                  ) : (
                    <Text className="font-sans-semibold text-[11px] text-[#4ade80]">Open</Text>
                  )}
                  {selectedDay ? <Check size={16} color="#22c55e" strokeWidth={2.5} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

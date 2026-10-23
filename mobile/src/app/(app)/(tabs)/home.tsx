import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { addDays, startOfDay, startOfWeekMonday, toDateKey } from "@/lib/dates";
import { tapHaptic } from "@/lib/haptics";
import { mediaSource } from "@/lib/media";
import { usePlansRange } from "@/hooks/use-planner";
import { useGrocerySummary } from "@/hooks/use-grocery";
import { useRecipeCount } from "@/hooks/use-recipes";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { CalendarDays, Plus, Search, ShoppingCart, Sparkles, User } from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useSessionStore((s) => s.user);

  const today = useMemo(() => startOfDay(), []);
  const thisWeekStart = useMemo(() => startOfWeekMonday(today), [today]);
  const thisWeekEnd = useMemo(() => addDays(thisWeekStart, 6), [thisWeekStart]);

  const plansQuery = usePlansRange(thisWeekStart, thisWeekEnd);
  const recipeCount = useRecipeCount();
  const groceryCount = useGrocerySummary();

  useEffect(() => {
    if (plansQuery.isError) toast.fromError(plansQuery.error, "Couldn’t load tonight’s plan.");
  }, [plansQuery.isError, plansQuery.error]);

  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);

  const todayKey = toDateKey(today);
  const tonight = plans.find((p) => p.planned_for.startsWith(todayKey)) ?? null;
  const showHeroSkeleton = plansQuery.isPending && !tonight;
  const hasPendingGrocery = (groceryCount.data ?? 0) > 0;

  const weekdayName = today.toLocaleDateString(undefined, { weekday: "long" });

  const cookTonight = () => {
    if (!tonight) {
      router.push("/planner");
      return;
    }
    router.push(`/recipes/${tonight.recipe.id}` as never);
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-6">
      {/* Tonight hero */}
      <View className="h-[300px] overflow-hidden">
        {tonight ? (
          <Image
            source={mediaSource(tonight.recipe.cover_image?.url)}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View className="absolute inset-0 bg-[#1d201d]" />
        )}
        <LinearGradient
          colors={["rgba(9,11,9,0.5)", "rgba(9,11,9,0)", "rgba(9,11,9,0.95)"]}
          locations={[0, 0.45, 1]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <View
          className="flex-row items-center justify-between px-5"
          style={{ paddingTop: insets.top + 8 }}
        >
          <Text className="font-sans-bold text-base tracking-tight">{weekdayName}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Account"
            onPress={() => {
              tapHaptic();
              router.push("/account");
            }}
            className="h-[34px] w-[34px] items-center justify-center overflow-hidden rounded-full bg-foreground/15 active:opacity-80"
          >
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={{ width: 34, height: 34 }} />
            ) : (
              <User size={16} color={colors.foreground} strokeWidth={2} />
            )}
          </Pressable>
        </View>

        <View className="absolute inset-x-0 bottom-0 flex-row items-end justify-between gap-3 px-5 pb-4">
          <View className="min-w-0 flex-1">
            <Text className="font-sans-bold text-[11px] tracking-[1px] text-success-soft">
              TONIGHT
            </Text>
            {tonight ? (
              <Text className="mt-0.5 font-sans-bold text-xl leading-tight tracking-tight">
                {tonight.recipe.name}
              </Text>
            ) : showHeroSkeleton ? (
              <Skeleton className="mt-1.5 h-6 w-40 bg-foreground/20" />
            ) : (
              <Text className="mt-0.5 font-sans-bold text-xl leading-tight tracking-tight">
                Nothing planned
              </Text>
            )}
          </View>
          <Button
            className="shrink-0 rounded-[11px] px-5"
            textClassName="text-[13px]"
            onPress={cookTonight}
          >
            {tonight ? "Cook" : "Plan"}
          </Button>
        </View>
      </View>

      {/* Action cards — 2×2 grid */}
      <View className="flex-row flex-wrap justify-between gap-y-2 px-5 pt-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Meal Plan"
          onPress={() => {
            tapHaptic();
            router.push("/planner/fill" as never);
          }}
          className="min-h-[104px] w-[48.5%] items-start justify-between rounded-xl border border-border bg-card p-3.5 active:opacity-80"
        >
          <CalendarDays size={18} color="rgba(34,197,94,0.55)" strokeWidth={2} />
          <View className="mt-3 gap-0.5">
            <Text className="font-sans-semibold text-sm">Meal Plan</Text>
            <Text className="text-[11.5px] text-faint">Plan your nights</Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a recipe"
          onPress={() => {
            tapHaptic();
            router.push("/planner/fill?mode=recipe" as never);
          }}
          className="min-h-[104px] w-[48.5%] items-start justify-between rounded-xl border border-border bg-card p-3.5 active:opacity-80"
        >
          <Sparkles size={18} color="rgba(34,197,94,0.55)" strokeWidth={2} />
          <View className="mt-3 gap-0.5">
            <Text className="font-sans-semibold text-sm">Create</Text>
            <Text className="text-[11.5px] text-faint">Cook right now</Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Import a recipe"
          onPress={() => {
            tapHaptic();
            router.push("/recipes/import?method=link" as never);
          }}
          className="min-h-[104px] w-[48.5%] items-start justify-between rounded-xl border border-border bg-card p-3.5 active:opacity-80"
        >
          <Plus size={18} color="rgba(34,197,94,0.55)" strokeWidth={2} />
          <View className="mt-3 gap-0.5">
            <Text className="font-sans-semibold text-sm">Import</Text>
            <Text className="text-[11.5px] text-faint">link · photo</Text>
          </View>
        </Pressable>

        {hasPendingGrocery ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Grocery list"
            onPress={() => {
              tapHaptic();
              router.push("/list");
            }}
            className="min-h-[104px] w-[48.5%] items-start justify-between rounded-xl border border-border bg-card p-3.5 active:opacity-80"
          >
            <ShoppingCart size={18} color="rgba(34,197,94,0.55)" strokeWidth={2} />
            <View className="mt-3 gap-0.5">
              <Text className="font-sans-semibold text-sm">Grocery</Text>
              <View className="mt-0.5 self-start rounded-full border border-[#22c55e]/35 bg-[#22c55e]/10 px-2 py-0.5">
                <Text className="font-sans-bold text-[11px] text-[#4ade80]">
                  {groceryCount.data}
                </Text>
              </View>
            </View>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Find a recipe"
            onPress={() => {
              tapHaptic();
              router.push("/recipes");
            }}
            className="min-h-[104px] w-[48.5%] items-start justify-between rounded-xl border border-border bg-card p-3.5 active:opacity-80"
          >
            <Search size={18} color="rgba(34,197,94,0.55)" strokeWidth={2} />
            <View className="mt-3 gap-0.5">
              <Text className="font-sans-semibold text-sm">Find</Text>
              {recipeCount.data === undefined ? (
                <Skeleton className="mt-1 h-3 w-10" />
              ) : (
                <Text className="text-[11.5px] text-faint">{recipeCount.data} saved</Text>
              )}
            </View>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

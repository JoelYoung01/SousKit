import { EmptyState } from "@/components/EmptyState";
import { SwipeRow } from "@/components/SwipeRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
  useCreateManualGroceryItem,
  useDeleteManualGroceryItem,
  useGroceryList,
  useSetGroceryStatus
} from "@/hooks/use-grocery";
import { colors } from "@/lib/colors";
import { formatShortRange } from "@/lib/dates";
import { getErrorMessage } from "@/api/errors";
import { tapHaptic } from "@/lib/haptics";
import { paths } from "@/lib/sitemap";
import type { GroceryItem } from "@/types";
import { useRouter } from "expo-router";
import { EyeOff, Plus, ShoppingCart } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** How long a crossed-off item stays visible so the user can undo. */
const UNDO_MS = 2000;

export default function GroceryListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [showDismissed, setShowDismissed] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [pendingHideKeys, setPendingHideKeys] = useState<Set<string>>(() => new Set());
  const hideTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const list = useGroceryList();
  const setStatus = useSetGroceryStatus();
  const createManual = useCreateManualGroceryItem();
  const deleteManual = useDeleteManualGroceryItem();

  const items = useMemo(() => list.data?.items ?? [], [list.data]);

  const visibleItems = useMemo(() => {
    if (showDismissed) return items.filter((i) => !i.deleted);
    return items.filter((i) => !i.dismissed && !i.deleted);
  }, [items, showDismissed]);

  const grouped = useMemo(() => {
    const map = new Map<string, GroceryItem[]>();
    for (const item of visibleItems) {
      const bucket = map.get(item.category) ?? [];
      bucket.push(item);
      map.set(item.category, bucket);
    }
    return Array.from(map.entries()).map(([category, categoryItems]) => ({
      category,
      items: categoryItems
    }));
  }, [visibleItems]);

  const activeCount = items.filter((i) => !i.dismissed && !i.deleted).length;
  const dismissedCount = items.filter((i) => i.dismissed && !i.deleted).length;

  const windowLabel = useMemo(() => {
    if (!list.data?.window_start || !list.data?.window_end) return "";
    return formatShortRange(new Date(list.data.window_start), new Date(list.data.window_end));
  }, [list.data]);

  const showSkeleton = list.isPending;

  useEffect(
    () => () => {
      for (const timer of hideTimers.current.values()) clearTimeout(timer);
      hideTimers.current.clear();
    },
    []
  );

  function isCrossed(item: GroceryItem) {
    return item.dismissed || pendingHideKeys.has(item.key);
  }

  function clearPending(key: string) {
    const timer = hideTimers.current.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      hideTimers.current.delete(key);
    }
    setPendingHideKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function queueHide(item: GroceryItem) {
    if (item.dismissed || pendingHideKeys.has(item.key)) return;
    setPendingHideKeys((prev) => new Set(prev).add(item.key));
    const timer = setTimeout(() => {
      hideTimers.current.delete(item.key);
      setPendingHideKeys((prev) => {
        const next = new Set(prev);
        next.delete(item.key);
        return next;
      });
      setStatus.mutate({ item, status: "dismissed" });
    }, UNDO_MS);
    hideTimers.current.set(item.key, timer);
  }

  function onRowTap(item: GroceryItem) {
    tapHaptic();
    if (pendingHideKeys.has(item.key)) {
      clearPending(item.key);
      return;
    }
    if (item.dismissed) {
      setStatus.mutate({ item, status: item.auto_dismissed ? "restored" : null });
      return;
    }
    queueHide(item);
  }

  function onAddItem() {
    const name = newItemName.trim();
    if (!name || createManual.isPending) return;
    createManual.mutate(
      { name },
      {
        onSuccess: () => setNewItemName("")
      }
    );
  }

  function onDelete(item: GroceryItem) {
    clearPending(item.key);
    if (item.is_manual && item.recipes.length === 0 && item.manual_item_ids.length > 0) {
      deleteManual.mutate(item.manual_item_ids[0]);
      return;
    }
    setStatus.mutate({ item, status: "deleted" });
  }

  function onViewRecipe(item: GroceryItem) {
    const recipe = item.recipes[0];
    if (!recipe) return;
    router.push(paths.recipeDetail(recipe.id) as never);
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingTop: insets.top + 20,
        paddingHorizontal: 16,
        paddingBottom: 24
      }}
      refreshControl={
        <RefreshControl
          refreshing={!list.isPending && list.isRefetching}
          onRefresh={() => void list.refetch()}
          tintColor={colors.mutedForeground}
        />
      }
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-sans-bold text-xl">Grocery</Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            Ingredients for the next 7 days
            {windowLabel ? <Text className="text-sm text-faint"> · {windowLabel}</Text> : null}
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          className={showDismissed ? "border-[rgba(34,197,94,0.45)] bg-card" : "bg-card"}
          onPress={() => setShowDismissed((v) => !v)}
        >
          <EyeOff size={14} color={showDismissed ? colors.green400 : colors.foreground} />
          <Text
            className={
              showDismissed
                ? "font-sans-semibold text-xs text-[#4ade80]"
                : "font-sans-semibold text-xs"
            }
          >
            {showDismissed ? "Hide dismissed" : "Show dismissed"}
          </Text>
        </Button>
      </View>

      <View className="mt-4 flex-row gap-2">
        <Input
          className="flex-1 bg-card"
          value={newItemName}
          onChangeText={setNewItemName}
          placeholder="Add an item…"
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={onAddItem}
          editable={!createManual.isPending}
        />
        <Button
          size="icon"
          className="shrink-0"
          disabled={!newItemName.trim() || createManual.isPending}
          onPress={onAddItem}
        >
          <Plus size={16} color={colors.foreground} />
        </Button>
      </View>

      {!showSkeleton && dismissedCount > 0 && !showDismissed ? (
        <Text className="mt-2 text-xs text-faint">
          {dismissedCount} dismissed · {activeCount} remaining
        </Text>
      ) : null}

      {showSkeleton ? (
        <View className="mt-5 gap-5">
          {[0, 1, 2].map((section) => (
            <View key={section} className="gap-2">
              <Skeleton className="h-3 w-20" />
              <View className="gap-1.5">
                {[0, 1, 2].map((row) => (
                  <View
                    key={row}
                    className="flex-row items-start gap-3 rounded-xl border border-border bg-card px-3 py-3"
                  >
                    <Skeleton className="mt-0.5 h-4 w-4 rounded" />
                    <View className="min-w-0 flex-1 gap-2">
                      <View className="flex-row justify-between gap-2">
                        <Skeleton className="h-3.5 w-2/5" />
                        <Skeleton className="h-3 w-12" />
                      </View>
                      <Skeleton className="h-2.5 w-3/5" />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : list.isError ? (
        <View className="mt-8 items-center rounded-xl border border-border bg-card px-4 py-6">
          <Text className="text-center text-sm text-muted-foreground">
            {getErrorMessage(list.error, "Couldn’t load the grocery list.")}
          </Text>
          <Button size="sm" className="mt-4" onPress={() => void list.refetch()}>
            Retry
          </Button>
        </View>
      ) : visibleItems.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-[rgba(34,197,94,0.15)]">
              <ShoppingCart size={24} color={colors.green500} />
            </View>
          }
          title={items.length === 0 ? "Nothing to shop for" : "All caught up"}
          description={
            items.length === 0
              ? "Plan meals for the next week and ingredients will show up here automatically."
              : "Dismissed items are hidden."
          }
          action={
            items.length === 0 ? (
              <Button onPress={() => router.push(paths.planner as never)}>Open planner</Button>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setShowDismissed(true)}>
                <Text className="font-sans-semibold text-sm text-[#22c55e]">Show dismissed</Text>
              </Pressable>
            )
          }
        />
      ) : (
        <View className="mt-5 gap-5">
          {grouped.map((group) => (
            <View key={group.category} className="gap-2">
              <Text className="px-0.5 font-sans-bold text-[11px] uppercase tracking-[0.08em] text-faint">
                {group.category}
              </Text>
              <View className="gap-1.5">
                {group.items.map((item) => {
                  const crossed = isCrossed(item);
                  return (
                    <SwipeRow
                      key={item.key}
                      onDismiss={() => queueHide(item)}
                      onDelete={() => onDelete(item)}
                      onView={item.recipes.length > 0 ? () => onViewRecipe(item) : undefined}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ checked: crossed }}
                        accessibilityLabel={
                          crossed ? `Restore ${item.name}` : `Cross off ${item.name}`
                        }
                        onPress={() => onRowTap(item)}
                        className={
                          crossed
                            ? "flex-row items-start gap-3 rounded-xl border border-border px-3 py-3 opacity-55"
                            : "flex-row items-start gap-3 rounded-xl border border-border px-3 py-3"
                        }
                      >
                        <View pointerEvents="none" className="mt-0.5">
                          <Checkbox
                            className="h-5 w-5"
                            checked={crossed}
                            onCheckedChange={() => {
                              /* decorative — whole row handles toggle */
                            }}
                          />
                        </View>
                        <View className="min-w-0 flex-1">
                          <View className="flex-row items-baseline justify-between gap-2">
                            <Text
                              className={
                                crossed
                                  ? "flex-1 font-sans-semibold text-sm leading-snug text-muted-foreground line-through"
                                  : "flex-1 font-sans-semibold text-sm leading-snug"
                              }
                            >
                              {item.name}
                            </Text>
                            {item.quantity_display ? (
                              <Text className="shrink-0 font-sans-medium text-xs text-[#86efac]">
                                {item.quantity_display}
                              </Text>
                            ) : null}
                          </View>
                          {item.recipe_titles ? (
                            <Text numberOfLines={1} className="mt-0.5 text-xs text-muted-foreground">
                              {item.recipe_titles}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    </SwipeRow>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

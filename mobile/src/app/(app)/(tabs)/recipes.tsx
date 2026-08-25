import { RecipeCard, RecipeCardSkeleton } from "@/components/RecipeCard";
import { RecipeSearchFab } from "@/components/recipes/RecipeSearchFab";
import { Text } from "@/components/ui/text";
import { useRecipeList, useRecipeSearch } from "@/hooks/use-recipes";
import { toast } from "@/stores/toast";
import type { RecipeCard as RecipeCardType } from "@/types";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function RecipesScreen() {
  const insets = useSafeAreaInsets();
  const [searchText, setSearchText] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchText), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  const list = useRecipeList();
  const search = useRecipeSearch(debounced);
  const isSearching = debounced.trim().length > 0;

  useEffect(() => {
    if (list.isError) toast.fromError(list.error, "Couldn’t load recipes.");
  }, [list.isError, list.error]);
  useEffect(() => {
    if (search.isError) toast.fromError(search.error, "Couldn’t search recipes.");
  }, [search.isError, search.error]);

  const data: RecipeCardType[] = useMemo(() => {
    // Preserve API relevance order for search; library browse stays newest-first.
    if (isSearching) return search.data ?? [];
    return list.data ?? [];
  }, [isSearching, search.data, list.data]);

  const showSkeleton = isSearching
    ? search.isPending || (search.isFetching && !search.data?.length)
    : list.isPending;

  const header = (
    <View className="pb-4">
      <Text className="font-sans-bold text-xl">Recipes</Text>
      <Text className="mt-1 text-sm text-muted-foreground">Your library</Text>
    </View>
  );

  const footer =
    !showSkeleton && !isSearching && data.length > 0 && list.hasNextPage ? (
      <Pressable
        accessibilityRole="button"
        disabled={list.isFetchingNextPage}
        onPress={() => void list.fetchNextPage()}
        className="mt-3 items-center rounded-xl border border-border bg-card px-4 py-3 active:opacity-70"
      >
        <Text className="font-sans-semibold text-sm text-[#22c55e]">
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </Text>
      </Pressable>
    ) : null;

  return (
    <View className="flex-1 bg-background">
      <FlatList
        className="flex-1"
        contentContainerStyle={{
          paddingTop: insets.top + 20,
          paddingHorizontal: 16,
          // Room for collapsed search FAB (56px) + bottom margin
          paddingBottom: 72
        }}
        data={showSkeleton ? [] : data}
        keyExtractor={(r) => String(r.id)}
        renderItem={({ item }) => <RecipeCard recipe={item} />}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          showSkeleton ? (
            <View className="gap-2">
              {[0, 1, 2, 3].map((n) => (
                <RecipeCardSkeleton key={n} />
              ))}
            </View>
          ) : (
            <View className="rounded-xl border border-border bg-card px-4 py-8">
              <Text className="text-center text-sm text-muted-foreground">
                {debounced.trim()
                  ? "No recipes matched that search."
                  : "No recipes yet — add one with +"}
              </Text>
            </View>
          )
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
      <RecipeSearchFab value={searchText} onChangeText={setSearchText} />
    </View>
  );
}

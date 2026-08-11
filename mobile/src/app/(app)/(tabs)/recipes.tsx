import { RecipeCard, RecipeCardSkeleton } from "@/components/RecipeCard";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { useRecipeList, useRecipeSearch } from "@/hooks/use-recipes";
import { toast } from "@/stores/toast";
import type { RecipeCard as RecipeCardType } from "@/types";
import { Search } from "lucide-react-native";
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
    if (isSearching) {
      return [...(search.data ?? [])].sort(
        (a, b) => new Date(b.created_on).getTime() - new Date(a.created_on).getTime()
      );
    }
    return list.data ?? [];
  }, [isSearching, search.data, list.data]);

  const showSkeleton = isSearching
    ? search.isPending || (search.isFetching && !search.data?.length)
    : list.isPending;

  const header = (
    <View className="pb-4">
      <Text className="font-sans-bold text-xl">Recipes</Text>
      <Text className="mt-1 text-sm text-muted-foreground">Your library</Text>
      <View className="relative mt-4">
        <View className="absolute left-3 top-0 z-10 h-11 justify-center">
          <Search size={16} color={colors.faint} />
        </View>
        <Input
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search recipes…"
          autoCapitalize="none"
          autoCorrect={false}
          className="h-11 rounded-xl pl-10"
        />
      </View>
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
    <FlatList
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingTop: insets.top + 20,
        paddingHorizontal: 16,
        paddingBottom: 24
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
  );
}

import { formatPrepTime } from "@/lib/dates";
import { markdownToPlain } from "@/lib/markdown";
import { colors } from "@/lib/colors";
import { tapHaptic } from "@/lib/haptics";
import { mediaSource } from "@/lib/media";
import type { RecipeCard as RecipeCardType } from "@/types";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Clock } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Skeleton } from "./ui/skeleton";
import { Text } from "./ui/text";

/** List card: cover thumb, name, description, prep time. */
export function RecipeCard({ recipe }: { recipe: RecipeCardType }) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        tapHaptic();
        router.push(`/recipes/${recipe.id}`);
      }}
      className="flex-row gap-3 rounded-xl border border-border bg-card p-3 active:opacity-80"
    >
      <Image
        source={mediaSource(recipe.cover_image?.url)}
        style={{ width: 96, height: 96, borderRadius: 12, backgroundColor: colors.muted }}
        contentFit="cover"
        transition={150}
      />
      <View className="min-w-0 flex-1 justify-center">
        <Text className="font-sans-semibold text-base" numberOfLines={1}>
          {recipe.name}
        </Text>
        {recipe.description ? (
          <Text className="mt-0.5 text-sm leading-5 text-muted-foreground" numberOfLines={2}>
            {markdownToPlain(recipe.description)}
          </Text>
        ) : null}
        {recipe.prep_time ? (
          <View className="mt-1.5 flex-row items-center gap-1.5">
            <Clock size={13} color={colors.mutedForeground} />
            <Text className="text-xs text-muted-foreground">
              {formatPrepTime(recipe.prep_time)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function RecipeCardSkeleton() {
  return (
    <View className="flex-row gap-3 rounded-xl border border-border bg-card p-3">
      <Skeleton className="h-24 w-24 rounded-lg" />
      <View className="flex-1 justify-center gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/3" />
      </View>
    </View>
  );
}

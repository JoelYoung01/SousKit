import { deleteRecipe } from "@/api/recipes";
import { EmptyState } from "@/components/EmptyState";
import { RecipeAiEditSheet } from "@/components/RecipeAiEditSheet";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { formatPrepTime } from "@/lib/dates";
import { recipeToMarkdown } from "@/lib/recipeMarkdown";
import { tapHaptic } from "@/lib/haptics";
import {
  formatIngredientAmountUnits,
  ingredientHasAmountOrUnits,
  normalizeIngredientDetails
} from "@/lib/ingredients";
import { splitInstructionSteps } from "@/lib/instructions";
import { mediaSource } from "@/lib/media";
import { syncAfterRecipeMutation } from "@/hooks/sync";
import { useHousehold } from "@/hooks/use-household";
import { useRecipe } from "@/hooks/use-recipes";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { ArrowLeft, Copy, Pencil, Sparkles } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function RecipeDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { recipeId } = useLocalSearchParams<{ recipeId: string }>();
  const user = useSessionStore((s) => s.user);
  const householdId = useHousehold().data?.id;

  const recipeQuery = useRecipe(recipeId);
  const recipe = recipeQuery.data;
  const canEdit =
    !!recipe &&
    (recipe.household_id === householdId || recipe.created_by.id === user?.id);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [aiEditOpen, setAiEditOpen] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const ingredientsY = useRef(0);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/recipes");
  };

  const onCopy = async () => {
    if (!recipe || copying) return;
    setCopying(true);
    try {
      await Clipboard.setStringAsync(recipeToMarkdown(recipe));
      toast.success("Recipe copied to clipboard.");
    } catch (er) {
      toast.fromError(er, "Couldn’t copy this recipe.");
    } finally {
      setCopying(false);
    }
  };

  const onDelete = async () => {
    if (!canEdit || deleting) return;
    setDeleting(true);
    try {
      await deleteRecipe(recipeId!);
      setDeleteOpen(false);
      syncAfterRecipeMutation();
      toast.success("Recipe deleted.");
      goBack();
    } catch (er) {
      toast.fromError(er, "Couldn’t delete this recipe.");
    } finally {
      setDeleting(false);
    }
  };

  if (recipeQuery.isError) {
    return (
      <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top + 40 }}>
        <EmptyState
          title="Couldn’t load this recipe"
          description="It may have been deleted."
          action={
            <Button variant="outline" size="sm" onPress={goBack}>
              Go back
            </Button>
          }
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView ref={scrollRef} contentContainerClassName="pb-10">
        {/* Hero */}
        <View className="h-56 overflow-hidden">
          {recipe ? (
            <Image
              source={mediaSource(recipe.cover_image?.url)}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <Skeleton className="h-full w-full rounded-none" />
          )}
          <LinearGradient
            colors={["rgba(9,11,9,0.55)", "rgba(9,11,9,0)", "rgba(9,11,9,1)"]}
            locations={[0, 0.5, 1]}
            pointerEvents="none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View
            className="absolute inset-x-0 z-10 flex-row items-center justify-between px-3"
            style={{ top: insets.top + 4 }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => {
                tapHaptic();
                goBack();
              }}
              className="h-9 w-9 items-center justify-center rounded-full bg-background/50 active:opacity-80"
            >
              <ArrowLeft size={16} color={colors.foreground} />
            </Pressable>
            {canEdit ? (
              <View className="flex-row items-center gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit with AI"
                  onPress={() => {
                    tapHaptic();
                    setAiEditOpen(true);
                  }}
                  className="h-9 w-9 items-center justify-center rounded-full bg-background/50 active:opacity-80"
                >
                  <Sparkles size={16} color={colors.green500} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit"
                  onPress={() => {
                    tapHaptic();
                    router.push(`/recipes/${recipeId}/edit` as never);
                  }}
                  className="h-9 w-9 items-center justify-center rounded-full bg-primary active:opacity-80"
                >
                  <Pencil size={16} color={colors.foreground} />
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        {/* Body card */}
        <View className="-mt-4 rounded-t-2xl border border-t-0 border-border bg-card px-5 pb-8 pt-5">
          {recipe ? (
            <>
              <View className="flex-row items-start justify-between gap-3">
                <Text className="flex-1 font-sans-bold text-xl leading-tight tracking-tight">
                  {recipe.name}
                </Text>
                <Button
                  size="sm"
                  className="shrink-0"
                  onPress={() =>
                    scrollRef.current?.scrollTo({ y: ingredientsY.current, animated: true })
                  }
                >
                  Cook
                </Button>
              </View>

              <View className="mt-4 flex-row gap-2">
                <View className="flex-1 items-center rounded-xl bg-secondary/50 px-3 py-3">
                  <Text className="text-xs text-muted-foreground">Total time</Text>
                  <Text className="mt-1 font-sans-semibold text-sm">
                    {formatPrepTime(recipe.prep_time) || "—"}
                  </Text>
                </View>
                <View className="flex-1 items-center rounded-xl bg-secondary/50 px-3 py-3">
                  <Text className="text-xs text-muted-foreground">Ingredients</Text>
                  <Text className="mt-1 font-sans-semibold text-sm">
                    {recipe.ingredients.length}
                  </Text>
                </View>
              </View>

              {recipe.description ? (
                <View className="mt-5">
                  <Text className="mb-1 font-sans-semibold text-sm">About</Text>
                  <Text className="text-base leading-6 text-muted-foreground">
                    {recipe.description}
                  </Text>
                </View>
              ) : null}

              <View
                className="mt-5"
                onLayout={(e) => {
                  ingredientsY.current = e.nativeEvent.layout.y + 180;
                }}
              >
                <Text className="mb-2 font-sans-semibold text-sm">Ingredients</Text>
                <View className="gap-1.5">
                  {recipe.ingredients.map((ingredient) => {
                    const amountUnits = formatIngredientAmountUnits(
                      ingredient.amount,
                      ingredient.units
                    );
                    const details = normalizeIngredientDetails(ingredient.details);

                    return (
                      <View key={ingredient.id} className="rounded-lg bg-secondary/40 px-3 py-2">
                        <Text className="text-base leading-6">
                          {amountUnits ? (
                            <Text className="text-muted-foreground">{amountUnits}</Text>
                          ) : null}
                          {ingredientHasAmountOrUnits(ingredient.amount, ingredient.units)
                            ? " • "
                            : ""}
                          {ingredient.name}
                          {details ? (
                            <Text className="text-faint"> ({details})</Text>
                          ) : null}
                        </Text>
                      </View>
                    );
                  })}
                  {recipe.ingredients.length === 0 ? (
                    <Text className="text-sm text-muted-foreground">No ingredients listed.</Text>
                  ) : null}
                </View>
              </View>

              <View className="mt-5">
                <Text className="mb-1 font-sans-semibold text-sm">Instructions</Text>
                <View className="gap-2.5">
                  {splitInstructionSteps(recipe.instructions).map((step, idx) => (
                    <Text key={`step-${idx}`} className="text-base leading-6 text-muted-foreground">
                      {step}
                    </Text>
                  ))}
                </View>
              </View>

              {recipe.notes ? (
                <View className="mt-5">
                  <Text className="mb-1 font-sans-semibold text-sm">Notes</Text>
                  <Text className="text-base leading-6 text-muted-foreground">{recipe.notes}</Text>
                </View>
              ) : null}

              <View className="mt-8 flex-row flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={copying} onPress={onCopy}>
                  {copying ? (
                    <ActivityIndicator size="small" color={colors.foreground} />
                  ) : (
                    <Copy size={16} color={colors.foreground} />
                  )}
                  {copying ? "Copying…" : "Copy recipe"}
                </Button>
                {canEdit ? (
                  <Button variant="destructive" size="sm" onPress={() => setDeleteOpen(true)}>
                    Delete recipe
                  </Button>
                ) : null}
              </View>
            </>
          ) : (
            <View className="gap-3">
              <Skeleton className="h-6 w-2/3" />
              <View className="flex-row gap-2">
                <Skeleton className="h-16 flex-1 rounded-xl" />
                <Skeleton className="h-16 flex-1 rounded-xl" />
              </View>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </View>
          )}
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={deleteOpen}
        title="Delete recipe?"
        description="This can’t be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={onDelete}
        onCancel={() => setDeleteOpen(false)}
      />

      {recipeId ? (
        <RecipeAiEditSheet
          visible={aiEditOpen}
          recipeId={recipeId}
          onClose={() => setAiEditOpen(false)}
        />
      ) : null}
    </View>
  );
}

import {
  diffRecipeVersions,
  fetchRecipeVersion,
  fetchRecipeVersions,
  restoreRecipeVersion
} from "@/api/recipes";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { syncAfterRecipeMutation } from "@/hooks/sync";
import { colors } from "@/lib/colors";
import { toast } from "@/stores/toast";
import type {
  IngredientSnapshot,
  RecipeDetail,
  RecipeVersionDetail,
  RecipeVersionDiff,
  RecipeVersionSummary
} from "@/types";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

const kindLabels: Record<string, string> = {
  create: "Created",
  edit: "Edited",
  ai_edit: "AI edit",
  import: "Imported",
  restore: "Restored"
};

const fieldLabels: Record<string, string> = {
  name: "Name",
  description: "Description",
  notes: "Notes",
  prep_time: "Prep time",
  cover_image: "Cover image",
  instructions: "Instructions"
};

function kindLabel(version: RecipeVersionSummary) {
  if (version.change_kind === "restore" && version.restored_from_version) {
    return `Restored from v${version.restored_from_version}`;
  }
  return kindLabels[version.change_kind] ?? version.change_kind;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatIngredient(row: IngredientSnapshot | null | undefined) {
  if (!row) return "";
  const amount = row.amount != null ? String(row.amount) : "";
  const units = row.units?.trim() ?? "";
  const qty = [amount, units].filter(Boolean).join(" ");
  const details = row.details?.trim();
  return `${qty ? `${qty} ` : ""}${row.name}${details ? ` (${details})` : ""}`;
}

type Props = {
  visible: boolean;
  recipeId: number;
  slug: string;
  headVersionNumber: number;
  canRestore: boolean;
  onClose: () => void;
  onPreview: (version: RecipeVersionDetail) => void;
  onRestored: (recipe: RecipeDetail) => void;
};

export function RecipeHistorySheet({
  visible,
  recipeId,
  slug,
  headVersionNumber,
  canRestore,
  onClose,
  onPreview,
  onRestored
}: Props) {
  const [versions, setVersions] = useState<RecipeVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [diff, setDiff] = useState<RecipeVersionDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    async function load() {
      await Promise.resolve();
      if (cancelled) return;
      setSelected(null);
      setDiff(null);
      setLoading(true);
      try {
        const rows = await fetchRecipeVersions(recipeId);
        if (!cancelled) setVersions(rows);
      } catch (er) {
        if (!cancelled) toast.fromError(er, "Couldn’t load version history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [visible, recipeId]);

  const selectVersion = async (version: RecipeVersionSummary) => {
    setSelected(version.version_number);
    setDiff(null);
    if (version.version_number <= 1) return;
    setDiffLoading(true);
    try {
      const next = await diffRecipeVersions(
        recipeId,
        version.version_number - 1,
        version.version_number
      );
      setDiff(next);
    } catch (er) {
      toast.fromError(er, "Couldn’t compare those versions.");
    } finally {
      setDiffLoading(false);
    }
  };

  const viewVersion = async (version: RecipeVersionSummary) => {
    try {
      const detail = await fetchRecipeVersion(recipeId, version.version_number);
      onPreview(detail);
      onClose();
    } catch (er) {
      toast.fromError(er, "Couldn’t open that version.");
    }
  };

  const restoreVersion = async (version: RecipeVersionSummary) => {
    if (!canRestore || restoring != null) return;
    setRestoring(version.version_number);
    try {
      const detail = await restoreRecipeVersion(recipeId, version.version_number);
      onRestored(detail);
      syncAfterRecipeMutation();
      if (detail.head_version_number === headVersionNumber) {
        toast.success("That version is already the latest content.");
      } else {
        toast.success(
          `Restored version ${version.version_number} as version ${detail.head_version_number}.`
        );
      }
      onClose();
    } catch (er) {
      toast.fromError(er, "Couldn’t restore that version.");
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} fullHeight>
      <Text className="font-sans-bold text-lg">Version history</Text>
      <Text className="mt-1 text-sm text-muted-foreground">
        {slug} · each save is kept. This screen shows the latest version.
      </Text>
      <ScrollView className="mt-3" contentContainerClassName="gap-2 pb-6">
        {loading ? <Text className="text-sm text-muted-foreground">Loading history…</Text> : null}
        {versions.map((version) => {
          const isSelected = selected === version.version_number;
          return (
            <View key={version.version_number} className="rounded-xl border border-border p-3">
              <Pressable onPress={() => void selectVersion(version)}>
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="font-sans-semibold text-sm">Version {version.version_number}</Text>
                  {version.is_current ? (
                    <Text className="text-[11px] font-sans-semibold text-[#4ade80]">Latest</Text>
                  ) : null}
                </View>
                <Text className="mt-0.5 text-xs text-muted-foreground">
                  {kindLabel(version)} · {formatWhen(version.created_on)}
                  {version.created_by_display_name ? ` · ${version.created_by_display_name}` : ""}
                </Text>
                <Text className="mt-1 text-sm" numberOfLines={1}>
                  {version.name}
                </Text>
              </Pressable>
              {isSelected ? (
                <View className="mt-3 gap-2">
                  {version.version_number === 1 ? (
                    <Text className="text-xs text-muted-foreground">
                      First saved version of this recipe.
                    </Text>
                  ) : null}
                  {diffLoading ? (
                    <ActivityIndicator color={colors.foreground} />
                  ) : null}
                  {diff && !diffLoading && diff.to_version === version.version_number ? (
                    <View className="gap-2">
                      {!diff.fields.length && !diff.ingredients.length ? (
                        <Text className="text-xs text-muted-foreground">
                          No content changes from version {diff.from_version}.
                        </Text>
                      ) : null}
                      {diff.fields.map((field) => (
                        <View key={field.field}>
                          <Text className="text-xs font-sans-semibold">
                            {fieldLabels[field.field] ?? field.field}
                          </Text>
                          {field.field === "instructions" && field.hunks.length
                            ? field.hunks.map((hunk, idx) => (
                                <View key={idx} className="mt-1 rounded-lg bg-secondary/60 px-2 py-1">
                                  {hunk.before ? (
                                    <Text className="text-xs text-red-300 line-through">{hunk.before}</Text>
                                  ) : null}
                                  {hunk.after ? (
                                    <Text className="text-xs text-[#86efac]">{hunk.after}</Text>
                                  ) : null}
                                </View>
                              ))
                            : (
                              <Text className="mt-1 text-xs text-muted-foreground">
                                {field.before ? `${field.before}` : ""}
                                {field.before && field.after ? " → " : ""}
                                {field.after ? `${field.after}` : ""}
                              </Text>
                            )}
                        </View>
                      ))}
                      {diff.ingredients.length ? (
                        <View>
                          <Text className="text-xs font-sans-semibold">Ingredients</Text>
                          {diff.ingredients.map((change, idx) => (
                            <Text key={`${change.op}-${idx}`} className="mt-1 text-xs text-muted-foreground">
                              {change.op === "added"
                                ? `Added ${formatIngredient(change.after)}`
                                : change.op === "removed"
                                  ? `Removed ${formatIngredient(change.before)}`
                                  : `${formatIngredient(change.before)} → ${formatIngredient(change.after)}`}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  <View className="flex-row flex-wrap gap-2">
                    <Button size="sm" variant="outline" onPress={() => void viewVersion(version)}>
                      View
                    </Button>
                    {canRestore && !version.is_current ? (
                      <Button
                        size="sm"
                        disabled={restoring != null}
                        onPress={() => void restoreVersion(version)}
                      >
                        {restoring === version.version_number ? "Restoring…" : "Restore"}
                      </Button>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

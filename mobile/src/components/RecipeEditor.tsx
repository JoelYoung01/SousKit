import {
  createIngredient,
  createRecipe,
  deleteIngredient,
  fetchRecipe,
  generateRecipeCover,
  updateIngredient,
  updateRecipe
} from "@/api/recipes";
import { uploadImage } from "@/api/uploads";
import { getErrorMessage } from "@/api/errors";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { colors } from "@/lib/colors";
import { mediaSource } from "@/lib/media";
import { syncAfterRecipeMutation } from "@/hooks/sync";
import type { RecipeDetail } from "@/types";
import { toast } from "@/stores/toast";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAwareScrollView, KeyboardStickyView } from "@/components/ui/keyboard";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface IngredientForm {
  id?: number;
  name: string;
  amount: string;
  units: string;
  details: string;
}

const emptyIngredient = (): IngredientForm => ({ name: "", amount: "", units: "", details: "" });

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Create/edit recipe form — port of the web RecipeEditView. */
export function RecipeEditor({ recipeId }: { recipeId?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const creating = recipeId === undefined;

  const [detail, setDetail] = useState<RecipeDetail | null>(null);
  const [loading, setLoading] = useState(!creating);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notes, setNotes] = useState("");
  const [prepTime, setPrepTime] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [coverImageId, setCoverImageId] = useState<number | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<IngredientForm[]>(
    creating ? [emptyIngredient()] : []
  );

  const [uploadingCover, setUploadingCover] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [coverError, setCoverError] = useState("");

  useEffect(() => {
    if (creating) return;
    let cancelled = false;
    fetchRecipe(recipeId)
      .then((r) => {
        if (cancelled) return;
        setDetail(r);
        setName(r.name);
        setDescription(r.description);
        setInstructions(r.instructions);
        setNotes(r.notes ?? "");
        setPrepTime(r.prep_time !== undefined && r.prep_time !== null ? String(r.prep_time) : "");
        setIsPublic(r.public);
        setCoverImageId(r.cover_image?.id ?? null);
        setCoverPreviewUrl(r.cover_image?.url ?? null);
        setIngredients(
          r.ingredients.map((i) => ({
            id: i.id,
            name: i.name,
            amount: i.amount !== null && i.amount !== undefined ? String(i.amount) : "",
            units: i.units ?? "",
            details: i.details ?? ""
          }))
        );
      })
      .catch((er) => {
        if (!cancelled) toast.fromError(er, "Couldn’t load this recipe.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [creating, recipeId]);

  const validForm =
    name.trim() &&
    description.trim() &&
    instructions.trim() &&
    ingredients.length > 0 &&
    ingredients.every((i) => i.name.trim());
  const canSave = Boolean(validForm) && !saving && !loading;
  const canGenerateCover = Boolean(name.trim()) && !generatingCover && !saving && !loading;

  const pickCoverImage = async () => {
    if (uploadingCover) return;
    setCoverError("");
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.85
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0]!;
    setUploadingCover(true);
    try {
      const upload = await uploadImage({
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType
      });
      setCoverImageId(upload.id);
      setCoverPreviewUrl(upload.url);
    } catch (er) {
      setCoverError(getErrorMessage(er, "Could not upload the image."));
      toast.fromError(er, "Could not upload the image.");
    } finally {
      setUploadingCover(false);
    }
  };

  const generateCover = async () => {
    if (!canGenerateCover) return;
    setGeneratingCover(true);
    setCoverError("");
    try {
      const upload = await generateRecipeCover({
        name: name.trim(),
        description: description.trim() || null,
        ingredients: ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim() }))
      });
      setCoverImageId(upload.id);
      setCoverPreviewUrl(upload.url);
    } catch (er) {
      setCoverError(getErrorMessage(er, "Could not find a cover image."));
      toast.fromError(er, "Could not find a cover image.");
    } finally {
      setGeneratingCover(false);
    }
  };

  const setIngredient = (index: number, patch: Partial<IngredientForm>) => {
    setIngredients((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const saveIngredients = async (savedRecipeId: number) => {
    const existing = detail?.ingredients ?? [];
    const toCreate = ingredients.filter((i) => !i.id);
    const toUpdate = ingredients.filter((i) => i.id);
    const toDelete = existing.filter((i) => !ingredients.some((row) => row.id === i.id));

    await Promise.all([
      ...toCreate.map((i) =>
        createIngredient({
          name: i.name.trim(),
          amount: parseAmount(i.amount),
          units: i.units.trim() || null,
          details: i.details.trim() || null,
          recipe_id: savedRecipeId
        })
      ),
      ...toUpdate.map((i) =>
        updateIngredient(i.id!, {
          name: i.name.trim(),
          amount: parseAmount(i.amount),
          units: i.units.trim() || null,
          details: i.details.trim() || null,
          recipe_id: savedRecipeId
        })
      ),
      ...toDelete.map((i) => deleteIngredient(i.id))
    ]);
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(creating ? "/home" : (`/recipes/${recipeId}` as never));
  };

  const saveChanges = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        notes: notes.trim() || null,
        public: isPublic,
        prep_time: prepTime.trim() ? Number(prepTime) : null,
        cover_image_id: coverImageId
      };
      const saved = creating ? await createRecipe(body) : await updateRecipe(recipeId!, body);
      await saveIngredients(saved.id);
      syncAfterRecipeMutation();
      toast.success(creating ? "Recipe created." : "Recipe saved.");
      goBack();
    } catch (er) {
      toast.fromError(er, "Couldn’t save this recipe.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <View style={{ paddingTop: insets.top }}>
        <ScreenHeader title={creating ? "New recipe" : "Edit recipe"} onBack={goBack} />
      </View>

      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4 pb-6 pt-2"
        keyboardShouldPersistTaps="handled"
        bottomOffset={96}
      >
        {/* Cover image */}
        <View className="gap-2">
          {coverPreviewUrl ? (
            <Image
              source={mediaSource(coverPreviewUrl)}
              style={{ width: "100%", height: 160, borderRadius: 14 }}
              contentFit="cover"
            />
          ) : null}
          <View className="flex-row flex-wrap items-center gap-2">
            <Button variant="secondary" onPress={pickCoverImage} disabled={uploadingCover}>
              {uploadingCover ? (
                <Spinner size="small" />
              ) : (
                <ImagePlus size={16} color={colors.foreground} />
              )}
              {uploadingCover ? "Uploading…" : "Upload photo"}
            </Button>
            <Button variant="secondary" onPress={generateCover} disabled={!canGenerateCover}>
              {generatingCover ? (
                <Spinner size="small" />
              ) : (
                <Sparkles size={16} color={colors.green500} />
              )}
              {generatingCover ? "Finding image…" : "Generate image"}
            </Button>
          </View>
          <Text className="text-xs leading-4 text-muted-foreground">
            Generate pulls a free public-domain food photo from the recipe name and ingredients.
            Enter a name first.
          </Text>
          {coverError ? <Text className="text-sm text-destructive">{coverError}</Text> : null}
        </View>

        <View className="gap-2">
          <Label>Name</Label>
          <Input value={name} onChangeText={setName} className="h-11 rounded-xl" />
        </View>

        <View className="gap-2">
          <Label>Description</Label>
          <Textarea
            value={description}
            onChangeText={setDescription}
            className="min-h-24 rounded-xl"
          />
        </View>

        <View className="gap-2">
          <Label>Instructions</Label>
          <Textarea
            value={instructions}
            onChangeText={setInstructions}
            className="min-h-32 rounded-xl"
          />
        </View>

        <View className="gap-2">
          <Label>Notes</Label>
          <Textarea value={notes} onChangeText={setNotes} className="min-h-20 rounded-xl" />
        </View>

        <View className="gap-2">
          <Label>Prep time (min)</Label>
          <Input
            value={prepTime}
            onChangeText={setPrepTime}
            keyboardType="number-pad"
            className="h-11 rounded-xl"
          />
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="font-sans-semibold text-sm">Ingredients</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add ingredient"
            onPress={() => setIngredients((rows) => [...rows, emptyIngredient()])}
            className="h-9 w-9 items-center justify-center rounded-lg active:bg-secondary"
          >
            <Plus size={16} color={colors.foreground} />
          </Pressable>
        </View>

        {ingredients.map((ingredient, index) => (
          <View key={ingredient.id ?? `new-${index}`} className="gap-1.5">
            <View className="flex-row gap-1.5">
              <Input
                value={ingredient.name}
                onChangeText={(v) => setIngredient(index, { name: v })}
                placeholder="Name"
                className="h-9 flex-1 rounded-lg text-xs"
              />
              <Input
                value={ingredient.amount}
                onChangeText={(v) => setIngredient(index, { amount: v })}
                placeholder="Amt"
                keyboardType="decimal-pad"
                className="h-9 w-[4.5rem] rounded-lg text-xs"
              />
              <Input
                value={ingredient.units}
                onChangeText={(v) => setIngredient(index, { units: v })}
                placeholder="Unit"
                className="h-9 w-16 rounded-lg text-xs"
              />
            </View>
            <View className="flex-row gap-1.5">
              <Input
                value={ingredient.details}
                onChangeText={(v) => setIngredient(index, { details: v })}
                placeholder="Details"
                className="h-9 flex-1 rounded-lg text-xs"
              />
              <Button
                size="icon-sm"
                variant="destructive"
                accessibilityLabel="Remove ingredient"
                onPress={() => setIngredients((rows) => rows.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} color={colors.foreground} />
              </Button>
            </View>
          </View>
        ))}
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View
          className="flex-row gap-2 border-t border-border bg-background px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <Button variant="outline" className="flex-1 bg-card" disabled={saving} onPress={goBack}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={!canSave} onPress={saveChanges}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

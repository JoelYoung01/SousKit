import {
  createIngredient,
  createRecipe,
  deleteIngredient,
  fetchRecipe,
  generateRecipeCover,
  updateIngredient,
  updateRecipe
} from "@/api/recipes";
import { uploadImage, type PickedImage } from "@/api/uploads";
import { getErrorMessage } from "@/api/errors";
import { del } from "@/api/client";
import { CoverImagePickerSheet } from "@/components/CoverImagePickerSheet";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { colors } from "@/lib/colors";
import {
  COVER_IMAGE_SOURCE_ITEMS,
  readClipboardImage,
  showCoverImageContextMenu,
  type CoverImageSourceAction
} from "@/lib/cover-image-menu";
import { loadCoverSkipKeys, rememberCoverSkipKey } from "@/lib/coverSkip";
import { normalizeCoverOption, normalizeUpload } from "@/lib/coverMedia";
import { tapHaptic } from "@/lib/haptics";
import { mediaSource } from "@/lib/media";
import { syncAfterRecipeMutation } from "@/hooks/sync";
import type { RecipeCoverOption, RecipeDetail, UploadSlim } from "@/types";
import { toast } from "@/stores/toast";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import {
  Camera,
  ChevronRight,
  ClipboardPaste,
  ImagePlus,
  Plus,
  Sparkles,
  Trash2
} from "lucide-react-native";
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
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [coverOptions, setCoverOptions] = useState<RecipeCoverOption[]>([]);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [coverSkipKeys, setCoverSkipKeys] = useState<string[]>([]);
  const [dismissingCoverId, setDismissingCoverId] = useState<number | null>(null);

  const coverRecipeKey = creating ? "new" : String(recipeId ?? "new");

  useEffect(() => {
    let cancelled = false;
    loadCoverSkipKeys(coverRecipeKey).then((keys) => {
      if (!cancelled) setCoverSkipKeys(keys);
    });
    return () => {
      cancelled = true;
    };
  }, [coverRecipeKey]);

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

  const uploadCoverAsset = async (asset: PickedImage, successMessage?: string) => {
    setUploadingCover(true);
    try {
      const upload = await uploadImage(asset);
      const normalized = normalizeUpload(upload);
      setCoverImageId(normalized.id);
      setCoverPreviewUrl(normalized.url);
      if (successMessage) {
        toast.success(successMessage);
      }
    } catch (er) {
      setCoverError(getErrorMessage(er, "Could not upload the image."));
      toast.fromError(er, "Could not upload the image.");
    } finally {
      setUploadingCover(false);
    }
  };

  const takeCoverPhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        const msg = "Camera access is required to take a recipe photo.";
        setCoverError(msg);
        toast.error(msg);
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.85
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0]!;
      await uploadCoverAsset({
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType
      });
    } catch (er) {
      setCoverError(getErrorMessage(er, "Could not open the camera."));
      toast.fromError(er, "Could not open the camera.");
    }
  };

  const pickCoverFromLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.85
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0]!;
      await uploadCoverAsset({
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType
      });
    } catch (er) {
      setCoverError(getErrorMessage(er, "Could not open your photo library."));
      toast.fromError(er, "Could not open your photo library.");
    }
  };

  const pasteCoverFromClipboard = async () => {
    const picked = await readClipboardImage();
    if (!picked) {
      const msg = "No image found on your clipboard. Copy an image first and try again.";
      setCoverError(msg);
      toast.error(msg);
      return;
    }
    await uploadCoverAsset(picked, "Cover photo pasted from clipboard.");
  };

  const handleCoverSourceAction = async (action: CoverImageSourceAction) => {
    setUploadMenuOpen(false);
    if (uploadingCover) return;
    setCoverError("");

    if (action === "take-photo") {
      await takeCoverPhoto();
      return;
    }
    if (action === "camera-roll") {
      await pickCoverFromLibrary();
      return;
    }
    if (action === "clipboard") {
      await pasteCoverFromClipboard();
    }
  };

  const openCoverSourceMenu = () => {
    if (uploadingCover) return;
    tapHaptic();
    setCoverError("");
    const handledNatively = showCoverImageContextMenu((action) => {
      void handleCoverSourceAction(action);
    });
    if (!handledNatively) {
      setUploadMenuOpen(true);
    }
  };

  const applyCover = (upload: RecipeCoverOption | UploadSlim) => {
    const normalized = "skip_key" in upload ? normalizeCoverOption(upload) : normalizeUpload(upload);
    if (!normalized.url) {
      setCoverError("Could not load the selected cover image.");
      return;
    }
    setCoverImageId(normalized.id);
    setCoverPreviewUrl(normalized.url);
    setCoverOptions([]);
    setCoverPickerOpen(false);
  };

  const generateCover = async () => {
    if (!canGenerateCover) return;
    setGeneratingCover(true);
    setCoverError("");
    try {
      const result = await generateRecipeCover({
        name: name.trim(),
        description: description.trim() || null,
        ingredients: ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim() })),
        limit: 4,
        exclude_keys: coverSkipKeys
      });
      if (!result.options.length) {
        setCoverError(
          "No cover photos found. Try a clearer dish name, clear dismissed photos, or upload your own."
        );
        return;
      }
      if (result.mode === "single" || result.options.length === 1) {
        applyCover(result.options[0]!);
        return;
      }
      setCoverOptions(result.options);
      setCoverPickerOpen(true);
    } catch (er) {
      setCoverError(getErrorMessage(er, "Could not find cover images."));
      toast.fromError(er, "Could not find cover images.");
    } finally {
      setGeneratingCover(false);
    }
  };

  const dismissCoverOption = async (option: RecipeCoverOption) => {
    if (dismissingCoverId) return;
    setDismissingCoverId(option.id);
    try {
      const nextKeys = await rememberCoverSkipKey(coverRecipeKey, option.skip_key);
      setCoverSkipKeys(nextKeys);
      let remaining: RecipeCoverOption[] = [];
      setCoverOptions((rows) => {
        remaining = rows.filter((o) => o.id !== option.id);
        return remaining;
      });
      void del(`/upload/${option.id}/`).catch(() => undefined);

      if (remaining.length < 3 && name.trim()) {
        const refill = await generateRecipeCover({
          name: name.trim(),
          description: description.trim() || null,
          ingredients: ingredients
            .filter((i) => i.name.trim())
            .map((i) => ({ name: i.name.trim() })),
          limit: 1,
          exclude_keys: [...nextKeys, ...remaining.map((o) => o.skip_key)]
        });
        setCoverOptions((rows) => {
          const next = [...rows];
          for (const cand of refill.options) {
            if (!next.some((o) => o.id === cand.id || o.skip_key === cand.skip_key)) {
              next.push(cand);
            }
          }
          return next;
        });
      }
    } catch (er) {
      toast.fromError(er, "Couldn’t dismiss that photo.");
    } finally {
      setDismissingCoverId(null);
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
            <Button variant="secondary" onPress={openCoverSourceMenu} disabled={uploadingCover}>
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
              {generatingCover ? "Generating…" : "Generate image"}
            </Button>
          </View>
          <Text className="text-xs leading-4 text-muted-foreground">
            Upload a photo by taking a picture, choosing from your camera roll, or pasting an image
            copied to your clipboard.
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

      <Sheet visible={uploadMenuOpen} onClose={() => setUploadMenuOpen(false)}>
        <Text className="px-1 pb-2 font-sans-semibold text-base">Upload recipe photo</Text>
        <View className="gap-1">
          {COVER_IMAGE_SOURCE_ITEMS.map((item) => {
            const Icon =
              item.id === "take-photo"
                ? Camera
                : item.id === "camera-roll"
                  ? ImagePlus
                  : ClipboardPaste;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => void handleCoverSourceAction(item.id)}
                className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-secondary/60"
              >
                <View className="h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                  <Icon size={19} color={colors.foreground} strokeWidth={2} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="font-sans-medium text-sm">{item.label}</Text>
                  <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
                    {item.description}
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.faint} />
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      <CoverImagePickerSheet
        visible={coverPickerOpen}
        options={coverOptions}
        dismissingId={dismissingCoverId}
        onSelect={applyCover}
        onClose={() => setCoverPickerOpen(false)}
        onDismiss={dismissCoverOption}
        onSearchAgain={() => {
          setCoverPickerOpen(false);
          void generateCover();
        }}
      />
    </View>
  );
}

import { getErrorMessage } from "@/api/errors";
import { importRecipeFromUrl } from "@/api/recipes";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { syncAfterRecipeMutation } from "@/hooks/sync";
import { colors } from "@/lib/colors";
import { toast } from "@/stores/toast";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Camera, Link2, PenLine } from "lucide-react-native";
import { useMemo, useState } from "react";
import { KeyboardAwareScrollView } from "@/components/ui/keyboard";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Spinner } from "@/components/ui/spinner";

export default function RecipeImportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ method?: string }>();
  const method = params.method === "photo" ? "photo" : "link";
  const [url, setUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const canImport = useMemo(() => Boolean(url.trim()) && !importing, [url, importing]);

  async function onImport() {
    if (!canImport) return;
    setImporting(true);
    setError("");
    try {
      const recipe = await importRecipeFromUrl(url.trim());
      syncAfterRecipeMutation();
      toast.success("Recipe imported — review and save any edits.");
      router.replace(`/recipes/${recipe.id}/edit` as never);
    } catch (er) {
      console.error(er);
      const message = getErrorMessage(er, "Couldn’t import that recipe.");
      setError(message);
      toast.fromError(er, "Couldn’t import that recipe.");
    }
    setImporting(false);
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScreenHeader title="Import a recipe" />
      <KeyboardAwareScrollView
        contentContainerClassName="px-4 pb-10 pt-2"
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        <Text className="text-sm text-muted-foreground">
          Paste a link to a recipe website and we’ll pull ingredients and steps.
        </Text>

        <View className="mt-5 flex-row gap-2">
          <Button
            size="sm"
            variant={method === "link" ? "default" : "outline"}
            onPress={() => router.setParams({ method: "link" })}
          >
            <Link2 size={16} color={colors.foreground} />
            Link
          </Button>
          <Button
            size="sm"
            variant={method === "photo" ? "default" : "outline"}
            onPress={() => router.setParams({ method: "photo" })}
          >
            <Camera size={16} color={colors.foreground} />
            Photo
          </Button>
        </View>

        <View className="mt-5 rounded-xl border border-border bg-card p-4">
          {method === "link" ? (
            <>
              <Label className="text-muted-foreground">Recipe URL</Label>
              <Input
                value={url}
                onChangeText={setUrl}
                placeholder="https://…"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={!importing}
                onSubmitEditing={() => void onImport()}
                returnKeyType="go"
                className="mt-2 h-11 rounded-xl bg-secondary"
              />
              <Button className="mt-4 w-full" disabled={!canImport} onPress={() => void onImport()}>
                {importing ? <Spinner color={colors.foreground} /> : null}
                {importing ? "Importing…" : "Import from link"}
              </Button>
              {error ? (
                <Text className="mt-3 text-xs text-destructive">{error}</Text>
              ) : (
                <Text className="mt-3 text-xs text-faint">
                  Works best with recipe blogs and sites that list ingredients in writing.
                  Social video links aren’t supported yet.
                </Text>
              )}
            </>
          ) : (
            <>
              <View className="min-h-[180px] items-center justify-center rounded-xl border border-dashed border-border bg-secondary/50 px-4">
                <Camera size={32} color={colors.green500} />
                <Text className="mt-2 font-sans-semibold text-sm">Scan a photo</Text>
                <Text className="mt-1 text-center text-xs text-muted-foreground">
                  Cookbook pages and handwritten cards — not available yet.
                </Text>
              </View>
              <Button className="mt-4 w-full" disabled>
                Choose photo
              </Button>
            </>
          )}
        </View>

        <Button
          variant="outline"
          className="mt-4 w-full"
          onPress={() => router.push("/recipes/new")}
        >
          <PenLine size={16} color={colors.foreground} />
          Write from scratch instead
        </Button>
      </KeyboardAwareScrollView>
    </View>
  );
}

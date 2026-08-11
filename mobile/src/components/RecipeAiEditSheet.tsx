import { aiEditRecipe } from "@/api/recipes";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { colors } from "@/lib/colors";
import { syncAfterRecipeMutation } from "@/hooks/sync";
import { toast } from "@/stores/toast";
import { Sparkles } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

type Props = {
  visible: boolean;
  recipeId: number | string;
  onClose: () => void;
  onApplied?: () => void;
};

export function RecipeAiEditSheet({ visible, recipeId, onClose, onApplied }: Props) {
  const [instruction, setInstruction] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = instruction.trim().length > 0 && !saving;

  const handleClose = () => {
    setInstruction("");
    setSaving(false);
    onClose();
  };

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await aiEditRecipe(recipeId, instruction.trim());
      syncAfterRecipeMutation();
      toast.success("Recipe updated with AI.");
      onApplied?.();
      handleClose();
    } catch (er) {
      toast.fromError(er, "Couldn’t apply that AI edit.");
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={handleClose}>
      <View className="gap-3 pb-2">
        <View className="flex-row items-center gap-2">
          <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
            <Sparkles size={18} color={colors.green500} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-sans-semibold text-base">Edit with AI</Text>
            <Text className="text-xs text-muted-foreground">
              Describe what to change — ingredients, servings, style, etc.
            </Text>
          </View>
        </View>

        <Textarea
          value={instruction}
          onChangeText={setInstruction}
          editable={!saving}
          placeholder="e.g. Make it dairy-free and cut prep time in half"
          className="min-h-[120px] rounded-xl"
          autoFocus
        />

        <View className="flex-row gap-2 pt-1">
          <Button variant="outline" className="flex-1" disabled={saving} onPress={handleClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={!canSave} onPress={onSave}>
            {saving ? <Spinner size="small" color={colors.foreground} /> : null}
            {saving ? "Updating…" : "Apply edit"}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

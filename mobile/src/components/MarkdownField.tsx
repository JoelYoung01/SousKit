import { MarkdownBody, MarkdownPreviewToggle } from "@/components/MarkdownBody";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { useState } from "react";
import { View } from "react-native";

export function MarkdownField({
  label,
  value,
  onChangeText,
  minHeightClass = "min-h-24"
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  minHeightClass?: string;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Label>{label}</Label>
        <MarkdownPreviewToggle mode={mode} onChange={setMode} />
      </View>
      {mode === "write" ? (
        <Textarea value={value} onChangeText={onChangeText} className={cn(minHeightClass, "rounded-xl")} />
      ) : (
        <View className={cn("rounded-xl border border-input bg-card px-3 py-3", minHeightClass)}>
          {value.trim() ? (
            <MarkdownBody source={value} />
          ) : (
            <Text className="text-sm text-muted-foreground">Nothing to preview.</Text>
          )}
        </View>
      )}
      <Text className="text-xs leading-4 text-muted-foreground">
        Markdown works here: **bold**, *italic*, and lists.
      </Text>
    </View>
  );
}

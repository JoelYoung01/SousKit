import type { UploadSlim } from "@/types";
import { mediaSource } from "@/lib/media";
import { colors } from "@/lib/colors";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";

/** Bottom sheet: pick one of several searched cover photos. */
export function CoverImagePickerSheet({
  visible,
  options,
  onSelect,
  onClose,
  onSearchAgain
}: {
  visible: boolean;
  options: UploadSlim[];
  onSelect: (upload: UploadSlim) => void;
  onClose: () => void;
  onSearchAgain?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Prefer the first option whenever a new result set opens.
  const activeId = selectedId ?? options[0]?.id ?? null;

  const confirm = () => {
    const chosen = options.find((o) => o.id === activeId) ?? options[0];
    if (chosen) onSelect(chosen);
  };

  return (
    <Sheet visible={visible} onClose={onClose} className="px-4 pb-2 pt-1">
      <Text className="font-sans-semibold text-lg">Choose a cover photo</Text>
      <Text className="mt-1 text-sm leading-5 text-muted-foreground">
        Free public-domain food photos matched to this recipe. Tap one to use it.
      </Text>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {options.map((option) => {
          const selected = activeId === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel="Cover photo option"
              onPress={() => setSelectedId(option.id)}
              className="overflow-hidden rounded-xl border-2"
              style={{
                width: "48%",
                flexGrow: 1,
                borderColor: selected ? colors.green500 : colors.border
              }}
            >
              <Image
                source={mediaSource(option.url)}
                style={{ width: "100%", height: 112 }}
                contentFit="cover"
              />
            </Pressable>
          );
        })}
      </View>

      <View className="mt-4 gap-2 pb-2">
        <Button disabled={!activeId} onPress={confirm}>
          Use this photo
        </Button>
        {onSearchAgain ? (
          <Button variant="secondary" onPress={onSearchAgain}>
            Search again
          </Button>
        ) : null}
        <Button variant="outline" onPress={onClose}>
          Cancel
        </Button>
      </View>
    </Sheet>
  );
}

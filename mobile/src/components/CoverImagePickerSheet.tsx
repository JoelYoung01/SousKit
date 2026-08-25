import type { RecipeCoverOption } from "@/types";
import { mediaSource } from "@/lib/media";
import { uploadMediaUrl } from "@/lib/coverMedia";
import { colors } from "@/lib/colors";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Image } from "expo-image";
import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

/** Bottom sheet: pick one of several searched cover photos. */
export function CoverImagePickerSheet({
  visible,
  options,
  dismissingId = null,
  onSelect,
  onClose,
  onSearchAgain,
  onDismiss
}: {
  visible: boolean;
  options: RecipeCoverOption[];
  dismissingId?: number | null;
  onSelect: (upload: RecipeCoverOption) => void;
  onClose: () => void;
  onSearchAgain?: () => void;
  onDismiss?: (upload: RecipeCoverOption) => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) {
      setSelectedId(null);
      return;
    }
    if (!options.some((o) => o.id === selectedId)) {
      setSelectedId(options[0]?.id ?? null);
    }
  }, [visible, options, selectedId]);

  const activeId = selectedId ?? options[0]?.id ?? null;

  const confirm = () => {
    const chosen = options.find((o) => o.id === activeId) ?? options[0];
    if (!chosen) return;
    onSelect(chosen);
  };

  return (
    <Sheet visible={visible} onClose={onClose} className="px-0 pb-0 pt-1" fullHeight>
      <ScrollView
        className="px-4"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-2"
      >
        <Text className="font-sans-semibold text-lg">Choose a cover photo</Text>
        <Text className="mt-1 text-sm leading-5 text-muted-foreground">
          Tap one to use it. Dismiss photos you don’t want — Search again won’t show them for this
          recipe.
        </Text>

        <View className="mt-4 flex-row flex-wrap gap-2">
          {options.map((option) => {
            const selected = activeId === option.id;
            const dismissing = dismissingId === option.id;
            const previewUrl = uploadMediaUrl(option);
            return (
              <View
                key={option.id}
                className="relative overflow-hidden rounded-xl border-2"
                style={{
                  width: "48%",
                  flexGrow: 1,
                  borderColor: selected ? colors.green500 : colors.border
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel="Cover photo option"
                  onPress={() => setSelectedId(option.id)}
                >
                  <Image
                    source={mediaSource(previewUrl)}
                    style={{ width: "100%", height: 112 }}
                    contentFit="cover"
                  />
                </Pressable>
                {onDismiss ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss this photo"
                    disabled={dismissing}
                    onPress={() => onDismiss(option)}
                    className="absolute right-1.5 top-1.5 h-7 w-7 items-center justify-center rounded-full border border-border bg-card"
                    style={{ opacity: dismissing ? 0.6 : 1 }}
                  >
                    {dismissing ? (
                      <Spinner size="small" />
                    ) : (
                      <X size={14} color={colors.foreground} />
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>

        {!options.length ? (
          <Text className="mt-3 text-sm text-muted-foreground">
            No options left — try Search again for more photos.
          </Text>
        ) : null}

        <View className="mt-4 gap-2">
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
      </ScrollView>
    </Sheet>
  );
}

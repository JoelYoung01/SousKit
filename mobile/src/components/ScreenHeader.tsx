import { cn } from "@/lib/cn";
import { colors } from "@/lib/colors";
import { tapHaptic } from "@/lib/haptics";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./ui/text";

/** Stack-screen header: back chevron, centered title, optional right slot. */
export function ScreenHeader({
  title,
  detail,
  detailTone = "muted",
  right,
  onBack
}: {
  title: string;
  /** Quiet status line under the title, such as an autosave state. */
  detail?: string;
  detailTone?: "muted" | "danger";
  right?: ReactNode;
  onBack?: () => void;
}) {
  const router = useRouter();

  const goBack = () => {
    tapHaptic();
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  };

  return (
    <View className="min-h-12 flex-row items-center px-2 py-1.5">
      <View className="w-16 items-start justify-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-lg active:opacity-70"
        >
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
      </View>
      <View className="min-w-0 flex-1 items-center">
        <Text className="text-center font-sans-semibold text-base" numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text
            accessibilityLiveRegion="polite"
            className={cn(
              "text-center text-[11px]",
              detailTone === "danger" ? "text-destructive" : "text-muted-foreground"
            )}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      <View className="w-16 items-end justify-center">{right}</View>
    </View>
  );
}

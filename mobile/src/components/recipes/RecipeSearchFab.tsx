import { Input } from "@/components/ui/input";
import { KeyboardStickyView } from "@/components/ui/keyboard";
import { colors } from "@/lib/colors";
import { tapHaptic } from "@/lib/haptics";
import { Search, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  value: string;
  onChangeText: (text: string) => void;
};

/**
 * Collapsed search FAB (bottom-right, above the tab bar). Tap to expand into a
 * full-width bar that sticks to the top of the keyboard via KeyboardStickyView.
 */
export function RecipeSearchFab({ value, onChangeText }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const keyboardVisible = useKeyboardState((s) => s.isVisible);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [progress] = useState(() => new Animated.Value(0));

  // Tab bar ~64px + safe area when keyboard is hidden; flush when keyboard up
  // (AppTabBar returns null while the keyboard is visible).
  const collapsedBottom = (keyboardVisible ? 12 : 72) + insets.bottom;
  const sidePad = 16;
  const fabSize = 56;
  const barHeight = 52;
  const maxBarWidth = width - sidePad * 2;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start(({ finished }) => {
      if (finished && expanded) {
        inputRef.current?.focus();
      }
    });
  }, [expanded, progress]);

  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fabSize, maxBarWidth]
  });
  const borderRadius = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fabSize / 2, 16]
  });
  const iconOpacity = progress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [1, 0, 0]
  });
  const fieldOpacity = progress.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0, 0, 1]
  });

  const close = () => {
    inputRef.current?.blur();
    setExpanded(false);
  };

  const onClearOrClose = () => {
    tapHaptic();
    if (value) onChangeText("");
    else close();
  };

  return (
    <KeyboardStickyView
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: collapsedBottom,
        zIndex: 40,
        paddingHorizontal: sidePad
      }}
      pointerEvents="box-none"
    >
      <View className="items-end" pointerEvents="box-none">
        <Animated.View
          style={{
            width: barWidth,
            height: expanded ? barHeight : fabSize,
            borderRadius,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            overflow: "hidden",
            shadowColor: "#16a34a",
            shadowOpacity: 0.28,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4
          }}
        >
          {/* Collapsed icon hit target */}
          <Animated.View
            pointerEvents={expanded ? "none" : "auto"}
            style={{
              ...absoluteFill,
              opacity: iconOpacity,
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search recipes"
              onPress={() => {
                tapHaptic();
                setExpanded(true);
              }}
              className="h-full w-full items-center justify-center active:opacity-80"
            >
              <Search size={22} color={colors.green500} strokeWidth={2.2} />
            </Pressable>
          </Animated.View>

          {/* Expanded search field */}
          <Animated.View
            pointerEvents={expanded ? "auto" : "none"}
            style={{
              ...absoluteFill,
              opacity: fieldOpacity,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 12,
              gap: 8
            }}
          >
            <Search size={16} color={colors.faint} strokeWidth={2} />
            <Input
              ref={inputRef}
              value={value}
              onChangeText={onChangeText}
              placeholder="Search recipes…"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              className="h-11 flex-1 border-0 bg-transparent px-0"
              onSubmitEditing={() => inputRef.current?.blur()}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={value ? "Clear search" : "Close search"}
              onPress={onClearOrClose}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
            >
              <X size={18} color={colors.mutedForeground} strokeWidth={2} />
            </Pressable>
          </Animated.View>
        </Animated.View>
      </View>
    </KeyboardStickyView>
  );
}

const absoluteFill = {
  position: "absolute" as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0
};

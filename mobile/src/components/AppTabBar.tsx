import { colors } from "@/lib/colors";
import { tapHaptic } from "@/lib/haptics";
import { BookOpen, CalendarDays, House, Plus, ShoppingCart } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./ui/text";

/**
 * Structural subset of react-navigation's BottomTabBarProps — expo-router
 * SDK 57 vendors its own react-navigation copy, so importing the type from
 * @react-navigation/bottom-tabs would clash with the vendored one.
 */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (event: {
      type: "tabPress";
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

const TAB_META: Record<string, { label: string; Icon: typeof House }> = {
  home: { label: "Home", Icon: House },
  recipes: { label: "Recipes", Icon: BookOpen },
  planner: { label: "Planner", Icon: CalendarDays },
  list: { label: "Grocery", Icon: ShoppingCart }
};

/**
 * Custom bottom tab bar: 4 tabs with a raised green "+" in the middle
 * (opens the Add sheet) — mirrors the web AppTabBar.
 */
export function AppTabBar({
  state,
  navigation,
  addOpen,
  onAddPress
}: TabBarProps & { addOpen: boolean; onAddPress: () => void }) {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((s) => s.isVisible);
  const [rotation] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: addOpen ? 1 : 0,
      duration: 180,
      useNativeDriver: true
    }).start();
  }, [addOpen, rotation]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] });

  // Custom tab bar isn't wired to tabBarHideOnKeyboard — hide it ourselves so
  // search fields (Recipes, planner sheets) aren't squeezed above the keyboard.
  if (keyboardVisible) return null;

  const pressTab = (index: number) => {
    const route = state.routes[index]!;
    const focused = state.index === index;
    tapHaptic();
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true
    });
    if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
  };

  const renderTab = (index: number) => {
    const route = state.routes[index]!;
    const meta = TAB_META[route.name] ?? { label: route.name, Icon: House };
    const focused = state.index === index;
    const color = focused ? colors.green500 : colors.faint;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={meta.label}
        onPress={() => pressTab(index)}
        className="flex-1 items-center justify-center gap-1"
      >
        <meta.Icon size={22} color={color} strokeWidth={focused ? 2.2 : 1.8} />
        <Text
          className={focused ? "text-[11px] text-[#22c55e] font-sans-medium" : "text-[11px] text-faint"}
        >
          {meta.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      className="border-t border-border bg-background"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="h-16 flex-row items-stretch">
        {renderTab(0)}
        {renderTab(1)}
        <View className="flex-1 items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addOpen ? "Close add menu" : "Add"}
            onPress={() => {
              tapHaptic();
              onAddPress();
            }}
            className="-mt-5 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg active:opacity-90"
          >
            <Animated.View style={{ transform: [{ rotate }] }}>
              <Plus size={26} color={colors.foreground} strokeWidth={2.4} />
            </Animated.View>
          </Pressable>
        </View>
        {renderTab(2)}
        {renderTab(3)}
      </View>
    </View>
  );
}

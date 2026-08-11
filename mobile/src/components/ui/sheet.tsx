import { KeyboardStickyView } from "@/components/ui/keyboard";
import { cn } from "@/lib/cn";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Bottom sheet: scrim fade + panel slide, drag-down on the handle to close.
 * Lifts with the keyboard via KeyboardStickyView so inputs stay visible.
 * Mirrors the web app's AddMenuSheet mechanics.
 */
export function Sheet({
  visible,
  onClose,
  children,
  className
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardState((s) => (s.isVisible ? s.height : 0));
  const [mounted, setMounted] = useState(visible);
  const [translateY] = useState(() => new Animated.Value(height));
  const [scrim] = useState(() => new Animated.Value(0));
  const closing = useRef(false);

  // Mount as soon as the caller asks for visibility (adjust-state-in-render
  // pattern); unmount happens after the exit animation completes.
  if (visible && !mounted) setMounted(true);

  const animateOut = useCallback(
    (after?: () => void) => {
      if (closing.current) return;
      closing.current = true;
      Animated.parallel([
        Animated.timing(scrim, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: height, duration: 220, useNativeDriver: true })
      ]).start(() => {
        setMounted(false);
        after?.();
      });
    },
    [height, scrim, translateY]
  );

  const requestClose = useCallback(() => animateOut(onClose), [animateOut, onClose]);
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      translateY.setValue(height);
      scrim.setValue(0);
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.timing(scrim, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 28,
            stiffness: 260,
            mass: 0.9
          })
        ]).start();
      });
    } else {
      animateOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // PanResponder.create only stores these callbacks; they run on gesture
  // events, never during render, so the refs rule is a false positive here.
  // eslint-disable-next-line react-hooks/refs
  const [panResponder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 80 || g.vy > 0.8) {
          requestCloseRef.current();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 30,
            stiffness: 300
          }).start();
        }
      }
    })
  );

  if (!mounted) return null;

  // Shrink tall sheets (e.g. recipe search) so they stay above the keyboard.
  const panelMaxHeight = (height - keyboardHeight) * 0.88;

  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      animationType="none"
      onRequestClose={requestClose}
    >
      <View className="flex-1 justify-end">
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.6)", opacity: scrim }]}
        >
          <Pressable style={{ flex: 1 }} onPress={requestClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View style={{ transform: [{ translateY }] }}>
          <KeyboardStickyView style={{ maxHeight: panelMaxHeight }}>
            <View
              className={cn(
                "rounded-t-[20px] border border-b-0 border-border bg-card px-4",
                className
              )}
              style={{ paddingBottom: insets.bottom + 12 }}
            >
              <View {...panResponder.panHandlers} className="items-center py-3">
                <View className="h-1.5 w-10 rounded-full bg-border" />
              </View>
              {children}
            </View>
          </KeyboardStickyView>
        </Animated.View>
      </View>
    </Modal>
  );
}

import { KeyboardStickyView } from "@/components/ui/keyboard";
import { cn } from "@/lib/cn";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const OPEN_SPRING = { damping: 28, stiffness: 260, mass: 0.9 };
const SNAP_SPRING = { damping: 30, stiffness: 300, mass: 0.9 };
const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 900;

type SheetMotion = {
  translateY: SharedValue<number>;
  scrim: SharedValue<number>;
  dragStartY: SharedValue<number>;
  windowHeight: SharedValue<number>;
};

function syncWindowHeight(motion: SheetMotion, windowHeight: number) {
  motion.windowHeight.value = windowHeight;
}

function animateSheetIn(motion: SheetMotion, windowHeight: number) {
  motion.translateY.value = windowHeight;
  motion.scrim.value = 0;
  requestAnimationFrame(() => {
    motion.scrim.value = withTiming(1, { duration: 200 });
    motion.translateY.value = withSpring(0, OPEN_SPRING);
  });
}

function animateSheetOut(
  motion: SheetMotion,
  closing: { current: boolean },
  onDone: () => void
) {
  if (closing.current) return;
  closing.current = true;
  motion.scrim.value = withTiming(0, { duration: 180 });
  motion.translateY.value = withTiming(motion.windowHeight.value, { duration: 220 }, (finished) => {
    if (finished) runOnJS(onDone)();
  });
}

/**
 * Bottom sheet: scrim fade + panel slide, drag-down to dismiss.
 * Uses RNGH + Reanimated so the handle drag works inside a Modal
 * (PanResponder alone often fails to capture there).
 * Lifts with the keyboard via KeyboardStickyView so inputs stay visible.
 * Tall sheets should put scrollable lists in their own ScrollView (not the
 * whole body) so action rows can stay pinned above the keyboard.
 */
export function Sheet({
  visible,
  onClose,
  children,
  className,
  fullHeight = false
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Stretch to nearly the full screen (minus a small top peek of scrim). */
  fullHeight?: boolean;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardState((s) => (s.isVisible ? s.height : 0));
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(height);
  const scrim = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const windowHeight = useSharedValue(height);
  const closing = useRef(false);
  const notifyParentOnClose = useRef(true);
  const onCloseRef = useRef(onClose);
  const motionRef = useRef<SheetMotion>({
    translateY,
    scrim,
    dragStartY,
    windowHeight
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    syncWindowHeight(motionRef.current, height);
  }, [height]);

  // Mount as soon as the caller asks for visibility (adjust-state-in-render
  // pattern); unmount happens after the exit animation completes.
  if (visible && !mounted) setMounted(true);

  const finishUnmount = useCallback(() => {
    setMounted(false);
    if (notifyParentOnClose.current) onCloseRef.current();
  }, []);

  const requestClose = useCallback(() => {
    notifyParentOnClose.current = true;
    animateSheetOut(motionRef.current, closing, finishUnmount);
  }, [finishUnmount]);

  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  // Stable JS callback for runOnJS — worklets must not read .current themselves.
  const closeFromGesture = useCallback(() => {
    requestCloseRef.current();
  }, []);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      notifyParentOnClose.current = true;
      animateSheetIn(motionRef.current, height);
    } else if (mounted) {
      // Parent flipped visible off — animate out without re-calling onClose.
      notifyParentOnClose.current = false;
      animateSheetOut(motionRef.current, closing, finishUnmount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Gesture factory only stores worklets; they run on the UI thread / gesture
  // events, never during render — same pattern as the prior PanResponder.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => {
    const motion = motionRef.current;
    return Gesture.Pan()
      .activeOffsetY(6)
      .failOffsetX([-24, 24])
      .onBegin(() => {
        motion.dragStartY.value = motion.translateY.value;
      })
      .onUpdate((e) => {
        const next = motion.dragStartY.value + e.translationY;
        motion.translateY.value = next < 0 ? 0 : next;
      })
      .onEnd((e) => {
        const shouldClose =
          motion.translateY.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY;
        if (shouldClose) {
          runOnJS(closeFromGesture)();
        } else {
          motion.translateY.value = withSpring(0, SNAP_SPRING);
        }
      });
  });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }]
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: scrim.value
  }));

  if (!mounted) return null;

  // Content-sized sheets stay under 88% of the visible viewport; full-height
  // sheets fill to just below the status bar so a sliver of scrim peeks above.
  const panelMaxHeight = fullHeight
    ? Math.max(240, height - Math.max(insets.top, 8) - keyboardHeight)
    : (height - keyboardHeight) * 0.88;
  const panelHeight = fullHeight ? panelMaxHeight : undefined;

  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      animationType="none"
      onRequestClose={requestClose}
    >
      {/* Modal hosts a separate native root — RNGH needs its own provider. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="flex-1 justify-end">
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "rgba(0,0,0,0.6)" },
              scrimStyle
            ]}
          >
            <Pressable style={{ flex: 1 }} onPress={requestClose} accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View style={sheetStyle}>
            <KeyboardStickyView style={{ maxHeight: panelMaxHeight }}>
              <View
                className={cn(
                  "overflow-hidden rounded-t-[20px] border border-b-0 border-border bg-card px-4",
                  fullHeight && "flex-col",
                  className
                )}
                style={{
                  maxHeight: panelMaxHeight,
                  height: panelHeight,
                  paddingBottom: insets.bottom + 12
                }}
              >
                <GestureDetector gesture={pan}>
                  <View
                    accessibilityRole="adjustable"
                    accessibilityLabel="Dismiss sheet"
                    accessibilityHint="Drag down to close"
                    className="items-center pb-2 pt-3"
                    // Generous hit target so the drawer feels grabable.
                    hitSlop={{ top: 8, bottom: 12, left: 24, right: 24 }}
                  >
                    <View className="h-1.5 w-10 rounded-full bg-border" />
                  </View>
                </GestureDetector>
                <View className={fullHeight ? "min-h-0 flex-1" : undefined}>{children}</View>
              </View>
            </KeyboardStickyView>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

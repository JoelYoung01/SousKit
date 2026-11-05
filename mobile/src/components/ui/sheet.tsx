import {
  SheetBodyMaxProvider,
  sheetBodyMaxHeight,
  sheetContentBottomPadding,
  sheetPanelMaxHeight
} from "@/components/ui/sheet-layout";
import { KeyboardStickyView } from "@/components/ui/keyboard";
import { cn } from "@/lib/cn";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";
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
const HANDLE_HEIGHT_ESTIMATE = 32;
const FOOTER_HEIGHT_ESTIMATE = 68;

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

function rememberHeight(current: number | null, next: number): number | null {
  const rounded = Math.ceil(next);
  return current === rounded ? current : rounded;
}

/**
 * Bottom sheet: scrim fade + panel slide, drag-down to dismiss.
 * Uses RNGH + Reanimated so the handle drag works inside a Modal
 * (PanResponder alone often fails to capture there).
 *
 * The panel lifts with the keyboard via KeyboardStickyView, and its max
 * height shrinks by that same keyboard height. A keyboard-sized spacer
 * inside the panel would double-count that offset.
 *
 * Content-sized sheets scroll their body once it exceeds the room above
 * the keyboard. Put submit/cancel rows in `footer` so a growing field
 * cannot push them behind the keyboard (a multiline input keeps the
 * keyboard up — Return inserts a newline).
 */
export function Sheet({
  visible,
  onClose,
  children,
  footer,
  className,
  fullHeight = false,
  onActivity
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Pinned to the bottom of the panel, above the keyboard. */
  footer?: ReactNode;
  className?: string;
  /** Stretch to nearly the full screen (minus a small top peek of scrim). */
  fullHeight?: boolean;
  /** Fires when the user touches the sheet, including the scrim. */
  onActivity?: () => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardState((s) => (s.isVisible ? s.height : 0));
  const [mounted, setMounted] = useState(visible);
  const [handleHeight, setHandleHeight] = useState<number | null>(null);
  const [footerHeight, setFooterHeight] = useState<number | null>(null);
  const [bodyContentHeight, setBodyContentHeight] = useState(0);
  const [trackedVisible, setTrackedVisible] = useState(visible);
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
  // Drop the previous body measurement before paint so a reopened sheet
  // doesn't flash at the last drawer's height. The scroll view reports the
  // new content size on layout.
  if (visible !== trackedVisible) {
    setTrackedVisible(visible);
    if (visible && bodyContentHeight !== 0) setBodyContentHeight(0);
  }

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

  const panelMaxHeight = sheetPanelMaxHeight({
    windowHeight: height,
    keyboardHeight,
    topInset: insets.top,
    fullHeight
  });
  const bottomPadding = sheetContentBottomPadding(keyboardHeight, insets.bottom);
  const bodyMaxHeight = sheetBodyMaxHeight({
    panelMaxHeight,
    handleHeight: handleHeight ?? HANDLE_HEIGHT_ESTIMATE,
    footerHeight: footer ? (footerHeight ?? FOOTER_HEIGHT_ESTIMATE) : 0,
    bottomPadding
  });
  // Hug the body until it hits the cap, then scroll. A plain flexGrow ScrollView
  // stretches to maxHeight and would turn every short menu into a tall drawer.
  const bodyHeight =
    bodyContentHeight > 0 ? Math.min(bodyContentHeight, bodyMaxHeight) : undefined;
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
        <View className="flex-1 justify-end" onTouchStart={onActivity}>
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
                  paddingBottom: bottomPadding
                }}
              >
                <GestureDetector gesture={pan}>
                  <View
                    accessibilityRole="adjustable"
                    accessibilityLabel="Dismiss sheet"
                    accessibilityHint="Drag down to close"
                    className="items-center pb-2 pt-3"
                    onLayout={(event) => {
                      const next = event.nativeEvent.layout.height;
                      setHandleHeight((current) => rememberHeight(current, next));
                    }}
                    // Generous hit target so the drawer feels grabable.
                    hitSlop={{ top: 8, bottom: 12, left: 24, right: 24 }}
                  >
                    <View className="h-1.5 w-10 rounded-full bg-border" />
                  </View>
                </GestureDetector>
                <SheetBodyMaxProvider maxHeight={bodyMaxHeight}>
                  {fullHeight ? (
                    <View className="min-h-0 flex-1" testID="sheet-body">
                      {children}
                    </View>
                  ) : (
                    <ScrollView
                      testID="sheet-body"
                      style={{
                        flexGrow: 0,
                        flexShrink: 1,
                        maxHeight: bodyMaxHeight,
                        height: bodyHeight
                      }}
                      contentContainerStyle={{ flexGrow: 0 }}
                      keyboardShouldPersistTaps="handled"
                      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                      nestedScrollEnabled
                      alwaysBounceVertical={false}
                      showsVerticalScrollIndicator
                      onContentSizeChange={(_width, nextHeight) => {
                        const rounded = Math.ceil(nextHeight);
                        setBodyContentHeight((current) => (current === rounded ? current : rounded));
                      }}
                    >
                      {children}
                    </ScrollView>
                  )}
                </SheetBodyMaxProvider>
                {footer ? (
                  <View
                    testID="sheet-footer"
                    className="pt-3"
                    onLayout={(event) => {
                      const next = event.nativeEvent.layout.height;
                      setFooterHeight((current) => rememberHeight(current, next));
                    }}
                  >
                    {footer}
                  </View>
                ) : null}
              </View>
            </KeyboardStickyView>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

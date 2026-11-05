import { GROCERY_CHECKOFF_COLLAPSE_MS } from "@/lib/grocery-checkoff";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View, type LayoutChangeEvent } from "react-native";

const EASE = Easing.out(Easing.cubic);
const FADE_MS = Math.round(GROCERY_CHECKOFF_COLLAPSE_MS * 0.7);

/**
 * Collapses its child on the y axis and fades it out, including the margin
 * underneath, so the rows below ease upward instead of jumping.
 */
export const GroceryCollapse = memo(function GroceryCollapse({
  leaving,
  marginBottom,
  children
}: {
  leaving: boolean;
  marginBottom: number;
  children: ReactNode;
}) {
  const contentHeight = useRef(0);
  const height = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const margin = useRef(new Animated.Value(marginBottom)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const marginBottomRef = useRef(marginBottom);
  const [clip, setClip] = useState(false);
  const clipRef = useRef(false);
  const leavingRef = useRef(leaving);
  leavingRef.current = leaving;
  marginBottomRef.current = marginBottom;

  const playLeaveRef = useRef(() => {});
  playLeaveRef.current = () => {
    const measured = contentHeight.current;
    if (measured <= 0 || !leavingRef.current) return;
    anim.current?.stop();
    if (!clipRef.current) {
      height.setValue(measured);
      opacity.setValue(1);
      margin.setValue(marginBottomRef.current);
      clipRef.current = true;
      setClip(true);
    }
    anim.current = Animated.parallel([
      Animated.timing(height, {
        toValue: 0,
        duration: GROCERY_CHECKOFF_COLLAPSE_MS,
        easing: EASE,
        useNativeDriver: false
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        easing: EASE,
        useNativeDriver: false
      }),
      Animated.timing(margin, {
        toValue: 0,
        duration: GROCERY_CHECKOFF_COLLAPSE_MS,
        easing: EASE,
        useNativeDriver: false
      })
    ]);
    anim.current.start();
  };

  useEffect(() => {
    if (leaving) {
      playLeaveRef.current();
      return () => anim.current?.stop();
    }

    const measured = contentHeight.current;
    anim.current?.stop();
    if (!clipRef.current || measured <= 0) {
      opacity.setValue(1);
      margin.setValue(marginBottom);
      return;
    }

    anim.current = Animated.parallel([
      Animated.timing(height, {
        toValue: measured,
        duration: GROCERY_CHECKOFF_COLLAPSE_MS,
        easing: EASE,
        useNativeDriver: false
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_MS,
        easing: EASE,
        useNativeDriver: false
      }),
      Animated.timing(margin, {
        toValue: marginBottom,
        duration: GROCERY_CHECKOFF_COLLAPSE_MS,
        easing: EASE,
        useNativeDriver: false
      })
    ]);
    anim.current.start(({ finished }) => {
      if (finished && !leavingRef.current) {
        clipRef.current = false;
        setClip(false);
      }
    });
    return () => anim.current?.stop();
  }, [height, leaving, margin, marginBottom, opacity]);

  function onLayout(event: LayoutChangeEvent) {
    const next = Math.ceil(event.nativeEvent.layout.height);
    if (next <= 0) return;
    // While clipped, the parent height is changing. Keep the open height.
    if (clipRef.current) return;
    const firstMeasure = contentHeight.current === 0;
    contentHeight.current = next;
    if (!leavingRef.current) {
      height.setValue(next);
      return;
    }
    if (firstMeasure) playLeaveRef.current();
  }

  return (
    <Animated.View
      style={{
        height: clip ? height : undefined,
        marginBottom: margin,
        opacity,
        overflow: clip ? "hidden" : "visible"
      }}
    >
      <View onLayout={onLayout}>{children}</View>
    </Animated.View>
  );
});

/** Category spacing that closes when every row in the section is leaving. */
export const GrocerySection = memo(function GrocerySection({
  leaving,
  gap,
  children
}: {
  leaving: boolean;
  gap: number;
  children: ReactNode;
}) {
  const margin = useRef(new Animated.Value(gap)).current;

  useEffect(() => {
    const anim = Animated.timing(margin, {
      toValue: leaving ? 0 : gap,
      duration: GROCERY_CHECKOFF_COLLAPSE_MS,
      easing: EASE,
      useNativeDriver: false
    });
    anim.start();
    return () => anim.stop();
  }, [gap, leaving, margin]);

  return <Animated.View style={{ marginBottom: margin }}>{children}</Animated.View>;
});

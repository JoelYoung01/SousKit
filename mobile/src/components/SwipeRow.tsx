import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { Eye, Trash2 } from "lucide-react-native";
import { memo, useCallback, useRef, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";

const DEFAULT_ACTION_WIDTH = 128;
const DISMISS_THRESHOLD = 72;
const OPEN_THRESHOLD = 40;

/**
 * Swipeable list row (grocery + planner). Drag right past the threshold to
 * fire onDismiss (when enabled), drag left to reveal action buttons.
 *
 * Uses RNGH Swipeable instead of PanResponder so horizontal swipes cooperate
 * with vertical ScrollView scrolling (dragOffsetFrom*Edge activation).
 */
export const SwipeRow = memo(function SwipeRow({
  children,
  onDismiss,
  onDelete,
  onView,
  actionWidth = DEFAULT_ACTION_WIDTH,
  canSwipeRight = true,
  dismissLabel = "Dismiss",
  deleteLabel = "Remove from list"
}: {
  children: ReactNode;
  onDismiss?: () => void;
  onDelete: () => void;
  onView?: () => void;
  actionWidth?: number;
  canSwipeRight?: boolean;
  dismissLabel?: string;
  deleteLabel?: string;
}) {
  const swipeableRef = useRef<Swipeable>(null);
  const allowRight = Boolean(canSwipeRight && onDismiss);
  const trayWidth = onView ? actionWidth : Math.min(actionWidth, 72);

  const close = useCallback(() => {
    swipeableRef.current?.close();
  }, []);

  const handleDismissOpen = useCallback(() => {
    onDismiss?.();
    swipeableRef.current?.close();
  }, [onDismiss]);

  const handleView = useCallback(() => {
    close();
    onView?.();
  }, [close, onView]);

  const handleDelete = useCallback(() => {
    close();
    onDelete();
  }, [close, onDelete]);

  const renderLeftActions = useCallback(() => {
    if (!allowRight) return null;
    return (
      <View className="w-28 justify-center bg-[rgba(34,197,94,0.22)] pl-4">
        <Text className="font-sans-semibold text-xs text-[#4ade80]">{dismissLabel}</Text>
      </View>
    );
  }, [allowRight, dismissLabel]);

  const renderRightActions = useCallback(() => {
    return (
      <View className="flex-row" style={{ width: trayWidth }}>
        {onView ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View recipe"
            onPress={handleView}
            className="flex-1 items-center justify-center bg-[#3f463f] active:opacity-80"
          >
            <Eye size={20} color={colors.foreground} strokeWidth={2} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          onPress={handleDelete}
          className="flex-1 items-center justify-center bg-[#dc2626] active:opacity-80"
        >
          <Trash2 size={20} color={colors.foreground} strokeWidth={2} />
        </Pressable>
      </View>
    );
  }, [deleteLabel, handleDelete, handleView, onView, trayWidth]);

  return (
    <Swipeable
      ref={swipeableRef}
      friction={2}
      overshootFriction={8}
      overshootLeft={false}
      overshootRight={false}
      dragOffsetFromLeftEdge={16}
      dragOffsetFromRightEdge={16}
      leftThreshold={DISMISS_THRESHOLD}
      rightThreshold={OPEN_THRESHOLD}
      enableTrackpadTwoFingerGesture
      renderLeftActions={allowRight ? renderLeftActions : undefined}
      renderRightActions={renderRightActions}
      onSwipeableOpen={(direction) => {
        if (direction === "left" && allowRight) handleDismissOpen();
      }}
      containerStyle={{ overflow: "hidden" }}
      childrenContainerStyle={{ backgroundColor: colors.card }}
    >
      {children}
    </Swipeable>
  );
});

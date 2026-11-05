import { GroceryCheckoffController, type CheckoffClock } from "@/lib/grocery-checkoff";
import { onScopeDispose, ref } from "vue";

/**
 * Shared idle timer for grocery check-offs. `animate` false skips the
 * collapse (used while dismissed rows stay on screen).
 */
export function useGroceryCheckoff(onCommit: (keys: string[]) => void, animate: () => boolean) {
  const waiting = ref<ReadonlySet<string>>(new Set());
  const leaving = ref<ReadonlySet<string>>(new Set());

  const controller = new GroceryCheckoffController(
    onCommit,
    (clock: CheckoffClock) => {
      waiting.value = clock.waiting;
      leaving.value = clock.leaving;
    },
    animate
  );

  onScopeDispose(() => controller.dispose());

  function isHeld(key: string) {
    return waiting.value.has(key) || leaving.value.has(key);
  }

  function isLeaving(key: string) {
    return leaving.value.has(key);
  }

  return {
    waiting,
    leaving,
    isHeld,
    isLeaving,
    queue: (key: string) => controller.queue(key),
    drop: (key: string) => controller.drop(key),
    noteActivity: () => controller.noteActivity(),
    prune: (liveKeys: ReadonlySet<string>) => controller.prune(liveKeys)
  };
}

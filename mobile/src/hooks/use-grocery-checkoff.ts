import { GroceryCheckoffController } from "@/lib/grocery-checkoff";
import { useCallback, useEffect, useState } from "react";

/**
 * Shared idle timer for grocery check-offs. `animate` false skips the
 * collapse (used while dismissed rows stay on screen).
 */
export function useGroceryCheckoff(onCommit: (keys: string[]) => void, animate: boolean) {
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(() => new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const [controller] = useState(
    () =>
      new GroceryCheckoffController(
        () => {},
        (clock) => {
          setWaiting(clock.waiting);
          setLeaving(clock.leaving);
        }
      )
  );

  useEffect(() => {
    controller.setHandlers(onCommit, () => animate);
  }, [animate, controller, onCommit]);

  useEffect(() => () => controller.dispose(), [controller]);

  const queue = useCallback((key: string) => controller.queue(key), [controller]);
  const drop = useCallback((key: string) => controller.drop(key), [controller]);
  const noteActivity = useCallback(() => controller.noteActivity(), [controller]);
  const prune = useCallback(
    (liveKeys: ReadonlySet<string>) => controller.prune(liveKeys),
    [controller]
  );

  return {
    waiting,
    leaving,
    isHeld: (key: string) => waiting.has(key) || leaving.has(key),
    isLeaving: (key: string) => leaving.has(key),
    queue,
    drop,
    noteActivity,
    prune
  };
}

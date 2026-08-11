import { LockScreen } from "@/components/LockScreen";
import { useAppLockStore } from "@/stores/app-lock";
import { useSessionStore } from "@/stores/session";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

/**
 * Renders the biometric LockScreen over the whole app while it is locked.
 * Starts a grace timer when backgrounded; re-locks only after an hour away
 * (native only). Returning within the hour resets the timer.
 */
export function AppLockGate() {
  const sessionStatus = useSessionStore((s) => s.status);
  const enabled = useAppLockStore((s) => s.enabled);
  const locked = useAppLockStore((s) => s.locked);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (state) => {
      const store = useAppLockStore.getState();
      if (state === "background") store.markBackgrounded();
      else if (state === "active") store.resume();
    });
    return () => sub.remove();
  }, []);

  if (sessionStatus !== "authed" || !enabled || !locked) return null;
  return <LockScreen />;
}

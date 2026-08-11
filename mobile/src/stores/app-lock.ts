import { secureStorage } from "@/lib/secure-storage";
import { create } from "zustand";

const APP_LOCK_KEY = "souskit.app_lock";
const LEFT_AT_KEY = "souskit.app_lock.left_at";

/** Re-lock only after the app has been away at least this long. */
export const APP_LOCK_GRACE_MS = 60 * 60 * 1000;

interface AppLockState {
  /** True once the persisted preference has been read. */
  ready: boolean;
  /** User preference: require biometric unlock when opening the app. */
  enabled: boolean;
  /** Whether the app is currently behind the biometric gate. */
  locked: boolean;
  /** Epoch ms when the app last went to background; null if not away. */
  leftAt: number | null;
  /** Restore the persisted preference. Cold starts lock only after the grace period. */
  bootstrap: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  /** Record that the app left the foreground (starts/resets the grace timer). */
  markBackgrounded: () => void;
  /** On return to foreground: lock if grace expired, otherwise clear the timer. */
  resume: () => void;
  /** Force-lock when enabled (e.g. tests). Prefer resume() in app code. */
  lock: () => void;
  unlock: () => void;
}

let bootstrapStarted = false;

/** Test hook — lets Jest re-run bootstrap in isolation. */
export function resetAppLockBootstrapForTests() {
  bootstrapStarted = false;
}

function shouldLock(enabled: boolean, leftAt: number | null, now = Date.now()): boolean {
  if (!enabled || leftAt == null) return false;
  return now - leftAt >= APP_LOCK_GRACE_MS;
}

export const useAppLockStore = create<AppLockState>((set, get) => ({
  ready: false,
  enabled: false,
  locked: false,
  leftAt: null,

  async bootstrap() {
    if (bootstrapStarted) return;
    bootstrapStarted = true;
    const [stored, leftRaw] = await Promise.all([
      secureStorage.get(APP_LOCK_KEY),
      secureStorage.get(LEFT_AT_KEY)
    ]);
    const enabled = stored === "1";
    const parsed = leftRaw != null ? Number(leftRaw) : NaN;
    const leftAt = Number.isFinite(parsed) ? parsed : null;
    set({ ready: true, enabled, leftAt, locked: shouldLock(enabled, leftAt) });
  },

  async setEnabled(on) {
    if (on) {
      await secureStorage.set(APP_LOCK_KEY, "1");
      await secureStorage.remove(LEFT_AT_KEY);
      // Never lock the session the user is currently using.
      set({ enabled: true, locked: false, leftAt: null });
      return;
    }
    await secureStorage.remove(APP_LOCK_KEY);
    await secureStorage.remove(LEFT_AT_KEY);
    set({ enabled: false, locked: false, leftAt: null });
  },

  markBackgrounded() {
    if (!get().enabled) return;
    const leftAt = Date.now();
    void secureStorage.set(LEFT_AT_KEY, String(leftAt));
    set({ leftAt });
  },

  resume() {
    if (!get().enabled) return;
    const { leftAt } = get();
    if (shouldLock(true, leftAt)) {
      set({ locked: true });
      return;
    }
    // Still within the grace window — clear so the next background starts a fresh hour.
    if (leftAt != null) void secureStorage.remove(LEFT_AT_KEY);
    set({ leftAt: null });
  },

  lock() {
    if (get().enabled) set({ locked: true });
  },

  unlock() {
    void secureStorage.remove(LEFT_AT_KEY);
    set({ locked: false, leftAt: null });
  }
}));

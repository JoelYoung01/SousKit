import { checkSessionToken } from "@/api/auth";
import { secureStorage as storage } from "@/lib/secure-storage";
import type { UserResponse } from "@/types";
import { create } from "zustand";

const TOKEN_KEY = "souskit.access_token";
const USER_KEY = "souskit.session_user";
/** Set when the server rejects the session, so login can offer a passkey. */
const REAUTH_KEY = "souskit.reauth_with_passkey";

/**
 * Minimum gap between foreground session refreshes. Cold start always
 * refreshes. The idle window is 30 days, so this only collapses duplicate
 * resume events.
 */
const TOUCH_MIN_INTERVAL_MS = 5_000;

export type SessionStatus = "loading" | "authed" | "anon";

interface SessionState {
  status: SessionStatus;
  token: string | null;
  user: UserResponse | null;
  /**
   * The last session was rejected (idle timeout or revoked). Login uses this
   * to offer a passkey. Explicit sign-out leaves it false.
   */
  reauthWithPasskey: boolean;
  /** Restore + verify the persisted session. Runs once at app start. */
  bootstrap: () => Promise<void>;
  /**
   * Ask the server to reset the 30-day idle window. Called whenever the app
   * comes back to the foreground. Network failures keep the current session.
   */
  touch: () => Promise<void>;
  /** Persist a fresh token + user after a successful auth exchange. */
  setSession: (token: string, user: UserResponse) => Promise<void>;
  /** Update the cached user (e.g. display-name edit). */
  setUser: (user: UserResponse) => void;
  /**
   * Sign out. Pass `{ reauth: true }` when the server rejected the session
   * so the login screen can offer a passkey instead of a password.
   */
  clear: (options?: { reauth?: boolean }) => Promise<void>;
}

let bootstrapStarted = false;
let refreshInFlight: Promise<void> | null = null;
let lastTouchAt = 0;

/** Test hook — lets Jest re-run bootstrap in isolation. */
export function resetSessionBootstrapForTests() {
  bootstrapStarted = false;
  refreshInFlight = null;
  lastTouchAt = 0;
}

async function readCachedUser(): Promise<UserResponse | null> {
  try {
    const raw = await storage.get(USER_KEY);
    return raw ? (JSON.parse(raw) as UserResponse) : null;
  } catch {
    return null;
  }
}

export const useSessionStore = create<SessionState>((set, get) => {
  async function rememberRejection() {
    await storage.remove(TOKEN_KEY);
    await storage.remove(USER_KEY);
    await storage.set(REAUTH_KEY, "1");
    set({ status: "anon", token: null, user: null, reauthWithPasskey: true });
  }

  async function refreshStoredSession() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const token = get().token ?? (await storage.get(TOKEN_KEY));
      if (!token) {
        const reauth = (await storage.get(REAUTH_KEY)) === "1";
        set({ status: "anon", token: null, user: null, reauthWithPasskey: reauth });
        return;
      }

      try {
        const session = await checkSessionToken(token);
        if (session) {
          await storage.set(TOKEN_KEY, session.access_token);
          await storage.set(USER_KEY, JSON.stringify(session.user));
          await storage.remove(REAUTH_KEY);
          lastTouchAt = Date.now();
          set({
            status: "authed",
            token: session.access_token,
            user: session.user,
            reauthWithPasskey: false
          });
          return;
        }
        await rememberRejection();
      } catch {
        // Offline or a server hiccup: keep the stored session. The idle
        // window is enforced when the server can be reached again.
        const cachedUser = get().user ?? (await readCachedUser());
        set({
          status: "authed",
          token,
          user: cachedUser,
          reauthWithPasskey: false
        });
      }
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  return {
    status: "loading",
    token: null,
    user: null,
    reauthWithPasskey: false,

    async bootstrap() {
      if (bootstrapStarted) return;
      bootstrapStarted = true;
      await refreshStoredSession();
    },

    async touch() {
      if (get().status !== "authed") return;
      if (Date.now() - lastTouchAt < TOUCH_MIN_INTERVAL_MS) return;
      await refreshStoredSession();
    },

    async setSession(token, user) {
      await storage.set(TOKEN_KEY, token);
      await storage.set(USER_KEY, JSON.stringify(user));
      await storage.remove(REAUTH_KEY);
      lastTouchAt = Date.now();
      set({ status: "authed", token, user, reauthWithPasskey: false });
    },

    setUser(user) {
      set({ user });
      void storage.set(USER_KEY, JSON.stringify(user));
    },

    async clear(options) {
      const reauth = options?.reauth ?? false;
      await storage.remove(TOKEN_KEY);
      await storage.remove(USER_KEY);
      if (reauth) await storage.set(REAUTH_KEY, "1");
      else await storage.remove(REAUTH_KEY);
      set({ status: "anon", token: null, user: null, reauthWithPasskey: reauth });
    }
  };
});

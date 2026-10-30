import { resetClientData } from "@/stores/sync";
import type { UserResponse } from "@/types/User";
import { AuthLoginEvent, checkSessionToken } from "@/utils";
import { defineStore } from "pinia";
import { ref } from "vue";

export const TOKEN_STORAGE_KEY = "access_token";
const USER_STORAGE_KEY = "current_user";

function readCachedUser(): UserResponse | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserResponse) : null;
  } catch {
    return null;
  }
}

export const useSessionStore = defineStore("session", () => {
  const access_token = ref<string | null>(localStorage.getItem(TOKEN_STORAGE_KEY));
  const currentUser = ref<UserResponse | null>(readCachedUser());
  /** True until the first session check finishes (avoids auth redirect races). */
  const loading = ref(true);
  let checking = false;

  function persistSession(token: string, user: UserResponse) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    access_token.value = token;
    currentUser.value = user;
  }

  async function checkSession() {
    if (checking) return;
    checking = true;
    loading.value = true;
    access_token.value = localStorage.getItem(TOKEN_STORAGE_KEY);

    if (access_token.value === null) {
      logout();
      loading.value = false;
      checking = false;
      return;
    }

    const session = await checkSessionToken(access_token.value);

    if (session) {
      persistSession(session.access_token, session.user);
    } else if (session === null) {
      logout();
    } else if (!currentUser.value) {
      currentUser.value = readCachedUser();
    }

    loading.value = false;
    checking = false;
  }

  /** Reset the idle window when the tab is used again. Failures keep the session. */
  async function touchSession() {
    if (loading.value || checking || !access_token.value) return;
    checking = true;
    try {
      const session = await checkSessionToken(access_token.value);
      if (session) persistSession(session.access_token, session.user);
      else if (session === null) logout();
    } finally {
      checking = false;
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    access_token.value = null;
    currentUser.value = null;
    resetClientData();
  }

  window.addEventListener(AuthLoginEvent, ((event: CustomEvent) => {
    persistSession(event.detail.access_token, event.detail.user);
    loading.value = false;
  }) as EventListener);

  checkSession();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void touchSession();
  });
  return { currentUser, loading, checkSession, logout };
});

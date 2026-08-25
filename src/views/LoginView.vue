<script setup lang="ts">
import souskitMark from "@/assets/souskit-mark.png";
import GoogleLoginButton from "@/components/GoogleLoginButton.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionStore } from "@/stores/session";
import { paths } from "@/sitemap";
import { AuthApiError, AuthErrorEvent, AuthPendingEvent, loginWithPassword } from "@/utils";
import { LoaderCircle } from "@lucide/vue";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const appTitle = import.meta.env.VITE_APP_TITLE;
const submitting = ref(false);
const googlePending = ref(false);
const errorMessage = ref<string | null>(null);
const email = ref("");
const password = ref("");

function onAuthPending() {
  googlePending.value = true;
  errorMessage.value = null;
}

function onAuthError(event: Event) {
  googlePending.value = false;
  const detail = (event as CustomEvent<{ message?: string }>).detail;
  errorMessage.value = detail?.message || "Google sign-in failed";
}

onMounted(() => {
  window.addEventListener(AuthPendingEvent, onAuthPending);
  window.addEventListener(AuthErrorEvent, onAuthError);
});
onUnmounted(() => {
  window.removeEventListener(AuthPendingEvent, onAuthPending);
  window.removeEventListener(AuthErrorEvent, onAuthError);
});

watch(
  () => session.currentUser,
  (user) => {
    if (!user) return;
    const redirect =
      typeof route.query.redirectUrl === "string" ? route.query.redirectUrl : paths.home;
    router.replace(redirect);
  },
  { immediate: true }
);

async function onSubmit() {
  if (submitting.value || googlePending.value) return;
  errorMessage.value = null;
  submitting.value = true;
  try {
    await loginWithPassword({
      email: email.value.trim(),
      password: password.value
    });
  } catch (err) {
    if (err instanceof AuthApiError && err.redirectTo) {
      if (import.meta.env.DEV && err.devOtp) {
        sessionStorage.setItem(`dev_otp:${err.email || email.value.trim()}`, err.devOtp);
      }
      await router.push(err.redirectTo);
      return;
    }
    errorMessage.value = err instanceof Error ? err.message : "Login failed";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="app-scroll flex h-full min-h-0 flex-col items-center justify-center gap-8 overflow-y-auto overscroll-y-contain bg-gradient-to-b from-elevated via-background to-background px-6 py-10"
  >
    <div class="flex flex-col items-center gap-3 text-center">
      <img :src="souskitMark" alt="" class="size-20 object-contain" />
      <h1 class="text-3xl font-bold tracking-tighter text-foreground">{{ appTitle }}</h1>
    </div>

    <!--
      After the Google popup/FedCM closes, the credential → API exchange can take
      a beat on slow networks. Swap the form for a loader so it doesn't look like
      sign-in failed and bounced back to login.
    -->
    <div
      v-if="googlePending"
      class="flex w-full max-w-[320px] flex-col items-center gap-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div class="flex flex-col items-center gap-3">
        <LoaderCircle class="size-8 animate-spin text-primary" aria-hidden="true" />
        <p class="text-sm font-medium text-foreground">Signing you in…</p>
        <p class="text-center text-xs text-muted-foreground">Finishing Google sign-in</p>
      </div>
      <div class="flex w-full flex-col gap-3" aria-hidden="true">
        <Skeleton class="h-11 w-full rounded-lg" />
        <Skeleton class="h-11 w-full rounded-lg" />
        <Skeleton class="h-11 w-full rounded-lg" />
      </div>
    </div>

    <template v-else>
      <form class="flex w-full max-w-[320px] flex-col gap-3" @submit.prevent="onSubmit">
        <div class="space-y-1.5">
          <Label for="login-email">Email</Label>
          <Input
            id="login-email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            placeholder="you@example.com"
            class="h-11"
          />
        </div>
        <div class="space-y-1.5">
          <Label for="login-password">Password</Label>
          <Input
            id="login-password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            placeholder="••••••••"
            class="h-11"
          />
        </div>
        <p v-if="errorMessage" class="text-sm text-destructive">{{ errorMessage }}</p>
        <Button class="h-11 w-full rounded-lg" type="submit" :disabled="submitting">
          {{ submitting ? "Signing in…" : "Sign in" }}
        </Button>
        <p class="text-center text-sm text-muted-foreground">
          New here?
          <RouterLink :to="paths.register" class="text-primary underline-offset-4 hover:underline">
            Create an account
          </RouterLink>
        </p>
      </form>

      <div class="flex w-full max-w-[320px] flex-col items-center gap-3">
        <div class="flex w-full items-center gap-3">
          <div class="h-px flex-1 bg-border" />
          <span class="text-xs text-faint">or</span>
          <div class="h-px flex-1 bg-border" />
        </div>

        <GoogleLoginButton />
      </div>
    </template>
  </div>
</template>

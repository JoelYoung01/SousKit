<script setup lang="ts">
import souskitMark from "@/assets/souskit-mark.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSessionStore } from "@/stores/session";
import { paths } from "@/sitemap";
import { AuthApiError, registerWithPassword } from "@/utils";
import { ref, watch } from "vue";
import { RouterLink, useRouter } from "vue-router";

const session = useSessionStore();
const router = useRouter();
const appTitle = import.meta.env.VITE_APP_TITLE;

const displayName = ref("");
const email = ref("");
const password = ref("");
const confirmPassword = ref("");
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

watch(
  () => session.currentUser,
  (user) => {
    if (user) router.replace(paths.home);
  },
  { immediate: true }
);

async function onSubmit() {
  if (submitting.value) return;
  errorMessage.value = null;

  if (password.value !== confirmPassword.value) {
    errorMessage.value = "Passwords do not match.";
    return;
  }
  if (password.value.length < 8) {
    errorMessage.value = "Password must be at least 8 characters.";
    return;
  }

  submitting.value = true;
  try {
    const result = await registerWithPassword({
      email: email.value.trim(),
      password: password.value,
      display_name: displayName.value.trim()
    });
    if (import.meta.env.DEV && result.dev_otp) {
      sessionStorage.setItem(`dev_otp:${result.email || email.value.trim()}`, result.dev_otp);
    }
    await router.push(result.redirect_to || paths.verifyEmail);
  } catch (err) {
    errorMessage.value =
      err instanceof AuthApiError || err instanceof Error
        ? err.message
        : "Could not create account";
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
      <img :src="souskitMark" alt="" class="size-16 object-contain" />
      <h1 class="text-3xl font-bold tracking-tight text-foreground">
        {{ appTitle }}
      </h1>
      <p class="max-w-xs text-sm text-muted-foreground">
        Create an account to save and plan recipes.
      </p>
    </div>

    <form class="flex w-full max-w-[320px] flex-col gap-3" @submit.prevent="onSubmit">
      <div class="space-y-1.5">
        <Label for="register-name">Display name</Label>
        <Input
          id="register-name"
          v-model="displayName"
          type="text"
          autocomplete="name"
          required
          maxlength="100"
          class="h-11"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="register-email">Email</Label>
        <Input
          id="register-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          class="h-11"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="register-password">Password</Label>
        <Input
          id="register-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          minlength="8"
          class="h-11"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="register-confirm">Confirm password</Label>
        <Input
          id="register-confirm"
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          required
          minlength="8"
          class="h-11"
        />
      </div>
      <p v-if="errorMessage" class="text-sm text-destructive">{{ errorMessage }}</p>
      <Button class="h-11 w-full rounded-lg" type="submit" :disabled="submitting">
        {{ submitting ? "Creating…" : "Create account" }}
      </Button>
      <p class="text-center text-sm text-muted-foreground">
        Already have an account?
        <RouterLink :to="paths.login" class="text-primary underline-offset-4 hover:underline">
          Sign in
        </RouterLink>
      </p>
    </form>
  </div>
</template>

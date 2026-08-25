<script setup lang="ts">
import souskitMark from "@/assets/souskit-mark.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSessionStore } from "@/stores/session";
import { paths } from "@/sitemap";
import { AuthApiError, resendVerificationEmail, verifyEmailOtp } from "@/utils";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const appTitle = import.meta.env.VITE_APP_TITLE;
const isDev = import.meta.env.DEV;

const email = ref("");
const otp = ref("");
const submitting = ref(false);
const resending = ref(false);
const errorMessage = ref<string | null>(null);
const infoMessage = ref<string | null>(null);
const devOtpHint = ref<string | null>(null);

const emailFromQuery = computed(() =>
  typeof route.query.email === "string" ? route.query.email : ""
);

onMounted(() => {
  email.value = emailFromQuery.value;
  if (email.value) {
    const cached = sessionStorage.getItem(`dev_otp:${email.value}`);
    if (cached) devOtpHint.value = cached;
  }
});

watch(emailFromQuery, (value) => {
  if (value) email.value = value;
});

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
  infoMessage.value = null;
  submitting.value = true;
  try {
    await verifyEmailOtp({
      email: email.value.trim(),
      otp: otp.value.trim()
    });
    sessionStorage.removeItem(`dev_otp:${email.value.trim()}`);
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : "Verification failed";
  } finally {
    submitting.value = false;
  }
}

async function onResend() {
  if (resending.value || !email.value.trim()) return;
  errorMessage.value = null;
  infoMessage.value = null;
  resending.value = true;
  try {
    const result = await resendVerificationEmail(email.value.trim());
    infoMessage.value = result.message;
    if (result.dev_otp) {
      devOtpHint.value = result.dev_otp;
      sessionStorage.setItem(`dev_otp:${result.email || email.value.trim()}`, result.dev_otp);
    }
  } catch (err) {
    errorMessage.value =
      err instanceof AuthApiError || err instanceof Error ? err.message : "Could not resend code";
  } finally {
    resending.value = false;
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
      <p class="max-w-sm text-sm text-muted-foreground">
        Enter the 6-digit code we sent to your email to finish creating your account.
      </p>
    </div>

    <form class="flex w-full max-w-[320px] flex-col gap-3" @submit.prevent="onSubmit">
      <div class="space-y-1.5">
        <Label for="verify-email">Email</Label>
        <Input
          id="verify-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          class="h-11"
        />
      </div>
      <div class="space-y-1.5">
        <Label for="verify-otp">Verification code</Label>
        <Input
          id="verify-otp"
          v-model="otp"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          required
          maxlength="12"
          placeholder="123456"
          class="h-11 tracking-[0.3em]"
        />
      </div>
      <p v-if="errorMessage" class="text-sm text-destructive">{{ errorMessage }}</p>
      <p v-if="infoMessage" class="text-sm text-muted-foreground">{{ infoMessage }}</p>
      <p
        v-if="isDev && devOtpHint"
        class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-faint"
      >
        Dev OTP: <span class="font-mono text-foreground">{{ devOtpHint }}</span>
      </p>
      <Button class="h-11 w-full rounded-lg" type="submit" :disabled="submitting">
        {{ submitting ? "Verifying…" : "Verify email" }}
      </Button>
      <Button
        type="button"
        variant="ghost"
        class="h-11 w-full"
        :disabled="resending || !email"
        @click="onResend"
      >
        {{ resending ? "Sending…" : "Resend code" }}
      </Button>
      <p class="text-center text-sm text-muted-foreground">
        <RouterLink :to="paths.login" class="text-primary underline-offset-4 hover:underline">
          Back to sign in
        </RouterLink>
      </p>
    </form>
  </div>
</template>

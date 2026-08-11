<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { paths } from "@/sitemap";
import { acceptHouseholdInvite } from "@/utils/household";
import { toast } from "@/utils/toast";
import { Users } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
const busy = ref(true);
const error = ref<string | null>(null);

async function join() {
  const token = String(route.params.token ?? "").trim();
  if (!token) {
    error.value = "This invite link is missing a token.";
    busy.value = false;
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const household = await acceptHouseholdInvite(token);
    toast.success(`Joined ${household.name}. Recipes and plans are shared now.`);
    await router.replace(paths.account);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Couldn’t join that household.";
    busy.value = false;
  }
}

onMounted(() => {
  void join();
});
</script>

<template>
  <div class="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 py-12 text-center">
    <div class="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
      <Users class="size-6" />
    </div>
    <h1 class="font-semibold text-xl">Joining household…</h1>
    <p v-if="busy" class="text-sm text-muted-foreground">Accepting your invite link.</p>
    <template v-else-if="error">
      <p class="max-w-sm text-sm text-destructive">{{ error }}</p>
      <div class="flex gap-2">
        <Button variant="outline" @click="router.push(paths.account)">Account</Button>
        <Button @click="join">Try again</Button>
      </div>
    </template>
  </div>
</template>

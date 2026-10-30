<script setup lang="ts">
import defaultUser from "@/assets/account-circle.svg";
import HouseholdSection from "@/components/HouseholdSection.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { paths } from "@/sitemap";
import { useSessionStore } from "@/stores/session";
import { put } from "@/utils/api";
import { toast } from "@/utils/toast";
import { Pencil } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const sessionStore = useSessionStore();
const editingDisplayName = ref(false);
const newDisplayName = ref(sessionStore.currentUser?.display_name || "");
const loading = ref(false);

const lastLoginDate = computed(() => {
  if (!sessionStore.currentUser?.last_login) return "Never";
  return new Date(sessionStore.currentUser.last_login).toLocaleString();
});

function logOut() {
  sessionStore.logout();
  router.push(paths.login);
}

async function updateDisplayName() {
  if (!sessionStore.currentUser) return;
  loading.value = true;
  try {
    await put(`/user/${sessionStore.currentUser.id}`, {
      display_name: newDisplayName.value
    });
    sessionStore.currentUser.display_name = newDisplayName.value;
    editingDisplayName.value = false;
    toast.success("Display name updated.");
  } catch (error) {
    console.error("Failed to update display name:", error);
    toast.fromError(error, "Couldn’t update your display name.");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="px-4 pt-5">
    <h1 class="text-center text-xl font-bold">My account</h1>

    <div class="mt-6 flex justify-center">
      <img
        :src="sessionStore.currentUser?.avatar_url || defaultUser"
        alt="Avatar"
        class="size-24 rounded-full object-cover ring-2 ring-border"
      />
    </div>

    <div class="mt-6 space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <p class="text-xs text-muted-foreground">Display name</p>
        <div v-if="!editingDisplayName" class="mt-1 flex items-center gap-2">
          <p class="font-semibold">{{ sessionStore.currentUser?.display_name }}</p>
          <Button size="icon-xs" variant="ghost" @click="editingDisplayName = true">
            <Pencil class="size-3.5" />
          </Button>
        </div>
        <div v-else class="mt-2 flex gap-2">
          <Input v-model="newDisplayName" class="h-9 rounded-lg bg-secondary" />
          <Button size="sm" :disabled="loading" @click="updateDisplayName">Save</Button>
          <Button size="sm" variant="outline" @click="editingDisplayName = false">Cancel</Button>
        </div>
      </div>

      <div>
        <p class="text-xs text-muted-foreground">Username</p>
        <p class="mt-1 text-sm">{{ sessionStore.currentUser?.username }}</p>
      </div>
      <div>
        <p class="text-xs text-muted-foreground">Email</p>
        <p class="mt-1 text-sm">{{ sessionStore.currentUser?.email }}</p>
      </div>
      <div>
        <p class="text-xs text-muted-foreground">Last login</p>
        <p class="mt-1 text-sm">{{ lastLoginDate }}</p>
      </div>
    </div>

    <div class="mt-4 rounded-xl border border-border bg-card p-4">
      <p class="text-xs text-muted-foreground">Session</p>
      <p class="mt-1 text-sm">
        You stay signed in while you use Sous Kit. Opening the app resets a 30-day timer. On iPhone,
        a passkey can sign you back in with Face ID after that.
      </p>
    </div>

    <HouseholdSection />

    <Button variant="destructive" class="mt-6 w-full" @click="logOut">Sign out</Button>
  </div>
</template>

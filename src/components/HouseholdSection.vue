<script setup lang="ts">
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { extractInviteToken, inviteLabel } from "@/lib/household-invite";
import { useGroceryStore } from "@/stores/grocery";
import { useSessionStore } from "@/stores/session";
import type { Household, HouseholdInvite, PendingHouseholdInvite } from "@/types";
import {
  acceptHouseholdInvite,
  fetchHousehold,
  fetchPendingHouseholdInvites,
  inviteToHousehold,
  leaveHousehold,
  removeHouseholdMember,
  renameHousehold,
  revokeHouseholdInvite
} from "@/utils/household";
import { toast } from "@/utils/toast";
import { Users } from "@lucide/vue";
import QRCode from "qrcode";
import { computed, onMounted, ref, watch } from "vue";

const sessionStore = useSessionStore();
const groceryStore = useGroceryStore();
const household = ref<Household | null>(null);
const pendingInvites = ref<PendingHouseholdInvite[]>([]);
const loading = ref(true);
const nameDraft = ref("");
const editingName = ref(false);
const busy = ref(false);
const pasteValue = ref("");

const inviteDialogOpen = ref(false);
const inviteUrl = ref<string | null>(null);
const inviteQrDataUrl = ref<string | null>(null);
const creatingInvite = ref(false);

const isOwner = computed(() => household.value?.my_role === "owner");
const shared = computed(() => (household.value?.member_count ?? 0) > 1);

async function load() {
  loading.value = true;
  try {
    const [hh, pending] = await Promise.all([fetchHousehold(), fetchPendingHouseholdInvites()]);
    household.value = hh;
    pendingInvites.value = pending;
  } catch (error) {
    toast.fromError(error, "Couldn’t load household.");
  } finally {
    loading.value = false;
  }
}

async function renderQr(url: string) {
  inviteQrDataUrl.value = await QRCode.toDataURL(url, {
    margin: 1,
    width: 240,
    color: { dark: "#090b09", light: "#ffffff" }
  });
}

watch(inviteUrl, (url) => {
  inviteQrDataUrl.value = null;
  if (url)
    void renderQr(url).catch(() => {
      toast.fromError(new Error("Couldn’t render the QR code."));
    });
});

async function onInvite() {
  if (busy.value || creatingInvite.value) return;
  creatingInvite.value = true;
  inviteDialogOpen.value = true;
  inviteUrl.value = null;
  try {
    const invite = await inviteToHousehold();
    const url = invite.invite_url;
    if (!url) throw new Error("Invite link missing from server response.");
    inviteUrl.value = url;
    await load();
  } catch (error) {
    inviteDialogOpen.value = false;
    toast.fromError(error, "Couldn’t create that invite.");
  } finally {
    creatingInvite.value = false;
  }
}

function showInvite(invite: HouseholdInvite) {
  const url = invite.invite_url;
  if (!url) {
    toast.fromError(new Error("That invite has no link to share."));
    return;
  }
  inviteUrl.value = url;
  inviteDialogOpen.value = true;
}

async function copyInviteLink() {
  if (!inviteUrl.value) return;
  try {
    await navigator.clipboard.writeText(inviteUrl.value);
    toast.success("Invite link copied.");
  } catch {
    toast.fromError(new Error("Couldn’t copy invite link."));
  }
}

async function onRename() {
  const name = nameDraft.value.trim();
  if (!name || busy.value) return;
  busy.value = true;
  try {
    household.value = await renameHousehold(name);
    editingName.value = false;
    toast.success("Household renamed.");
  } catch (error) {
    toast.fromError(error, "Couldn’t rename household.");
  } finally {
    busy.value = false;
  }
}

async function onLeave() {
  if (!shared.value) return;
  if (
    !confirm("Leave this household? Shared recipes, plans, and the grocery list stay with them.")
  ) {
    return;
  }
  busy.value = true;
  try {
    household.value = await leaveHousehold();
    groceryStore.invalidate();
    toast.success("You left the household.");
  } catch (error) {
    toast.fromError(error, "Couldn’t leave the household.");
  } finally {
    busy.value = false;
  }
}

async function onRemove(userId: number) {
  if (!confirm("Remove this member from the household?")) return;
  busy.value = true;
  try {
    await removeHouseholdMember(userId);
    await load();
    toast.success("Member removed.");
  } catch (error) {
    toast.fromError(error, "Couldn’t remove that member.");
  } finally {
    busy.value = false;
  }
}

async function onAccept(token: string) {
  busy.value = true;
  try {
    household.value = await acceptHouseholdInvite(token);
    pendingInvites.value = await fetchPendingHouseholdInvites();
    groceryStore.invalidate();
    toast.success("Joined household. Recipes and plans are shared now.");
  } catch (error) {
    toast.fromError(error, "Couldn’t accept that invite.");
  } finally {
    busy.value = false;
  }
}

async function onRevoke(inviteId: number) {
  busy.value = true;
  try {
    await revokeHouseholdInvite(inviteId);
    await load();
  } catch (error) {
    toast.fromError(error, "Couldn’t revoke invite.");
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="mt-6 space-y-3">
    <div
      v-if="pendingInvites.length"
      class="space-y-3 rounded-xl border border-primary/40 bg-card p-4"
    >
      <p class="text-sm font-semibold text-primary">Household invites</p>
      <div v-for="invite in pendingInvites" :key="invite.id" class="space-y-2">
        <p class="text-sm">
          {{ invite.invited_by_name }} invited you to {{ invite.household_name }}
        </p>
        <Button size="sm" :disabled="busy" @click="onAccept(invite.token)"> Join household </Button>
      </div>
    </div>

    <div class="rounded-xl border border-border bg-card p-4">
      <div class="flex items-center gap-2 text-muted-foreground">
        <Users class="size-4" />
        <p class="text-xs uppercase tracking-wide">Household</p>
      </div>

      <div v-if="loading" class="mt-3 text-sm text-muted-foreground">Loading…</div>
      <template v-else-if="household">
        <div v-if="!editingName" class="mt-2 flex items-center justify-between gap-2">
          <p class="font-semibold">{{ household.name }}</p>
          <Button
            v-if="isOwner"
            size="sm"
            variant="ghost"
            @click="
              nameDraft = household!.name;
              editingName = true;
            "
          >
            Rename
          </Button>
        </div>
        <div v-else class="mt-2 flex gap-2">
          <Input v-model="nameDraft" class="h-9 rounded-lg bg-secondary" />
          <Button size="sm" :disabled="busy" @click="onRename">Save</Button>
          <Button size="sm" variant="outline" @click="editingName = false">Cancel</Button>
        </div>

        <p class="mt-1 text-xs text-muted-foreground">
          {{ household.member_count }}/{{ household.max_members }} people · shared recipes, planner,
          and grocery list
        </p>

        <div class="mt-4 space-y-3">
          <div
            v-for="member in household.members"
            :key="member.user_id"
            class="flex items-center justify-between gap-2"
          >
            <div>
              <p class="text-sm font-semibold">
                {{ member.display_name
                }}{{ member.user_id === sessionStore.currentUser?.id ? " (you)" : "" }}
              </p>
              <p class="text-xs text-muted-foreground">{{ member.role }} · {{ member.email }}</p>
            </div>
            <Button
              v-if="isOwner && member.user_id !== sessionStore.currentUser?.id"
              size="sm"
              variant="outline"
              :disabled="busy"
              @click="onRemove(member.user_id)"
            >
              Remove
            </Button>
          </div>
        </div>

        <div v-if="isOwner" class="mt-5 space-y-2 border-t border-border pt-4">
          <p class="text-xs text-muted-foreground">
            Invite someone with a QR code or single-use link
          </p>
          <Button class="w-full" :disabled="busy || creatingInvite" @click="onInvite">
            {{ creatingInvite ? "Creating invite…" : "Invite" }}
          </Button>

          <div v-if="household.pending_invites.length" class="mt-2 space-y-2">
            <p class="text-xs text-muted-foreground">Pending invites</p>
            <div
              v-for="invite in household.pending_invites"
              :key="invite.id"
              class="flex items-center justify-between gap-2"
            >
              <p class="text-sm">{{ inviteLabel(invite) }}</p>
              <div class="flex gap-1">
                <Button
                  v-if="invite.invite_url"
                  size="sm"
                  variant="outline"
                  @click="showInvite(invite)"
                >
                  Show QR
                </Button>
                <Button size="sm" variant="ghost" :disabled="busy" @click="onRevoke(invite.id)">
                  Revoke
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-5 space-y-2 border-t border-border pt-4">
          <p class="text-xs text-muted-foreground">Have an invite link?</p>
          <div class="flex gap-2">
            <Input
              v-model="pasteValue"
              placeholder="Paste invite link"
              class="h-9 rounded-lg bg-secondary"
            />
            <Button
              size="sm"
              :disabled="busy || !pasteValue.trim()"
              @click="
                (() => {
                  const token = extractInviteToken(pasteValue);
                  if (!token) {
                    toast.fromError(new Error('That doesn’t look like an invite link.'));
                    return;
                  }
                  onAccept(token).then(() => {
                    pasteValue = '';
                  });
                })()
              "
            >
              Join
            </Button>
          </div>
        </div>

        <Button
          v-if="shared"
          variant="outline"
          class="mt-5 w-full"
          :disabled="busy"
          @click="onLeave"
        >
          Leave household
        </Button>
      </template>
    </div>

    <Dialog v-model:open="inviteDialogOpen">
      <DialogContent class="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle>Invite to household</DialogTitle>
          <DialogDescription>
            Scan the QR code or copy the single-use link. Opens the Sous Kit app when installed,
            otherwise this web app.
          </DialogDescription>
        </DialogHeader>

        <div class="flex justify-center rounded-xl bg-white p-4">
          <div
            v-if="creatingInvite || !inviteQrDataUrl"
            class="flex h-[240px] w-[240px] items-center justify-center text-sm text-muted-foreground"
          >
            {{ creatingInvite ? "Creating…" : "Loading QR…" }}
          </div>
          <img
            v-else
            :src="inviteQrDataUrl"
            alt="Household invite QR code"
            class="h-[240px] w-[240px]"
          />
        </div>

        <p
          v-if="inviteUrl"
          class="break-all text-center text-xs text-muted-foreground"
          :title="inviteUrl"
        >
          {{ inviteUrl }}
        </p>

        <DialogFooter class="gap-2 sm:justify-stretch">
          <Button class="w-full" :disabled="!inviteUrl" @click="copyInviteLink">Copy link</Button>
          <Button variant="outline" class="w-full" @click="inviteDialogOpen = false">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

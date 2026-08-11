import { InviteLinkDialog } from "@/components/InviteLinkDialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import {
  useHousehold,
  useHouseholdMutations,
  usePendingHouseholdInvites
} from "@/hooks/use-household";
import { colors } from "@/lib/colors";
import {
  extractInviteToken,
  inviteLabel,
  resolveInviteUrl
} from "@/lib/household-invite";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";
import type { HouseholdInvite } from "@/types";
import { Users } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

export function HouseholdSection() {
  const user = useSessionStore((s) => s.user);
  const householdQuery = useHousehold();
  const pendingQuery = usePendingHouseholdInvites();
  const mutations = useHouseholdMutations();

  const household = householdQuery.data;
  const isOwner = household?.my_role === "owner";
  const shared = (household?.member_count ?? 0) > 1;

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<number | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [pasteValue, setPasteValue] = useState("");

  async function onInvite() {
    if (mutations.invite.isPending || creatingInvite) return;
    setCreatingInvite(true);
    setInviteDialogOpen(true);
    setInviteLink(null);
    try {
      const invite = await mutations.invite.mutateAsync();
      const url = resolveInviteUrl(invite);
      if (!url) throw new Error("Invite link missing from server response.");
      setInviteLink(url);
    } catch (error) {
      setInviteDialogOpen(false);
      toast.fromError(error, "Couldn’t create that invite.");
    } finally {
      setCreatingInvite(false);
    }
  }

  function showInvite(invite: HouseholdInvite) {
    const url = resolveInviteUrl(invite);
    if (!url) {
      toast.fromError(new Error("That invite has no link to share."));
      return;
    }
    setInviteLink(url);
    setInviteDialogOpen(true);
  }

  async function onRename() {
    const name = nameDraft.trim();
    if (!name || mutations.rename.isPending) return;
    try {
      await mutations.rename.mutateAsync(name);
      setEditingName(false);
      toast.success("Household renamed.");
    } catch (error) {
      toast.fromError(error, "Couldn’t rename household.");
    }
  }

  async function onLeave() {
    try {
      await mutations.leave.mutateAsync();
      setLeaveOpen(false);
      toast.success(
        shared ? "You left the household." : "You’re already in your own kitchen."
      );
    } catch (error) {
      toast.fromError(error, "Couldn’t leave the household.");
    }
  }

  async function onRemove(userId: number) {
    try {
      await mutations.removeMember.mutateAsync(userId);
      setRemoveTarget(null);
      toast.success("Member removed.");
    } catch (error) {
      toast.fromError(error, "Couldn’t remove that member.");
    }
  }

  async function onAccept(token: string) {
    try {
      await mutations.acceptInvite.mutateAsync(token);
      toast.success("Joined household. Recipes and plans are shared now.");
    } catch (error) {
      toast.fromError(error, "Couldn’t accept that invite.");
    }
  }

  if (householdQuery.isLoading) {
    return (
      <View className="mt-6 items-center rounded-xl border border-border bg-card p-6">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!household) {
    return (
      <View className="mt-6 rounded-xl border border-border bg-card p-4">
        <Text className="text-sm text-muted-foreground">Couldn’t load household.</Text>
      </View>
    );
  }

  return (
    <View className="mt-6 gap-3">
      {(pendingQuery.data?.length ?? 0) > 0 ? (
        <View className="gap-3 rounded-xl border border-primary/40 bg-card p-4">
          <Text className="font-sans-semibold text-sm text-primary">Household invites</Text>
          {pendingQuery.data!.map((invite) => (
            <View key={invite.id} className="gap-2">
              <Text className="text-sm">
                {invite.invited_by_name} invited you to {invite.household_name}
              </Text>
              <Button size="sm" onPress={() => void onAccept(invite.token)}>
                Join household
              </Button>
            </View>
          ))}
        </View>
      ) : null}

      <View className="rounded-xl border border-border bg-card p-4">
        <View className="flex-row items-center gap-2">
          <Users size={16} color={colors.mutedForeground} />
          <Text className="text-xs uppercase tracking-wide text-muted-foreground">
            Household
          </Text>
        </View>

        {!editingName ? (
          <View className="mt-2 flex-row items-center justify-between gap-2">
            <Text className="font-sans-semibold text-base">{household.name}</Text>
            {isOwner ? (
              <Pressable
                onPress={() => {
                  setNameDraft(household.name);
                  setEditingName(true);
                }}
                hitSlop={8}
              >
                <Text className="text-sm text-primary">Rename</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View className="mt-2 flex-row items-center gap-2">
            <Input
              value={nameDraft}
              onChangeText={setNameDraft}
              className="h-10 flex-1 rounded-lg bg-secondary"
            />
            <Button size="sm" onPress={() => void onRename()}>
              Save
            </Button>
            <Button size="sm" variant="outline" onPress={() => setEditingName(false)}>
              Cancel
            </Button>
          </View>
        )}

        <Text className="mt-1 text-xs text-muted-foreground">
          {household.member_count}/{household.max_members} people · shared recipes, planner,
          and grocery list
        </Text>

        <View className="mt-4 gap-3">
          {household.members.map((member) => (
            <View key={member.user_id} className="flex-row items-center justify-between gap-2">
              <View className="flex-1">
                <Text className="text-sm font-sans-semibold">
                  {member.display_name}
                  {member.user_id === user?.id ? " (you)" : ""}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {member.role}
                  {member.email ? ` · ${member.email}` : ""}
                </Text>
              </View>
              {isOwner && member.user_id !== user?.id ? (
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => setRemoveTarget(member.user_id)}
                >
                  Remove
                </Button>
              ) : null}
            </View>
          ))}
        </View>

        {isOwner ? (
          <View className="mt-5 gap-2 border-t border-border pt-4">
            <Text className="text-xs text-muted-foreground">
              Invite someone with a QR code or single-use link
            </Text>
            <Button
              disabled={mutations.invite.isPending || creatingInvite}
              onPress={() => void onInvite()}
            >
              {creatingInvite ? "Creating invite…" : "Invite"}
            </Button>

            {household.pending_invites.length > 0 ? (
              <View className="mt-2 gap-2">
                <Text className="text-xs text-muted-foreground">Pending invites</Text>
                {household.pending_invites.map((invite) => (
                  <View
                    key={invite.id}
                    className="flex-row items-center justify-between gap-2"
                  >
                    <Text className="flex-1 text-sm">{inviteLabel(invite)}</Text>
                    <Button size="sm" variant="outline" onPress={() => showInvite(invite)}>
                      Show QR
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() =>
                        void mutations.revokeInvite.mutateAsync(invite.id).catch((error) => {
                          toast.fromError(error, "Couldn’t revoke invite.");
                        })
                      }
                    >
                      Revoke
                    </Button>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View className="mt-5 gap-2 border-t border-border pt-4">
          <Text className="text-xs text-muted-foreground">Have an invite link?</Text>
          <View className="flex-row items-center gap-2">
            <Input
              value={pasteValue}
              onChangeText={setPasteValue}
              autoCapitalize="none"
              placeholder="Paste invite link"
              className="h-10 flex-1 rounded-lg bg-secondary"
            />
            <Button
              size="sm"
              disabled={mutations.acceptInvite.isPending || !pasteValue.trim()}
              onPress={() => {
                const token = extractInviteToken(pasteValue);
                if (!token) {
                  toast.fromError(new Error("That doesn’t look like an invite link."));
                  return;
                }
                void onAccept(token).then(() => setPasteValue(""));
              }}
            >
              Join
            </Button>
          </View>
        </View>

        {shared ? (
          <Button variant="outline" className="mt-5" onPress={() => setLeaveOpen(true)}>
            Leave household
          </Button>
        ) : null}
      </View>

      <InviteLinkDialog
        visible={inviteDialogOpen}
        inviteUrl={inviteLink}
        loading={creatingInvite && !inviteLink}
        onClose={() => setInviteDialogOpen(false)}
        onCopied={() => toast.success("Invite link copied.")}
        onError={(message) => toast.fromError(new Error(message))}
      />

      <ConfirmDialog
        visible={leaveOpen}
        onCancel={() => setLeaveOpen(false)}
        title="Leave household?"
        description="Shared recipes, plans, and the grocery list stay with the household. You’ll get a fresh empty kitchen."
        confirmLabel="Leave"
        destructive
        onConfirm={() => void onLeave()}
      />

      <ConfirmDialog
        visible={removeTarget != null}
        onCancel={() => setRemoveTarget(null)}
        title="Remove member?"
        description="They’ll lose access to this household’s shared data."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (removeTarget != null) void onRemove(removeTarget);
        }}
      />
    </View>
  );
}

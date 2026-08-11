import { updateUser } from "@/api/users";
import { AppLockToggle } from "@/components/AppLockToggle";
import { HouseholdSection } from "@/components/HouseholdSection";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { queryClient } from "@/lib/query-client";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Pencil, UserRound } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAwareScrollView } from "@/components/ui/keyboard";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="mt-1 text-sm">{value}</Text>
    </View>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useSessionStore((s) => s.user);
  const setUser = useSessionStore((s) => s.setUser);
  const clear = useSessionStore((s) => s.clear);

  const [editing, setEditing] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState(user?.display_name ?? "");
  const [saving, setSaving] = useState(false);

  const lastLogin = user?.last_login ? new Date(user.last_login).toLocaleString() : "Never";

  async function saveDisplayName() {
    if (!user || saving) return;
    const name = newDisplayName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const updated = await updateUser(user.id, { display_name: name });
      setUser({ ...user, ...updated });
      setEditing(false);
      toast.success("Display name updated.");
    } catch (error) {
      toast.fromError(error, "Couldn’t update your display name.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await clear();
    queryClient.clear();
    router.replace("/login");
  }

  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 24
      }}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
        <ScreenHeader title="My account" />

        <View className="px-4 pt-4">
          <View className="items-center">
            {user?.avatar_url ? (
              <Image
                source={{ uri: user.avatar_url }}
                style={{ width: 96, height: 96, borderRadius: 48 }}
                contentFit="cover"
                accessibilityLabel="Avatar"
              />
            ) : (
              <View className="h-24 w-24 items-center justify-center rounded-full border-2 border-border bg-card">
                <UserRound size={44} color={colors.mutedForeground} strokeWidth={1.5} />
              </View>
            )}
          </View>

          <View className="mt-6 gap-4 rounded-xl border border-border bg-card p-4">
            <View>
              <Text className="text-xs text-muted-foreground">Display name</Text>
              {!editing ? (
                <View className="mt-1 flex-row items-center gap-2">
                  <Text className="font-sans-semibold text-base">{user?.display_name}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Edit display name"
                    hitSlop={8}
                    onPress={() => {
                      setNewDisplayName(user?.display_name ?? "");
                      setEditing(true);
                    }}
                    className="h-7 w-7 items-center justify-center rounded-md active:opacity-70"
                  >
                    <Pencil size={14} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ) : (
                <View className="mt-2 flex-row items-center gap-2">
                  <Input
                    value={newDisplayName}
                    onChangeText={setNewDisplayName}
                    autoFocus
                    className="h-10 flex-1 rounded-lg bg-secondary"
                    onSubmitEditing={() => void saveDisplayName()}
                  />
                  <Button size="sm" disabled={saving} onPress={() => void saveDisplayName()}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" onPress={() => setEditing(false)}>
                    Cancel
                  </Button>
                </View>
              )}
            </View>

            <Field label="Username" value={user?.username ?? ""} />
            <Field label="Email" value={user?.email ?? ""} />
            <Field label="Last login" value={lastLogin} />
          </View>

          <HouseholdSection />

          <AppLockToggle />

          <Button variant="destructive" className="mt-6" onPress={() => void signOut()}>
            Sign out
          </Button>
        </View>
    </KeyboardAwareScrollView>
  );
}

import {
  deletePasskey,
  fetchPasskeyRegistrationOptions,
  listPasskeys,
  verifyPasskeyRegistration,
  type PasskeySummary
} from "@/api/passkeys";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { APP_NAME, SESSION_IDLE_DAYS } from "@/config";
import { colors } from "@/lib/colors";
import {
  PASSKEY_READY_KEY,
  createPasskey,
  isPasskeyCancel,
  passkeysSupported
} from "@/lib/passkeys";
import { secureStorage } from "@/lib/secure-storage";
import { toast } from "@/stores/toast";
import { ScanFace } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

/**
 * Account card for saving a passkey. The app never asks for it until the
 * session has been idle for SESSION_IDLE_DAYS.
 */
export function PasskeySection() {
  const [supported] = useState(passkeysSupported);
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const rows = await listPasskeys();
    setPasskeys(rows);
    if (rows.length === 0) await secureStorage.remove(PASSKEY_READY_KEY);
  };

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void listPasskeys()
      .then((rows) => {
        if (!cancelled) setPasskeys(rows);
      })
      .catch((error) => {
        if (!cancelled) toast.fromError(error, "Couldn’t load passkeys.");
      });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const addPasskey = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const options = await fetchPasskeyRegistrationOptions();
      const credential = await createPasskey(options);
      await verifyPasskeyRegistration(credential);
      await secureStorage.set(PASSKEY_READY_KEY, "1");
      await reload();
      toast.success("Passkey saved. Face ID can sign you in after you’re away.");
    } catch (error) {
      if (!isPasskeyCancel(error)) toast.fromError(error, "Couldn’t save that passkey.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await deletePasskey(id);
      await reload();
      toast.success("Passkey removed.");
    } catch (error) {
      toast.fromError(error, "Couldn’t remove that passkey.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-4 rounded-xl border border-border bg-card p-4">
      <Text className="text-xs text-muted-foreground">Passkey</Text>
      <View className="mt-2 flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-secondary">
          <ScanFace size={18} color={colors.green500} />
        </View>
        <View className="min-w-0 flex-1 gap-2">
          <Text className="font-sans-semibold text-sm">Face ID when you’ve been away</Text>
          <Text className="text-xs text-muted-foreground">
            {APP_NAME} stays signed in while you use it, and resets a {SESSION_IDLE_DAYS}-day
            timer every time you open it. It won’t ask you to sign in before then. After that, a
            passkey signs you back in with Face ID instead of a password.
          </Text>
          {supported ? (
            <>
              {passkeys?.map((row) => (
                <View key={row.id} className="flex-row items-center justify-between gap-2">
                  <Text className="text-xs text-muted-foreground">
                    Saved {new Date(row.created_on).toLocaleDateString()}
                  </Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onPress={() => void remove(row.id)}
                  >
                    Remove
                  </Button>
                </View>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                disabled={busy}
                onPress={() => void addPasskey()}
              >
                {busy ? "Waiting for Face ID…" : "Add passkey"}
              </Button>
            </>
          ) : (
            <Text className="text-xs text-muted-foreground">
              Add the passkey on your iPhone. Face ID sign-in is part of the iOS app.
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

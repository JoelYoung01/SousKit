import { Text } from "@/components/ui/text";
import { APP_NAME } from "@/config";
import {
  authenticateBiometric,
  getBiometricSupport,
  type BiometricSupport
} from "@/lib/biometrics";
import { colors } from "@/lib/colors";
import { useAppLockStore } from "@/stores/app-lock";
import { toast } from "@/stores/toast";
import { ScanFace } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";

/**
 * "Security" card with the Face ID / Touch ID app-lock preference.
 * Hidden entirely when the device has no enrolled biometrics (and on web).
 */
export function AppLockToggle() {
  const enabled = useAppLockStore((s) => s.enabled);
  const [support, setSupport] = useState<BiometricSupport | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getBiometricSupport().then((s) => {
      if (!cancelled) setSupport(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!support?.available) return null;
  const label = support.label;

  const onToggle = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (on) {
        // Confirm biometrics work before trusting them as the app lock.
        const ok = await authenticateBiometric(`Enable ${label} unlock`);
        if (!ok) {
          toast.error("Couldn’t verify it’s you.");
          return;
        }
        await useAppLockStore.getState().setEnabled(true);
        toast.success(`${label} unlock enabled.`);
      } else {
        await useAppLockStore.getState().setEnabled(false);
        toast.success(`${label} unlock disabled.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-4 rounded-xl border border-border bg-card p-4">
      <Text className="text-xs text-muted-foreground">Security</Text>
      <View className="mt-2 flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-secondary">
          <ScanFace size={18} color={colors.green500} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-sans-semibold text-sm">{label} unlock</Text>
          <Text className="mt-0.5 text-xs text-muted-foreground">
            Require {label} after an hour away from {APP_NAME}
          </Text>
        </View>
        <Switch
          value={enabled}
          disabled={busy}
          onValueChange={(v) => void onToggle(v)}
          trackColor={{ false: colors.secondary, true: colors.primary }}
          thumbColor={colors.foreground}
          ios_backgroundColor={colors.secondary}
          accessibilityLabel={`${label} unlock`}
        />
      </View>
    </View>
  );
}

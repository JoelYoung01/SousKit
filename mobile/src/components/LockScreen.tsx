import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { APP_NAME } from "@/config";
import { authenticateBiometric, getBiometricSupport } from "@/lib/biometrics";
import { colors } from "@/lib/colors";
import { queryClient } from "@/lib/query-client";
import { useAppLockStore } from "@/stores/app-lock";
import { useSessionStore } from "@/stores/session";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { ScanFace } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Full-screen biometric gate shown over the app while it is locked.
 * Auto-prompts Face ID / Touch ID on mount; offers sign-out as an escape
 * hatch (e.g. biometrics no longer enrolled).
 */
export function LockScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState<string>("Face ID");
  const [prompting, setPrompting] = useState(false);
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);

  const tryUnlock = async () => {
    if (prompting) return;
    setPrompting(true);
    setFailed(false);
    try {
      const ok = await authenticateBiometric(`Unlock ${APP_NAME}`);
      if (ok) useAppLockStore.getState().unlock();
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPrompting(false);
    }
  };

  useEffect(() => {
    void getBiometricSupport().then((s) => setLabel(s.label));
    if (!attempted.current) {
      attempted.current = true;
      void tryUnlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    useAppLockStore.getState().unlock();
    await useSessionStore.getState().clear();
    queryClient.clear();
    router.replace("/login");
  };

  return (
    <View
      style={[StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      className="items-center justify-center bg-background px-6"
    >
      <View className="flex-1 items-center justify-center gap-8">
        <View className="items-center gap-3">
          <Image
            source={require("@/assets/images/souskit-mark.png")}
            style={{ width: 72, height: 72 }}
            contentFit="contain"
          />
          <Text className="font-sans-bold text-2xl tracking-tight">{APP_NAME}</Text>
          <Text className="text-sm text-muted-foreground">Locked</Text>
        </View>

        <View className="items-center gap-3">
          {failed ? (
            <Text className="text-center text-sm text-muted-foreground">
              Couldn’t verify it’s you. Try again.
            </Text>
          ) : null}
          <Button className="h-11 px-6" disabled={prompting} onPress={() => void tryUnlock()}>
            <ScanFace size={18} color={colors.foreground} />
            {prompting ? "Unlocking…" : `Unlock with ${label}`}
          </Button>
        </View>
      </View>

      <Button variant="ghost" className="mb-2" onPress={() => void signOut()}>
        Sign out
      </Button>
    </View>
  );
}

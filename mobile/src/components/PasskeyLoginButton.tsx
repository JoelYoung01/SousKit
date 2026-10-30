import {
  fetchPasskeyLoginOptions,
  verifyPasskeyLogin
} from "@/api/passkeys";
import { getErrorMessage } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { colors } from "@/lib/colors";
import {
  PASSKEY_READY_KEY,
  getPasskey,
  isPasskeyCancel,
  passkeysSupported
} from "@/lib/passkeys";
import { secureStorage } from "@/lib/secure-storage";
import { useSessionStore } from "@/stores/session";
import { ScanFace } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";

interface PasskeyLoginButtonProps {
  /** When a previous session expired, offer Face ID once without a tap. */
  autoPrompt?: boolean;
  onPendingChange: (pending: boolean) => void;
  onError: (message: string) => void;
}

/**
 * Discoverable passkey sign-in. The system sheet is Face ID / Touch ID.
 * Shown only on iOS devices that can create passkeys.
 */
export function PasskeyLoginButton({
  autoPrompt = false,
  onPendingChange,
  onError
}: PasskeyLoginButtonProps) {
  const [supported] = useState(passkeysSupported);
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    onPendingChange(true);
    try {
      const options = await fetchPasskeyLoginOptions();
      const credential = await getPasskey(options);
      const session = await verifyPasskeyLogin(credential);
      await secureStorage.set(PASSKEY_READY_KEY, "1");
      await useSessionStore.getState().setSession(session.access_token, session.user);
    } catch (error) {
      onPendingChange(false);
      if (!isPasskeyCancel(error)) {
        onError(getErrorMessage(error, "Passkey sign-in failed"));
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!supported || !autoPrompt || attempted.current) return;
    let cancelled = false;
    void (async () => {
      const ready = await secureStorage.get(PASSKEY_READY_KEY);
      if (cancelled || ready !== "1" || attempted.current) return;
      attempted.current = true;
      await signIn();
    })();
    return () => {
      cancelled = true;
    };
    // signIn is stable enough for a one-shot prompt; busy is guarded inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt, supported]);

  if (!supported) return null;

  return (
    <Button
      variant="outline"
      className="h-11 w-full"
      disabled={busy}
      onPress={() => void signIn()}
    >
      <ScanFace size={18} color={colors.foreground} />
      {busy ? "Waiting for Face ID…" : "Sign in with Face ID"}
    </Button>
  );
}

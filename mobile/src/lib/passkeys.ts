import { Platform } from "react-native";
import { create, get, isSupported } from "react-native-passkeys";

/** Set after this device saves a passkey, so an expired session can offer Face ID. */
export const PASSKEY_READY_KEY = "souskit.passkey_ready";

export class PasskeyCancelled extends Error {
  constructor() {
    super("Passkey cancelled");
    this.name = "PasskeyCancelled";
  }
}

/** iOS platform passkeys. Hidden on web and on devices that can't use them. */
export function passkeysSupported(): boolean {
  if (Platform.OS !== "ios") return false;
  try {
    return isSupported();
  } catch {
    return false;
  }
}

export function isPasskeyCancel(error: unknown): boolean {
  if (error instanceof PasskeyCancelled) return true;
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; name?: unknown; message?: unknown };
  const text = `${String(record.code ?? "")} ${String(record.name ?? "")} ${String(record.message ?? "")}`;
  return /cancel/i.test(text);
}

type CreationOptions = Parameters<typeof create>[0];
type RequestOptions = Parameters<typeof get>[0];

export async function createPasskey(options: Record<string, unknown>) {
  const credential = await create(options as CreationOptions);
  if (!credential) throw new PasskeyCancelled();
  return credential;
}

export async function getPasskey(options: Record<string, unknown>) {
  const credential = await get(options as RequestOptions);
  if (!credential) throw new PasskeyCancelled();
  return credential;
}

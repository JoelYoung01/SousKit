import type { TokenPayload } from "@/api/auth";
import { del, get, post } from "@/api/client";

export type PasskeySummary = {
  id: number;
  created_on: string;
  last_used_on?: string | null;
};

export function fetchPasskeyRegistrationOptions(): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>("/auth/passkeys/register/options/");
}

export function verifyPasskeyRegistration(credential: object): Promise<PasskeySummary> {
  return post<PasskeySummary>("/auth/passkeys/register/verify/", credential);
}

export function listPasskeys(): Promise<PasskeySummary[]> {
  return get<PasskeySummary[]>("/auth/passkeys/");
}

export function deletePasskey(id: number): Promise<void> {
  return del(`/auth/passkeys/${id}/`);
}

export function fetchPasskeyLoginOptions(): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>("/auth/passkeys/login/options/");
}

export function verifyPasskeyLogin(credential: object): Promise<TokenPayload> {
  return post<TokenPayload>("/auth/passkeys/login/verify/", credential);
}

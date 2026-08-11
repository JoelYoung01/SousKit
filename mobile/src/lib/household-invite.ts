import { API_ORIGIN } from "@/config";

/**
 * Helpers for household join links (QR / copy URL / deep link parsing).
 */

/** HTTPS join URL for a token (same shape Universal Links use). */
export function buildInviteUrl(token: string): string {
  return `${API_ORIGIN}/join/${encodeURIComponent(token)}`;
}

/** Pull an invite token from a paste of a join URL or a raw token. */
export function extractInviteToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const fromPath = (pathname: string): string | null => {
    const match = pathname.match(/\/join\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  try {
    if (trimmed.includes("://")) {
      const url = new URL(trimmed);
      // souskit://join/TOKEN → host "join", path "/TOKEN"
      if (url.protocol === "souskit:" && url.hostname === "join") {
        const token = url.pathname.replace(/^\/+/, "");
        if (token) return decodeURIComponent(token);
      }
      const fromPathname = fromPath(url.pathname);
      if (fromPathname) return fromPathname;
      const q = url.searchParams.get("token");
      if (q) return q;
    } else if (trimmed.startsWith("/join/") || trimmed.startsWith("join/")) {
      const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      const fromPathname = fromPath(path.split("?")[0] ?? path);
      if (fromPathname) return fromPathname;
    }
  } catch {
    // fall through to raw-token check
  }

  if (/^[A-Za-z0-9_-]{8,128}$/.test(trimmed)) return trimmed;
  return null;
}

export function resolveInviteUrl(invite: {
  invite_url?: string | null;
  token?: string | null;
}): string | null {
  if (invite.invite_url) return invite.invite_url;
  if (invite.token) return buildInviteUrl(invite.token);
  return null;
}

export function inviteLabel(invite: { email?: string | null; expires_on: string }): string {
  if (invite.email) return invite.email;
  const expires = new Date(invite.expires_on);
  if (Number.isNaN(expires.getTime())) return "Invite link";
  return `Link · expires ${expires.toLocaleDateString()}`;
}

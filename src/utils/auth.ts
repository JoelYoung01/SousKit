import type { UserResponse } from "@/types/User";

export const AuthLoginEvent = "auth:login";
export const AuthErrorEvent = "auth:error";
/** Fired when an auth exchange starts (e.g. Google credential → API). */
export const AuthPendingEvent = "auth:pending";

export type AuthRedirectPayload = {
  code: string;
  message: string;
  redirect_to: string;
  email?: string | null;
  dev_otp?: string | null;
};

export type TokenPayload = {
  access_token: string;
  user: UserResponse;
};

export class AuthApiError extends Error {
  status: number;
  detail: unknown;
  redirectTo?: string;
  email?: string;
  devOtp?: string | null;

  constructor(
    message: string,
    options: {
      status: number;
      detail?: unknown;
      redirectTo?: string;
      email?: string;
      devOtp?: string | null;
    }
  ) {
    super(message);
    this.name = "AuthApiError";
    this.status = options.status;
    this.detail = options.detail;
    this.redirectTo = options.redirectTo;
    this.email = options.email;
    this.devOtp = options.devOtp;
  }
}

function parseDetail(
  detail: unknown,
  body?: Record<string, unknown> | null
): {
  message: string;
  redirectTo?: string;
  email?: string;
  code?: string;
  devOtp?: string | null;
} {
  const topMessage =
    typeof body?.user_message === "string" && body.user_message.trim()
      ? body.user_message.trim()
      : null;

  if (typeof detail === "string") {
    return { message: topMessage || detail };
  }
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    const nestedMessage =
      (typeof d.user_message === "string" && d.user_message) ||
      (typeof d.message === "string" && d.message) ||
      null;
    return {
      message: topMessage || nestedMessage || "Request failed",
      redirectTo: typeof d.redirect_to === "string" ? d.redirect_to : undefined,
      email: typeof d.email === "string" ? d.email : undefined,
      code:
        (typeof body?.code === "string" && body.code) ||
        (typeof d.code === "string" ? d.code : undefined),
      devOtp: typeof d.dev_otp === "string" ? d.dev_otp : null
    };
  }
  return { message: topMessage || "Request failed" };
}

async function readAuthResponse(response: Response) {
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  return data as Record<string, unknown> | null;
}

/**
 * Verify a stored session. The server resets the 30-day idle window and
 * returns a new token — callers must persist `access_token`.
 * `null` means the session was rejected. `undefined` means a transient failure.
 */
export async function checkSessionToken(
  access_token: string
): Promise<TokenPayload | null | undefined> {
  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/verify-session/`, {
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error("Recieved Non-200 response code while verifying session");
    return (await response.json()) as TokenPayload;
  } catch (er) {
    console.error(er);
    return undefined;
  }
}

function dispatchLogin(access_token: string, user: unknown) {
  window.dispatchEvent(new CustomEvent(AuthLoginEvent, { detail: { access_token, user } }));
}

export async function loginWithGoogle(payload: { credential: string }) {
  window.dispatchEvent(new CustomEvent(AuthPendingEvent, { detail: { provider: "google" } }));
  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login-google/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await readAuthResponse(response);
    if (!response.ok) {
      const parsed = parseDetail(data?.detail ?? data, data);
      const message = parsed.message || "Google sign-in failed";
      const error = new AuthApiError(message, {
        status: response.status,
        detail: data?.detail
      });
      window.dispatchEvent(new CustomEvent(AuthErrorEvent, { detail: { message: error.message } }));
      throw error;
    }

    const token = data as unknown as TokenPayload;
    dispatchLogin(token.access_token, token.user);
    return token;
  } catch (er) {
    // Ensure the login UI can leave the pending state for network/parse failures
    // that never produced AuthErrorEvent.
    if (!(er instanceof AuthApiError)) {
      const message = er instanceof Error ? er.message : "Google sign-in failed";
      window.dispatchEvent(new CustomEvent(AuthErrorEvent, { detail: { message } }));
    }
    throw er;
  }
}

export async function registerWithPassword(payload: {
  email: string;
  password: string;
  display_name: string;
}): Promise<AuthRedirectPayload> {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/register/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await readAuthResponse(response);
  if (!response.ok) {
    const parsed = parseDetail(data?.detail ?? data, data);
    throw new AuthApiError(parsed.message, { status: response.status, detail: data?.detail });
  }
  return data as unknown as AuthRedirectPayload;
}

export async function loginWithPassword(payload: {
  email: string;
  password: string;
}): Promise<TokenPayload> {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await readAuthResponse(response);

  if (response.status === 403) {
    const parsed = parseDetail(data?.detail, data);
    const locationHeader = response.headers.get("Location") || undefined;
    throw new AuthApiError(parsed.message || "Email not verified", {
      status: 403,
      detail: data?.detail,
      redirectTo: parsed.redirectTo || locationHeader,
      email: parsed.email,
      devOtp: parsed.devOtp
    });
  }

  if (!response.ok) {
    const parsed = parseDetail(data?.detail ?? data, data);
    throw new AuthApiError(parsed.message || "Login failed", {
      status: response.status,
      detail: data?.detail
    });
  }

  const token = data as unknown as TokenPayload;
  dispatchLogin(token.access_token, token.user);
  return token;
}

export async function verifyEmailOtp(payload: {
  email: string;
  otp: string;
}): Promise<TokenPayload> {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/verify-email/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await readAuthResponse(response);
  if (!response.ok) {
    const parsed = parseDetail(data?.detail ?? data, data);
    throw new AuthApiError(parsed.message || "Verification failed", {
      status: response.status,
      detail: data?.detail
    });
  }
  const token = data as unknown as TokenPayload;
  dispatchLogin(token.access_token, token.user);
  return token;
}

export async function resendVerificationEmail(email: string): Promise<AuthRedirectPayload> {
  const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/resend-verification/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email })
  });
  const data = await readAuthResponse(response);
  if (!response.ok) {
    const parsed = parseDetail(data?.detail ?? data, data);
    throw new AuthApiError(parsed.message || "Could not resend code", {
      status: response.status,
      detail: data?.detail
    });
  }
  return data as unknown as AuthRedirectPayload;
}

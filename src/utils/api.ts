import { TOKEN_STORAGE_KEY } from "@/stores/session";
import { parseApiErrorBody } from "./errors";

function networkErrorMessage(error: unknown, context?: string): string {
  const base = context
    ? `Couldn’t ${context} — the request never reached the server.`
    : "Couldn’t reach the server.";
  const reason =
    error instanceof TypeError
      ? error.message
      : error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : null;
  if (reason && !/network request failed|failed to fetch/i.test(reason)) {
    return `${base} (${reason})`;
  }
  return `${base} Check your connection and try again.`;
}

export class ApiError extends Error {
  public status: number;
  public ok: boolean;
  public userMessage: string;
  public detail: unknown;
  public code?: string;

  constructor(
    message: string,
    response: Response,
    options?: { userMessage?: string; detail?: unknown; code?: string }
  ) {
    super(message || response.statusText);
    this.name = "ApiError";
    this.status = response.status;
    this.ok = response.ok;
    this.userMessage = options?.userMessage || message || response.statusText;
    this.detail = options?.detail;
    this.code = options?.code;
  }
}

async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function doFetch(url: string, options?: RequestInit, meta?: { action?: string }) {
  const access_token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const headers: HeadersInit = {};
  if (access_token) {
    headers.Authorization = `Bearer ${access_token}`;
  }

  if (!url.includes("http")) {
    url = `${import.meta.env.VITE_API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  const builtOptions = {
    ...options,
    headers: {
      ...options?.headers,
      ...headers
    }
  };

  let response: Response;
  try {
    response = await fetch(url, builtOptions);
  } catch (er) {
    const networkMessage = networkErrorMessage(er, meta?.action);
    throw new ApiError(networkMessage, new Response(null, { status: 503 }), {
      userMessage: networkMessage
    });
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    const parsed = parseApiErrorBody(body);
    throw new ApiError(parsed.userMessage, response, {
      userMessage: parsed.userMessage,
      detail: parsed.detail,
      code: parsed.code
    });
  }

  if (response.status === 204) return;

  return await response.json();
}

export async function get<T = any>(url: string): Promise<T> {
  return doFetch(url, undefined, { action: "load that data" });
}

export async function post<T = any>(
  url: string,
  body?: object,
  headers?: Record<string, string>
): Promise<T> {
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  };

  return doFetch(url, options, { action: "save that" });
}

export async function put<T = any>(
  url: string,
  body?: object,
  headers?: Record<string, string>
): Promise<T> {
  const options = {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  };

  return doFetch(url, options, { action: "save that" });
}

export async function patch<T = any>(
  url: string,
  body?: object,
  headers?: Record<string, string>
): Promise<T> {
  const options = {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  };

  return doFetch(url, options, { action: "update that" });
}

export async function del(url: string): Promise<any> {
  const options = {
    method: "DELETE"
  };
  return doFetch(url, options, { action: "delete that" });
}

export async function postFile<T = any>(url: string, file: FormData): Promise<T> {
  const options = {
    method: "POST",
    body: file
  };

  return doFetch(url, options, { action: "upload that photo" });
}

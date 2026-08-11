/**
 * Runtime configuration.
 *
 * `EXPO_PUBLIC_*` variables are inlined into the JS bundle at build time
 * (set them in `mobile/.env` for local dev or in CI for release builds).
 */

const envApiUrl = process.env.EXPO_PUBLIC_API_URL;

/**
 * Base URL of the Sous Kit API, e.g. https://sous-kit.com/api.
 * A native app needs an absolute URL, so ignore empty or relative values
 * (CI passes unset GitHub vars through as empty strings, and the web app's
 * API_URL var is the relative `/api`).
 */
export const API_URL: string =
  envApiUrl && /^https?:\/\//.test(envApiUrl)
    ? envApiUrl
    : __DEV__
      ? "http://localhost:8000/api"
      : "https://sous-kit.com/api";

/** Origin the API is served from — used to resolve relative upload URLs. */
export const API_ORIGIN: string = API_URL.replace(/\/api\/?$/, "");

/**
 * Google OAuth client IDs for native sign-in (optional).
 * When empty, the Google button is hidden and email/password still works.
 */
export const GOOGLE_IOS_CLIENT_ID: string = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
export const GOOGLE_WEB_CLIENT_ID: string = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

export const APP_NAME = "Sous Kit";

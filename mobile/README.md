# Sous Kit iOS app

Native iOS app for Sous Kit, built with [Expo](https://expo.dev) / React Native. It mirrors the web UI feature-for-feature — same dark zinc + green design system, same API — with native navigation, gestures, haptics, and secure keychain sessions.

## Stack

| Concern | Choice |
|---|---|
| Framework | React Native 0.86 + Expo SDK 57 (TypeScript) |
| Navigation | `expo-router` (file-system routes, typed) |
| Styling | NativeWind 4 (Tailwind CSS classes, shadcn-style components in `src/components/ui/`) |
| Server state | `@tanstack/react-query` |
| Local state | `zustand` (session, toasts, app lock) |
| Auth storage | `expo-secure-store` (iOS Keychain) |
| Sign-in | Email/password, Sign in with Apple (`expo-apple-authentication`), Google (`expo-auth-session`) |
| App lock | Face ID / Touch ID via `expo-local-authentication` |
| Fonts / icons | Figtree (`@expo-google-fonts`) / `lucide-react-native` |
| Tests | Jest (`jest-expo`) + React Native Testing Library |

The native `ios/` project is **generated, never committed** (Expo [Continuous Native Generation](https://docs.expo.dev/workflow/continuous-native-generation/)): `pnpm exec expo prebuild -p ios` recreates it from `app.config.ts` at any time.

## Development

All commands run from `mobile/`.

```bash
pnpm install

# iterate on Linux/Windows/macOS — web preview at http://localhost:8081
pnpm web

# on a Mac with Xcode — build & run the iOS simulator
pnpm ios

# on your iPhone without a Mac — install the Expo Go app, then
pnpm start   # scan the QR code from Expo Go
```

The app talks to the FastAPI backend. For local development start it from the repo root (see the root README), and the app's default `http://localhost:8000/api` will reach it. Point a device/simulator elsewhere with an env var:

```bash
EXPO_PUBLIC_API_URL="https://sous-kit.example.dev/api" pnpm web
```

### Quality gates

```bash
pnpm lint        # eslint (expo config)
pnpm typecheck   # tsc --noEmit
pnpm test        # jest unit + component tests
```

CI runs all three plus `expo prebuild` / `expo export` sanity checks on every PR that touches `mobile/` (`.github/workflows/MobileCI.yaml`).

## Configuration

`EXPO_PUBLIC_*` vars are inlined into the JS bundle at build time (see `src/config.ts`):

| Variable | Purpose | Default |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | API base URL (must be absolute; empty/relative values are ignored) | `http://localhost:8000/api` in dev, production URL in release |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | iOS OAuth client for native Google sign-in | empty → Google button hidden |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Web OAuth client (used by the web preview) | empty |

Native project settings (bundle id, build number) come from env vars read in `app.config.ts`: `SOUSKIT_IOS_BUNDLE_ID`, `SOUSKIT_IOS_BUILD_NUMBER`. Default bundle id is `com.joelyoung.souskit`.

## Releasing to your phone (TestFlight)

`.github/workflows/MobileRelease.yaml` builds, signs, and uploads the app to TestFlight on every push to `main` that touches `mobile/`. Signing uses Xcode **cloud-managed signing** with an App Store Connect API key — no certificates or provisioning profiles to export and rotate by hand, and no registered devices needed (the archive is unsigned; distribution signing happens at export).

Until the secrets below exist, the workflow skips the signed build with a warning (it stays green).

### One-time Apple setup

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year) with your Apple ID.
2. In [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api), create a **Team key** with the **Admin** role. Note the **Key ID** and **Issuer ID**, and download the `.p8` file (only downloadable once). Admin is required: Xcode's cloud signing can only create the distribution certificate/profile with an Admin (or Account Holder) key — App Manager keys fail at export with "Cloud signing permission error", and a key's role cannot be changed after creation.
3. In [App Store Connect → Apps](https://appstoreconnect.apple.com/apps), click **+ → New App**: platform iOS, name **Sous Kit** / **SousKit**, bundle ID `com.joelyoung.souskit` (register it on the same page if prompted; must match `SOUSKIT_IOS_BUNDLE_ID` if you override it), SKU anything (e.g. `sous-kit`).
4. Find your **Team ID** in [Apple Developer → Membership](https://developer.apple.com/account#MembershipDetailsCard) (10-character string).

### GitHub repository secrets

| Secret | Value |
|---|---|
| `APPLE_TEAM_ID` | 10-char Team ID |
| `ASC_KEY_ID` | API key's Key ID |
| `ASC_ISSUER_ID` | API key's Issuer ID |
| `ASC_PRIVATE_KEY` | Full contents of the `.p8` file (multiline is fine) |
| `GOOGLE_IOS_CLIENT_ID` | Optional — iOS OAuth client id for Google sign-in |

Also uses `secrets.GOOGLE_CLIENT_ID` (existing web OAuth client). Optional GitHub **variables**: `MOBILE_API_URL` (absolute API base override — do NOT reuse the web app's relative `API_URL`) and `SOUSKIT_IOS_BUNDLE_ID` (bundle id override; defaults to `com.joelyoung.souskit`).

### Installing on your phone

1. Install **TestFlight** from the App Store and sign in with the same Apple ID.
2. After the first successful workflow run, the build appears in App Store Connect → TestFlight (a few minutes of processing). Add yourself as an internal tester on the same page.
3. Open TestFlight on the phone → install Sous Kit. Subsequent merges to `main` push new builds automatically and TestFlight notifies you.

Each run also attaches the raw `.ipa` as a workflow artifact for ad-hoc installs.

### Sign in with Apple

The login screen shows Apple's native sign-in button on iOS devices. Two requirements:

1. The App ID (bundle ID) must have the **Sign in with Apple** capability enabled: [Apple Developer → Identifiers](https://developer.apple.com/account/resources/identifiers/list) → select the bundle ID → check *Sign In with Apple* → Save. (If CI created the App ID automatically, edit it there.) The entitlement itself is added by `expo prebuild` via the `expo-apple-authentication` plugin.
2. The server verifies identity tokens against the app's bundle ID — set `APPLE_APP_BUNDLE_ID` in the server `.env` only if you override the default `com.joelyoung.souskit`.

No extra secret is needed: verification uses Apple's public keys.

### Universal Links (household invites)

Invite QR codes and copy-link buttons share an HTTPS URL (`https://<host>/join/<token>`). When the app is installed, iOS should open Sous Kit; otherwise the web join page accepts the invite.

1. Enable **Associated Domains** on the App ID: [Apple Developer → Identifiers](https://developer.apple.com/account/resources/identifiers/list) → select the bundle ID → check *Associated Domains* → Save. `expo prebuild` adds the `applinks:` entitlement from `associatedDomains` in `app.config.ts`.
2. Set server `APPLE_TEAM_ID` (same 10-char Team ID as the GitHub secret) so the API serves `/.well-known/apple-app-site-association`.
3. Set server `FRONTEND_HOST` to the public web origin (e.g. `https://sous-kit.com`) so invite URLs use the correct host.
4. Optional CI/build override: `SOUSKIT_ASSOCIATED_DOMAIN` (host only, no scheme) if it differs from the default `sous-kit.com`.

Custom-scheme links (`souskit://join/<token>`) also route to the same screen for local testing.

### Face ID unlock

Account → Security → **Face ID unlock** gates the app behind Face ID / Touch ID (`expo-local-authentication`): prompts after the app has been away for an hour (cold start or return from background), with device-passcode fallback and a sign-out escape hatch. Returning within the hour resets the timer. The preference is stored in the Keychain; the row is hidden on devices without enrolled biometrics (and on web).

### Google sign-in on iOS (optional)

Password login works out of the box. For the Google button:

1. In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type **iOS** with bundle ID `com.joelyoung.souskit`.
2. Set the client id as the `GOOGLE_IOS_CLIENT_ID` GitHub secret (baked into the app) **and** in the server's `.env` (`GOOGLE_IOS_CLIENT_ID=...`) so the API accepts tokens minted for the iOS client.

## Project layout

```
mobile/
  app.config.ts          Expo config (name, bundle id, plugins)
  src/
    app/                 expo-router screens (auth + tabs)
    components/          UI + feature components
    api/                 API client wrappers
    stores/              zustand stores
    lib/                 colors, query client, biometrics, …
    types/               shared API types (mirror web `src/types/`)
  assets/images/         icon, splash, souskit-mark
```

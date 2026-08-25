# Cursor Cloud agent guide

Detailed setup, run, and testing notes for Cursor Cloud agents working in this repo. `AGENTS.md` links here so that this context is only loaded when needed.

This is a single repo containing the backend plus two clients:

- Backend: FastAPI app in `api/` (entry `api/main.py`), SQLite database (no external DB needed), migrations via Alembic. Python deps are managed with `uv` (`pyproject.toml` + `uv.lock`); `uv sync` creates a `.venv` in the repo root. Run backend commands with `uv run ...` (no manual venv activation needed).
- iOS app (primary product): Expo / React Native app in `mobile/` with its own pnpm workspace (`cd mobile && pnpm install`). See "iOS app" below and `mobile/README.md`.
- Web frontend: Vue 3 + Vite + Tailwind CSS + shadcn-vue SPA in `src/` (dev server on port 5173). See `DESIGN.md` and `SITE_MAP.md` for UI/routing.

Standard commands live in `README.md`, `package.json`, and `pyproject.toml`. Below are only the non-obvious caveats.

## Environment variables (`.env`)

- A `.env` file at the repo root is required for BOTH services and is gitignored, so it is not in version control. It persists in the VM snapshot; recreate it only if missing. Required keys (dev values are fine locally): `VITE_APP_TITLE`, `VITE_API_URL=http://localhost:8000/api`, `VITE_GOOGLE_CLIENT_ID` (any non-empty placeholder), `ENVIRONMENT=development`, `SECRET_KEY`, `SUPERUSER_GID`.
- Non-obvious: Vite's `validateVars` plugin (in `vite.config.ts`) reads `process.env`, NOT the `.env` file. You MUST export the vars into the shell before running `pnpm dev`/`pnpm build`, e.g. `set -a && . ./.env && set +a && pnpm dev`. Running `pnpm dev` without exporting fails with "Required environment variables are missing".
- Non-obvious: the FastAPI settings (`api/core/config.py`) point `env_file` at `../.env` (outside the repo when run from the root), so the backend effectively relies on process env vars. Export `.env` the same way before running the backend: `set -a && . ./.env && set +a && uv run fastapi dev api/main.py`.

## Database setup (not part of the dependency update script)

- The SQLite DB lives at `data/database.db`. Create dirs and seed once: `mkdir -p data/uploads data/logs && set -a && . ./.env && set +a && uv run alembic upgrade head && uv run python -m api.scripts.load_data`. The seed creates verified admin + test password users and 10 sample recipes. Seeding is state setup, so it is intentionally NOT in the startup update script.
- In production, Alembic runs as part of deploy via the Docker entrypoint (`scripts/docker-entrypoint.sh`): `alembic upgrade head` before uvicorn starts. That updates the persistent `data/` volume when a new image is rolled out. Local `fastapi dev` does **not** auto-migrate — run `uv run alembic upgrade head` yourself when the schema changes.
- Admins can also apply pending migrations via `POST /api/admin/migrations/upgrade/` (Bearer token for an `admin` user). Useful if the volume was behind after a deploy that did not restart the container, or for one-off recovery.

## Running the services

- Backend: `set -a && . ./.env && set +a && uv run fastapi dev api/main.py --host 0.0.0.0 --port 8000` (docs at `/api/docs`).
- Frontend: `set -a && . ./.env && set +a && pnpm dev --host 0.0.0.0 --port 5173`.

## Authentication

Password auth and Google OAuth are both supported.

### Password flow

- `POST /api/auth/register/` — create email/password user (unverified); response includes `redirect_to` (`/verify-email?email=...`) and sets `Location`. In `ENVIRONMENT=development`, response also includes `dev_otp`.
- `POST /api/auth/verify-email/` — confirm OTP, then mint session JWT.
- `POST /api/auth/resend-verification/` — resend OTP (rate-limited; generic response).
- `POST /api/auth/login/` — email/password. If the account exists but is unverified, the API returns **403** with `detail.redirect_to` / `Location: /verify-email?email=...` so the SPA must follow the server-directed page (and may refresh the OTP).
- `POST /api/auth/login-google/` — unchanged Google ID token exchange; Google users are treated as email-verified (and can link to an existing password account with the same email).
- `POST /api/auth/login-apple/` — Sign in with Apple identity-token exchange (`identity_token`, optional `full_name`). Verified against Apple's JWKS with `APPLE_APP_BUNDLE_ID` as the audience; same create-or-link-by-email behavior as Google. Native iOS only — the button never renders in the Expo web preview, so it cannot be manually tested in this VM (unit tests + curl error paths only).

OTP codes are HMAC-hashed at rest, expire after `EMAIL_OTP_EXPIRE_MINUTES` (default 15), and attempt-limited. Without SMTP env vars the backend logs the OTP; configure `SMTP_*` + `EMAILS_FROM_EMAIL` to send real mail.

### Seeded local users

`uv run python -m api.scripts.load_data` creates two verified password users (overridable via env):

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@example.com` | `adminpass123` |
| Test | `test@example.com` | `testpass123` |

The admin seed also receives `SUPERUSER_GID` when set.

### Local login

- Seeded password users (above) sign in through the normal email/password form on `/login` — there is no dedicated bypass button or `/auth/dev-login/` shortcut.
- Ensure the DB is seeded first so those users exist.
- Google One Tap / FedCM is not auto-prompted on load; users sign in via the Google button on the login page.

## Meal-plan wizard LLM

- Routes under `/api/meal-plan-wizard/`. Pipeline stages: create session → ideate (SSE) → select → build (SSE) → commit.
- Without `OPENROUTER_API_KEY`, the backend uses a deterministic stub LLM (`api/core/llm/client.py`). Set the key to call OpenRouter (`api/core/llm/client.py` → `OpenRouterLlmClient`). Optional `OPENROUTER_MODEL` defaults to `inception/mercury-2`. Tool helpers for user-scoped recipe search live in `api/core/llm/tools.py`.

## Recipe semantic search

- `GET /api/recipe/search/?searchText=...` runs hybrid lexical (ILIKE) + embedding cosine ranking over recipes the user can access (`api/core/recipe_search.py`).
- Embeddings are stored on `Recipe.embedding_json` / `embedding_model` and refreshed on create/update/import/AI-edit/ingredient changes (and lazily backfilled during search).
- With `OPENROUTER_API_KEY`, vectors come from OpenRouter (`OPENROUTER_EMBEDDING_MODEL`, default `openai/text-embedding-3-small`, `OPENROUTER_EMBEDDING_DIMENSIONS=384`). Without a key, a deterministic local hashing embedder keeps the hybrid path working in dev.

## Recipe import from URL

- `POST /api/recipe/import-from-url/` with `{ "url": "https://..." }` (auth required). Fetches the page (SSRF-safe), extracts via `recipe-scrapers` / schema.org first, then falls back to OpenRouter when structured markup is missing and `OPENROUTER_API_KEY` is set. Creates a private recipe + ingredients (optional cover via `IMAGE_GEN_PROVIDER`) and returns `RecipeDetail`.
- Social / short-video hosts (Instagram, TikTok, YouTube Shorts, Facebook, etc.) are rejected with a clear 422 — out of scope for v1.
- UI: web `RecipeImportView` and mobile `recipes/import` — on success navigate to the recipe edit screen for review. Photo scan remains stubbed.
- Needs outbound HTTPS to the recipe site (and OpenRouter / Openverse when those providers are enabled).

## Recipe cover images (generated recipes)

- On wizard **commit**, newly created recipes get a cover via `api/core/image_gen/` (ABC + factory, same pattern as the LLM client).
- Recipe edit also has **Generate image** → `POST /api/recipe/generate-cover/` (body: name, optional description/ingredients, optional `limit` default 4, optional `exclude_keys`) which returns `{ provider, mode, options: [{ …Upload fields, skip_key }] }`. Search providers (`broke`) use `mode: "pick"` so the UI shows a chooser; the form binds the chosen option as `cover_image_id`. Dismissed options’ `skip_key` values are stored per-recipe in local storage and sent back as `exclude_keys` so Search again / Generate skips them.
- `IMAGE_GEN_PROVIDER` selects the adapter:
  - `broke` (default) — free Openverse search limited to `cc0,pdm` (public domain); downloads bytes into `UPLOAD_DIR` and returns up to `limit` candidates. Queries are **title-first** so renaming a recipe and regenerating changes results. No API key.
  - `stub` — skip network; leave cover unset (UI shows the default placeholder); generate-cover returns 404 with a clear message.
  - `qwen` — reserved for DashScope Qwen-Image-3.0; needs `DASHSCOPE_API_KEY` (not implemented yet).
- Failures are soft on wizard commit: commit still succeeds if search/download fails. The edit-page button surfaces a 404 when nothing suitable is found.
- Openverse requires outbound HTTPS to `api.openverse.org` (and the image CDN hosts in results, often `live.staticflickr.com`).
- Manual uploads: `POST /api/upload/` (multipart field `file`). The filename must be non-empty — empty filenames are rejected with a clear 422 (previously a validation serialization bug made this look like a client "network error").

## iOS app (`mobile/`)

- Separate pnpm project: `cd mobile && pnpm install` (do not mix with the root web `package.json`). Uses pnpm 10 with `node-linker=hoisted` (`mobile/.npmrc`) for Metro compatibility.
- Testing on Linux (no Mac/simulator in the VM): run the Expo **web preview** — `cd mobile && pnpm web` (Metro dev server on port 8081, opens the same app rendered via react-native-web). Point it at the local API with the backend running; the default dev API URL is `http://localhost:8000/api`. Sign in with the seeded password users below.
- Native-only surfaces that the web preview cannot exercise: Sign in with Apple (`expo-apple-authentication`) and the Face ID / Touch ID app lock (`expo-local-authentication`; the Account → Security toggle hides itself when no biometric hardware is enrolled, which includes web). Cover these with the Jest suites and `expo prebuild` checks instead.
- Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` (Jest; RNTL v14 `render`/`fireEvent` are async — `await` them). Bundling sanity: `pnpm exec expo export --platform web`; native config sanity: `pnpm exec expo prebuild --platform ios --no-install` (generates the gitignored `ios/`).
- Real iOS builds require macOS and run in CI (`.github/workflows/MobileRelease.yaml`); do not attempt `pod install`/`xcodebuild` in the Linux VM.

## Lint / test / build

- Web frontend lint: `pnpm lint` (ESLint; note it runs with `--fix`). Build (includes `vue-tsc` type-check): `pnpm build`.
- Python linters `flake8`/`black`/`isort` are in the `dev` dependency group; run them via `uv run flake8 api alembic` / `uv run black api alembic`. They have pre-existing findings in `api/core/seed_database.py` (long seed strings) and the Alembic migrations; these are not from new work.
- The mobile app has a Jest suite (`cd mobile && pnpm test`). There is no automated test suite for the API or web frontend (no pytest/vitest configured).

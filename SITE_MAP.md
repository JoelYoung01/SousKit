# Site map

Canonical map of routes, layouts, and page modules. The TypeScript module [`src/sitemap.ts`](./src/sitemap.ts) mirrors this file and is what the router and nav chrome import.

## Auth

| Path | Name | Page | Auth | Notes |
|------|------|------|------|-------|
| `/login` | `login` | `views/LoginView.vue` | Public | Email/password + Google; redirects to `redirectUrl` or home |
| `/register` | `register` | `views/RegisterView.vue` | Public | Create email/password account → server redirects to verify |
| `/verify-email` | `verify-email` | `views/VerifyEmailView.vue` | Public | OTP confirmation; query `?email=` |

Unauthenticated visits to protected routes → `/login?redirectUrl=<fullPath>`.

Unverified password login → API `403` with `Location` / `redirect_to` → `/verify-email?email=...`.

## App shell (bottom tab bar)

Layout: `layouts/AppShell.vue` (tab bar + add sheet). Children render in the shell outlet.

| Path | Name | Page | Tab | Notes |
|------|------|------|-----|-------|
| `/` | — | — | — | Redirect → `/home` |
| `/home` | `home` | `views/HomeView.vue` | Home | Tonight hero, week strip, 2×2 action cards (Create · Import · Find · Grocery) |
| `/recipes` | `recipes` | `views/recipes/RecipesView.vue` | Recipes | Results start at top; search floats at the bottom above the tab bar; swipe a row left to delete (owned), right to schedule (next open night preselected) |
| `/planner` | `planner` | `views/planner/PlannerView.vue` | Planner | Sliding week calendar; empty night opens recipe search + Create wizard CTA; filled night opens recipe detail; swipe left on a filled night to unplan |
| `/planner/fill` | `planner-fill` | `views/planner/MealPlanWizardView.vue` | Planner | Fill-gaps / plan-week LLM wizard; `?mode=recipe` = Create flow (single recipe, optional day assign at the end) |
| `/list` | `list` | `views/list/ShoppingListView.vue` | Grocery | Auto grocery list from planned meals (next 7 days); tap a row to cross off (2s undo), then it hides; swipe left for view/delete |
| `/account` | `account` | `views/AccountView.vue` | — | Profile + household sharing; opened from home avatar |
| `/join/:token` | `join-household` | `views/JoinHouseholdView.vue` | Required | Single-use household invite link (QR / copy URL); Universal Links open the iOS app when installed, otherwise this web page |

### Add menu (sheet, not a tab destination)

Opened by the raised **+** control. Items:

| Action | Target | Status |
|--------|--------|--------|
| Import from link | `/recipes/import?method=link` | Live (`POST /recipe/import-from-url/`) |
| Scan a photo | `/recipes/import?method=photo` | UI stub |
| Generate a recipe | `/planner/fill?mode=recipe` | Live (LLM wizard; optional day assign after save) |
| Write from scratch | `/recipes/new` | Live |
| Add meal to plan | `/planner` | Live |
| Grocery list | `/list` | Live (derived from planner) |

## Recipe flows (no tab highlight, or Recipes)

| Path | Name | Page | Auth | Notes |
|------|------|------|------|-------|
| `/recipes/new` | `recipe-new` | `views/recipes/RecipeEditView.vue` | Required | Create |
| `/recipes/import` | `recipe-import` | `views/recipes/RecipeImportView.vue` | Required | Link import live; photo still stub |
| `/recipes/:recipeId` | `recipe-detail` | `views/recipes/RecipeDetailView.vue` | Required | `:recipeId` = `\d+` |
| `/recipes/:recipeId/edit` | `recipe-edit` | `views/recipes/RecipeEditView.vue` | Required | Edit owned recipe |

## Social / misc

| Path | Name | Page | Auth | Notes |
|------|------|------|------|-------|
| `/users/:userId` | `public-user` | `views/PublicUserView.vue` | Required | Public profile + recipes |
| `/:pathMatch(.*)*` | `not-found` | `views/NotFoundView.vue` | Required | 404 |

## Legacy path redirects

Preserve bookmarks from the Vuetify app:

| Old | New |
|-----|-----|
| `/discover` | `/recipes` |
| `/my-recipes` | `/recipes` |
| `/meal-planning` | `/planner` |
| `/add-recipe` | `/recipes/new` |
| `/my-account` | `/account` |
| `/recipe/:id/detail` | `/recipes/:id` |
| `/recipe/:id/edit` | `/recipes/:id/edit` |
| `/user/:id` | `/users/:id` |

## Feature coverage (no new product scope)

- **Recipe storage** — list, search, detail, create/edit, delete, cover image, public flag
- **Meal planning** — plan/unplan by day; home week strip + tonight hero; fill-gaps wizard (goals / diet / ingredients → idea shortlist → recipe build → plan commit; OpenRouter when `OPENROUTER_API_KEY` is set, else stub LLM)
- **Create recipe** — home Create card → `/planner/fill?mode=recipe` (single-recipe LLM flow); optional day assign after review; skip keeps the recipe unplanned
- **Import recipe** — paste a recipe website URL (`POST /recipe/import-from-url/`); schema.org scrape first, OpenRouter LLM fallback when configured; photo scan still stubbed; social video links out of scope for v1
- **Grocery list** — ingredients for planned meals in a sliding 7-day window; tap to cross off with a short undo window before hide; dismiss/delete state persisted per household
- **Household sharing** — each user has a household (up to 8 members); recipes, planner, and grocery list are shared within the household; owners invite via QR code / single-use join link from Account (`/join/:token`; iOS Universal Links open the app when installed)

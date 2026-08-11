# Design system

Source of truth for visual language. Derived from the Recipe App Home design exploration (hero-driven home + raised “+” sheet). Implement UI against this doc and [`SITE_MAP.md`](./SITE_MAP.md).

## Product feel

- Mobile-first web app (PWA-style). Primary canvas ≈ 390px wide, centered on larger screens (`max-w-md`).
- Users come to: (a) import a recipe, (b) find a saved recipe, (c) plan meals, (d) see what’s for dinner tonight.
- Dark only for now — no light theme.

## Typography

- **UI font:** Figtree (Google Fonts), weights 400–700. One typeface only.
- Avoid Inter / Roboto / Arial / system stacks as the primary face.
- Body / long-form content (recipe instructions, descriptions): **16px** (`text-base`) with relaxed line-height; line length stays natural inside the `max-w-md` shell (~60–80ch).
- Larger display text → tighter tracking (`tracking-tight` / `tracking-tighter`); small meta can stay default or slightly open.
- Hierarchy (home as reference):
  - Weekday header: 16px / 700 / tight tracking
  - Hero recipe title: 20px / 700 / tight tracking
  - Section / row labels: 14–14.5px / 600
  - Meta / muted: 11–12.5px / 400–600
  - Tab labels: 10px / 500–600
  - Eyebrow (“TONIGHT”): 11px / 700 / letter-spacing ~0.08em / uppercase

## Color (zinc dark + green accent)

Neutrals are near-black / near-white (never pure `#000` / `#fff`) and lightly saturated toward the green accent so the palette feels coherent. Prefer cool-green undertones only — don’t mix warm greys. Give each role a distinct brightness so surfaces don’t compete. Container fills stay within ~12% HSB brightness of the canvas; borders contrast with **both** the fill and the background.

| Token | Hex | Usage |
|-------|-----|--------|
| `--background` | `#090b09` | App canvas |
| `--card` | `#181b18` | Rows, sheets, surfaces |
| `--elevated` | `#151816` | Tab bar / closer chrome (lighter than canvas) |
| `--secondary` / muted | `#1f231f` | Highlighted rows, soft fills |
| `--border` / `--input` | `#323834` | Hairlines, card borders |
| `--foreground` | `#f4f7f5` | Primary text / on-primary |
| `--muted-foreground` | `#9aa39c` | Secondary text |
| `--faint` | `#6b746e` | Tertiary / placeholders / inactive icons |
| `--gap-dot` | `#3f463f` | Unplanned day indicator |
| Primary fill | `#16a34a` (`green-600`) | Buttons, FAB |
| Primary on-dark | `#22c55e` (`green-500`) | Links, active tab |
| Success soft | `#4ade80` / `#86efac` | Badges, “TONIGHT” eyebrow |
| Tints | `rgba(34,197,94,…)` | Today cell, badge chips |

Map these to shadcn CSS variables (`--primary`, `--background`, etc.) in `src/assets/index.css`. Keep **dark class** on `<html>`.

**Contrast:** High contrast for content and primary actions; low contrast for structure (borders, inactive icons, tab chrome). Icons paired with labels should be slightly muted (`/75` or `text-faint`) so the label stays the heavier signal.

## Shape & elevation

- Radius: ~12–14px for rows/cards (`--radius` 14px); ~20px top radius on bottom sheets; FAB fully round.
- Nest corners: inner radius ≈ outer radius − gap (e.g. card `rounded-xl` + `p-3` → image `rounded-sm`).
- Outer padding ≥ inner padding inside containers.
- Borders: 1px `--border`. **Depth technique = borders + flat fills** — do not use drop shadows on dark surfaces (they don’t read). Exception: the raised FAB keeps a single soft green glow (`0 4px 8px`, blur = 2× Y-offset) with a 4px canvas-colored ring.
- Don’t stack hard divides (hero gradient + sheet top border + divider) next to each other.
- Buttons: horizontal padding ≈ 2× vertical (`px-4` on `h-9`, etc.).

## Layout patterns

### App chrome

1. **Scrollable content** above a fixed bottom tab bar.
2. **Tab bar** (global): Home · Recipes · **[+]** · Planner · Grocery.
3. Raised center **+** opens the Add sheet (not a direct route). When open, “+” rotates to × / “Close”.
4. Safe-area padding under the tab bar (~20px) for home-indicator devices.

### Home (landed direction)

Column: **full-bleed Tonight hero** → **week-at-a-glance** → **action card grid** → tab bar.

- Hero (~300px): recipe photo, gradient scrim, weekday + profile avatar overlay, “TONIGHT” + title + meta + **Cook** CTA. Empty state: prompt to plan tonight.
- Week strip: swipeable weeks (past + future) with weekday + date; green dot = planned, zinc gap = unplanned; today tinted/outlined. Tap a day → that day’s plan in the planner. “Fill the gaps →” → planner fill wizard for the visible week.
- Planner: vertical sliding weeks with **this week sticky at top**; day rows (not a month grid). “Fill gaps” (header) and a floating **Plan week** CTA above the tab bar open the wizard. Prefer primary actions like Plan week low on the screen for thumb reach — don’t bury them in section headers.
- Action cards (2×2, not a recent-feed): **Create** (AI recipe wizard) · **Import** · **Find** · **Grocery** (count chip when available).

### Add sheet

Bottom sheet over dimmed scrim:

1. **Add new** — Import from link (highlighted), Scan a photo, Write from scratch.
2. Divider
3. **Quick adds** — Add meal to plan, Grocery list.

Wire link import to `POST /recipe/import-from-url/`; keep photo scan stubbed until a backend exists.

## Motion

Keep motion intentional and light (app-wide):

1. Sheet slide-up + scrim fade.
2. FAB “+” → “×” rotate.
2a. Recipes library search FAB (bottom-right) expands into a full-width bar that sticks above the keyboard.
3. Subtle press/active opacity on action rows and tab items.
4. Page transitions: short fade + slight vertical rise (~180ms) between shell routes.
5. Skeleton pulse (`animate-pulse` muted bars) while list/hero data loads — never blank the page behind “Loading…”.

## Loading & caching

- Tab roots (Home, Recipes, Planner, Grocery) stay mounted via `KeepAlive` after first visit.
- Shared Pinia stores (`recipes`, `planner`, `grocery`) hold fetched data so revisits paint immediately; soft-refresh in the background when needed.
- First paint shows page chrome + skeletons; content fills in when the network returns.
- Prefer slim list DTOs (`RecipeCard`) and summary/count endpoints for badges over shipping full payloads.

## Components (shadcn-vue)

Prefer primitives from `@/components/ui/*`: Button, Input, Textarea, Checkbox, Dialog, Sheet, Calendar, Popover, Separator, Badge, Avatar, Label, ScrollArea, Skeleton, etc.

App-specific compositions live under `@/components/` (e.g. `AppTabBar`, `AddMenuSheet`, `RecipeCard`, `TonightHero`).

## Imagery

- Recipe covers are the visual anchor. Use real cover URLs from the API; fall back to `@/assets/default-recipe.jpg`.
- Dev: prefix relative upload URLs with `http://localhost:8000`.

## Spacing & alignment

- Prefer an 8px-related scale for padding/gaps (`2`, `4`, `8`, `12`, `16`, `20`, `24`…).
- Align elements to shared edges; week strip uses a 7-column grid inside the shell (shell itself is a single centered column, not a 12-col marketing grid).
- In horizontal rows (action rows, list cells), order by visual weight: primary label heaviest, trailing meta lightest; supporting icons stay quieter than the label.

## Anti-patterns

- No Vuetify / MDI.
- No purple-gradient “AI default” look; no cream/serif terracotta kit; no broadsheet newspaper layout.
- No card grids in the hero; no floating promo badges on hero media.
- Don’t put brand wordmark on home — weekday is the header; brand lives on login / account.
- No pure black/white fills for UI chrome; no mixed warm+cool greys; no shadow-based elevation on dark surfaces (except the FAB glow).
- No stacked adjacent hard edges (border on border, divider flush against a container edge without spacing).

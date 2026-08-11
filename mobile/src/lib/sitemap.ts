/**
 * Mobile mirror of the web app's src/sitemap.ts — tab bar + add-menu source
 * of truth. Keep aligned with SITE_MAP.md when routes change.
 */

export const paths = {
  login: "/login",
  register: "/register",
  verifyEmail: "/verify-email",
  home: "/home",
  recipes: "/recipes",
  recipeNew: "/recipes/new",
  recipeImport: "/recipes/import",
  recipeDetail: (id: number | string) => `/recipes/${id}`,
  recipeEdit: (id: number | string) => `/recipes/${id}/edit`,
  planner: "/planner",
  plannerFill: "/planner/fill",
  /** Ad-hoc LLM recipe create; optional day assign after save. */
  recipeGenerate: "/planner/fill?mode=recipe",
  list: "/list",
  account: "/account",
  /** Household invite deep link / Universal Link landing */
  joinHousehold: (token: string) => `/join/${encodeURIComponent(token)}`
} as const;

export type AddMenuActionId =
  | "import-link"
  | "import-photo"
  | "recipe-generate"
  | "recipe-scratch"
  | "plan-meal"
  | "shop-item";

export interface AddMenuAction {
  id: AddMenuActionId;
  title: string;
  description: string;
  href: string;
  group: "create" | "quick";
  highlighted?: boolean;
  /** When true, UI may show a stub / coming-soon treatment */
  stub?: boolean;
}

export const addMenuActions: AddMenuAction[] = [
  {
    id: "import-link",
    title: "Import from link",
    description: "Paste a URL, we pull the recipe",
    href: `${paths.recipeImport}?method=link`,
    group: "create",
    highlighted: true
  },
  {
    id: "import-photo",
    title: "Scan a photo",
    description: "Cookbook page or handwritten card",
    href: `${paths.recipeImport}?method=photo`,
    group: "create",
    stub: true
  },
  {
    id: "recipe-generate",
    title: "Generate a recipe",
    description: "Describe the vibe — AI writes it",
    href: paths.recipeGenerate,
    group: "create",
    highlighted: true
  },
  {
    id: "recipe-scratch",
    title: "Write from scratch",
    description: "Blank recipe form",
    href: paths.recipeNew,
    group: "create"
  },
  {
    id: "plan-meal",
    title: "Add meal to plan",
    description: "Pick a day, pick a recipe",
    href: paths.planner,
    group: "quick"
  },
  {
    id: "shop-item",
    title: "Grocery list",
    description: "Ingredients for the next 7 days",
    href: paths.list,
    group: "quick"
  }
];

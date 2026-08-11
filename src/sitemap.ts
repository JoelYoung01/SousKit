/**
 * Runtime site map — keep in sync with SITE_MAP.md.
 * Router, tab bar, and page links should import from here.
 */

export type SiteRouteName =
  | "login"
  | "register"
  | "verify-email"
  | "home"
  | "recipes"
  | "recipe-new"
  | "recipe-import"
  | "recipe-detail"
  | "recipe-edit"
  | "planner"
  | "planner-fill"
  | "list"
  | "account"
  | "join-household"
  | "public-user"
  | "not-found";

export type TabId = "home" | "recipes" | "add" | "planner" | "list";

export interface TabItem {
  id: TabId;
  label: string;
  /** Route name when this tab navigates; `add` opens the sheet instead */
  routeName?: SiteRouteName;
  path?: string;
}

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
  joinHousehold: (token: string) => `/join/${encodeURIComponent(token)}`,
  publicUser: (id: number | string) => `/users/${id}`,
  notFound: "/not-found"
} as const;

export const tabs: TabItem[] = [
  { id: "home", label: "Home", routeName: "home", path: paths.home },
  { id: "recipes", label: "Recipes", routeName: "recipes", path: paths.recipes },
  { id: "add", label: "Add" },
  { id: "planner", label: "Planner", routeName: "planner", path: paths.planner },
  { id: "list", label: "Grocery", routeName: "list", path: paths.list }
];

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

/** Which route names highlight which tab */
export const tabByRouteName: Partial<Record<SiteRouteName, TabId>> = {
  home: "home",
  recipes: "recipes",
  "recipe-new": "recipes",
  "recipe-import": "recipes",
  "recipe-detail": "recipes",
  "recipe-edit": "recipes",
  planner: "planner",
  "planner-fill": "planner",
  list: "list"
};

export const legacyRedirects: Array<{ from: string; to: string }> = [
  { from: "/discover", to: paths.recipes },
  { from: "/my-recipes", to: paths.recipes },
  { from: "/meal-planning", to: paths.planner },
  { from: "/add-recipe", to: paths.recipeNew },
  { from: "/my-account", to: paths.account },
  { from: "/recipe/:recipeId(\\d+)/detail", to: "/recipes/:recipeId" },
  { from: "/recipe/:recipeId(\\d+)/edit", to: "/recipes/:recipeId/edit" },
  { from: "/user/:userId(\\d+)", to: "/users/:userId" }
];

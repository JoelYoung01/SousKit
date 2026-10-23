export interface GroceryQuantity {
  amount: number | null;
  units: string | null;
}

export interface GroceryRecipeRef {
  id: number;
  name: string;
}

export interface GroceryItem {
  key: string;
  name: string;
  category: string;
  quantities: GroceryQuantity[];
  quantity_display: string;
  recipes: GroceryRecipeRef[];
  recipe_titles: string;
  source_ingredient_ids: number[];
  manual_item_ids: number[];
  is_manual: boolean;
  auto_dismissed: boolean;
  dismissed: boolean;
  deleted: boolean;
}

export interface GroceryManualItemCreate {
  name: string;
  amount?: number | null;
  units?: string | null;
}

export interface GroceryManualItemUpdate {
  name: string;
  amount?: number | null;
  units?: string | null;
}

export interface GroceryListResponse {
  window_start: string;
  window_end: string;
  window_days: number;
  items: GroceryItem[];
}

export interface GrocerySummaryResponse {
  window_start: string;
  window_end: string;
  window_days: number;
  active_count: number;
}

/** null = smart auto window (adjusts to the furthest planned meal). */
export type GroceryWindowChoice = number | null;

export const GROCERY_WINDOW_OPTIONS: { value: GroceryWindowChoice; label: string }[] = [
  { value: null, label: "Planned" },
  { value: 3, label: "3d" },
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" }
];

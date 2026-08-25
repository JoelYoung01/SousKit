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

export interface GroceryListResponse {
  window_start: string;
  window_end: string;
  items: GroceryItem[];
}

export interface GrocerySummaryResponse {
  window_start: string;
  window_end: string;
  active_count: number;
}

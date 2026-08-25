import type {
  GroceryItem,
  GroceryItemStatus,
  GroceryListResponse,
  GroceryManualItemCreate,
  GroceryManualItemUpdate,
  GrocerySummaryResponse
} from "@/types";
import { del, get, post, put } from "./client";

export function fetchGroceryList(): Promise<GroceryListResponse> {
  return get<GroceryListResponse>("/grocery/");
}

export function fetchGrocerySummary(): Promise<GrocerySummaryResponse> {
  return get<GrocerySummaryResponse>("/grocery/summary/");
}

export function setGroceryItemStatus(
  itemKey: string,
  status: GroceryItemStatus
): Promise<GroceryItem> {
  return put<GroceryItem>("/grocery/state/", { item_key: itemKey, status });
}

export function createManualGroceryItem(
  body: GroceryManualItemCreate
): Promise<GroceryItem> {
  return post<GroceryItem>("/grocery/items/", body);
}

export function updateManualGroceryItem(
  itemId: number,
  body: GroceryManualItemUpdate
): Promise<GroceryItem> {
  return put<GroceryItem>(`/grocery/items/${itemId}/`, body);
}

export function deleteManualGroceryItem(itemId: number): Promise<void> {
  return del(`/grocery/items/${itemId}/`);
}

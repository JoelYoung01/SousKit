import type { GroceryItem } from "@/types";

/** Items that belong on a shopping trip (not crossed off / deleted). */
export function getExportableGroceryItems(items: GroceryItem[]): GroceryItem[] {
  return items.filter((item) => !item.dismissed && !item.deleted);
}

/** One line for a reminder title or a plain-text bullet. */
export function formatGroceryExportLine(item: GroceryItem): string {
  const qty = item.quantity_display?.trim();
  if (qty) return `${item.name} (${qty})`;
  return item.name;
}

/**
 * Plain-text grocery list grouped by category, suitable for clipboard paste
 * into Notes, Messages, Reminders (manual), etc.
 */
export function formatGroceryListPlainText(
  items: GroceryItem[],
  options?: { title?: string }
): string {
  const exportable = getExportableGroceryItems(items);
  const title = options?.title?.trim() || "Grocery";

  if (exportable.length === 0) {
    return `${title}\n(No items)`;
  }

  const groups = new Map<string, GroceryItem[]>();
  for (const item of exportable) {
    const bucket = groups.get(item.category) ?? [];
    bucket.push(item);
    groups.set(item.category, bucket);
  }

  const sections: string[] = [title, ""];
  for (const [category, categoryItems] of groups) {
    sections.push(category);
    for (const item of categoryItems) {
      sections.push(`- ${formatGroceryExportLine(item)}`);
    }
    sections.push("");
  }

  return sections.join("\n").trimEnd() + "\n";
}

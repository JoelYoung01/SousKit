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

/** Shopping notes joined for a single line under the item title. */
export function formatGroceryNotesLine(notes: string[] | null | undefined): string {
  return (notes ?? [])
    .map((note) => note.trim())
    .filter(Boolean)
    .join(" · ");
}

/**
 * Lines that sit under the item title.
 * Notes come first. The source recipe follows when notes are present, or
 * whenever `includeSource` is set (Reminders already stores the source there).
 */
export function formatGroceryItemContextLines(
  item: GroceryItem,
  options?: { includeSource?: boolean }
): string[] {
  const lines: string[] = [];
  const notes = formatGroceryNotesLine(item.notes);
  if (notes) lines.push(notes);
  const source = item.recipe_titles?.trim();
  if (source && (options?.includeSource || notes)) lines.push(source);
  return lines;
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
      for (const line of formatGroceryItemContextLines(item)) {
        sections.push(`  ${line}`);
      }
    }
    sections.push("");
  }

  return sections.join("\n").trimEnd() + "\n";
}

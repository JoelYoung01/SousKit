/**
 * Small Markdown subset for recipe description, instructions, and notes.
 * Keep in sync with mobile/src/lib/markdown.ts.
 *
 * Supports headings, paragraphs (single newlines are line breaks), bold,
 * italic, inline code, links, and one level of nested lists.
 */

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "break" }
  | { type: "code"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "link"; href: string; children: InlineNode[] };

export type ListBlock = {
  type: "list";
  ordered: boolean;
  start: number;
  items: ListItem[];
};

export type ListItem = {
  children: InlineNode[];
  nested: ListBlock | null;
};

export type BlockNode =
  | { type: "heading"; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | ListBlock;

const UNSAFE_URL = /^(javascript|data|vbscript):/i;

export function parseMarkdown(source: string): BlockNode[] {
  const text = (source || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n");
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(\S.*)$/.exec(lines[index]);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseInlines(heading[2].trim())
      });
      index += 1;
      continue;
    }

    const marker = parseListMarker(lines[index]);
    if (marker && marker.depth === 0) {
      const list = readList(lines, index, marker.ordered);
      blocks.push(list.block);
      index = list.next;
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+\S/.test(lines[index]) &&
      !parseListMarker(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", children: joinLines(paragraph) });
  }

  return blocks;
}

/** Flatten Markdown to a single line for cards and other compact previews. */
export function markdownToPlain(source: string): string {
  return parseMarkdown(source)
    .map(blockPlain)
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function blockPlain(block: BlockNode): string {
  if (block.type === "list") {
    return block.items
      .map((item) => {
        const nested = item.nested ? blockPlain(item.nested) : "";
        return [inlinePlain(item.children), nested].filter(Boolean).join(" ");
      })
      .join(" ");
  }
  return inlinePlain(block.children);
}

function inlinePlain(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") return node.text;
      if (node.type === "break") return " ";
      if (node.type === "link") return inlinePlain(node.children);
      return inlinePlain(node.children);
    })
    .join("");
}

function joinLines(lines: string[]): InlineNode[] {
  const children: InlineNode[] = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex) children.push({ type: "break" });
    children.push(...parseInlines(line));
  });
  return children;
}

function readList(
  lines: string[],
  start: number,
  ordered: boolean
): { block: ListBlock; next: number } {
  const items: ListItem[] = [];
  let index = start;
  let firstNumber = 1;
  let sawNumber = false;

  while (index < lines.length) {
    if (!lines[index].trim()) break;

    const marker = parseListMarker(lines[index]);
    if (marker && marker.depth === 0) {
      if (marker.ordered !== ordered) break;
      if (!sawNumber) {
        firstNumber = marker.start;
        sawNumber = true;
      }
      items.push({ children: parseInlines(marker.content), nested: null });
      index += 1;
      continue;
    }

    if (marker && marker.depth > 0 && items.length) {
      const parent = items[items.length - 1];
      const nested = readNestedList(lines, index);
      parent.nested = nested.block;
      index = nested.next;
      continue;
    }

    const continuation = /^(\s{2,})(\S.*)$/.exec(lines[index]);
    if (continuation && items.length && !/^(#{1,3})\s+\S/.test(continuation[2])) {
      const target = lastNestedItem(items[items.length - 1]) ?? items[items.length - 1];
      target.children.push({ type: "break" }, ...parseInlines(continuation[2].trim()));
      index += 1;
      continue;
    }

    break;
  }

  return {
    block: {
      type: "list",
      ordered,
      start: ordered ? firstNumber : 1,
      items
    },
    next: index
  };
}

function readNestedList(lines: string[], start: number): { block: ListBlock; next: number } {
  const first = parseListMarker(lines[start]);
  const ordered = first?.ordered ?? false;
  const items: ListItem[] = [];
  let index = start;
  const firstNumber = first?.start ?? 1;

  while (index < lines.length) {
    const marker = parseListMarker(lines[index]);
    if (!marker || marker.depth === 0) break;
    if (marker.ordered !== ordered) break;
    items.push({ children: parseInlines(marker.content), nested: null });
    index += 1;
  }

  return {
    block: { type: "list", ordered, start: firstNumber, items },
    next: index
  };
}

function lastNestedItem(item: ListItem): ListItem | null {
  if (!item.nested || !item.nested.items.length) return null;
  return item.nested.items[item.nested.items.length - 1];
}

function parseListMarker(line: string): {
  depth: number;
  ordered: boolean;
  start: number;
  content: string;
} | null {
  const match = /^(\s*)([-*+]|\d{1,3}[.)])\s+(\S.*)$/.exec(line);
  if (!match) return null;
  const marker = match[2];
  const ordered = /\d/.test(marker);
  return {
    depth: match[1].length >= 2 ? 1 : 0,
    ordered,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    content: match[3]
  };
}

export function parseInlines(input: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (!buffer) return;
    nodes.push({ type: "text", text: buffer });
    buffer = "";
  };

  while (index < input.length) {
    if (input[index] === "\\" && index + 1 < input.length && "*_`[]\\".includes(input[index + 1])) {
      buffer += input[index + 1];
      index += 2;
      continue;
    }

    if (input[index] === "`") {
      const end = input.indexOf("`", index + 1);
      if (end > index + 1) {
        flush();
        nodes.push({ type: "code", text: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    const double = matchDelimited(input, index, input.startsWith("__", index) ? "__" : "**");
    if ((input.startsWith("**", index) || input.startsWith("__", index)) && double) {
      flush();
      nodes.push({ type: "strong", children: parseInlines(double.body) });
      index = double.next;
      continue;
    }

    const marker = input[index] === "*" || input[index] === "_" ? input[index] : "";
    if ((marker === "*" || marker === "_") && canOpenEmphasis(input, index, marker)) {
      const end = findEmphasisCloser(input, index + 1, marker);
      if (end !== -1) {
        flush();
        nodes.push({ type: "em", children: parseInlines(input.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }

    const link = matchLink(input, index);
    if (link) {
      flush();
      nodes.push({ type: "link", href: link.href, children: parseInlines(link.label) });
      index = link.next;
      continue;
    }

    buffer += input[index];
    index += 1;
  }

  flush();
  return nodes;
}

function matchDelimited(
  input: string,
  index: number,
  marker: "**" | "__"
): { body: string; next: number } | null {
  if (!input.startsWith(marker, index)) return null;
  const end = input.indexOf(marker, index + marker.length);
  if (end === -1 || end === index + marker.length) return null;
  return { body: input.slice(index + marker.length, end), next: end + marker.length };
}

function canOpenEmphasis(input: string, index: number, marker: "*" | "_"): boolean {
  const next = input[index + 1];
  if (!next || /\s/.test(next)) return false;
  const prev = input[index - 1];
  if (marker === "_") return !prev || !/[A-Za-z0-9]/.test(prev);
  if (prev && /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next)) return false;
  return true;
}

function findEmphasisCloser(input: string, from: number, marker: "*" | "_"): number {
  for (let index = from; index < input.length; index += 1) {
    if (input[index] === "\\") {
      index += 1;
      continue;
    }
    if (input[index] !== marker) continue;
    if (marker === "*" && input[index + 1] === "*") {
      index += 1;
      continue;
    }
    if (marker === "*" && /\s/.test(input[index - 1] || "")) continue;
    if (marker === "_") {
      const prev = input[index - 1];
      const next = input[index + 1];
      if (!prev || /\s/.test(prev)) continue;
      if (next && /[A-Za-z0-9]/.test(next)) continue;
    }
    return index;
  }
  return -1;
}

function matchLink(
  input: string,
  index: number
): { label: string; href: string; next: number } | null {
  if (input[index] !== "[") return null;
  const labelEnd = input.indexOf("]", index + 1);
  if (labelEnd === -1 || input[labelEnd + 1] !== "(") return null;
  const hrefEnd = input.indexOf(")", labelEnd + 2);
  if (hrefEnd === -1) return null;
  const label = input.slice(index + 1, labelEnd);
  const href = input.slice(labelEnd + 2, hrefEnd).trim();
  if (!label.trim() || !isSafeUrl(href)) return null;
  return { label, href, next: hrefEnd + 1 };
}

function isSafeUrl(href: string): boolean {
  if (!href || /\s/.test(href) || UNSAFE_URL.test(href)) return false;
  return /^(https?:\/\/|mailto:)/i.test(href);
}

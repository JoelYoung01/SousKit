/** Source-link paste parsing and site-name lookup. Keep in sync with src/lib/sourceLinks.ts. */

export interface SourceLink {
  name: string;
  url: string;
}

export interface SourceLinkDraft extends SourceLink {
  /** True until the user types a custom label, so a lookup can replace the hostname. */
  autoName: boolean;
}

const MAX_LINKS = 12;

function urlPattern(): RegExp {
  return /https?:\/\/[^\s<>"']+/gi;
}

export function hostnameLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    const parts = host.split(".").filter(Boolean);
    const sld = parts.length >= 2 ? parts[parts.length - 2]! : parts[0] || "";
    const words = sld.split(/[-_]+/).filter(Boolean);
    if (!words.length) return "Link";
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  } catch {
    return "Link";
  }
}

export function sourceLinkKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.search ? `${host}${path}${parsed.search}` : `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function cleanUrl(url: string): string {
  return url.replace(/[),.;]+$/g, "");
}

function cleanName(value: string): string {
  let text = value.replace(urlPattern(), " ").replace(/\s+/g, " ").trim();
  let previous = "";
  while (text && text !== previous) {
    previous = text;
    text = text.replace(/^[,|–—:-]+|[,|–—:-]+$/g, "").trim();
  }
  return text;
}

/** Turn a paste into links. A bare name has an empty URL (label for the next link). */
export function parseSourceLinkInput(raw: string): SourceLink[] {
  const text = raw.replace(/\u00a0/g, " ").trim();
  if (!text) return [];

  const results: SourceLink[] = [];
  for (const line of text.split(/\n+/)) {
    const urls = [...line.matchAll(urlPattern())].map((match) => cleanUrl(match[0] ?? ""));
    if (!urls.length) {
      const name = cleanName(line);
      if (name) results.push({ name, url: "" });
      continue;
    }
    const label = urls.length === 1 ? cleanName(line) : "";
    for (const url of urls) {
      if (url) results.push({ name: label, url });
    }
  }
  return results;
}

export function isPlaceholderName(name: string, url: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return trimmed.toLowerCase() === hostnameLabel(url).toLowerCase();
}

export function applySourceLinkInput(
  raw: string,
  pendingName: string
): { additions: SourceLinkDraft[]; pendingName: string } {
  const parsed = parseSourceLinkInput(raw);
  const nameOnly = parsed.filter((item) => !item.url);
  const withUrl = parsed.filter((item) => item.url);
  let pending = pendingName.trim();

  if (!withUrl.length) {
    const last = nameOnly.at(-1);
    return { additions: [], pendingName: last?.name ?? pending };
  }

  const additions: SourceLinkDraft[] = [];
  for (const item of withUrl) {
    if (item.name) {
      additions.push({ name: item.name, url: item.url, autoName: false });
    } else if (pending) {
      additions.push({ name: pending, url: item.url, autoName: false });
      pending = "";
    } else {
      additions.push({ name: hostnameLabel(item.url), url: item.url, autoName: true });
    }
  }
  if (nameOnly.length) pending = nameOnly[nameOnly.length - 1]!.name;
  return { additions, pendingName: pending };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function cleanSiteName(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim().replace(/^[\s|·•\-–—]+|[\s|·•\-–—]+$/g, "");
  if (!text) return null;
  if (["home", "homepage", "welcome", "index", "recipe", "recipes"].includes(text.toLowerCase())) {
    return null;
  }
  if (text.length > 60 || text.startsWith("@") || /^https?:/i.test(text)) return null;
  return text.slice(0, 80);
}

function metaContent(html: string, names: string[]): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      const key = (match[1] ?? "").toLowerCase();
      attrs.set(key, decodeEntities(match[2] || match[3] || match[4] || "").trim());
    }
    const key = (attrs.get("property") || attrs.get("name") || attrs.get("itemprop") || "").toLowerCase();
    if (names.includes(key)) {
      const found = cleanSiteName(attrs.get("content"));
      if (found) return found;
    }
  }
  return null;
}

/** Site name from HTML, or null when the page does not identify itself. */
export function siteNameFromHtml(pageHtml: string, url: string): string | null {
  const page = pageHtml.slice(0, 200_000);
  const meta = metaContent(page, ["og:site_name", "application-name"]);
  if (meta) return meta;

  const titleMatch = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch?.[1]) return null;
  const title = decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim();
  const parts = title
    .split(/\s+[|–—·•-]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const hostCompact = hostnameLabel(url).toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const part of parts) {
    const cleaned = cleanSiteName(part);
    if (!cleaned) continue;
    const compact = cleaned.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (hostCompact && (hostCompact.includes(compact) || compact.includes(hostCompact))) {
      return cleaned;
    }
  }
  return cleanSiteName(parts[parts.length - 1] ?? "");
}

export async function readSiteNameFromPage(
  url: string
): Promise<{ name: string | null; fetched: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    if (!response.ok) return { name: null, fetched: false };
    const type = response.headers.get("content-type") ?? "";
    if (type && !/html|xml|text\/plain/i.test(type)) return { name: null, fetched: false };
    const html = (await response.text()).slice(0, 150_000);
    return { name: siteNameFromHtml(html, response.url || url), fetched: true };
  } catch {
    return { name: null, fetched: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupSiteName(
  url: string,
  resolveOnServer: (url: string) => Promise<SourceLink>
): Promise<SourceLink> {
  const direct = await readSiteNameFromPage(url);
  if (direct.name) return { name: direct.name, url };
  if (direct.fetched) return { name: hostnameLabel(url), url };
  try {
    const resolved = await resolveOnServer(url);
    return {
      name: resolved.name?.trim() || hostnameLabel(resolved.url || url),
      url: resolved.url || url
    };
  } catch {
    return { name: hostnameLabel(url), url };
  }
}

export function mergeSourceLinks(
  existing: SourceLinkDraft[],
  additions: SourceLinkDraft[]
): { links: SourceLinkDraft[]; rejected: "duplicate" | "limit" | null } {
  const links = [...existing];
  const seen = new Set(links.map((link) => sourceLinkKey(link.url)));
  let rejected: "duplicate" | "limit" | null = null;
  for (const addition of additions) {
    if (links.length >= MAX_LINKS) {
      rejected = "limit";
      break;
    }
    const key = sourceLinkKey(addition.url);
    if (seen.has(key)) {
      rejected = rejected ?? "duplicate";
      continue;
    }
    seen.add(key);
    links.push(addition);
  }
  return { links, rejected };
}

export const SOURCE_LINK_LIMIT = MAX_LINKS;

"""Recipe source links: a JSON object of display names and URLs.

Stored on ``recipe_version.source_links_json`` as::

    {"links": [{"name": "Serious Eats", "url": "https://www.seriouseats.com/chili"}]}

The editor can paste one URL, a comma-separated list, or a name. Names are
resolved from the page (``og:site_name``, then the title) and saved separately
from the URL.
"""

from __future__ import annotations

import html
import json
import re
from typing import Any
from urllib.parse import urlparse

from api.core.recipe_import.fetch import (
    RecipeImportError,
    assert_public_http_url,
    fetch_public_html,
    host_is_blocked_literal,
)

MAX_SOURCE_LINKS = 12
_MAX_NAME = 80
_MAX_URL = 2048

_META_TAG = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_ATTR = re.compile(
    r"""([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""",
    re.IGNORECASE,
)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_TITLE_SPLIT = re.compile(r"\s+[\|\-–—·•]\s+")
_GENERIC_NAMES = {
    "home",
    "homepage",
    "welcome",
    "index",
    "recipe",
    "recipes",
}
_IMPORT_LINE = re.compile(
    r"(?:^|\n)[ \t]*Imported from (https?://\S+)[ \t]*(?=\n|$)",
    re.IGNORECASE,
)


class SourceLinkError(ValueError):
    """A source-link payload cannot be stored."""


def hostname_label(url: str) -> str:
    """Readable fallback when a page does not name itself."""
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    parts = [part for part in host.split(".") if part]
    sld = parts[-2] if len(parts) >= 2 else (parts[0] if parts else "")
    words = [word for word in re.split(r"[-_]+", sld) if word]
    if not words:
        return "Link"
    return " ".join(word[:1].upper() + word[1:] for word in words)[:_MAX_NAME]


def link_key(url: str) -> str:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower().removeprefix("www.")
    path = (parsed.path or "").rstrip("/") or "/"
    query = parsed.query
    return f"{host}{path}?{query}" if query else f"{host}{path}"


def _tag_attrs(tag: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for match in _ATTR.finditer(tag):
        key = match.group(1).lower()
        value = match.group(2) or match.group(3) or match.group(4) or ""
        attrs[key] = html.unescape(value).strip()
    return attrs


def _clean_site_name(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"\s+", " ", html.unescape(value)).strip()
    text = text.strip(" |·•-–—")
    if not text or text.lower() in _GENERIC_NAMES:
        return None
    if len(text) > 60:
        return None
    return text[:_MAX_NAME]


def _meta_content(page: str, names: set[str]) -> str | None:
    for tag in _META_TAG.findall(page):
        attrs = _tag_attrs(tag)
        key = (
            attrs.get("property") or attrs.get("name") or attrs.get("itemprop") or ""
        ).lower()
        if key in names:
            found = _clean_site_name(attrs.get("content"))
            if (
                found
                and not found.startswith("@")
                and not found.lower().startswith("http")
            ):
                return found
    return None


def _name_from_title(title: str, url: str) -> str | None:
    parts = [
        part.strip() for part in _TITLE_SPLIT.split(title) if part and part.strip()
    ]
    if len(parts) < 2:
        return None
    host_compact = re.sub(r"[^a-z0-9]", "", hostname_label(url).lower())
    for part in parts:
        cleaned = _clean_site_name(part)
        if not cleaned:
            continue
        compact = re.sub(r"[^a-z0-9]", "", cleaned.lower())
        if host_compact and (host_compact in compact or compact in host_compact):
            return cleaned
    return _clean_site_name(parts[-1])


def site_name_from_html(page_html: str, url: str) -> str:
    """Best display name for a page: site meta, then title, then the hostname."""
    page = page_html[:200_000] if page_html else ""
    meta = _meta_content(page, {"og:site_name", "application-name", "og:site"})
    if meta:
        return meta
    title_match = _TITLE.search(page)
    if title_match:
        title = re.sub(r"\s+", " ", html.unescape(title_match.group(1))).strip()
        from_title = _name_from_title(title, url)
        if from_title:
            return from_title
    return hostname_label(url)


def _coerce_row(row: Any, *, strict: bool) -> dict[str, str] | None:
    if isinstance(row, str):
        name, url = "", row
    elif isinstance(row, dict):
        name = str(row.get("name") or "")
        url = str(row.get("url") or "")
    else:
        if strict:
            raise SourceLinkError("Each source link needs a URL.")
        return None

    url = url.strip()
    if not url:
        if strict:
            raise SourceLinkError("Each source link needs a URL.")
        return None
    if len(url) > _MAX_URL:
        if strict:
            raise SourceLinkError("One of those URLs is too long.")
        return None
    try:
        url = assert_public_http_url(url)
    except RecipeImportError as exc:
        if strict:
            raise SourceLinkError(exc.message) from exc
        return None

    cleaned_name = re.sub(r"\s+", " ", name).strip()[:_MAX_NAME]
    if not cleaned_name:
        cleaned_name = hostname_label(url)
    return {"name": cleaned_name, "url": url}


def normalize_source_links(rows: Any) -> list[dict[str, str]]:
    """Validate and dedupe links, preserving order. Empty input is an empty list."""
    if rows is None:
        return []
    if isinstance(rows, str):
        # A comma-separated paste is accepted so the field stays easy to set.
        pieces = [part.strip() for part in re.split(r"[\n,]+", rows) if part.strip()]
        rows = [{"name": "", "url": part} for part in pieces]
    if not isinstance(rows, list):
        raise SourceLinkError("Source links must be a list of URLs.")
    if len(rows) > MAX_SOURCE_LINKS:
        raise SourceLinkError(f"You can save up to {MAX_SOURCE_LINKS} source links.")

    normalized: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        link = _coerce_row(row, strict=True)
        if link is None:
            continue
        key = link_key(link["url"])
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(link)
    return normalized


def dump_source_links(rows: Any) -> str | None:
    """JSON object blob, or None when the recipe has no source links."""
    links = normalize_source_links(rows)
    if not links:
        return None
    return json.dumps({"links": links}, separators=(",", ":"), ensure_ascii=False)


def load_source_links(raw: str | None) -> list[dict[str, str]]:
    if not raw or not str(raw).strip():
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        rows = parsed.get("links", [])
    elif isinstance(parsed, list):
        rows = parsed
    else:
        return []
    if not isinstance(rows, list):
        return []

    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows:
        link = _coerce_row(row, strict=False)
        if link is None:
            continue
        host = urlparse(link["url"]).hostname or ""
        if host_is_blocked_literal(host):
            continue
        key = link_key(link["url"])
        if key in seen:
            continue
        seen.add(key)
        links.append(link)
    return links


def format_source_links(links: list[dict[str, str]] | None) -> str | None:
    if not links:
        return None
    return "\n".join(f"{link['name']} ({link['url']})" for link in links)


def extract_legacy_import_notes(
    notes: str | None,
) -> tuple[str | None, list[dict[str, str]]]:
    """Pull ``Imported from https://…`` lines out of older recipe notes."""
    if not notes or "imported from http" not in notes.lower():
        return notes, []

    found: list[dict[str, str]] = []

    def _replace(match: re.Match[str]) -> str:
        url = match.group(1).rstrip(".,)")
        try:
            url = assert_public_http_url(url)
        except RecipeImportError:
            return match.group(0)
        found.append({"name": hostname_label(url), "url": url})
        return "\n"

    cleaned = _IMPORT_LINE.sub(_replace, notes)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return (cleaned or None), found


def resolve_source_link(url: str) -> dict[str, str]:
    """Fetch a page and return ``{name, url}``.

    Invalid or private URLs raise ``RecipeImportError``. If the site is
    reachable but does not identify itself, the hostname is the name. A
    download failure still returns the original URL so the chip can be saved.
    """
    cleaned = assert_public_http_url(url)
    try:
        final_url, page_html = fetch_public_html(cleaned)
    except RecipeImportError:
        return {"name": hostname_label(cleaned), "url": cleaned}
    # Keep the caller's URL when the redirect lands on a different host only
    # if we still have a usable page. The final URL is what the chip opens.
    return {
        "name": site_name_from_html(page_html, final_url),
        "url": final_url,
    }

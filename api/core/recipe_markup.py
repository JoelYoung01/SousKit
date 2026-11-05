"""Turn simple recipe HTML into Markdown, and recover it while importing.

Recipe pages often store bold, italics, and lists in schema.org text or in
the visible recipe card. recipe-scrapers flattens those to plain text. This
module keeps the small subset we render in the clients.
"""

from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from typing import Any

from bs4 import BeautifulSoup

_MARKUP_RE = re.compile(
    r"<\s*/?\s*(strong|b|em|i|br|p|ul|ol|li|h[1-6]|a|blockquote)\b",
    re.IGNORECASE,
)
_SKIP_TAGS = {"script", "style", "noscript", "svg", "template", "iframe"}
_BOLD_TAGS = {"strong", "b"}
_ITALIC_TAGS = {"em", "i"}
_HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
_LIST_START = re.compile(r"^\s*(?:[-*+]\s+|\d{1,3}[.)]\s+)")
_SAFE_HREF = re.compile(r"^(https?://|mailto:)", re.IGNORECASE)
_MARKER_ONLY = re.compile(r"^\s*(?:[-*+]|\d+\.)\s*$")


def contains_markup(value: Any) -> bool:
    if isinstance(value, str):
        if _MARKUP_RE.search(value):
            return True
        if "&lt;" in value.lower() and _MARKUP_RE.search(html.unescape(value)):
            return True
        return False
    if isinstance(value, list):
        return any(contains_markup(item) for item in value)
    if isinstance(value, dict):
        return any(contains_markup(item) for item in value.values())
    return False


def html_to_markdown(value: str) -> str:
    """Convert a small HTML subset to Markdown. Unknown tags are dropped."""
    raw = html.unescape(value or "")
    if not raw.strip():
        return ""
    parser = _HtmlMarkdownParser()
    try:
        parser.feed(raw)
        parser.close()
    except Exception:  # noqa: BLE001 — broken markup still yields readable text
        return re.sub(r"<[^>]+>", "", raw).strip()
    return parser.text()


class _HtmlMarkdownParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._out: list[str] = []
        self._skip = 0
        self._markers: list[str] = []
        self._lists: list[dict[str, Any]] = []
        self._anchor: list[str] | None = None
        self._anchor_href: str | None = None
        self._pending_space = False

    def text(self) -> str:
        if self._anchor is not None:
            label = "".join(self._anchor).strip()
            href = self._anchor_href
            self._anchor = None
            self._anchor_href = None
            if label and href:
                self._emit(f"[{label}]({href})")
            elif label:
                self._emit(label)
        while self._markers:
            self._emit(self._markers.pop())
        cleaned = "".join(self._out)
        cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        # Drop empty markers from tags that wrapped nothing. Require whitespace
        # so **bold** and *italic* stay intact.
        cleaned = re.sub(r"\*\*\s+\*\*", "", cleaned)
        cleaned = re.sub(r"(?<!\*)\*\s+\*(?!\*)", "", cleaned)
        return cleaned.strip()

    def _emit(self, text: str) -> None:
        if self._anchor is not None:
            self._anchor.append(text)
        else:
            self._out.append(text)

    def _tail(self) -> str:
        return "".join(self._anchor if self._anchor is not None else self._out)

    def _flush_space(self) -> None:
        if not self._pending_space:
            return
        self._pending_space = False
        tail = self._tail()
        if tail and not tail.endswith(("\n", " ")):
            self._emit(" ")

    def _break(self, *, blank: bool) -> None:
        self._pending_space = False
        tail = self._tail()
        if not tail.strip():
            return
        # A fresh list marker should keep its item text on the same line.
        if _MARKER_ONLY.match(tail.split("\n")[-1]):
            return
        if blank:
            if not tail.endswith("\n\n"):
                self._emit("\n" if tail.endswith("\n") else "\n\n")
        elif not tail.endswith("\n"):
            self._emit("\n")

    def _open_marker(self, marker: str) -> None:
        self._flush_space()
        self._markers.append(marker)
        self._emit(marker)

    def _close_marker(self, marker: str) -> None:
        if marker not in self._markers:
            return
        while self._markers and self._markers[-1] != marker:
            self._emit(self._markers.pop())
        if self._markers and self._markers[-1] == marker:
            self._markers.pop()
            self._emit(marker)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in _SKIP_TAGS:
            self._skip += 1
            return
        if self._skip:
            return
        attr = {key.lower(): value or "" for key, value in attrs}
        if tag in _BOLD_TAGS:
            self._open_marker("**")
        elif tag in _ITALIC_TAGS:
            self._open_marker("*")
        elif tag == "br":
            self._pending_space = False
            self._emit("\n")
        elif tag in _HEADING_TAGS:
            level = min(int(tag[1]), 3)
            self._break(blank=True)
            self._emit(f"{'#' * level} ")
        elif tag == "p":
            self._break(blank=not self._lists)
        elif tag in {"div", "blockquote", "section", "article", "tr"}:
            if not self._lists:
                self._break(blank=False)
        elif tag in {"ul", "ol"}:
            self._break(blank=not self._lists)
            start = 1
            if tag == "ol":
                try:
                    start = int(attr.get("start") or "1")
                except ValueError:
                    start = 1
            self._lists.append({"kind": tag, "n": start - 1})
        elif tag == "li":
            if not self._lists:
                self._lists.append({"kind": "ul", "n": 0})
            self._break(blank=False)
            current = self._lists[-1]
            indent = "  " * (len(self._lists) - 1)
            if current["kind"] == "ol":
                current["n"] += 1
                marker = f"{current['n']}. "
            else:
                marker = "- "
            self._emit(f"{indent}{marker}")
        elif tag == "a" and self._anchor is None:
            href = attr.get("href", "").strip()
            if _SAFE_HREF.match(href):
                self._flush_space()
                self._anchor = []
                self._anchor_href = href
        elif tag == "img":
            alt = attr.get("alt", "").strip()
            if alt:
                self._flush_space()
                self._emit(alt)
                self._pending_space = True

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in _SKIP_TAGS and self._skip:
            self._skip -= 1
            return
        if self._skip:
            return
        if tag in _BOLD_TAGS:
            self._close_marker("**")
        elif tag in _ITALIC_TAGS:
            self._close_marker("*")
        elif tag in {"ul", "ol"} and self._lists:
            self._lists.pop()
            self._break(blank=not self._lists)
        elif tag == "a" and self._anchor is not None:
            label = "".join(self._anchor).strip()
            href = self._anchor_href
            self._anchor = None
            self._anchor_href = None
            if label and href:
                self._emit(f"[{label}]({href})")
            elif label:
                self._emit(label)
        elif tag in {"p", *_HEADING_TAGS} and not self._lists:
            self._break(blank=True)
        elif tag in {"div", "blockquote", "section", "article"} and not self._lists:
            self._break(blank=False)

    def handle_data(self, data: str) -> None:
        if self._skip or not data:
            return
        text = data.replace("\u00a0", " ").replace("\u200b", "")
        text = re.sub(r"\s+", " ", text)
        if not text.strip():
            if self._tail() and not self._tail().endswith("\n"):
                self._pending_space = True
            return
        if text.startswith(" "):
            self._pending_space = True
        self._flush_space()
        self._emit(text.strip())
        if text.endswith(" "):
            self._pending_space = True


def _normalize_plain(text: str) -> str:
    text = (
        text.replace("\u2010", "-")
        .replace("\u2011", "-")
        .replace("\u2012", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\u2212", "-")
    )
    text = text.replace(":", " ")
    text = re.sub(r"(?m)^#{1,6}\s*", "", text)
    text = re.sub(r"(?m)^\s*\d+[.)]\s+", "", text)
    text = re.sub(r"(?m)^\s*[-*+]\s+", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[*_`]+", "", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def _clean_heading(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().rstrip(":").strip()


def _compatible(rich: str, plain: str) -> bool:
    """True when formatted text is the same copy as the flattened field."""
    rich_plain = _normalize_plain(rich)
    plain_plain = _normalize_plain(plain)
    if len(rich_plain) < 4:
        return False
    if not plain_plain:
        return True
    return rich_plain[:24] in plain_plain or plain_plain[:24] in rich_plain


def _starts_like_list(text: str) -> bool:
    return bool(_LIST_START.match(text))


def _number_step(number: int, markdown: str) -> str:
    stripped = markdown.strip()
    if not stripped:
        return ""
    first, *rest = stripped.split("\n")
    if _starts_like_list(first):
        return stripped
    numbered = f"{number}. {first}"
    if rest:
        return "\n".join([numbered, *rest])
    return numbered


def _schema_description(schema: dict[str, Any] | None) -> str | None:
    if not isinstance(schema, dict):
        return None
    raw = schema.get("description")
    if isinstance(raw, list):
        raw = raw[0] if raw else ""
    if not isinstance(raw, str) or not contains_markup(raw):
        return None
    text = html_to_markdown(raw).strip()
    return text or None


def schema_instructions_to_markdown(raw: Any) -> str:
    lines: list[str] = []
    counter = 0

    def append_step(text: str) -> None:
        nonlocal counter
        body = text.strip()
        if not body:
            return
        first = body.split("\n", 1)[0]
        if "\n" in body and _starts_like_list(first):
            lines.append(body)
            return
        if _starts_like_list(first):
            lines.append(body)
            return
        counter += 1
        lines.append(_number_step(counter, body))

    def walk(node: Any) -> None:
        if isinstance(node, str):
            append_step(html_to_markdown(node))
            return
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        kind = str(node.get("@type") or "")
        name = node.get("name")
        children = node.get("itemListElement")
        if kind == "HowToSection":
            heading = _clean_heading(html_to_markdown(str(name or "")))
            if heading:
                if lines and lines[-1] != "":
                    lines.append("")
                lines.append(f"## {heading}")
                lines.append("")
            for item in children or []:
                walk(item)
            return
        if children:
            heading = _clean_heading(html_to_markdown(str(name))) if name else ""
            if heading:
                if lines and lines[-1] != "":
                    lines.append("")
                lines.append(f"## {heading}")
                lines.append("")
            for item in children:
                walk(item)
            return
        text = node.get("text")
        if not text:
            return
        body = html_to_markdown(str(text)).strip()
        if name and body and not str(text).startswith(str(name).rstrip(".")):
            label = html_to_markdown(str(name)).strip()
            if label and label not in body:
                body = f"**{label}.** {body}"
        append_step(body)

    walk(raw)
    return "\n".join(lines).strip()


def _element_markdown(element) -> str:
    return html_to_markdown(element.decode_contents()).strip()


def _html_description(soup: BeautifulSoup) -> str | None:
    for selector in (
        ".wprm-recipe-summary",
        ".tasty-recipes-description-body",
        ".tasty-recipes-description",
        ".mv-create-description",
    ):
        element = soup.select_one(selector)
        if element is None:
            continue
        text = _element_markdown(element)
        if text:
            return text
    return None


def _html_instructions(soup: BeautifulSoup) -> str | None:
    grouped = _wprm_groups(soup)
    if grouped:
        return grouped
    steps = soup.select(".wprm-recipe-instruction-text")
    if steps:
        lines = []
        number = 0
        for step in steps:
            text = _element_markdown(step)
            if not text:
                continue
            number += 1
            lines.append(_number_step(number, text))
        if lines:
            return "\n".join(lines).strip()
    for selector in (
        ".tasty-recipes-instructions-body",
        ".tasty-recipes-instructions",
        ".mv-create-instructions",
    ):
        element = soup.select_one(selector)
        if element is None or not contains_markup(str(element)):
            continue
        text = _element_markdown(element)
        if text:
            return text
    return None


def _wprm_groups(soup: BeautifulSoup) -> str | None:
    groups = soup.select(".wprm-recipe-instruction-group")
    if not groups:
        return None
    lines: list[str] = []
    number = 0
    found = False
    for group in groups:
        title_el = group.select_one(
            ".wprm-recipe-instruction-group-name, "
            ".wprm-recipe-instruction-group-title"
        )
        title = ""
        if title_el is not None:
            title = _clean_heading(_element_markdown(title_el))
        if title:
            number = 0
            if lines and lines[-1] != "":
                lines.append("")
            lines.append(f"## {title}")
            lines.append("")
        for step in group.select(".wprm-recipe-instruction-text"):
            text = _element_markdown(step)
            if not text:
                continue
            found = True
            number += 1
            lines.append(_number_step(number, text))
    if not found:
        return None
    return "\n".join(lines).strip()


def _html_notes(soup: BeautifulSoup) -> str | None:
    for selector in (
        ".wprm-recipe-notes",
        ".tasty-recipes-notes-body",
        ".tasty-recipes-notes",
        ".mv-create-notes",
    ):
        element = soup.select_one(selector)
        if element is None:
            continue
        text = _element_markdown(element)
        text = re.sub(
            r"^#{1,3}\s+notes\s*\n+", "", text, count=1, flags=re.IGNORECASE
        ).strip()
        if text:
            return text[:12000]
    return None


def enrich_recipe_text(
    *,
    soup: BeautifulSoup | None,
    schema: dict[str, Any] | None,
    description: str,
    instructions: str,
) -> tuple[str, str, str | None]:
    """Prefer formatted Markdown when it matches the scraped plain text."""
    rich_description = _schema_description(schema)
    schema_instructions = None
    raw_instructions = None
    if isinstance(schema, dict):
        raw_instructions = schema.get("recipeInstructions") or schema.get(
            "RecipeInstructions"
        )
    # Structured HowTo sections are useful even when the step text is plain.
    if isinstance(raw_instructions, (list, dict)) or contains_markup(raw_instructions):
        schema_instructions = schema_instructions_to_markdown(raw_instructions) or None

    html_instructions = None
    if soup is not None:
        if not rich_description:
            candidate = _html_description(soup)
            if candidate and _compatible(candidate, description):
                rich_description = candidate
        candidate = _html_instructions(soup)
        if candidate and _compatible(candidate, instructions):
            html_instructions = candidate
        notes = _html_notes(soup)
    else:
        notes = None

    # The visible card keeps bold step labels. Schema sections are the fallback.
    rich_instructions = html_instructions or schema_instructions

    return (
        (rich_description or description).strip(),
        (rich_instructions or instructions).strip(),
        notes,
    )

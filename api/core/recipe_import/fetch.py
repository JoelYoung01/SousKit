"""Fetch public recipe pages with basic SSRF protections."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from api.core.logging import logger

MAX_HTML_BYTES = 2_000_000
FETCH_TIMEOUT = 20.0
MAX_REDIRECTS = 5

# Browser-like UA — many recipe CDNs return 402/403 to overt bot strings.
_USER_AGENT = (
    "Mozilla/5.0 (compatible; SousKit/1.0; +https://github.com/JoelYoung01/RecipeDB) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# Social / short-video hosts — not supported in v1 (no reliable recipe HTML).
_UNSUPPORTED_HOST_SUFFIXES = (
    "instagram.com",
    "instagr.am",
    "tiktok.com",
    "vm.tiktok.com",
    "facebook.com",
    "fb.watch",
    "fb.com",
    "youtube.com",
    "youtu.be",
    "m.youtube.com",
    "shorts.youtube.com",
    "pinterest.com",
    "pin.it",
    "x.com",
    "twitter.com",
    "threads.net",
)


class RecipeImportError(Exception):
    """User-facing import failure."""

    def __init__(self, message: str, *, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _host_matches_suffix(host: str, suffix: str) -> bool:
    host = host.lower().rstrip(".")
    suffix = suffix.lower().rstrip(".")
    return host == suffix or host.endswith("." + suffix)


def assert_supported_recipe_url(url: str) -> str:
    """Validate URL shape and reject known video/social hosts."""
    raw = (url or "").strip()
    if not raw:
        raise RecipeImportError("Paste a recipe URL to import.")

    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise RecipeImportError("URL must start with http:// or https://.")
    if not parsed.netloc:
        raise RecipeImportError("That doesn’t look like a valid URL.")

    host = (parsed.hostname or "").lower()
    if not host:
        raise RecipeImportError("That doesn’t look like a valid URL.")

    for suffix in _UNSUPPORTED_HOST_SUFFIXES:
        if _host_matches_suffix(host, suffix):
            raise RecipeImportError(
                "Importing from social video apps isn’t supported yet. "
                "Try a recipe website link instead (Allrecipes, NYT Cooking, "
                "blogs with a written recipe, etc.)."
            )

    return raw


def _is_bad_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def host_is_blocked_literal(hostname: str) -> bool:
    """True for localhost and literal private IPs. Does not resolve DNS."""
    host = (hostname or "").lower().rstrip(".")
    if not host:
        return True
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return _is_bad_ip(ip)


def _assert_public_host(hostname: str) -> None:
    host = hostname.lower().rstrip(".")
    if host_is_blocked_literal(host):
        raise RecipeImportError("That URL can’t be used.")

    try:
        # Prefer getaddrinfo so we catch every resolved address family.
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise RecipeImportError(
            "We couldn’t reach that website. Check the link and try again."
        ) from exc

    if not infos:
        raise RecipeImportError(
            "We couldn’t reach that website. Check the link and try again."
        )

    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if _is_bad_ip(ip):
            raise RecipeImportError("That URL can’t be used.")


def assert_public_http_url(url: str) -> str:
    """Validate an http(s) URL. Social hosts are allowed; localhost is not."""
    raw = (url or "").strip()
    if not raw:
        raise RecipeImportError("Enter a URL.")
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise RecipeImportError("URL must start with http:// or https://.")
    if not parsed.hostname:
        raise RecipeImportError("That doesn’t look like a valid URL.")
    if host_is_blocked_literal(parsed.hostname):
        raise RecipeImportError("That URL can’t be used.")
    return raw


def fetch_public_html(url: str, *, timeout: float = 8.0) -> tuple[str, str]:
    """Download HTML for a source link. Returns ``(final_url, html)``."""
    return _download_html(assert_public_http_url(url), timeout=timeout)


def fetch_recipe_html(url: str) -> tuple[str, str]:
    """Download HTML for a recipe import. Returns ``(final_url, html)``."""
    return _download_html(assert_supported_recipe_url(url), timeout=FETCH_TIMEOUT)


def _download_html(safe_url: str, *, timeout: float) -> tuple[str, str]:
    current = safe_url

    with httpx.Client(
        timeout=timeout,
        follow_redirects=False,
        headers={
            "User-Agent": _USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.8",
        },
    ) as client:
        for _ in range(MAX_REDIRECTS + 1):
            parsed = urlparse(current)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                raise RecipeImportError("That URL can’t be used.")
            _assert_public_host(parsed.hostname)

            try:
                response = client.get(current)
            except httpx.HTTPError as exc:
                logger.info("Recipe import fetch failed for %s: %s", current, exc)
                raise RecipeImportError(
                    "We couldn’t download that page. Check the link and try again."
                ) from exc

            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise RecipeImportError(
                        "That website returned a redirect we couldn’t follow."
                    )
                current = str(httpx.URL(current).join(location))
                continue

            if response.status_code >= 400:
                raise RecipeImportError(
                    f"That website returned an error ({response.status_code}). "
                    "Try a different recipe link."
                )

            content_type = (response.headers.get("content-type") or "").lower()
            if content_type and not any(
                part in content_type
                for part in ("text/html", "application/xhtml", "text/plain", "text/")
            ):
                raise RecipeImportError(
                    "That link doesn’t look like a recipe web page."
                )

            content = response.content[: MAX_HTML_BYTES + 1]
            if len(content) > MAX_HTML_BYTES:
                raise RecipeImportError(
                    "That page is too large to import. Try a simpler recipe URL."
                )

            html = content.decode(response.encoding or "utf-8", errors="replace")
            return str(response.url), html

    raise RecipeImportError("Too many redirects while loading that page.")

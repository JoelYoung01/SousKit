"""Parse free-text recipe ingredient lines into structured fields."""

from __future__ import annotations

import html as html_lib
import re
from typing import Any

# Common culinary units (singular + plural / abbreviations).
_UNITS = (
    r"teaspoons?",
    r"tablespoons?",
    r"tsp\.?",
    r"tbsp\.?",
    r"tbs\.?",
    r"cups?",
    r"c\.?",
    r"ounces?",
    r"oz\.?",
    r"pounds?",
    r"lbs?\.?",
    r"grams?",
    r"kilograms?",
    r"g\.?",
    r"kg\.?",
    r"milliliters?",
    r"liters?",
    r"ml\.?",
    r"l\.?",
    r"fluid ounces?",
    r"fl\.?\s*oz\.?",
    r"pints?",
    r"quarts?",
    r"gallons?",
    r"cloves?",
    r"slices?",
    r"pieces?",
    r"pinch(?:es)?",
    r"dashes?",
    r"cans?",
    r"packages?",
    r"pkg\.?",
    r"bunch(?:es)?",
    r"heads?",
    r"stalks?",
    r"sprigs?",
    r"leaves?",
    r"sheets?",
    r"sticks?",
    r"cubes?",
    r"handfuls?",
    r"litres?",
    r"liters?",
    r"quarts?",
    r"centimetres?",
    r"centimeters?",
    r"cm\.?",
    r"millimetres?",
    r"millimeters?",
    r"mm\.?",
    r"inches?",
    r"inch",
)

_UNIT_RE = "|".join(_UNITS)

# 1, 1/2, 1½, 1 1/2, 2.5, .5, 1-2
_AMOUNT_RE = (
    r"(?P<amount>"
    r"\d+\s+\d+\s*/\s*\d+"  # 1 1/2
    r"|\d+\s*/\s*\d+"  # 1/2
    r"|\d*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]"  # unicode fractions / mixed
    r"|\d+(?:\.\d+)?"  # 2 or 2.5
    r"|\.\d+"  # .5
    r"|\d+\s*-\s*\d+"  # 2-3
    r")"
)

_LINE_RE = re.compile(
    rf"^\s*{_AMOUNT_RE}" rf"(?:\s*(?P<units>{_UNIT_RE}))?" rf"(?:\s+(?P<rest>.+))?$",
    re.IGNORECASE,
)

_UNICODE_FRACTIONS = {
    "½": 0.5,
    "⅓": 1 / 3,
    "⅔": 2 / 3,
    "¼": 0.25,
    "¾": 0.75,
    "⅕": 0.2,
    "⅖": 0.4,
    "⅗": 0.6,
    "⅘": 0.8,
    "⅙": 1 / 6,
    "⅚": 5 / 6,
    "⅛": 0.125,
    "⅜": 0.375,
    "⅝": 0.625,
    "⅞": 0.875,
}

# Normalize unit display to short forms when obvious.
_UNIT_NORMALIZE = {
    "teaspoon": "tsp",
    "teaspoons": "tsp",
    "tsp.": "tsp",
    "tablespoon": "tbsp",
    "tablespoons": "tbsp",
    "tbsp.": "tbsp",
    "tbs": "tbsp",
    "tbs.": "tbsp",
    "cup": "cup",
    "cups": "cups",
    "c.": "cup",
    "ounce": "oz",
    "ounces": "oz",
    "oz.": "oz",
    "pound": "lb",
    "pounds": "lb",
    "lb.": "lb",
    "lbs": "lb",
    "lbs.": "lb",
    "gram": "g",
    "grams": "g",
    "g.": "g",
    "kilogram": "kg",
    "kilograms": "kg",
    "kg.": "kg",
    "milliliter": "ml",
    "milliliters": "ml",
    "ml.": "ml",
    "liter": "l",
    "liters": "l",
    "l.": "l",
    "clove": "cloves",
    "cloves": "cloves",
    "package": "package",
    "packages": "packages",
    "pkg.": "package",
    "pkg": "package",
}


def parse_amount(raw: str) -> float | None:
    """Convert a quantity token to float. Ranges use the lower bound."""
    text = (raw or "").strip().lower().replace(" ", "")
    if not text:
        return None

    # Range like 2-3 → take first
    if "-" in text and "/" not in text:
        text = text.split("-", 1)[0]

    # Mixed unicode: 1½
    if len(text) >= 2 and text[-1] in _UNICODE_FRACTIONS and text[:-1].isdigit():
        return float(text[:-1]) + _UNICODE_FRACTIONS[text[-1]]

    if text in _UNICODE_FRACTIONS:
        return _UNICODE_FRACTIONS[text]

    # Mixed ascii: 1 1/2 (spaces already stripped → 11/2 is wrong). Re-parse original.
    spaced = (raw or "").strip()
    mixed = re.match(r"^(\d+)\s+(\d+)\s*/\s*(\d+)$", spaced)
    if mixed:
        whole, num, den = mixed.groups()
        den_f = float(den)
        if den_f == 0:
            return None
        return float(whole) + float(num) / den_f

    frac = re.match(r"^(\d+)\s*/\s*(\d+)$", spaced)
    if frac:
        num, den = frac.groups()
        den_f = float(den)
        if den_f == 0:
            return None
        return float(num) / den_f

    try:
        return float(text)
    except ValueError:
        return None


# A second measurement after " / ", including lengths RecipeTin writes as 5cm/2".
# Atomic so "3/4 tsp" stays one fraction and is not split on the slash.
_NUM = (
    r"(?>"
    r"\d+\s+\d+\s*/\s*\d+"
    r"|\d+\s*/\s*\d+"
    r"|\d*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]"
    r"|\d+(?:\.\d+)?"
    r"|\.\d+"
    r")"
)
_MEASURE_UNIT = (
    r"(?:fluid\s+ounces?|fl\.?\s*oz\.?|"
    r"tablespoons?|teaspoons?|tbsp\.?|tsp\.?|"
    r"kilograms?|kg|grams?|"
    r"pounds?|lbs?\.?|ounces?|oz\.?|"
    r"millilitres?|milliliters?|ml|"
    r"litres?|liters?|"
    r"quarts?|pints?|gallons?|cups?|"
    r"centimetres?|centimeters?|cm|"
    r"millimetres?|millimeters?|mm|"
    r"inches?|inch|"
    r"[\"″”]|"
    # Bare letters last so "kg" and "ml" win over "g" and "l".
    r"g|l"
    r")"
)
_MEASURE = rf"(?P<num>{_NUM})(?:\s*(?P<unit>{_MEASURE_UNIT}))?"
_DUAL_PREFIX = re.compile(
    rf"^\s*{_MEASURE}\s*/\s*(?P<num2>{_NUM})"
    rf"(?:\s*(?P<unit2>{_MEASURE_UNIT}))?"
    rf"(?:\s+(?P<rest>\S.*))?$",
    re.IGNORECASE,
)
_QUALIFIED_UNIT = re.compile(
    r"^(?P<unit>(?:small|medium|large)\s+"
    r"(?:bunch(?:es)?|handfuls?|pinch(?:es)?|sprigs?|stalks?|heads?|"
    r"cans?|pieces?))\s+(?P<rest>.+)$",
    re.IGNORECASE,
)
# Count words that are the ingredient when nothing follows ("4 cloves").
_COUNT_AS_NAME = {
    "clove",
    "cloves",
    "leaf",
    "leaves",
    "slice",
    "slices",
    "piece",
    "pieces",
    "stick",
    "sticks",
    "sheet",
    "sheets",
    "sprig",
    "sprigs",
}
_PREP_TAIL = re.compile(
    r"^(?:bone[\s-]?in|skin[\s-]?on|halved|quartered|sliced|finely|roughly|"
    r"thin(?:ly)?|thick(?:ly)?|minced|chopped|diced|crushed|grated|peeled|"
    r"optional|to taste|plus\b|or\b|about\b|approx|softened|melted|divided|"
    r"packed|freshly|cut\b|trimmed|seeded|deveined|room temperature|"
    r"at room|for garnish|for serving|to garnish|preferably|such as|"
    r"\w+ed\b)",
    re.IGNORECASE,
)
_DETAILS_LIMIT = 400


def _display_unit(raw: str | None) -> str | None:
    if not raw:
        return None
    text = raw.strip()
    if text in {'"', "″", "”"}:
        return "in"
    key = text.lower().rstrip(".")
    mapped = _UNIT_NORMALIZE.get(key)
    if mapped:
        return mapped
    return text or None


def _format_measure(num_raw: str, unit_raw: str | None) -> str:
    number = re.sub(r"\s+", " ", num_raw or "").strip()
    unit = (unit_raw or "").strip()
    if unit in {'"', "″", "”"}:
        return f'{number}"'
    shown = _display_unit(unit) if unit else None
    if shown:
        return f"{number} {shown}"
    return number


def _join_details(*parts: str | None) -> str | None:
    bits: list[str] = []
    for part in parts:
        text = (part or "").strip(" ;,")
        if text:
            bits.append(text)
    if not bits:
        return None
    return "; ".join(bits)[:_DETAILS_LIMIT]


def _unwrap_parens(text: str) -> str:
    value = text.strip()
    while value.startswith("(") and value.endswith(")"):
        depth = 0
        wraps_all = True
        for index, char in enumerate(value):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and index != len(value) - 1:
                    wraps_all = False
                    break
        if not wraps_all or depth != 0:
            break
        value = value[1:-1].strip()
    return value


def _peel_trailing_paren(text: str) -> tuple[str, str | None]:
    """Split 'oil (vegetable or canola (or other))' without eating inner parens."""
    value = text.strip()
    if not value.endswith(")"):
        return value, None
    depth = 0
    start = None
    for index in range(len(value) - 1, -1, -1):
        char = value[index]
        if char == ")":
            depth += 1
        elif char == "(":
            depth -= 1
            if depth == 0:
                start = index
                break
    if start is None or start == 0:
        return value, None
    name = value[:start].strip().rstrip(",").strip()
    inner = _unwrap_parens(value[start + 1 : -1])
    if not name or not inner:
        return value, None
    return name, inner


def _split_prep_clause(text: str) -> tuple[str, str | None]:
    for sep in (" — ", " – ", " - "):
        if sep in text:
            name, details = text.split(sep, 1)
            name = name.strip()
            details = details.strip(" ,")
            if name and details:
                return name, details
    if "," in text:
        name, details = text.split(",", 1)
        name = name.strip()
        details = details.strip()
        # "Thai Basil, mint, coriander" stays one ingredient. "garlic, minced" splits.
        if name and details and _PREP_TAIL.match(details):
            return name, details
    return text, None


def _clean_group(text: str) -> str | None:
    cleaned = re.sub(r"\s+", " ", text or "").strip().rstrip(":").strip()
    return cleaned[:80] or None


def _split_name_details(rest: str) -> tuple[str, str | None]:
    text = re.sub(r"\s+", " ", rest).strip().strip(",").strip()
    text = re.sub(r"\(\s*,\s*", "(", text)
    if not text:
        return "ingredient", None

    name, paren_details = _peel_trailing_paren(text)
    name, prep_details = _split_prep_clause(name)
    return name or "ingredient", _join_details(prep_details, paren_details)


def _row(
    name: str,
    amount: float | None,
    units: str | None,
    details: str | None,
    group_name: str | None = None,
) -> dict[str, Any]:
    return {
        "name": (name or "ingredient").strip()[:200] or "ingredient",
        "amount": amount,
        "units": units[:40] if units else None,
        "details": details[:_DETAILS_LIMIT] if details else None,
        "group_name": group_name[:80] if group_name else None,
    }


def _apply_qualified_unit(rest: str, units: str | None) -> tuple[str, str | None]:
    if units or not rest:
        return rest, units
    qualified = _QUALIFIED_UNIT.match(rest)
    if not qualified:
        return rest, units
    return qualified.group("rest").strip(), _display_unit(qualified.group("unit"))


def parse_ingredient_line(line: str) -> dict[str, Any]:
    """Parse one ingredient line into name / amount / units / details."""
    cleaned = html_lib.unescape(line or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.lstrip("-•*☐▢").strip()
    cleaned = re.sub(r"\(\s*,\s*", "(", cleaned)
    if not cleaned:
        return _row("ingredient", None, None, None)

    dual = _DUAL_PREFIX.match(cleaned)
    if dual and (dual.group("unit") or dual.group("unit2")):
        amount = parse_amount(dual.group("num") or "")
        units = _display_unit(dual.group("unit"))
        alternate = _format_measure(dual.group("num2") or "", dual.group("unit2"))
        rest = (dual.group("rest") or "").strip()
        if not rest:
            return _row(cleaned, amount, units, _join_details(f"or {alternate}"))
        name, details = _split_name_details(rest)
        return _row(name, amount, units, _join_details(f"or {alternate}", details))

    match = _LINE_RE.match(cleaned)
    if not match:
        name, details = _split_name_details(cleaned)
        return _row(name, None, None, details)

    amount = parse_amount(match.group("amount") or "")
    units_raw = (match.group("units") or "").strip()
    units = _UNIT_NORMALIZE.get(units_raw.lower(), units_raw or None)
    if units == "":
        units = None

    rest = (match.group("rest") or "").strip()
    rest, units = _apply_qualified_unit(rest, units)
    if not rest:
        # "4 cloves" is the spice. "2 cups" with no name keeps the raw line.
        if units and units.lower() in _COUNT_AS_NAME:
            return _row(units, amount, None, None)
        return _row(cleaned, amount, units, None)

    # Leading parenthetical size: "1 (14 oz) can diced tomatoes"
    leading_paren = re.match(
        r"^\((?P<details>[^)]+)\)\s+(?P<rest>.+)$",
        rest,
    )
    if leading_paren:
        size_detail = leading_paren.group("details").strip()
        after = leading_paren.group("rest").strip()
        container = re.match(
            r"^(?P<container>cans?|packages?|jars?|bottles?|boxes?|bags?|pkg\.?)\s+"
            r"(?P<name>.+)$",
            after,
            re.IGNORECASE,
        )
        if container and not units:
            name, details = _split_name_details(container.group("name"))
            cont = container.group("container").rstrip(".").lower()
            if cont.startswith("pkg"):
                cont = "package"
            return _row(
                name,
                amount,
                cont,
                _join_details(size_detail, details),
            )
        name, details = _split_name_details(after)
        return _row(name, amount, units, _join_details(size_detail, details))

    name, details = _split_name_details(rest)
    return _row(name, amount, units, details)


def _ingredient_from_wprm_li(li, group_name: str | None) -> dict[str, Any] | None:
    def span_text(class_name: str) -> str:
        element = li.select_one(f".{class_name}")
        if element is None:
            return ""
        return re.sub(r"\s+", " ", element.get_text(" ", strip=True)).strip()

    amount_raw = span_text("wprm-recipe-ingredient-amount")
    unit_raw = span_text("wprm-recipe-ingredient-unit")
    name_raw = span_text("wprm-recipe-ingredient-name")
    notes_raw = span_text("wprm-recipe-ingredient-notes")
    if not name_raw and not amount_raw:
        return None

    amount = None
    units = _display_unit(unit_raw)
    alternate = None
    quantity = amount_raw
    if quantity:
        parsed = parse_ingredient_line(quantity)
        # A bare quantity span ("1.5 kg / 3 lb" or "3/4") has no ingredient name.
        if parsed["name"] == quantity or _DUAL_PREFIX.match(quantity):
            amount = parsed["amount"]
            if parsed["units"]:
                units = parsed["units"]
            alternate = parsed["details"]
        else:
            amount = parsed["amount"]
            if parsed["units"] and not units:
                units = parsed["units"]

    if unit_raw and not units:
        units = _display_unit(unit_raw)
    if name_raw and not units:
        name_raw, pulled = _apply_qualified_unit(name_raw, None)
        if pulled:
            units = pulled

    name, name_details = (
        _split_name_details(name_raw) if name_raw else ("ingredient", None)
    )
    note = (
        _unwrap_parens(re.sub(r"^[,\s]+", "", notes_raw).strip()) if notes_raw else ""
    )
    note = note.strip(" ,;")
    return _row(
        name,
        amount,
        units,
        _join_details(alternate, name_details, note or None),
        group_name,
    )


def ingredients_from_html(soup) -> list[dict[str, Any]] | None:
    """Read WP Recipe Maker ingredient groups, including dual measurements."""
    if soup is None:
        return None
    groups = soup.select(".wprm-recipe-ingredient-group")
    rows: list[dict[str, Any]] = []
    if groups:
        for group in groups:
            title_el = group.select_one(
                ".wprm-recipe-ingredient-group-name, .wprm-recipe-group-name"
            )
            group_name = _clean_group(
                title_el.get_text(" ", strip=True) if title_el is not None else ""
            )
            for item in group.select("li.wprm-recipe-ingredient"):
                row = _ingredient_from_wprm_li(item, group_name)
                if row and row["name"] and row["name"] != "ingredient":
                    rows.append(row)
    else:
        for item in soup.select("li.wprm-recipe-ingredient"):
            row = _ingredient_from_wprm_li(item, None)
            if row and row["name"] and row["name"] != "ingredient":
                rows.append(row)
    return rows or None

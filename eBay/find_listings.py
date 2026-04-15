#!/usr/bin/env python3
"""
Search eBay (Browse API) by catalog number (Scott-style) + optional subject.

Query text: US uses ``{country} Scott {num} …``; other countries use
``{country} {num} …`` (no ``Scott``), closer to the main site search.

By default the request does not send ``filter`` or ``sort`` (broad). Pass
``--filter`` (e.g. fixed price + used) to narrow to competitor-style listings.

Results include ``shipping_cost`` from each summary, prefer titles that mention
SCV / catalog value (``--no-scv-priority`` to disable), and drop mixed lots /
multi-number listings by heuristic (``--include-multi-stamp`` to keep them).

Item aspect **Quality** (e.g. Used) is applied via Browse ``aspect_filter``, not
``q``: use ``--quality-used`` (requires a single ``category_ids``). Override with
``--aspect-filter`` (same format as eBay docs: ``categoryId:ID,Aspect:{Value}``).

``category_ids`` defaults from ``country`` using ``ebay_category`` on each
``country`` row in ``xframe/output/consolidated_data.json`` (see xFrame model
``country.ebay_category``). If the file is missing, the country is unknown, or
there is no ``ebay_category``, ``category_ids`` is omitted (same effect as
``--all-categories`` for that search). Override with ``--category-id`` or pass
an explicit value; use ``--all-categories`` to skip ``category_ids`` always.

Search requests use ``fieldgroups=FULL,EXTENDED,MATCHING_ITEMS`` when a single
``category_ids`` is sent (per Browse API rules), so responses can include a
``refinement`` block plus extended fields on each ``itemSummaries`` entry.

OAuth: token.txt must contain a line:
  eBay: <access_token>

Use a Buy API **access** token for ``api.ebay.com`` (not refresh-token payloads).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Sequence
from pathlib import Path
from urllib.parse import quote

import requests

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TOKEN_FILE = REPO_ROOT / "token.txt"
DEFAULT_CONSOLIDATED_DATA = REPO_ROOT / "xframe" / "output" / "consolidated_data.json"
BROWSE_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
BROWSE_ITEM_ROOT = "https://api.ebay.com/buy/browse/v1/item"

# ``find_competitor_listings(..., category_ids=...)`` default: pick from country
_AUTO_CATEGORY_IDS = object()
# Pass this as ``category_ids`` to omit the ``category_ids`` query parameter
OMIT_CATEGORY_FILTER = object()


def load_ebay_token(token_path: Path) -> str:
    """Read the bearer token from the line ``eBay: ...`` in token.txt."""
    if not token_path.is_file():
        raise FileNotFoundError(f"Token file not found: {token_path}")

    text = token_path.read_text(encoding="utf-8")
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.lower().startswith("ebay:"):
            token = line.split(":", 1)[1].strip()
            if not token:
                raise ValueError(f"Empty token after 'eBay:' in {token_path}")
            return token

    raise ValueError(
        f"No line starting with 'eBay:' in {token_path}. "
        "Add: eBay: <your_oauth_access_token>"
    )


def _norm_country(country: str | None) -> str:
    s = (country or "").strip()
    return s if s else "US"


# ``Path.resolve()`` string → parsed ``data.country`` bundle (eBay categories + name resolution)
_COUNTRY_BUNDLE_CACHE: dict[str, dict[str, object]] = {}

_UK_DISPLAY_ALIASES = frozenset(
    {
        "uk",
        "united kingdom",
        "great britain",
        "britain",
        "england",
        "northern ireland",
    }
)


def _country_rows_from_consolidated(path: Path) -> list[dict]:
    """Return ``data.country`` rows from consolidated JSON (dict or list layout)."""
    if not path.is_file():
        return []
    try:
        root = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    block = (root.get("data") or {}).get("country")
    if isinstance(block, dict):
        return [v for v in block.values() if isinstance(v, dict)]
    if isinstance(block, list):
        return [x for x in block if isinstance(x, dict)]
    return []


def _get_country_bundle(path: Path) -> dict[str, object]:
    """
    Cached parse of ``data.country``: ``ebay`` id→category, ``iso_by_id`` id→ISO2,
    ``display_to_id`` normalized ``display_name``→``country_id`` (lower).
    """
    key = str(path.resolve())
    if key in _COUNTRY_BUNDLE_CACHE:
        return _COUNTRY_BUNDLE_CACHE[key]
    rows = _country_rows_from_consolidated(path)
    ebay: dict[str, int] = {}
    iso_by_id: dict[str, str] = {}
    display_to_id: dict[str, str] = {}
    for row in rows:
        cid = str(row.get("country_id") or "").strip().lower()
        if not cid:
            continue
        iso_by_id[cid] = cid.upper()
        raw_ec = row.get("ebay_category")
        if raw_ec is not None:
            try:
                ebay[cid] = int(raw_ec)
            except (TypeError, ValueError):
                pass
        dn = row.get("display_name")
        if isinstance(dn, str) and dn.strip():
            nk = re.sub(r"\s+", " ", dn.strip()).lower()
            display_to_id[nk] = cid
    bundle: dict[str, object] = {"ebay": ebay, "iso_by_id": iso_by_id, "display_to_id": display_to_id}
    _COUNTRY_BUNDLE_CACHE[key] = bundle
    return bundle


def _ebay_category_map_for_path(path: Path) -> dict[str, int]:
    return dict(_get_country_bundle(path)["ebay"])  # type: ignore[arg-type]


def default_category_ids_for_country(
    country: str | None,
    *,
    consolidated_path: Path | None = None,
) -> str | None:
    """
    Resolve Browse ``category_ids`` from ``ebay_category`` in consolidated data.

    Matches ``country`` to ``data.country`` via ``country_id`` or
    ``display_name`` in consolidated data (same source as eBay categories).
    Returns ``None`` when no mapping exists.
    """
    path = consolidated_path if consolidated_path is not None else DEFAULT_CONSOLIDATED_DATA
    m = _ebay_category_map_for_path(path)
    if not m:
        return None
    iso = _country_to_iso2(_norm_country(country), consolidated_path=path)
    cid = iso.lower()
    if cid == "uk" and "gb" in m:
        return str(m["gb"])
    if cid in m:
        return str(m[cid])
    slug = _norm_country(country).strip().lower()
    if slug and slug in m:
        return str(m[slug])
    return None


def _browse_search_q(
    country_display: str,
    scott_number: str,
    subject: str,
    *,
    consolidated_path: Path | None = None,
) -> str:
    """
    Build ``q`` like the site search. US listings usually say ``Scott``; elsewhere
    use ``{country} {catalog#} …`` (e.g. ``Sweden O6``), not ``Sweden Scott O6``.
    """
    iso = _country_to_iso2(country_display, consolidated_path=consolidated_path)
    parts = [country_display.strip(), scott_number.strip()]
    if iso == "US":
        parts.insert(1, "Scott")
    sub = (subject or "").strip()
    if sub:
        parts.append(sub)
    return " ".join(parts)


def _country_to_iso2(country: str, *, consolidated_path: Path | None = None) -> str:
    """
    Map free-text ``country`` to ISO-3166 alpha-2 using ``data.country`` in
    consolidated data (``country_id`` and ``display_name``). Falls back to ``US``
    when unknown; two-letter input passes through if no consolidated file.
    """
    s = (country or "").strip()
    if not s:
        return "US"
    path = consolidated_path if consolidated_path is not None else DEFAULT_CONSOLIDATED_DATA
    b = _get_country_bundle(path)
    iso_by_id: dict[str, str] = b["iso_by_id"]  # type: ignore[assignment]
    display_to_id: dict[str, str] = b["display_to_id"]  # type: ignore[assignment]

    if not iso_by_id:
        u = s.upper()
        if len(u) == 2 and u.isalpha():
            return u
        return "US"

    sl = s.lower()
    if sl in iso_by_id:
        return iso_by_id[sl]

    u = s.upper()
    if len(u) == 2 and u.isalpha() and u.lower() in iso_by_id:
        return iso_by_id[u.lower()]

    nk = re.sub(r"\s+", " ", s).lower()
    if nk in display_to_id:
        cid = display_to_id[nk]
        return iso_by_id[cid]

    if nk in _UK_DISPLAY_ALIASES and "gb" in iso_by_id:
        return "GB"

    if len(u) == 2 and u.isalpha():
        return u

    return "US"


def _browse_aspect_filter_quality_used(category_ids_query: str | None) -> str | None:
    """
    Build Browse ``aspect_filter`` for stamp item aspect **Quality: Used**.

    eBay requires the same category id in ``category_ids`` and inside
    ``aspect_filter``; only a **single** id is supported (no comma list).
    """
    if not category_ids_query:
        return None
    s = str(category_ids_query).strip()
    if "," in s:
        return None
    if not s.isdigit():
        return None
    return f"categoryId:{s},Quality:{{Used}}"


def _category_ids_param(
    category_ids: str | int | Sequence[str | int] | None,
) -> str | None:
    """Return a comma-separated category_ids string for the API, or None to omit."""
    if category_ids is None:
        return None
    if isinstance(category_ids, (str, int)):
        s = str(category_ids).strip()
        return s if s else None
    parts = [str(x).strip() for x in category_ids if str(x).strip()]
    return ",".join(parts) if parts else None


_SCV_HINT = re.compile(
    r"(?i)\bscv\b|"
    r"\bscott\s+cat(?:alog)?\.?\s*val(?:ue)?\b|"
    r"\bcat(?:alog)?\.?\s*val(?:ue)?\s*\$|"
    r"\bcv\s*\$|"
    r"\bcat\s*\$\s*[\d,]+",  # e.g. ``cat $525``, ``cat $70``
)


def _scv_literal_in_title(title: str | None) -> bool:
    return bool(title and re.search(r"(?i)\bscv\b", title))


def _text_has_scv(title: str | None, short_description: str | None, specifics_blob: str = "") -> bool:
    """True if title / description / aspects mention Scott catalog value (SCV, etc.)."""
    blob = " ".join(
        x
        for x in (title or "", short_description or "", specifics_blob)
        if x
    )
    return bool(_SCV_HINT.search(blob))


_MULTI_STAMP_PHRASE = re.compile(
    r"(?i)\b("
    r"lot of|mixed lot|stamps lot|stamp lot|accumulation|assortment|"
    r"selection of|pack of|group of|complete set|set of\s*\d|"
    r"multiple\s+stamps"
    r")\b",
)


def _normalize_scott_token(s: str) -> str:
    t = s.strip().upper().replace(" ", "").replace("-", "")
    m = re.fullmatch(r"O(\d+)([A-Z]?)", t)
    if m:
        n, sfx = m.group(1), m.group(2)
        n_norm = str(int(n)) if n.isdigit() else n
        return f"O{n_norm}{sfx}"
    return t


def _extract_scott_like_tokens(text: str) -> set[str]:
    """Catalog tokens (e.g. O1, O6, 156) from listing text; used to detect multi-stamp lots."""
    if not text:
        return set()
    u = text.upper()
    found: set[str] = set()
    for m in re.finditer(r"(?i)(?:sc(?:ott)?\.?|#)\s*#?\s*(O\d+[A-Z]?)\b", u):
        found.add(_normalize_scott_token(m.group(1)))
    for m in re.finditer(r"(?i)(?:sc(?:ott)?\.?)\s*#?\s*(\d{1,4}[A-Z]?)\b", u):
        tok = _normalize_scott_token(m.group(1))
        if not tok.startswith("O"):
            found.add(tok)
    for m in re.finditer(r"(?i)#\s*(\d{1,4}[A-Z]?)\b", u):
        tok = _normalize_scott_token(m.group(1))
        if not tok.startswith("O"):
            found.add(tok)
    for m in re.finditer(r"(?i)\b(O\d+[A-Z]?)\b", u):
        found.add(_normalize_scott_token(m.group(1)))
    return {t for t in found if t}


def _is_probably_multi_stamp(
    title: str | None,
    short_description: str | None,
    sought_scott: str,
) -> bool:
    """
    Heuristic: drop lots / accumulations and listings that clearly pair several
    catalog numbers (e.g. ``#O1 #O3 #O6``) when searching for a single stamp.
    """
    t = f"{title or ''} {short_description or ''}"
    if _MULTI_STAMP_PHRASE.search(t):
        return True
    if t.count("#") >= 2:
        return True
    sought = _normalize_scott_token(sought_scott)
    tokens = {_normalize_scott_token(x) for x in _extract_scott_like_tokens(t)}
    tokens.discard(sought)
    if len(tokens) >= 1:
        return True
    # e.g. "O6, O8" without hashes
    if re.search(r"(?i)\bO\d+[A-Z]?\b\s*[,/&+]\s*\bO\d+[A-Z]?\b", t):
        ms = re.findall(r"(?i)\b(O\d+[A-Z]?)\b", t)
        uniq = {_normalize_scott_token(x) for x in ms}
        uniq.discard(sought)
        if len(uniq) >= 1:
            return True
    return False


def _shipping_cost_from_summary(item: dict) -> tuple[str | None, str | None]:
    """
    Best-effort shipping from Browse ``itemSummaries[].shippingOptions``.

    Returns ``(display_string, raw_type)`` e.g. ``("FREE", "FIXED")`` or
    ``("3.25 USD", "FIXED")``; both None if unknown / calculated-only.
    """
    opts = item.get("shippingOptions")
    if not isinstance(opts, list) or not opts:
        return None, None
    numeric: list[tuple[float, str, str]] = []
    for opt in opts:
        if not isinstance(opt, dict):
            continue
        typ = (opt.get("shippingCostType") or "").upper()
        sc = opt.get("shippingCost") or {}
        val, cur = sc.get("value"), sc.get("currency") or "USD"
        if typ == "FREE":
            return f"0.00 {cur}".strip(), "FREE"
        if val is None:
            continue
        try:
            v = float(str(val))
        except (TypeError, ValueError):
            continue
        if v == 0.0:
            return f"0.00 {cur}".strip(), typ or "FIXED"
        numeric.append((v, str(cur), typ or ""))
    if not numeric:
        for opt in opts:
            if isinstance(opt, dict) and (opt.get("shippingCostType") or "").upper() == "CALCULATED":
                return None, "CALCULATED"
        return None, None
    best = min(numeric, key=lambda x: x[0])
    return f"{best[0]:.2f} {best[1]}".strip(), best[2]


def _search_allows_extended_fieldgroup(category_ids_query_value: str | None) -> bool:
    """
    Browse search rejects some ``fieldgroups`` when ``category_ids`` lists
    multiple categories. Allow ``FULL`` / ``EXTENDED`` when omitted or a single id.
    """
    if category_ids_query_value is None:
        return True
    parts = [p for p in category_ids_query_value.split(",") if p.strip()]
    return len(parts) <= 1


def browse_item_url(item_id: str) -> str:
    """REST URL for ``GET /buy/browse/v1/item/{item_id}`` (path segment URL-encoded)."""
    return f"{BROWSE_ITEM_ROOT}/{quote(item_id, safe='')}"


def fetch_item_specifics(
    item_id: str,
    token: str,
    *,
    marketplace_id: str = "EBAY_US",
    timeout: float = 30.0,
) -> list[dict[str, str]]:
    """
    Load ``localizedAspects`` from Browse ``getItem`` (name / value / type).

    Search summaries do not include full item specifics; this is a separate call.
    """
    if not (item_id or "").strip():
        return []
    headers = {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": marketplace_id,
        "Accept-Encoding": "gzip",
    }
    r = requests.get(browse_item_url(item_id), headers=headers, timeout=timeout)
    r.raise_for_status()
    raw = r.json().get("localizedAspects") or []
    out: list[dict[str, str]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        name = row.get("name")
        val = row.get("value")
        if name is None and val is None:
            continue
        entry: dict[str, str] = {
            "name": str(name) if name is not None else "",
            "value": str(val) if val is not None else "",
        }
        t = row.get("type")
        if t is not None:
            entry["type"] = str(t)
        out.append(entry)
    return out


def find_competitor_listings(
    scott_number: str,
    subject: str,
    token: str,
    *,
    country: str | None = "US",
    category_ids: str | int | Sequence[str | int] | object = _AUTO_CATEGORY_IDS,
    limit: int = 5,
    marketplace_id: str = "EBAY_US",
    item_filter: str | None = None,
    sort: str | None = None,
    with_item_specifics: bool = False,
    exclude_multi_stamp: bool = True,
    prioritize_scv: bool = True,
    search_limit: int | None = None,
    consolidated_data: Path | None = None,
    quality_used: bool = False,
    aspect_filter: str | None = None,
    timeout: float = 30.0,
) -> list[dict]:
    """
    Search the Browse ``item_summary/search`` endpoint (production ebay.com).

    ``country`` + catalog number build ``q``: US → ``US Scott {num} …``; other
    countries → ``{country} {num} …`` (no ``Scott``), to align with web search.

    By default no ``filter`` or ``sort`` is sent (broad, like the main site). Pass
    ``item_filter`` e.g. ``buyingOptions:{FIXED_PRICE},conditions:{USED}`` to
    narrow to competitor-style listings.

    ``category_ids``: use default ``_AUTO_CATEGORY_IDS`` (omit this argument) to
    pick ``category_ids`` from ``ebay_category`` in ``consolidated_data`` for
    ``country``. Pass ``OMIT_CATEGORY_FILTER`` to omit the parameter. Otherwise
    pass a string, int, or sequence for explicit category id(s).

    Search uses ``fieldgroups=FULL,EXTENDED,MATCHING_ITEMS`` when allowed (all
    refinement containers plus extended item summary fields such as
    ``shortDescription``). Full item specifics
    (``localizedAspects``) are only on ``getItem``; set ``with_item_specifics``
    to true to merge them (one extra HTTP request per hit).

    By default, listings that look like multi-stamp lots are dropped
    (``exclude_multi_stamp``), hits mentioning SCV / Scott catalog value are
    listed first (``prioritize_scv``), and ``shipping_cost`` is taken from
    ``shippingOptions`` on each summary.

    Set ``quality_used`` to send ``aspect_filter=…,Quality:{Used}`` (Browse item
    aspect), which needs exactly one ``category_ids`` value. Pass ``aspect_filter``
    explicitly to filter on any aspect (same rules). ``item_filter`` remains for
    fields like ``conditions:{USED}`` (listing condition), which is separate
    from the **Quality** item specific on stamp categories.

    Returns a list of dicts with keys including title, item_id, price, url,
    condition, condition_id, short_description when present, and item_specifics
    when ``with_item_specifics`` is true.
    """
    cc = _norm_country(country)
    headers = {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": marketplace_id,
        "Accept-Encoding": "gzip",
    }

    query = _browse_search_q(cc, scott_number, subject, consolidated_path=consolidated_data)
    fetch_cap = search_limit if search_limit is not None else min(200, max(limit * 12, limit))
    fetch_cap = max(fetch_cap, limit)
    params: dict[str, str] = {
        "q": query,
        "limit": str(fetch_cap),
    }
    if item_filter:
        params["filter"] = item_filter
    if sort:
        params["sort"] = sort
    if category_ids is OMIT_CATEGORY_FILTER:
        cat_raw: str | int | Sequence[str | int] | None = None
    elif category_ids is _AUTO_CATEGORY_IDS:
        cat_raw = default_category_ids_for_country(cc, consolidated_path=consolidated_data)
    else:
        cat_raw = category_ids

    cat = _category_ids_param(cat_raw)
    if cat is not None:
        params["category_ids"] = cat
    if _search_allows_extended_fieldgroup(cat):
        params["fieldgroups"] = "FULL,EXTENDED,MATCHING_ITEMS"

    asp = (aspect_filter or "").strip() or None
    if asp is None and quality_used:
        asp = _browse_aspect_filter_quality_used(cat)
    if asp:
        params["aspect_filter"] = asp

    response = requests.get(
        BROWSE_SEARCH_URL,
        headers=headers,
        params=params,
        timeout=timeout,
    )

    response.raise_for_status()

    data = response.json()
    items = data.get("itemSummaries") or []
    out: list[dict] = []
    for i in items:
        price_block = i.get("price") or {}
        price_val = price_block.get("value")
        currency = price_block.get("currency")
        price = f"{price_val} {currency}".strip() if price_val else None
        title = i.get("title")
        short_desc = i.get("shortDescription")
        ship_cost, ship_type = _shipping_cost_from_summary(i)
        row: dict = {
            "title": title,
            "item_id": i.get("itemId"),
            "price": price,
            "url": i.get("itemWebUrl"),
            "shipping_cost": ship_cost,
            "shipping_cost_type": ship_type,
            "condition": i.get("condition"),
            "condition_id": i.get("conditionId"),
            "short_description": short_desc,
            "has_scv": _text_has_scv(
                title if isinstance(title, str) else None,
                short_desc if isinstance(short_desc, str) else None,
                "",
            ),
        }
        cats = i.get("categories")
        if isinstance(cats, list) and cats:
            row["categories"] = [
                {"id": c.get("categoryId"), "name": c.get("categoryName")}
                for c in cats
                if isinstance(c, dict)
            ]
        lids = i.get("leafCategoryIds")
        if isinstance(lids, list) and lids:
            row["leaf_category_ids"] = lids
        aspects = i.get("localizedAspects")
        if isinstance(aspects, list) and aspects:
            row["item_specifics"] = [
                {
                    "name": str(a.get("name", "")),
                    "value": str(a.get("value", "")),
                    **({"type": str(a["type"])} if a.get("type") is not None else {}),
                }
                for a in aspects
                if isinstance(a, dict)
            ]
        out.append(row)

    if exclude_multi_stamp:
        out = [
            r
            for r in out
            if not _is_probably_multi_stamp(
                r.get("title") if isinstance(r.get("title"), str) else None,
                r.get("short_description")
                if isinstance(r.get("short_description"), str)
                else None,
                scott_number,
            )
        ]

    if prioritize_scv:
        out.sort(
            key=lambda r: (
                0 if r.get("has_scv") else 1,
                0 if _scv_literal_in_title(r.get("title") if isinstance(r.get("title"), str) else None) else 1,
                (r.get("title") or "").lower(),
            )
        )

    out = out[:limit]

    if with_item_specifics:
        for row in out:
            iid = row.get("item_id")
            if not isinstance(iid, str) or not iid.strip():
                row["item_specifics"] = []
                continue
            try:
                specifics = fetch_item_specifics(
                    iid,
                    token,
                    marketplace_id=marketplace_id,
                    timeout=timeout,
                )
                row["item_specifics"] = specifics
                aspect_blob = " ".join(
                    f"{p.get('name', '')}:{p.get('value', '')}" for p in specifics
                )
                row["has_scv"] = _text_has_scv(
                    row.get("title") if isinstance(row.get("title"), str) else None,
                    row.get("short_description")
                    if isinstance(row.get("short_description"), str)
                    else None,
                    aspect_blob,
                )
            except requests.RequestException:
                row["item_specifics"] = []
        if prioritize_scv:
            out.sort(
                key=lambda r: (
                    0 if r.get("has_scv") else 1,
                    0 if _scv_literal_in_title(r.get("title") if isinstance(r.get("title"), str) else None) else 1,
                    (r.get("title") or "").lower(),
                )
            )

    return out


def _summaries_for_llm(items: list[dict]) -> list[str]:
    """Legacy-style one-line strings for prompts."""
    lines = []
    for i in items:
        t = i.get("title") or ""
        lines.append(f"Title: {t}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description="Search eBay for Scott + subject listings.")
    parser.add_argument("scott", help="Scott catalog number (e.g. 156)")
    parser.add_argument("subject", nargs="?", default="", help="Extra search words (optional)")
    parser.add_argument(
        "--country",
        default="US",
        metavar="CC",
        help="Country prefix in the search query (default: US; empty → US)",
    )
    parser.add_argument(
        "--token-file",
        type=Path,
        default=DEFAULT_TOKEN_FILE,
        help=f"Path to token.txt (default: {DEFAULT_TOKEN_FILE})",
    )
    parser.add_argument("--limit", type=int, default=5, help="Max results (default 5)")
    parser.add_argument(
        "--category-id",
        action="append",
        dest="category_ids",
        metavar="ID",
        help=(
            "eBay category ID(s); repeat for multiple. "
            "Default: ``ebay_category`` from consolidated data for --country "
            f"(see {DEFAULT_CONSOLIDATED_DATA})."
        ),
    )
    parser.add_argument(
        "--all-categories",
        action="store_true",
        help="Omit category_ids (do not restrict to a stamps leaf category).",
    )
    parser.add_argument(
        "--quality-used",
        action="store_true",
        help=(
            "Set Browse aspect_filter to item specific Quality:{Used} (requires "
            "exactly one --category-id or a single consolidated ebay_category). "
            "See eBay Browse aspect_filter; use --aspect-filter for other aspects."
        ),
    )
    parser.add_argument(
        "--aspect-filter",
        default=None,
        metavar="EXPR",
        help=(
            "Raw Browse aspect_filter (e.g. categoryId:47171,Grade:{F/VF (Fine/Very Fine)}). "
            "Overrides --quality-used when both are set."
        ),
    )
    parser.add_argument(
        "--filter",
        dest="item_filter",
        default=None,
        metavar="EXPR",
        help=(
            "Browse API filter expression. Example (narrow): "
            "buyingOptions:{FIXED_PRICE},conditions:{USED}. Default: none."
        ),
    )
    parser.add_argument(
        "--sort",
        default=None,
        metavar="KEY",
        help="Browse API sort (e.g. newlyListed). Default: none (API default).",
    )
    parser.add_argument(
        "--with-item-specifics",
        action="store_true",
        help=(
            "For each hit, call getItem and add item_specifics (localizedAspects). "
            "One extra API request per listing; search alone does not return them."
        ),
    )
    parser.add_argument(
        "--include-multi-stamp",
        action="store_true",
        help="Keep listings that look like lots or multiple catalog numbers (default: exclude them).",
    )
    parser.add_argument(
        "--no-scv-priority",
        action="store_true",
        help="Do not sort SCV / Scott catalog value mentions ahead of other hits (default: prioritize).",
    )
    parser.add_argument(
        "--search-limit",
        type=int,
        default=None,
        metavar="N",
        help="Raw Browse limit before multi-stamp filter (default: min(200, max(12*limit, limit))).",
    )
    parser.add_argument(
        "--consolidated-data",
        type=Path,
        default=None,
        metavar="PATH",
        help=(
            "xFrame consolidated_data.json for country ebay_category defaults "
            f"(default: {DEFAULT_CONSOLIDATED_DATA})."
        ),
    )
    parser.add_argument(
        "--format",
        choices=("json", "lines"),
        default="json",
        help="json: full objects; lines: Title: ... only",
    )
    args = parser.parse_args()

    try:
        token = load_ebay_token(args.token_file)
    except (OSError, ValueError) as e:
        print(str(e), file=sys.stderr)
        return 1

    if args.all_categories:
        cat_arg: object = OMIT_CATEGORY_FILTER
    elif args.category_ids:
        cat_arg = args.category_ids
    else:
        cat_arg = _AUTO_CATEGORY_IDS

    try:
        items = find_competitor_listings(
            args.scott,
            args.subject,
            token,
            country=args.country,
            category_ids=cat_arg,
            limit=args.limit,
            item_filter=args.item_filter,
            sort=args.sort,
            with_item_specifics=args.with_item_specifics,
            exclude_multi_stamp=not args.include_multi_stamp,
            prioritize_scv=not args.no_scv_priority,
            search_limit=args.search_limit,
            consolidated_data=args.consolidated_data,
            quality_used=args.quality_used,
            aspect_filter=args.aspect_filter,
        )
    except requests.HTTPError as e:
        print(str(e), file=sys.stderr)
        if e.response is not None:
            r = e.response
            print(f"Status: {r.status_code}\n{(r.text or '')[:800]}", file=sys.stderr)
        return 2
    except requests.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        return 2

    if args.format == "json":
        print(json.dumps(items, indent=2))
    else:
        for line in _summaries_for_llm(items):
            print(line)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

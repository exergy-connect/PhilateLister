#!/usr/bin/env python3
"""
Fill `aps/Submission Form-Stamps Fillable.pdf` (or a compatible template) from a
PhilateLister-style listing JSON (xFrame export: top-level `stamp` array, optional
`country`, `catalog_system`, `stamp_catalog_number`).

Dependencies (from repo root):
  python3 -m venv .venv
  .venv/bin/pip install -r aps/requirements-pdf.txt

Stamp images: `image_basename` is resolved next to the listing JSON, then `uploads/`, then
`listings/` under the repo root, and drawn into the black placeholder on page 1 (coordinates
match `aps/Submission Form-Stamps Fillable.pdf` only).

Example:
  .venv/bin/python aps/fill_submission_form.py \\
    listings/stamp_2026-04-13_19-15-08-561_image_00dec819.json \\
    -o /tmp/submission_filled.pdf
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path
from typing import Any

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.constants import PageAttributes as PG
    from pypdf.generic import NameObject
except ImportError as e:
    print("Missing dependency: install with pip install -r aps/requirements-pdf.txt", file=sys.stderr)
    raise SystemExit(1) from e

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None  # type: ignore[misc, assignment]

# AcroForm field names in aps/Submission Form-Stamps Fillable.pdf
F_COUNTRY = "Country"
F_SCOTT = "Scott Cat"
F_DESC1 = "Description 1"
F_DESC2 = "Description 2"
F_DESC3 = "Description 3"
F_SELLER_SKU = "Seller Item No sellers use only not published"
F_OTHER_CAT = "Other Catalogue Name"
F_CONDITION = "Condition"
F_CONDITION_USED = "Condition 1"
F_CONFIGURATION = "Configuration"

APS_DIR = Path(__file__).resolve().parent
REPO_ROOT = APS_DIR.parent

DEFAULT_TEMPLATE = APS_DIR / "Submission Form-Stamps Fillable.pdf"

# Black stamp-photo placeholder on page 1 of DEFAULT_TEMPLATE (PyMuPDF top-left coords).
STAMP_PLACEHOLDER_RECT = (83.7, 79.0, 590.0, 385.0)

# stamp.condition_quality -> (Condition 1 export, Condition gum export or None)
_CONDITION_MAP: dict[str, tuple[str | None, str | None]] = {
    "mint_never_hinged": ("/Unused", "/NH"),
    "mint_hinged": ("/Unused", "/H"),
    "mint_no_gum": ("/Unused", "/NG"),
    "mint_disturbed_gum": ("/Unused", "/HR"),
    "used": ("/Used", None),
    "used_on_paper": ("/Used", None),
    "on_cover": ("/Used", None),
    "faulty": ("/Used", None),
    "unknown": (None, None),
}


def resolve_stamp_image_path(listing_json: Path, stamp: dict[str, Any]) -> Path | None:
    """Locate stamp image file from `image_basename` for the given listing path."""
    base = stamp.get("image_basename")
    if not base or not str(base).strip():
        return None
    name = str(base).strip()
    candidates = [
        listing_json.parent / name,
        REPO_ROOT / "uploads" / name,
        REPO_ROOT / "listings" / name,
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("Listing JSON must be a single object")
    return data


def country_display(data: dict[str, Any], country_id: str) -> str:
    for row in data.get("country") or []:
        if isinstance(row, dict) and row.get("country_id") == country_id:
            name = row.get("display_name")
            if name:
                return str(name)
    return country_id.upper() if country_id else ""


def format_scott(scott: dict[str, Any] | None) -> str:
    if not scott or not isinstance(scott, dict):
        return ""
    section = scott.get("section")
    num = scott.get("number")
    var = scott.get("variation")
    parts: list[str] = []
    if section is not None and str(section).strip() != "":
        parts.append(str(section).strip())
    if num is not None:
        parts.append(str(num))
    if var is not None and str(var).strip() != "":
        parts.append(str(var).strip())
    if parts:
        # e.g. O + 6 -> O6 for single-letter section + integer (common Scott style)
        if len(parts) == 2 and isinstance(section, str) and len(section) <= 2 and str(num).isdigit():
            return f"{section}{num}"
        return " ".join(parts)
    return ""


def other_catalog_lines(data: dict[str, Any], stamp_id: str) -> str:
    """Non-Scott supplemental catalog lines for 'Other Catalogue Name'."""
    systems = data.get("catalog_system") or []
    abbrev_name = {
        str(r.get("catalog_system_abbreviation")): str(r.get("name") or r.get("catalog_system_abbreviation") or "")
        for r in systems
        if isinstance(r, dict) and r.get("catalog_system_abbreviation")
    }
    bits: list[str] = []
    for row in data.get("stamp_catalog_number") or []:
        if not isinstance(row, dict) or row.get("stamp_id") != stamp_id:
            continue
        ab = str(row.get("catalog_system_abbreviation") or "")
        if ab.upper() in ("SC",):
            continue
        label = abbrev_name.get(ab, ab)
        num = row.get("catalog_number")
        if num is not None and str(num).strip():
            bits.append(f"{label}: {num}")
    return "; ".join(bits)


def split_description(title: str, summary: str, max_len: int = 900) -> tuple[str, str, str]:
    """Spread title + summary across three PDF text fields."""
    chunks: list[str] = []
    if title.strip():
        chunks.append(title.strip())
    if summary.strip():
        chunks.append(summary.strip())
    combined = "\n\n".join(chunks)
    if len(combined) <= max_len:
        return combined, "", ""
    # Prefer filling field 1, then 2, then 3
    parts: list[str] = ["", "", ""]
    remaining = combined
    for i in range(3):
        if not remaining:
            break
        parts[i] = remaining[:max_len]
        remaining = remaining[max_len:].lstrip()
    return parts[0], parts[1], parts[2]


def configuration_value(stamp_count: int) -> str:
    if stamp_count <= 1:
        return "/Single"
    return "/Multiple"


def condition_fields(stamp: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    cq = stamp.get("condition_quality")
    if not isinstance(cq, str):
        return out
    used_state, gum_state = _CONDITION_MAP.get(cq, (None, None))
    if used_state:
        out[F_CONDITION_USED] = used_state
    if gum_state:
        out[F_CONDITION] = gum_state
    return out


def pick_stamp(data: dict[str, Any], index: int | None) -> dict[str, Any]:
    stamps = data.get("stamp")
    if not isinstance(stamps, list) or not stamps:
        raise ValueError("Listing JSON has no stamp[] array")
    if index is None:
        index = 0
    if index < 0 or index >= len(stamps):
        raise IndexError(f"stamp index {index} out of range (0..{len(stamps) - 1})")
    st = stamps[index]
    if not isinstance(st, dict):
        raise TypeError("stamp[] entries must be objects")
    return st


def build_form_values(
    data: dict[str, Any],
    stamp: dict[str, Any],
    *,
    stamp_count: int,
    stamp_index: int,
) -> dict[str, str]:
    cid = str(stamp.get("country_id") or "")
    values: dict[str, str] = {
        F_COUNTRY: country_display(data, cid),
        F_SCOTT: format_scott(stamp.get("scott") if isinstance(stamp.get("scott"), dict) else None),
        F_SELLER_SKU: str(stamp.get("stamp_id") or ""),
        F_OTHER_CAT: other_catalog_lines(data, str(stamp.get("stamp_id") or "")),
        F_CONFIGURATION: configuration_value(stamp_count),
    }
    d1, d2, d3 = split_description(
        str(stamp.get("title") or ""),
        str(stamp.get("summary") or ""),
    )
    values[F_DESC1] = d1
    values[F_DESC2] = d2
    values[F_DESC3] = d3
    if stamp_index > 0 and not values[F_DESC3]:
        values[F_DESC3] = (
            f"(Stamp {stamp_index + 1} of {stamp_count} in file - see Description 1-2.)"
        )
    values.update(condition_fields(stamp))
    # Optional: tuck centering into spare description line
    cg = stamp.get("centering_grade")
    if cg and not values[F_DESC3]:
        values[F_DESC3] = f"Centering (schema): {cg}"
    return values


def _coerce_pdf_name(value: Any) -> NameObject:
    """Radio/checkbox values in PDF must be Name objects (e.g. /Used), not text strings."""
    if isinstance(value, NameObject):
        return value
    s = str(value).strip()
    if not s.startswith("/"):
        s = "/" + s
    return NameObject(s)


def _fix_acroform_button_appearances(writer: PdfWriter) -> None:
    """
    pypdf's update_page_form_field_values sets /Btn parent /V as TextStringObject; Acrobat,
    Preview, and many viewers only tick radios when /V is a Name and each kid's /AS matches
    an entry in that widget's appearance /N dictionary.
    """
    for page in writer.pages:
        annots = page.get(PG.ANNOTS)
        if not annots:
            continue

        btn_parents: dict[int, Any] = {}
        widgets: list[Any] = []
        for aref in annots:
            ann = aref.get_object()
            if ann.get("/Subtype") != "/Widget":
                continue
            parent = ann.get("/Parent")
            if not parent:
                continue
            po = parent.get_object()
            if po.get("/FT") != "/Btn":
                continue
            widgets.append(ann)
            btn_parents[id(po)] = po

        for po in btn_parents.values():
            pv = po.get("/V")
            if pv is not None:
                po[NameObject("/V")] = _coerce_pdf_name(pv)

        for ann in widgets:
            po = ann["/Parent"].get_object()
            pv = po.get("/V")
            if pv is None:
                continue
            choice = _coerce_pdf_name(pv)
            ap = ann.get("/AP")
            if not ap:
                continue
            ap = ap.get_object() if hasattr(ap, "get_object") else ap
            n_dict = ap.get("/N")
            if not n_dict:
                continue
            n_dict = n_dict.get_object() if hasattr(n_dict, "get_object") else n_dict
            if choice in n_dict:
                ann[NameObject("/AS")] = choice
            else:
                ann[NameObject("/AS")] = NameObject("/Off")
            # Radio children should not carry a separate /V (only /AS).
            if "/T" not in ann and NameObject("/V") in ann:
                del ann[NameObject("/V")]


def fill_pdf(
    template: Path,
    values: dict[str, str],
    output: Path,
    *,
    stamp_image_path: Path | None = None,
) -> None:
    reader = PdfReader(str(template))
    writer = PdfWriter()
    writer.append(reader)
    # Only keys that exist on the form (skip empty strings if desired)
    cleaned = {k: v for k, v in values.items() if v is not None and v != ""}
    for page in writer.pages:
        writer.update_page_form_field_values(page, cleaned, auto_regenerate=True)
    _fix_acroform_button_appearances(writer)
    output.parent.mkdir(parents=True, exist_ok=True)

    use_image = stamp_image_path is not None and stamp_image_path.is_file()
    if use_image and fitz is None:
        print("Warning: pymupdf not installed; output PDF has no stamp image.", file=sys.stderr)
        use_image = False

    if use_image:
        buffer = io.BytesIO()
        writer.write(buffer)
        buffer.seek(0)
        doc = fitz.open(stream=buffer.read(), filetype="pdf")
        try:
            rect = fitz.Rect(*STAMP_PLACEHOLDER_RECT)
            doc[0].insert_image(
                rect,
                filename=str(stamp_image_path),
                keep_proportion=True,
                overlay=True,
                alpha=0,
            )
            doc.save(str(output))
        finally:
            doc.close()
    else:
        with output.open("wb") as f:
            writer.write(f)


def cmd_list_fields(template: Path) -> None:
    reader = PdfReader(str(template))
    fields = reader.get_fields()
    if not fields:
        print("No AcroForm fields found.")
        return
    for name in sorted(fields.keys()):
        f = fields[name]
        ft = f.get("/FT") if f else None
        print(f"{name}\t{ft}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Fill Submission Form PDF from listing JSON.")
    p.add_argument(
        "listing_json",
        nargs="?",
        type=Path,
        help="Path to listing .json (PhilateLister / xFrame shape)",
    )
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output PDF path (default: <listing_stem>_submission.pdf next to input)",
    )
    p.add_argument(
        "-t",
        "--template",
        type=Path,
        default=DEFAULT_TEMPLATE,
        help=f"Fillable PDF template (default: {DEFAULT_TEMPLATE})",
    )
    p.add_argument(
        "-n",
        "--stamp-index",
        type=int,
        default=0,
        help="0-based index into stamp[] when the file lists multiple stamps (default: 0)",
    )
    p.add_argument(
        "--list-fields",
        action="store_true",
        help="Print AcroForm field names from the template and exit",
    )
    p.add_argument(
        "--image",
        type=Path,
        default=None,
        help="Override stamp image path (default: resolve from stamp.image_basename)",
    )
    p.add_argument(
        "--no-image",
        action="store_true",
        help="Do not embed a stamp image on the form",
    )
    args = p.parse_args(argv)

    template = args.template.resolve()
    if not template.is_file():
        print(f"Template not found: {template}", file=sys.stderr)
        return 1

    if args.list_fields:
        cmd_list_fields(template)
        return 0

    if not args.listing_json:
        p.error("listing_json is required unless --list-fields is set")

    listing_path = args.listing_json.resolve()
    if not listing_path.is_file():
        print(f"Listing not found: {listing_path}", file=sys.stderr)
        return 1

    data = load_json(listing_path)
    stamps = data.get("stamp")
    stamp_count = len(stamps) if isinstance(stamps, list) else 0
    stamp = pick_stamp(data, args.stamp_index)
    values = build_form_values(data, stamp, stamp_count=stamp_count, stamp_index=args.stamp_index)

    out = args.output
    if out is None:
        out = listing_path.with_name(f"{listing_path.stem}_submission.pdf")

    img: Path | None = None
    if not args.no_image:
        if args.image is not None:
            img = args.image.resolve()
            if not img.is_file():
                print(f"Image not found: {img}", file=sys.stderr)
                return 1
        else:
            img = resolve_stamp_image_path(listing_path, stamp)
            if img is None and stamp.get("image_basename"):
                print(
                    f"Warning: image_basename {stamp.get('image_basename')!r} not found on disk.",
                    file=sys.stderr,
                )

    fill_pdf(template, values, out.resolve(), stamp_image_path=img)
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

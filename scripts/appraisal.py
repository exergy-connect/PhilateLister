#!/usr/bin/env python3
"""Generate an eBay-oriented stamp listing via Gemini from a local image path (e.g. CI)."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3-flash")


def parse_philatelister_commit(message: str | None) -> dict[str, Any]:
    """Parse index.html upload commits: 'PhilateLister upload: <file>\\n\\n{...json}'."""
    raw = (message or "").strip()
    out: dict[str, Any] = {"raw": message or "", "first_line": "", "meta": {}}
    if not raw:
        return out
    if "\n\n" in raw:
        first, rest = raw.split("\n\n", 1)
        out["first_line"] = first.strip()
        try:
            out["meta"] = json.loads(rest.strip())
        except json.JSONDecodeError:
            out["meta"] = {}
    else:
        out["first_line"] = raw
    return out


def build_gemini_prompt(image_basename: str, parsed: dict[str, Any]) -> str:
    meta = parsed.get("meta") or {}
    first_line = parsed.get("first_line") or ""
    meta_json = json.dumps(meta, indent=2, ensure_ascii=False)

    target = meta.get("targetPrice")
    notes = meta.get("notes")
    file_meta = meta.get("file")

    mismatch = ""
    if file_meta and file_meta != image_basename:
        mismatch = (
            f"\nNote: Commit metadata file field is {file_meta!r} but this run is for "
            f"{image_basename!r}; still apply target price and notes if they are relevant.\n"
        )

    return f"""You are helping a stamp dealer prepare an eBay listing for this upload.

Image file name: {image_basename}
{mismatch}
Commit summary line (from uploader):
{first_line if first_line else "(none)"}

Full structured parameters from the upload form (JSON — use every field that helps identification or listing copy):
{meta_json}

Dealer target listing price (use as pricing context; do not invent a Scott value): {json.dumps(target)}
Dealer notes and hints (incorporate into identification and description): {json.dumps(notes)}

From the stamp image, identify the issue where possible. Provide:
- A concise eBay title
- Scott or main catalog number when you can justify it, or say when uncertain
- A condition report visible from the image
- Details on the cancel, if any, such as city name or date of cancellation
- Listing body text that respects the dealer's notes and is consistent with their target price band (polite, professional tone)"""


def _guess_mime(path: Path) -> str:
    mime, _ = mimetypes.guess_type(path.name)
    if mime and mime.startswith("image/"):
        return mime
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "image/jpeg")


def _response_text(response) -> str:
    t = getattr(response, "text", None)
    if t:
        return t
    parts = []
    if response.candidates:
        for c in response.candidates:
            content = getattr(c, "content", None)
            if not content or not getattr(content, "parts", None):
                continue
            for p in content.parts:
                if getattr(p, "text", None):
                    parts.append(p.text)
    return "\n".join(parts) if parts else ""


def run_appraisal(image_path: str, commit_message: str | None = None) -> None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: GEMINI_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    path = Path(image_path)
    if not path.is_file():
        print(f"Error: File {image_path} not found.", file=sys.stderr)
        sys.exit(1)

    parsed = parse_philatelister_commit(commit_message)
    prompt = build_gemini_prompt(path.name, parsed)

    client = genai.Client(api_key=api_key)
    img_bytes = path.read_bytes()
    mime = _guess_mime(path)

    response = client.models.generate_content(
        model=DEFAULT_MODEL,
        contents=[
            types.Part.from_bytes(data=img_bytes, mime_type=mime),
            prompt,
        ],
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.HIGH
            )
        ),
    )

    text = _response_text(response)
    if not text.strip():
        print("Error: Empty model response.", file=sys.stderr)
        sys.exit(1)

    base_name = path.stem
    listings = Path("listings")
    listings.mkdir(parents=True, exist_ok=True)
    out_path = listings / f"{base_name}.txt"
    out_path.write_text(text, encoding="utf-8")
    print(f"Listing created: {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Gemini stamp appraisal; pass PhilateLister commit message for dealer context."
    )
    parser.add_argument("image_path", help="Path to the stamp image under uploads/")
    parser.add_argument(
        "--commit-message",
        default=os.environ.get("COMMIT_MESSAGE"),
        metavar="TEXT",
        help="Full head commit message (default: COMMIT_MESSAGE env)",
    )
    args = parser.parse_args()
    run_appraisal(args.image_path, args.commit_message or "")


if __name__ == "__main__":
    main()

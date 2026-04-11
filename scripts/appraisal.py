#!/usr/bin/env python3
"""Generate an eBay-oriented stamp listing via Gemini from a local image path (e.g. CI)."""

from __future__ import annotations

import argparse
import functools
import json
import mimetypes
import os
import re
import sys
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

_REPO_ROOT = Path(__file__).resolve().parent.parent
_CONSOLIDATED_SCHEMA_PATH = _REPO_ROOT / "xframe" / "output" / "consolidated.schema.json"
# Basename for prompts/<id>.json only (no path segments).
_PROMPT_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$")


def prompt_id_from_meta(meta: dict[str, Any]) -> str:
    raw = str(meta.get("prompt") or "").strip()
    if not raw:
        return "stamp_listing"
    if not _PROMPT_ID_RE.fullmatch(raw):
        raise ValueError(f"Invalid prompt id in commit metadata: {raw!r}")
    return raw


@functools.lru_cache(maxsize=16)
def _load_prompt_pack(prompt_basename: str) -> tuple[str, str]:
    """Return (preferred_model, template) from prompts/<basename>.json."""
    if not _PROMPT_ID_RE.fullmatch(prompt_basename):
        raise ValueError(f"Invalid prompt id: {prompt_basename!r}")
    path = _REPO_ROOT / "prompts" / f"{prompt_basename}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Missing prompt template: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    model = str(data.get("preferred_model") or "gemini-3-flash-preview").strip()
    if "template_lines" in data:
        lines = data["template_lines"]
        if not isinstance(lines, list):
            raise TypeError("template_lines must be a JSON array of strings")
        template = "\n".join(str(line) for line in lines)
    elif "template" in data:
        template = str(data["template"])
    else:
        raise KeyError(f"{path} needs template_lines or template")
    return model, template


def generate_config_for_model(model: str) -> types.GenerateContentConfig | None:
    """thinking_level applies to Gemini 3.x; 2.5 models reject it."""
    if "gemini-3" not in model.lower():
        return None
    return types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(
            thinking_level=types.ThinkingLevel.HIGH
        )
    )


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


def _file_mismatch_gap(image_basename: str, meta: dict[str, Any]) -> str:
    """Blank line vs. note when commit metadata file field does not match this image."""
    file_meta = meta.get("file")
    if file_meta and file_meta != image_basename:
        return (
            "\nNote: Commit metadata file field is "
            f"{file_meta!r} but this run is for {image_basename!r}; "
            "still apply target price and notes if they are relevant.\n"
        )
    return "\n"


def _consolidated_schema_json_for_prompt() -> str:
    """Pretty-printed consolidated.schema.json for xFrame catalog prompts."""
    if not _CONSOLIDATED_SCHEMA_PATH.is_file():
        raise FileNotFoundError(
            f"Missing {_CONSOLIDATED_SCHEMA_PATH}; run the TypeScript xFrame consolidator "
            f"with --working-dir pointing at this repo's xframe/ directory first."
        )
    raw = _CONSOLIDATED_SCHEMA_PATH.read_text(encoding="utf-8")
    try:
        return json.dumps(json.loads(raw), indent=2, ensure_ascii=False)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in {_CONSOLIDATED_SCHEMA_PATH}: {exc}") from exc


def build_gemini_prompt(image_basename: str, parsed: dict[str, Any]) -> str:
    meta = parsed.get("meta") or {}
    prompt_id = prompt_id_from_meta(meta)
    _, template = _load_prompt_pack(prompt_id)
    first_line = parsed.get("first_line") or ""
    meta_json = json.dumps(meta, indent=2, ensure_ascii=False)
    target = meta.get("targetPrice")
    notes = meta.get("notes")
    gap = _file_mismatch_gap(image_basename, meta)
    first_display = first_line if first_line else "(none)"
    stamp_suggested_id = Path(image_basename).stem

    text = template
    if "__CONSOLIDATED_SCHEMA_JSON__" in text:
        text = text.replace("__CONSOLIDATED_SCHEMA_JSON__", _consolidated_schema_json_for_prompt())
    text = text.replace("__IMAGE_BASENAME__", image_basename)
    text = text.replace("__FILE_MISMATCH_GAP__", gap)
    text = text.replace("__FIRST_LINE__", first_display)
    text = text.replace("__META_JSON__", meta_json)
    text = text.replace("__TARGET_JSON__", json.dumps(target))
    text = text.replace("__NOTES_JSON__", json.dumps(notes))
    text = text.replace("__STAMP_SUGGESTED_ID__", stamp_suggested_id)
    return text


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


def _strip_markdown_json_fence(text: str) -> str:
    """Remove optional ``` / ```json fences from model output."""
    t = text.strip()
    if not t.startswith("```"):
        return t
    lines = t.split("\n")
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


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
    try:
        prompt = build_gemini_prompt(path.name, parsed)
    except (ValueError, FileNotFoundError, KeyError, TypeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    img_bytes = path.read_bytes()
    mime = _guess_mime(path)

    meta = parsed.get("meta") or {}
    prompt_id = prompt_id_from_meta(meta)
    preferred_model, _ = _load_prompt_pack(prompt_id)
    model = (os.environ.get("GEMINI_MODEL") or "").strip() or preferred_model
    gen_cfg = generate_config_for_model(model)
    gen_kwargs: dict[str, Any] = {
        "model": model,
        "contents": [
            types.Part.from_bytes(data=img_bytes, mime_type=mime),
            prompt,
        ],
    }
    if gen_cfg is not None:
        gen_kwargs["config"] = gen_cfg

    response = client.models.generate_content(**gen_kwargs)

    text = _response_text(response)
    if not text.strip():
        print("Error: Empty model response.", file=sys.stderr)
        sys.exit(1)

    base_name = path.stem
    listings = Path("listings")
    listings.mkdir(parents=True, exist_ok=True)
    if prompt_id == "xframe":
        body = _strip_markdown_json_fence(text)
        try:
            parsed_json = json.loads(body)
        except json.JSONDecodeError as exc:
            print(f"Warning: model output is not valid JSON ({exc}); writing raw text.", file=sys.stderr)
            out_path = listings / f"{base_name}.json"
            out_path.write_text(body, encoding="utf-8")
        else:
            out_path = listings / f"{base_name}.json"
            out_path.write_text(
                json.dumps(parsed_json, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        print(f"xFrame catalog JSON written: {out_path}")
    else:
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

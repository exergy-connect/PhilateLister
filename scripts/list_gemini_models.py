#!/usr/bin/env python3
"""List Gemini models available to your API key (requires GEMINI_API_KEY)."""

from __future__ import annotations

import os
import sys

from google import genai


def main() -> None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Set GEMINI_API_KEY in the environment.", file=sys.stderr)
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    print(f"{'model id (use with generate_content)':<50} {'display_name':<30} supported_actions")
    print("-" * 120)

    for model in client.models.list():
        name = (model.name or "").removeprefix("models/")
        display = (model.display_name or "")[:28]
        actions = getattr(model, "supported_actions", None) or []
        actions_s = ",".join(str(a) for a in actions) if actions else ""
        print(f"{name:<50} {display:<30} {actions_s}")


if __name__ == "__main__":
    main()

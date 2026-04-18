#!/usr/bin/env python3
"""Rewrite cert_templates.js from psag_cert_*_template.png (run after editing templates)."""

from __future__ import annotations

import base64
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent
    pairs = [
        ("large", "psag_cert_large_template.png"),
        ("small", "psag_cert_small_template.png"),
    ]
    lines = [
        "/** Embedded PSAG certificate templates so canvas export works on file:// (avoids tainted canvas). */",
        "/** Regenerate: python3 regenerate_cert_templates.py */",
        "window.TEMPLATE_DATA_URLS = {",
    ]
    for key, fname in pairs:
        data = (root / fname).read_bytes()
        b64 = base64.standard_b64encode(data).decode("ascii")
        lines.append(f'  {key}: "data:image/png;base64,{b64}",')
    lines.append("};")
    out = root / "cert_templates.js"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

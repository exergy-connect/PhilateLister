#!/usr/bin/env bash
#   ./consolidate.sh china
set -euo pipefail
cd "$(dirname "$0")"

country="${1:-}"
if [[ -z "$country" ]]; then
  echo "usage: $0 <country>" >&2
  exit 1
fi
shift || true

exec xform consolidate.xp --final xp --with "country=${country}" "$@"

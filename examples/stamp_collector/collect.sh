#!/usr/bin/env bash
#   ./collect.sh china
#   ./collect.sh china --refresh
set -euo pipefail
cd "$(dirname "$0")"

refresh=false
country=""
extra=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --refresh) refresh=true; shift ;;
    -h|--help)
      echo "usage: $0 <country> [--refresh] [xform args...]" >&2
      exit 0
      ;;
    *)
      if [[ -z "$country" && "$1" != --* ]]; then country="$1"
      else extra+=("$1"); fi
      shift
      ;;
  esac
done

if [[ -z "$country" ]]; then
  echo "usage: $0 <country> [--refresh] [xform args...]" >&2
  exit 1
fi

args=(stamp_collector.xp --final json --auto-approve --with "country=${country}")
[[ "$refresh" == true ]] && args+=(--with refresh=true)
[[ ${#extra[@]} -gt 0 ]] && args+=("${extra[@]}")
exec xform "${args[@]}"

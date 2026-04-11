#!/usr/bin/env bash
# Create remote branch stamp-data from the repo default branch so the upload form
# can commit there. That keeps GitHub Pages (usually built from main) from
# rebuilding on every stamp upload.
set -euo pipefail
git fetch origin
default=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)
if git show-ref --verify --quiet "refs/remotes/origin/stamp-data"; then
  echo "Remote branch stamp-data already exists."
  exit 0
fi
git branch stamp-data "origin/${default}"
git push -u origin stamp-data
echo "Pushed stamp-data from origin/${default}. Set philatelister-branch to stamp-data in index.html (default in repo)."

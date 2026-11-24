#!/usr/bin/env bash
# Build the static editor and publish it as the gh-pages branch (GitHub Pages source).
# gh-pages holds build output only; each deploy replaces it (force push), source history stays on main.
set -euo pipefail
cd "$(dirname "$0")/.."
out=.cache/pages
bun scripts/build-pages.ts "$out"
rev=$(git rev-parse --short HEAD)
remote=$(git remote get-url origin)
cd "$out"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy editor from ${rev}"
git push -q -f "$remote" gh-pages
echo "pushed gh-pages (${rev})"

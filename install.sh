#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$repo_root"

command -v node >/dev/null 2>&1 || { echo "Node.js 22.13+ is required." >&2; exit 1; }

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) { console.error(`Node.js 22.13+ is required; found ${process.version}.`); process.exit(1); }'

# Prefer pnpm on PATH; Corepack is only a fallback because Node.js 25+ no longer bundles it.
if command -v pnpm >/dev/null 2>&1; then
  pnpm=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  pnpm=(corepack pnpm)
else
  pinned="$(node -p 'require("./package.json").packageManager.split("+")[0]')"
  echo "pnpm is required. Install it once with: npm install -g $pinned" >&2
  exit 1
fi

echo "Installing Screenshot Studio dependencies..."
"${pnpm[@]}" install --frozen-lockfile

echo "Checking the Chromium builds used for screenshot export..."
"${pnpm[@]}" exec playwright install chromium chromium-headless-shell

echo "Screenshot Studio is ready."

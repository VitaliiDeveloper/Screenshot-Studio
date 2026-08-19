#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$repo_root"

command -v node >/dev/null 2>&1 || { echo "Node.js 22.13+ is required." >&2; exit 1; }
command -v corepack >/dev/null 2>&1 || { echo "Corepack is required." >&2; exit 1; }

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) { console.error(`Node.js 22.13+ is required; found ${process.version}.`); process.exit(1); }'

echo "Installing Screenshot Studio dependencies..."
corepack pnpm install --frozen-lockfile

echo "Installing the Chromium builds used for screenshot export..."
corepack pnpm exec playwright install chromium chromium-headless-shell

echo "Screenshot Studio is ready."

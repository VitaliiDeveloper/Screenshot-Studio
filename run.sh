#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$repo_root"

echo "Cleaning generated caches..."
"$repo_root/clean.sh"

"$repo_root/install.sh"

echo "Starting Screenshot Studio at http://localhost:3000 ..."
exec corepack pnpm dev

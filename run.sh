#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$repo_root"

echo "Cleaning generated caches..."
"$repo_root/clean.sh"

"$repo_root/install.sh"

echo "Starting Screenshot Studio at http://localhost:3000 ..."
# Call the web package directly: the root "dev" script shells out to a bare `pnpm`,
# which is not on PATH unless the contributor ran `corepack enable`.
exec corepack pnpm --filter @screenshot-studio/web dev

#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

# Sourced to reuse the pnpm command it resolves; it is a quick no-op when nothing changed.
source "$repo_root/install.sh"

echo "Starting Screenshot Studio at http://localhost:3000 ..."
# Call the web package directly: the root "dev" script shells out to a bare `pnpm`,
# which is not on PATH when pnpm comes from Corepack.
exec "${pnpm[@]}" --filter @screenshot-studio/web dev

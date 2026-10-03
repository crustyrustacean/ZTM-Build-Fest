#!/usr/bin/env sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$project_root/build-wasm.sh"
printf '%s\n' 'WASM build succeeded.'
printf '%s\n' 'Serving Kin at http://localhost:8000. Press Ctrl+C to stop.'
exec node "$project_root/server/server.mjs"
